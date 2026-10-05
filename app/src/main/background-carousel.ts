import { nativeImage } from 'electron'
import { collectBackgroundImages, encodeMediaPath } from './background'
import { logger } from './logger'
import {
  cropForViewport,
  emptyRegion,
  VisualRegionDetector,
  type Size,
  type VisualRegion
} from './visual-region-detector'
import type { BackgroundState } from '../shared/types'

// 与原 Qt 版 BackgroundWidget 一致:10 秒轮换、900ms 交叉淡化、resize 后 120ms 去抖重新检测
const ROTATION_INTERVAL_MS = 10000
const TRANSITION_DURATION_MS = 900
const RESIZE_DETECTION_DELAY_MS = 120
const DEFAULT_VIEWPORT: Size = { width: 1315, height: 1000 }

interface BackgroundSlot {
  generation: number
  path: string
  width: number
  height: number
  region: VisualRegion
}

/**
 * 主进程背景轮播(对应 C++ BackgroundWidget):
 * 随机选图 → Python 视觉识别 → 计算视口裁剪 → 推送渲染端交叉淡化显示。
 * 检测在后台进行,检测结果就绪后再次推送;窗口 resize 后延迟重新检测。
 */
class BackgroundCarousel {
  private images: string[] = []
  private generation = 0
  private current: BackgroundSlot | null = null
  /** 已选中、等待 AI 识别完成后再切入显示的下一张背景 */
  private staged: BackgroundSlot | null = null
  private rotationTimer: NodeJS.Timeout | null = null
  private resizeTimer: NodeJS.Timeout | null = null
  private transitioningUntil = 0
  private detectionInProgress = false
  private pendingDetectionPaths: string[] = []
  private modelReady = false
  private debugMode = false
  private detector = new VisualRegionDetector()
  private lastState: BackgroundState | null = null
  private getWindow: () => Electron.BrowserWindow | null = () => null

  start(getWindow: () => Electron.BrowserWindow | null): void {
    this.getWindow = getWindow
    this.images = collectBackgroundImages()
    logger.info(`开始创建背景组件，背景图数量：${this.images.length}`)
    if (this.images.length === 0) {
      logger.info('背景图为空，跳过背景组件初始化')
      return
    }
    const first = this.loadSlot()
    if (!first) {
      logger.warning('没有可读取的背景图片，背景组件保持空白')
      return
    }
    this.current = first
    this.push()
    void this.requestDetection(first.path)
    void this.warmup()
    this.scheduleRotation()
    logger.info('背景轮播已启动')
  }

  /** 切换到随机背景(手动 ↓ 与定时轮换共用;切换期间调用会被忽略)。
   * 新图先"待命"并做 AI 识别,识别完成才切入显示,避免先显示未识别的居中裁剪再跳变。 */
  switchBackground(): void {
    if (this.images.length < 2 || Date.now() < this.transitioningUntil) {
      return
    }
    const slot = this.loadSlot()
    if (!slot) {
      return
    }
    logger.debug(`切换背景（等待识别完成）：${slot.path}`)
    this.staged = slot
    void this.requestDetection(slot.path)
    this.scheduleRotation()
  }

  handleWindowResized(): void {
    if (!this.current) {
      return
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
    }
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null
      this.push()
      if (this.current) {
        void this.requestDetection(this.current.path)
      }
    }, RESIZE_DETECTION_DELAY_MS)
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled
    const slot = this.current
    logger.info(
      `调试模式：${enabled ? '开启' : '关闭'}${slot ? `，线框状态：${slot.region.debugOverlayStatus || '未知'}` : '，当前无背景'}`
    )
    this.push()
  }

  toggleDebugMode(): void {
    this.setDebugMode(!this.debugMode)
  }

  currentPath(): string | null {
    return this.current?.path ?? null
  }

  /** 最近一次推送的状态;渲染端挂载晚于轮播启动时用它补齐第一帧 */
  lastPushedState(): BackgroundState | null {
    return this.lastState
  }

  async dispose(): Promise<void> {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer)
      this.rotationTimer = null
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    await this.detector.dispose()
  }

  private async warmup(): Promise<void> {
    logger.info('开始加载视觉识别模型')
    const ready = await this.detector.warmup()
    this.modelReady = ready
    if (ready) {
      logger.info('视觉识别模型加载完成')
    } else {
      logger.error('视觉识别模型加载失败')
    }
  }

  private scheduleRotation(): void {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer)
    }
    this.rotationTimer = setTimeout(() => {
      this.rotationTimer = null
      this.switchBackground()
    }, ROTATION_INTERVAL_MS)
  }

  /** 随机选一张可读取的图(从随机起点顺序尝试,全部失败返回 null) */
  private loadSlot(): BackgroundSlot | null {
    const count = this.images.length
    if (count === 0) {
      return null
    }
    const startIndex = Math.floor(Math.random() * count)
    for (let offset = 0; offset < count; offset++) {
      const path = this.images[(startIndex + offset) % count]
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) {
        logger.warning(`无法读取背景图片：${path}`)
        continue
      }
      const size = image.getSize()
      logger.debug(`已加载背景图：${path}`)
      return {
        generation: ++this.generation,
        path,
        width: size.width,
        height: size.height,
        region: emptyRegion()
      }
    }
    return null
  }

  private async requestDetection(path: string): Promise<void> {
    if (!path) {
      return
    }
    if (this.detectionInProgress) {
      if (!this.pendingDetectionPaths.includes(path)) {
        this.pendingDetectionPaths.push(path)
      }
      return
    }
    this.detectionInProgress = true
    if (!this.modelReady) {
      logger.info('视觉识别模型仍在加载，后台检测将等待模型就绪')
    }
    const slot =
      this.current?.path === path
        ? this.current
        : this.staged?.path === path
          ? this.staged
          : null
    try {
      logger.debug(`开始识别背景：${path}`)
      const region = await this.detector.detect(
        path,
        slot
          ? { width: slot.width, height: slot.height }
          : { width: 0, height: 0 },
        this.viewportSize()
      )
      if (slot && slot.path === path) {
        slot.region = region
      }
      if (this.debugMode && slot === this.current && !region.debugOverlay) {
        logger.warning(
          region.debugOverlayStatus
            ? `调试线框加载失败：${region.debugOverlayStatus}`
            : '调试线框加载失败：未知错误'
        )
      }
      // 待命图识别完成:提升为当前图并推送换代(渲染端随即交叉淡化切入)
      let promoted = false
      if (slot && this.staged === slot) {
        this.current = slot
        this.staged = null
        this.transitioningUntil = Date.now() + TRANSITION_DURATION_MS
        promoted = true
        logger.debug(`识别完成，切换显示：${slot.path}`)
      }
      if (promoted || slot === this.current) {
        this.push()
      }
    } catch (error) {
      logger.error(`背景识别失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.detectionInProgress = false
    }
    const pendingPath = this.pendingDetectionPaths.shift()
    if (pendingPath) {
      void this.requestDetection(pendingPath)
    }
  }

  private push(): void {
    const slot = this.current
    if (!slot) {
      return
    }
    const crop = cropForViewport(
      { width: slot.width, height: slot.height },
      slot.region,
      this.viewportSize()
    )
    const state: BackgroundState = {
      generation: slot.generation,
      path: slot.path,
      url: `media://local/${encodeMediaPath(slot.path)}`,
      imageWidth: slot.width,
      imageHeight: slot.height,
      crop
    }
    if (this.debugMode) {
      state.debugOverlayStatus = slot.region.debugOverlayStatus
      if (slot.region.debugOverlay) {
        state.debugOverlay = new Uint8Array(slot.region.debugOverlay.data)
      }
    }
    this.lastState = state
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('background:state', state)
      } catch (error) {
        logger.warning(`背景状态推送失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private viewportSize(): Size {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      const [width, height] = win.getContentSize()
      if (width > 0 && height > 0) {
        return { width, height }
      }
    }
    return DEFAULT_VIEWPORT
  }
}

export const backgroundCarousel = new BackgroundCarousel()
