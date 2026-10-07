import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { app, nativeImage } from 'electron'
import { collectBackgroundImages } from '../main/background'
import { configFilePath } from '../main/config'
import { parseIni } from '../main/ini'
import { logger } from '../main/logger'
import {
  cropForViewport,
  emptyRegion,
  VisualRegionDetector,
  type Size,
  type VisualRegion
} from '../main/visual-region-detector'
import type { BackgroundRect } from '../shared/types'

// 与主程序背景轮播一致:10 秒轮换一张新背景
const ROTATION_INTERVAL_MS = 10000
// 请求等待 AI 检测的上限:超时先返回几何回退裁剪(响应头 X-Detection-Pending: 1),
// 检测继续在后台进行并缓存,客户端稍后重取即可拿到 AI 结果
const DETECTION_WAIT_TIMEOUT_MS = 15000
// 与主程序一致的默认视口;首个请求到来前用它预热当前图的检测
const DEFAULT_VIEWPORT: Size = { width: 1315, height: 1000 }
const DEFAULT_PORT = 26925
const JPEG_QUALITY = 92
const MAX_ENCODE_CACHE_ENTRIES = 8

interface BackgroundSlot {
  generation: number
  path: string
  image: Electron.NativeImage
  size: Size
  /** 当前图在各视口尺寸下的 AI 检测结果(Python 的 background_crop 依赖视口比例,须按视口缓存) */
  regions: Map<string, VisualRegion>
  pending: Map<string, Promise<VisualRegion>>
}

interface EncodedImage {
  data: Buffer
  width: number
  height: number
}

function regionKey(viewport: Size): string {
  return `${viewport.width}x${viewport.height}`
}

function parsePositiveInt(raw: string | null): number | null {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 16384 ? parsed : null
}

/** 端口解析:NTEMM_BG_SERVER_PORT > 主程序 ini 的 [BgServer] port > 默认 26925 */
function resolvePort(): number {
  const fromEnv = Number.parseInt(process.env.NTEMM_BG_SERVER_PORT ?? '', 10)
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 65536) {
    return fromEnv
  }
  try {
    const configPath = configFilePath()
    if (existsSync(configPath)) {
      const fromIni = Number.parseInt(
        parseIni(readFileSync(configPath, 'utf-8')).BgServer?.port ?? '',
        10
      )
      if (Number.isFinite(fromIni) && fromIni > 0 && fromIni < 65536) {
        return fromIni
      }
    }
  } catch {
    // 配置不可读时按默认端口
  }
  return DEFAULT_PORT
}

/**
 * 无界面背景图服务(供其他 React+Electron 程序消费):
 * 沿用主程序 ini 的图库/模型设置,按 10 秒轮换持有「当前背景」,
 * HTTP 接口传入窗口尺寸,返回 AI 识别焦点处、按视口比例裁剪好的背景图,
 * 消费端可直接把返回的图片字节用作背景。
 */
class BackgroundService {
  private detector = new VisualRegionDetector()
  private server: Server | null = null
  private rotationTimer: NodeJS.Timeout | null = null
  private port = DEFAULT_PORT
  private images: string[] = []
  private current: BackgroundSlot | null = null
  private generation = 0
  private lastViewport: Size | null = null
  private encodeCache = new Map<string, EncodedImage>()
  private modelReady = false
  private warmupPromise: Promise<boolean> | null = null

  start(): void {
    this.port = resolvePort()
    void this.ensureWarmup()
    this.rotate()
    this.scheduleRotation()

    const server = createServer((request, response) => {
      void this.dispatch(request, response)
    })
    server.on('error', (error) => {
      // 端口被占用等监听失败时直接退出:静默存活却无法响应,比退出更难排查
      logger.error(`背景服务 HTTP 监听失败（端口 ${this.port}）：${error.message}`)
      app.quit()
    })
    server.listen(this.port, '127.0.0.1', () => {
      logger.info(
        `背景服务已监听 http://127.0.0.1:${this.port}/background?width=<宽>&height=<高>[&format=png][&meta=1]`
      )
    })
    this.server = server
  }

  async stop(): Promise<void> {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer)
      this.rotationTimer = null
    }
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await this.detector.dispose()
  }

  /** 立即重新收集图库并轮换(重复启动的第二个实例会触发此信号) */
  reloadNow(): void {
    logger.info('收到外部刷新信号，立即轮换背景')
    this.rotate()
    this.scheduleRotation()
  }

  /** 重新读取 ini 收集图库并随机换图;图库为空时清空当前图、暂停推送,轮换计时继续等目录恢复 */
  private rotate(): void {
    this.images = collectBackgroundImages()
    if (this.images.length === 0) {
      if (this.current) {
        this.current = null
        this.encodeCache.clear()
        logger.warning('背景图库为空，暂停提供背景；目录恢复后自动继续')
      }
      return
    }
    const slot = this.loadSlot()
    if (!slot) {
      return
    }
    if (this.current?.path === slot.path) {
      // 随机重选到同一张:保留已有检测结果,不换代
      return
    }
    this.current = slot
    this.encodeCache.clear()
    logger.debug(`切换背景：${slot.path}`)
    // 用最近请求过的视口预热检测,请求到来前把 AI 结果备好
    void this.ensureRegion(slot, this.lastViewport ?? DEFAULT_VIEWPORT)
  }

  private scheduleRotation(): void {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer)
    }
    this.rotationTimer = setTimeout(() => {
      this.rotationTimer = null
      this.rotate()
      this.scheduleRotation()
    }, ROTATION_INTERVAL_MS)
  }

  /** 随机选一张可读取的图(从随机起点顺序尝试,全部失败返回 null)——与主程序一致 */
  private loadSlot(): BackgroundSlot | null {
    const count = this.images.length
    const startIndex = Math.floor(Math.random() * count)
    for (let offset = 0; offset < count; offset++) {
      const path = this.images[(startIndex + offset) % count]
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) {
        logger.warning(`无法读取背景图片：${path}`)
        continue
      }
      return {
        generation: ++this.generation,
        path,
        image,
        size: image.getSize(),
        regions: new Map(),
        pending: new Map()
      }
    }
    return null
  }

  private ensureWarmup(): Promise<boolean> {
    if (!this.warmupPromise) {
      logger.info('开始加载视觉识别模型')
      this.warmupPromise = this.detector
        .warmup()
        .then((ready) => {
          this.modelReady = ready
          if (ready) {
            logger.info('视觉识别模型加载完成')
          } else {
            logger.error('视觉识别模型加载失败')
          }
          return ready
        })
        .catch(() => {
          this.modelReady = false
          return false
        })
    }
    return this.warmupPromise
  }

  /** 取当前图在指定视口下的检测结果:命中缓存直接返回,否则复用/发起检测(首次会等到模型就绪) */
  private ensureRegion(slot: BackgroundSlot, viewport: Size): Promise<VisualRegion> {
    const key = regionKey(viewport)
    const cached = slot.regions.get(key)
    if (cached) {
      return Promise.resolve(cached)
    }
    const pending = slot.pending.get(key)
    if (pending) {
      return pending
    }
    const run = (async () => {
      if (!this.modelReady) {
        await this.ensureWarmup()
      }
      logger.debug(`开始识别背景：${slot.path}（视口 ${key}）`)
      return this.detector.detect(slot.path, slot.size, viewport)
    })()
      .then((region) => {
        slot.regions.set(key, region)
        return region
      })
      .catch((error) => {
        // 不缓存失败结果:下次请求重新检测
        logger.error(`背景识别失败：${error instanceof Error ? error.message : String(error)}`)
        return emptyRegion()
      })
      .finally(() => {
        slot.pending.delete(key)
      })
    slot.pending.set(key, run)
    return run
  }

  /** 等待检测结果;超过上限不拖住请求,先给回退裁剪并标记 pending */
  private async waitForRegion(
    slot: BackgroundSlot,
    viewport: Size
  ): Promise<{ region: VisualRegion; pending: boolean }> {
    const key = regionKey(viewport)
    const cached = slot.regions.get(key)
    if (cached) {
      return { region: cached, pending: false }
    }
    const timedOut = await Promise.race([
      this.ensureRegion(slot, viewport).then(() => false),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(true), DETECTION_WAIT_TIMEOUT_MS).unref()
      })
    ])
    return {
      region: slot.regions.get(key) ?? emptyRegion(),
      pending: timedOut
    }
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders)
        response.end()
        return
      }
      if (request.method !== 'GET') {
        response.writeHead(405, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' })
        response.end('Method Not Allowed')
        return
      }
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.port}`)
      if (url.pathname === '/health') {
        this.respondHealth(response, corsHeaders)
        return
      }
      if (url.pathname === '/background') {
        await this.respondBackground(url, response, corsHeaders)
        return
      }
      response.writeHead(404, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not Found。可用接口：/background?width=<宽>&height=<高>、/health')
    } catch (error) {
      logger.error(`背景服务请求处理失败：${error instanceof Error ? error.message : String(error)}`)
      if (!response.headersSent) {
        response.writeHead(500, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' })
      }
      if (!response.writableEnded) {
        response.end('Internal Server Error')
      }
    }
  }

  private async respondBackground(
    url: URL,
    response: ServerResponse,
    corsHeaders: Record<string, string>
  ): Promise<void> {
    const slot = this.current
    if (!slot) {
      response.writeHead(503, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' })
      response.end('背景图库为空，请检查主程序 ini 的 Paths/background_images_directory')
      return
    }
    const width = parsePositiveInt(url.searchParams.get('width'))
    const height = parsePositiveInt(url.searchParams.get('height'))
    if (!width || !height) {
      response.writeHead(400, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' })
      response.end('需要正整数参数 width（窗口宽）与 height（窗口高）')
      return
    }
    const viewport = { width, height }
    this.lastViewport = viewport

    const { region, pending } = await this.waitForRegion(slot, viewport)
    const crop = cropForViewport(slot.size, region, viewport)
    if (crop.width <= 0 || crop.height <= 0) {
      response.writeHead(503, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' })
      response.end('背景裁剪失败，请稍后重试')
      return
    }
    const format = url.searchParams.get('format') === 'png' ? 'png' : 'jpeg'
    const encoded = this.encodeCrop(slot, crop, format)
    if (!encoded) {
      response.writeHead(500, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' })
      response.end('背景图编码失败')
      return
    }

    const commonHeaders = {
      ...corsHeaders,
      'cache-control': 'no-store',
      'x-background-generation': String(slot.generation),
      'x-detection-pending': pending ? '1' : '0'
    }
    if (url.searchParams.get('meta') === '1') {
      response.writeHead(200, { ...commonHeaders, 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          generation: slot.generation,
          path: slot.path,
          imageWidth: slot.size.width,
          imageHeight: slot.size.height,
          crop,
          width: encoded.width,
          height: encoded.height,
          format,
          detectionPending: pending,
          data: encoded.data.toString('base64')
        })
      )
      return
    }
    response.writeHead(200, {
      ...commonHeaders,
      'content-type': format === 'png' ? 'image/png' : 'image/jpeg',
      'content-length': encoded.data.length
    })
    response.end(encoded.data)
  }

  /** 裁剪并编码;同代背景的相同裁剪直接命中缓存,避免反复解码/编码大图 */
  private encodeCrop(
    slot: BackgroundSlot,
    crop: BackgroundRect,
    format: 'png' | 'jpeg'
  ): EncodedImage | null {
    const key = `${slot.generation}:${crop.x},${crop.y},${crop.width},${crop.height}:${format}`
    const cached = this.encodeCache.get(key)
    if (cached) {
      return cached
    }
    const cropped = slot.image.crop({
      x: Math.floor(crop.x),
      y: Math.floor(crop.y),
      width: Math.floor(crop.width),
      height: Math.floor(crop.height)
    })
    if (cropped.isEmpty()) {
      return null
    }
    const size = cropped.getSize()
    const entry: EncodedImage = {
      data: format === 'png' ? cropped.toPNG() : cropped.toJPEG(JPEG_QUALITY),
      width: size.width,
      height: size.height
    }
    this.encodeCache.set(key, entry)
    if (this.encodeCache.size > MAX_ENCODE_CACHE_ENTRIES) {
      const oldest = this.encodeCache.keys().next().value
      if (oldest !== undefined) {
        this.encodeCache.delete(oldest)
      }
    }
    return entry
  }

  private respondHealth(response: ServerResponse, corsHeaders: Record<string, string>): void {
    response.writeHead(200, { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        ok: true,
        service: 'nte-bg-server',
        port: this.port,
        images: this.images.length,
        current: this.current ? basename(this.current.path) : null,
        generation: this.current?.generation ?? null,
        modelReady: this.modelReady,
        lastViewport: this.lastViewport
      })
    )
  }
}

export const backgroundService = new BackgroundService()
