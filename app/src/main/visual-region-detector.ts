import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { nativeImage } from 'electron'
import { orientationModel, pythonExecutable, pythonModelCache, visualRegionScript } from './config'
import { logger } from './logger'
import type { BackgroundRect } from '../shared/types'

export interface Size {
  width: number
  height: number
}

/** 对应 C++ VisualRegion 结构 */
export interface VisualRegion {
  /** 检测出的区域;hasCrop=false 时为 null */
  bounds: BackgroundRect | null
  detected: boolean
  hasCrop: boolean
  /** AI 调试线框 PNG(全图尺寸) */
  debugOverlay: { data: Buffer; width: number; height: number } | null
  debugOverlayStatus: string
}

const READY_TIMEOUT_MS = 120_000
const DETECT_TIMEOUT_MS = 120_000

export function emptyRegion(): VisualRegion {
  return { bounds: null, detected: false, hasCrop: false, debugOverlay: null, debugOverlayStatus: '' }
}

function intersectRect(a: BackgroundRect, b: BackgroundRect): BackgroundRect {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function isEmptyRect(rect: BackgroundRect): boolean {
  return rect.width <= 0 || rect.height <= 0
}

/**
 * 对应 VisualRegionDetector::cropForViewport:按视口比例从源图取裁剪矩形。
 * 已有检测裁剪时直接使用;否则以检测焦点(或图心)为中心取视口比例的最大裁剪。
 */
export function cropForViewport(imageSize: Size, region: VisualRegion, viewportSize: Size): BackgroundRect {
  if (imageSize.width <= 0 || imageSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  const imageRect: BackgroundRect = { x: 0, y: 0, width: imageSize.width, height: imageSize.height }
  if (region.hasCrop && region.bounds && !isEmptyRect(region.bounds)) {
    return intersectRect(region.bounds, imageRect)
  }

  const viewportRatio = viewportSize.width / viewportSize.height
  let cropWidth = imageSize.width
  let cropHeight = imageSize.height
  if (imageSize.width / imageSize.height > viewportRatio) {
    cropWidth = Math.max(1, Math.round(imageSize.height * viewportRatio))
  } else {
    cropHeight = Math.max(1, Math.round(imageSize.width / viewportRatio))
  }

  const focus = region.detected && region.bounds
    ? {
        x: Math.floor(region.bounds.x + region.bounds.width / 2),
        y: Math.floor(region.bounds.y + region.bounds.height / 2)
      }
    : { x: imageSize.width / 2, y: imageSize.height / 2 }
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), Math.max(0, maximum))
  const left = clamp(focus.x - Math.floor(cropWidth / 2), 0, imageSize.width - cropWidth)
  const top = clamp(focus.y - Math.floor(cropHeight / 2), 0, imageSize.height - cropHeight)
  return { x: left, y: top, width: cropWidth, height: cropHeight }
}

/** 行缓冲读取器:read 超时或流结束后返回 null */
class LineReader {
  private buffer = ''
  private lines: string[] = []
  private waiter: ((line: string) => void) | null = null
  private ended = false

  constructor(stream: NodeJS.ReadableStream) {
    stream.setEncoding('utf-8')
    stream.on('data', (chunk: string) => this.push(chunk))
    stream.on('close', () => this.end())
  }

  private push(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      const waiter = this.waiter
      if (waiter) {
        this.waiter = null
        waiter(line)
      } else if (line) {
        this.lines.push(line)
      }
      index = this.buffer.indexOf('\n')
    }
  }

  read(timeoutMs: number): Promise<string | null> {
    const queued = this.lines.shift()
    if (queued !== undefined) {
      return Promise.resolve(queued)
    }
    if (this.ended) {
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null
        resolve(null)
      }, timeoutMs)
      this.waiter = (line) => {
        clearTimeout(timer)
        resolve(line)
      }
    })
  }

  end(): void {
    this.ended = true
    const waiter = this.waiter
    this.waiter = null
    waiter?.('')
  }
}

/**
 * 对应 C++ VisualRegionDetector::PythonBridge:
 * 以 --server 模式运行 visual_region_detector.py,通过 stdin/stdout 的 JSON 行协议通信。
 */
class PythonBridge {
  private process: ChildProcessWithoutNullStreams | null = null
  private stdout: LineReader | null = null
  private ready = false
  private stderrBuffer = ''
  /** 串行化检测请求(Python 端逐行处理,不允许并发) */
  private chain: Promise<unknown> = Promise.resolve()

  constructor() {
    this.start()
  }

  private start(): void {
    const orientationModelPath = orientationModel()
    const args = [
      visualRegionScript(),
      '--server',
      '--device',
      'auto',
      '--cache-dir',
      pythonModelCache()
    ]
    if (existsSync(orientationModelPath)) {
      args.push('--orientation-model', orientationModelPath)
    } else {
      logger.warning(`方向模型不存在，跳过模型并使用 fallback 视觉检测：${orientationModelPath}`)
    }
    logger.info(`启动 Python 视觉识别进程：${pythonExecutable()}`)

    // -X utf8:Windows 上管道 stdin 默认按 ANSI 代码页(GBK)解码,中文路径会变乱码
    const child = spawn(pythonExecutable(), ['-X', 'utf8', ...args], { windowsHide: true })
    this.process = child
    this.stdout = new LineReader(child.stdout)
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => this.drainStandardError(chunk))
    child.on('error', (error) => {
      logger.error(`Python 视觉识别进程错误：${error.message}`)
      this.ready = false
      this.stdout?.end()
    })
    child.on('close', () => {
      this.ready = false
      this.drainStandardError('', true)
      this.stdout?.end()
    })
    child.stdin.on('error', (error) => {
      logger.error(`无法向 Python 视觉识别进程写入：${error.message}`)
      this.ready = false
    })
  }

  isReady(): boolean {
    return this.ready && this.process !== null && this.process.exitCode === null
  }

  /** 等待 ready 握手(与 C++ 构造函数中的 120 秒等待一致) */
  async warmup(): Promise<boolean> {
    const line = await this.stdout?.read(READY_TIMEOUT_MS)
    if (!line) {
      logger.error('Python 视觉识别进程未返回 ready 响应')
      this.kill()
      return false
    }
    let ready = false
    try {
      ready = JSON.parse(line)?.ready === true
    } catch {
      ready = false
    }
    this.ready = ready
    if (ready) {
      logger.info('Python 视觉识别进程已就绪')
    } else {
      logger.error(`Python 视觉识别进程初始化失败：${line.slice(0, 500)}`)
      this.kill()
    }
    return ready
  }

  async detect(imagePath: string, imageSize: Size, viewportSize: Size): Promise<VisualRegion> {
    const run = this.chain.then(() => this.detectOnce(imagePath, imageSize, viewportSize))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async detectOnce(imagePath: string, imageSize: Size, viewportSize: Size): Promise<VisualRegion> {
    if (!this.isReady() || imageSize.width <= 0 || imageSize.height <= 0) {
      return emptyRegion()
    }
    const request = JSON.stringify({
      image: imagePath.replace(/\\/g, '/'),
      viewport_size: [viewportSize.width, viewportSize.height]
    })
    this.process!.stdin.write(request + '\n')
    const line = await this.stdout?.read(DETECT_TIMEOUT_MS)
    if (!line) {
      this.ready = false
      logger.error('Python 视觉识别进程未返回检测结果')
      return emptyRegion()
    }

    let result: Record<string, unknown>
    try {
      result = JSON.parse(line)
    } catch {
      logger.error(`Python 视觉识别进程返回了无效 JSON：${line.slice(0, 500)}`)
      return emptyRegion()
    }
    if (typeof result.error === 'string') {
      logger.error(`Python 视觉识别失败：${result.error}`)
      return emptyRegion()
    }

    const region = emptyRegion()
    region.detected = result.detected === true
    this.parseDebugOverlay(result, region)

    const cropCandidate =
      (result.background_crop && typeof result.background_crop === 'object'
        ? result.background_crop
        : undefined) ??
      (result.bounds && typeof result.bounds === 'object' ? result.bounds : undefined)
    const bounds = cropCandidate as Record<string, unknown> | undefined
    if (!bounds) {
      return region
    }
    const detectedBounds: BackgroundRect = {
      x: Number(bounds.x) || 0,
      y: Number(bounds.y) || 0,
      width: Number(bounds.width) || 0,
      height: Number(bounds.height) || 0
    }
    const crop = intersectRect(detectedBounds, {
      x: 0,
      y: 0,
      width: imageSize.width,
      height: imageSize.height
    })
    if (isEmptyRect(crop)) {
      return region
    }
    region.bounds = crop
    region.hasCrop = true
    return region
  }

  private parseDebugOverlay(result: Record<string, unknown>, region: VisualRegion): void {
    const encoded = typeof result.debug_overlay === 'string' ? result.debug_overlay : ''
    const overlaySize = result.debug_overlay_size
    if (!encoded) {
      region.debugOverlayStatus = 'Python 未返回调试线框'
      return
    }
    if (!Array.isArray(overlaySize) || overlaySize.length !== 2) {
      region.debugOverlayStatus = '调试线框尺寸缺失'
      return
    }
    const data = Buffer.from(encoded, 'base64')
    if (data.length === 0) {
      region.debugOverlayStatus = '调试线框 Base64 解码失败'
      return
    }
    const width = Number(overlaySize[0]) || 0
    const height = Number(overlaySize[1]) || 0
    if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
      region.debugOverlayStatus = '调试线框尺寸无效'
      return
    }
    const overlay = nativeImage.createFromBuffer(data)
    if (overlay.isEmpty()) {
      region.debugOverlayStatus = '调试线框 PNG 解码失败'
      return
    }
    const actual = overlay.getSize()
    if (actual.width !== width || actual.height !== height) {
      region.debugOverlayStatus = '调试线框图像尺寸不匹配'
      return
    }
    region.debugOverlay = { data, width, height }
    region.debugOverlayStatus = '调试线框已解码'
  }

  /** 对应 C++ 析构:礼貌退出,3 秒后强杀 */
  async dispose(): Promise<void> {
    const child = this.process
    if (!child || child.exitCode !== null) {
      return
    }
    this.ready = false
    child.stdin.write('__quit__\n')
    const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
    const timedKill = setTimeout(() => child.kill(), 3000)
    await exited
    clearTimeout(timedKill)
  }

  private kill(): void {
    const child = this.process
    if (child && child.exitCode === null) {
      child.kill()
    }
  }

  private drainStandardError(chunk = '', flush = false): void {
    this.stderrBuffer += chunk
    let index = this.stderrBuffer.indexOf('\n')
    while (index >= 0) {
      logStandardErrorLine(this.stderrBuffer.slice(0, index))
      this.stderrBuffer = this.stderrBuffer.slice(index + 1)
      index = this.stderrBuffer.indexOf('\n')
    }
    if (flush && this.stderrBuffer.trim().length > 0) {
      logStandardErrorLine(this.stderrBuffer)
      this.stderrBuffer = ''
    }
  }
}

function logStandardErrorLine(line: string): void {
  const message = line.trim()
  if (message) {
    logger.warning(`Python stderr：${message}`)
  }
}

/**
 * 对应 C++ VisualRegionDetector:
 * 方向模型缺失时仅用 fallback 检测;否则优先 Python 检测结果,失败时回退 fallback。
 */
export class VisualRegionDetector {
  private bridge: PythonBridge | null = null

  async warmup(): Promise<boolean> {
    if (!existsSync(orientationModel())) {
      logger.warning('方向模型不存在，使用 fallback 视觉检测')
      return true
    }
    if (!this.bridge) {
      this.bridge = new PythonBridge()
    }
    return this.bridge.warmup()
  }

  async detect(imagePath: string, imageSize: Size, viewportSize: Size): Promise<VisualRegion> {
    if (imageSize.width <= 0 || imageSize.height <= 0) {
      return emptyRegion()
    }
    if (!existsSync(orientationModel())) {
      return fallbackDetect(imagePath, imageSize)
    }
    if (!this.bridge) {
      this.bridge = new PythonBridge()
    }
    const pythonRegion = await this.bridge.detect(imagePath, imageSize, viewportSize)
    if ((pythonRegion.hasCrop && pythonRegion.bounds) || pythonRegion.debugOverlay) {
      return pythonRegion
    }
    return fallbackDetect(imagePath, imageSize)
  }

  async dispose(): Promise<void> {
    const bridge = this.bridge
    this.bridge = null
    await bridge?.dispose()
  }
}

/**
 * 对应 C++ fallbackDetect:把图像缩到约 128x128,按「局部对比度 + 饱和度」显著度
 * 加权求质心,取质心为中心的 58% 区域作为人物焦点区域。
 */
function fallbackDetect(imagePath: string, imageSize: Size): VisualRegion {
  const region = emptyRegion()
  const image = nativeImage.createFromPath(imagePath)
  if (image.isEmpty() || imageSize.width <= 0 || imageSize.height <= 0) {
    return region
  }

  const scale = Math.min(128 / imageSize.width, 128 / imageSize.height)
  const sampleWidth = Math.max(1, Math.round(imageSize.width * scale))
  const sampleHeight = Math.max(1, Math.round(imageSize.height * scale))
  const sample = image.resize({ width: sampleWidth, height: sampleHeight })
  const size = sample.getSize()
  if (size.width <= 0 || size.height <= 0) {
    return region
  }
  // Windows 上 toBitmap() 返回 BGRA 排列
  const bitmap = sample.toBitmap()
  const pixel = (x: number, y: number): { r: number; g: number; b: number } => {
    const offset = (y * size.width + x) * 4
    return { r: bitmap[offset + 2], g: bitmap[offset + 1], b: bitmap[offset] }
  }

  let totalWeight = 0
  let minimumWeight = 0
  let maximumWeight = 0
  let weightedX = 0
  let weightedY = 0

  for (let y = 1; y < size.height - 1; y++) {
    for (let x = 1; x < size.width - 1; x++) {
      const current = pixel(x, y)
      const left = pixel(x - 1, y)
      const right = pixel(x + 1, y)
      const top = pixel(x, y - 1)
      const bottom = pixel(x, y + 1)

      const luminance = 0.2126 * current.r + 0.7152 * current.g + 0.0722 * current.b
      const neighbourAverage =
        (0.2126 * (left.r + right.r + top.r + bottom.r) +
          0.7152 * (left.g + right.g + top.g + bottom.g) +
          0.0722 * (left.b + right.b + top.b + bottom.b)) /
        4
      const contrast = Math.abs(luminance - neighbourAverage)
      const channelMax = Math.max(current.r, current.g, current.b)
      const channelMin = Math.min(current.r, current.g, current.b)
      // Qt QColor::hsvSaturation() / 255
      const saturation = channelMax === 0 ? 0 : (channelMax - channelMin) / channelMax
      const weight = contrast + saturation * 24

      minimumWeight = Math.min(minimumWeight, weight)
      maximumWeight = Math.max(maximumWeight, weight)
      totalWeight += weight
      weightedX += x * weight
      weightedY += y * weight
    }
  }

  if (totalWeight <= 0 || maximumWeight - minimumWeight < 2) {
    return {
      ...region,
      bounds: { x: 0, y: 0, width: imageSize.width, height: imageSize.height },
      detected: false
    }
  }

  const centerX = weightedX / totalWeight
  const centerY = weightedY / totalWeight
  const regionWidth = Math.max(1, Math.floor(sampleWidth * 0.58))
  const regionHeight = Math.max(1, Math.floor(sampleHeight * 0.58))
  const sampleRect: BackgroundRect = {
    x: Math.floor(centerX - regionWidth / 2),
    y: Math.floor(centerY - regionHeight / 2),
    width: regionWidth,
    height: regionHeight
  }
  const clamped = intersectRect(sampleRect, { x: 0, y: 0, width: sampleWidth, height: sampleHeight })
  if (isEmptyRect(clamped)) {
    return region
  }

  const scaleX = imageSize.width / sampleWidth
  const scaleY = imageSize.height / sampleHeight
  region.bounds = {
    x: Math.floor(clamped.x * scaleX),
    y: Math.floor(clamped.y * scaleY),
    width: Math.max(1, Math.floor(clamped.width * scaleX)),
    height: Math.max(1, Math.floor(clamped.height * scaleY))
  }
  region.detected = true
  return region
}
