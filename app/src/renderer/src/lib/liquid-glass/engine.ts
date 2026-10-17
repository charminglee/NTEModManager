/**
 * 液态玻璃引擎:对 @ybouane/liquidglass 的适配层(唯一与库内部实现耦合的文件)。
 *
 * 库的默认模型是「一个 root + 若干必须是 root 直接子元素的玻璃」,场景(玻璃背后的
 * 画面)固定取 root 子元素树。本应用需要的是另一种模型:
 *   1. 玻璃元素可以出现在任意层级(按钮/输入框的玻璃片嵌在面板、卡片里);
 *   2. 玻璃背后的画面由显式来源决定(应用背景图 + 淡出遮罩),而不是 root 子元素;
 *   3. 玻璃元素随 React 挂载/卸载动态增删。
 *
 * 因此这里覆写实例上的若干内部方法(库的 dist 未压缩、方法名保留,覆写以原型方法
 * 为参照,并在升级库版本时复核)。除此之外的行为(WebGL 管线、脏标记、尺寸跟踪、
 * 布局变化重测)完全沿用库自身实现。
 */
import { LiquidGlass } from '@ybouane/liquidglass'
import type { GlassConfig } from '@ybouane/liquidglass'

/**
 * 场景层:一个真实元素(图片/画布走快速路径,其余走 html-to-image 缓存)、
 * 一层纯色,或一层画布绘制指令(渐变遮罩等:同步绘制,跳过抓取与缓存,
 * 避免 html-to-image 的"取图时机/缓存过期"窗口里玻璃缺层)
 */
export type SceneLayer =
  | { el: HTMLElement; alpha?: number }
  | { color: string; alpha?: number }
  | {
      /** 在"视口坐标系"里同步绘制(engine 已把画笔原点平移到视口左上角) */
      paint: (ctx: CanvasRenderingContext2D) => void
      alpha?: number
    }

export interface GlassEngineOptions {
  /** 坐标基准容器(必须覆盖整个视口,通常就是应用壳) */
  root: HTMLElement
  /** 全局缺省玻璃参数 */
  defaults?: Partial<GlassConfig>
}

/** 影子外扩(与库 SHADOW_PAD 一致):判断玻璃是否在视口内时留出余量 */
const SHADOW_PAD = 20
/**
 * 可见判定的预加载边距:至少提前一张卡的高度把即将进入视口的玻璃纳入渲染。
 * 滚动驱动入场动画会让卡片在视口边缘就开始移动,若等玻璃真正相交才首绘,
 * 首帧会短暂露出未采样的透明画布。
 */
const VISIBILITY_PRELOAD_PX = 160
/** config 批量合并阈值:同一批变化的玻璃数达到该值(或总数的 1/3)时改走全量重画 */
const CONFIG_MERGE_ABS = 8
/** 尺寸兜底检测间隔(ms):ResizeObserver 之外的周期性保险(无 RO 时按帧退化为高频) */
const SIZE_FALLBACK_INTERVAL_MS = 500
const SIZE_FALLBACK_INTERVAL_NO_RO_MS = 100
/**
 * 滚动刷新窗口(ms):滚动停止后仍保持每帧刷新的宽限(覆盖惯性滚动与
 * scroll 事件的收尾间隙),过期后渲染循环回到空闲
 */
const SCROLL_REFRESH_WINDOW_MS = 200

interface LayerRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 库实例的内部成员视图。这里只声明本适配层真正用到的部分;库升级时若签名变化,
 * TypeScript 会在这里报错,便于定位。
 */
interface GlassInternals {
  root: HTMLElement
  glassSet: Set<HTMLElement>
  glassCanvases: Map<HTMLElement, HTMLCanvasElement>
  _glassContentDirty: Set<HTMLElement>
  _glassCache: Map<HTMLElement, { centerX: number; centerY: number }>
  _glassLastSize: Map<HTMLElement, { w: number; h: number }>
  _closestGlassAncestor(node: Node): HTMLElement | null
  _markGlassAndDependents(element: HTMLElement, rectOverride?: DOMRect): void
  markChanged(element?: HTMLElement): void
  capture: {
    invalidateCache(element: HTMLElement): void
    captureElement(element: HTMLElement, force?: boolean): Promise<void>
  }
  _start(): Promise<void>
  destroy(): void
  _setupGlassElements(): void
  _getSortedChildren(): HTMLElement[]
  _composeSceneForGlass(
    glass: HTMLElement,
    sampleRect: LayerRect,
    rootRect: DOMRect,
    dpr: number
  ): void
  _prewarmStaticCaptures(): Promise<void>
  _captureGlassContent(targets?: Set<HTMLElement> | null): Promise<void>
  _detectDynamic(): boolean
  _getConfig(el: HTMLElement): GlassConfig
  _checkGlassSizeChanges(): boolean
  _renderFrame(): void
  _renderGlassElement(
    child: HTMLElement,
    rootRect: DOMRect,
    dpr: number,
    isDragging: boolean,
    dirtyTargets: Set<HTMLElement>,
    renderedThisFrame: Array<{ rect: LayerRect }>
  ): void
  _prepareSceneCanvas(width: number, height: number): void
  _drawNonGlassChildToScene(
    child: HTMLElement,
    sampleRect: LayerRect,
    rootRect: DOMRect,
    dpr: number
  ): void
  _drawPriorGlassToScene(
    child: HTMLElement,
    sampleRect: LayerRect,
    rootRect: DOMRect,
    dpr: number
  ): void
  _sceneCtx: CanvasRenderingContext2D
  /** 覆写后返回布尔:是否实际重建了画布(尺寸或样式有变) */
  _updateGlassCanvasSize(el: HTMLElement): boolean
  _glassSubtreeObserver: MutationObserver | null
  _glassDirty: Set<HTMLElement>
  _sortedChildren: HTMLElement[]
  _globalDirty: boolean
}

/** 库实例 → 引擎(覆写的内部方法里需要读引擎侧的场景表) */
const engineByInstance = new WeakMap<object, GlassEngine>()

/** 按 DOM 顺序排序(近似绘制顺序:后出现的元素画在后面,浮层因挂到 body 尾部自然在后) */
function sortByDocumentOrder(elements: HTMLElement[]): HTMLElement[] {
  return elements.slice().sort((a, b) => {
    if (a === b) return 0
    const relation = a.compareDocumentPosition(b)
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })
}

export class GlassEngine {
  readonly instance: LiquidGlass
  private readonly internals: GlassInternals
  /** 已销毁标记:start 是异步的(内部有图片预抓取),销毁可能落在启动完成之前 */
  private destroyed = false
  /** 每个玻璃元素背后的场景层 */
  private readonly scenes = new Map<HTMLElement, SceneLayer[]>()
  /**
   * 玻璃的场景依赖:仅 overlay 玻璃依赖自己的父玻璃画布。库默认按 DOM
   * 顺序和矩形相交做级联刷新,会把主列表与对话框这类同背景但不相关的
   * 玻璃也一起重画;这里用显式来源替代该推断。
   */
  private readonly glassDependencies = new Map<HTMLElement, Set<HTMLElement>>()
  /** 当前帧实际重绘的玻璃及采样矩形,供依赖它的 overlay 玻璃判断级联 */
  private readonly renderedGlassThisFrame = new Map<HTMLElement, LayerRect>()
  private readonly relevantPriorGlass: Array<{ rect: LayerRect }> = []
  private defaultScene: SceneLayer[] = []
  private suspended = false
  /** 因不可见/暂停而跳过的玻璃:保留脏标记,下帧继续试探,可见即补画 */
  private readonly deferred = new Set<HTMLElement>()
  /** ResizeObserver 尺寸变化队列:下一帧渲染循环统一消费,避免每帧全量读 offsetWidth */
  private readonly pendingSizeSync = new Set<HTMLElement>()
  /** 尺寸监听器;环境缺失时退化为周期性兜底检测 */
  private readonly sizeObserver: ResizeObserver | null
  /**
   * 视口可见性跟踪:静止期由 IntersectionObserver 维护,避免渲染循环持续
   * 对全部玻璃做 getBoundingClientRect 检查。滚动活跃期的旧结果会晚一帧,
   * 因此改由 scrollFrameVisible 同帧校准。
   */
  private readonly visibleGlass = new Set<HTMLElement>()
  private readonly visibilityObserver: IntersectionObserver | null
  /** IO 首次回调前用 rect 兜底判可见,避免首帧把可见玻璃全判成离屏 */
  private visibilityReady = false
  /**
   * 滚动帧的同步可见集合。IntersectionObserver 的回调晚于 rAF 绘制,
   * 快速滚动时新进视口的卡片会在当帧继续使用上一位置的画布。滚动活跃期
   * 改用实测矩形重建本集合,让脏标记、可见判定与绘制发生在同一帧。
   */
  private readonly scrollFrameVisible = new Set<HTMLElement>()
  private scrollFrameUsesRect = false
  /** 上次尺寸兜底检测的时间戳 */
  private lastSizeFallbackAt = 0
  /** 最近一次 scroll 事件时间戳:窗口期内按同帧位移刷新玻璃,画面逐帧跟随滚动 */
  private lastScrollAt = -Infinity
  /** 全局滚动监听(capture:内层 overflow 容器的 scroll 不冒泡,须在捕获阶段收) */
  private readonly onWindowScroll: () => void
  /** data-config 突变的去重集合(observer 回调内批量合并,见 flushConfigOwnerMarks) */
  private readonly pendingConfigOwners = new Set<HTMLElement>()

  constructor({ root, defaults }: GlassEngineOptions) {
    // 保留库默认的 preserveDrawingBuffer=true。玻璃合成结果通过 drawImage
    // 回读到各元素自己的 2D 画布;关闭后备缓冲保留时,多画布连续回读在部分
    // GPU/ANGLE 驱动上会读到旧帧,表现为整排卡片沿用先前位置的深色背景。
    this.instance = new LiquidGlass({ root, glassElements: [], defaults })
    const internals = this.instance as unknown as GlassInternals
    this.internals = internals
    this.onWindowScroll = () => {
      this.lastScrollAt = performance.now()
    }
    this.sizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              this.pendingSizeSync.add(entry.target as HTMLElement)
            }
          })
    this.visibilityObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              this.visibilityReady = true
              for (const entry of entries) {
                const el = entry.target as HTMLElement
                if (entry.isIntersecting) {
                  const wasVisible = this.visibleGlass.has(el)
                  this.visibleGlass.add(el)
                  // 每次从不可见变为可见都必须主动补画。不能只依赖下一次
                  // 渲染循环的 posChanged 判定:快速甩动后滚动事件可能先停止,
                  // 渲染循环随即回到空闲,而 IO 回调此时才把卡片纳入可见集;
                  // 缺少这枚脏标记时,画布会一直停在旧位置的采样上。
                  if (!wasVisible) {
                    this.deferred.delete(el)
                    this.internals._glassDirty.add(el)
                  }
                } else {
                  this.visibleGlass.delete(el)
                }
              }
            },
            // 视口外预加载一段:卡片即将滚入时先按目标位置完成首绘,等真正
            // 进入视口时画布已经可用,不会先露出透明/旧采样的一帧
            { rootMargin: `${VISIBILITY_PRELOAD_PX}px` }
          )
    this.patchInternals()
  }

  // ──────────────────────────────── 对外 API ────────────────────────────────

  async start(): Promise<void> {
    await this.internals._start()
    // _start 的收尾段会重新点火渲染循环、重装观察器;若这段窗口里已 destroy
    // (开发态 StrictMode 双挂载与热更新会立刻做完 setup→cleanup),
    // 这里必须再收尾销毁一次,否则这次启动会变成"僵尸实例":渲染循环永久
    // 空转、观察器残留、状态卡在 suspended,并且永远不再对外产画
    if (this.destroyed) {
      this.internals.destroy()
      throw new Error('玻璃引擎在启动完成前已被销毁')
    }
    // 库在 _start 里装了两个观察器:一个盯 root 直接子节点结构,另一个盯每个玻璃子树
    // (childList/characterData/attributes)。本应用的玻璃内容始终是活 DOM,渲染不读
    // 子树内容(见 _captureGlassContent 覆写),子树/文本变化不影响任何画布输出,
    // 却会让所属玻璃被反复全套重渲染(日志视图每秒数十条推送是重灾区)。这里把子树
    // 观察器替换为只盯 data-config 的窄观察器,大幅收窄触发面。
    this.installConfigObserver()
    if (this.sizeObserver) {
      for (const el of this.internals.glassSet) {
        this.sizeObserver.observe(el)
      }
    }
    if (this.visibilityObserver) {
      for (const el of this.internals.glassSet) {
        this.visibilityObserver.observe(el)
      }
    }
    // 滚动期间渲染循环需要被逐帧唤醒(见 _renderFrame 覆写),用 capture 监听
    // 收全部滚动容器的事件;passive 避免任何滚动阻塞风险
    window.addEventListener('scroll', this.onWindowScroll, { capture: true, passive: true })
    // 库会把 root 的 user-select 置为 none;本应用的 body 已是 none,这里不额外处理,
    // 但记住该副作用:root 上不要依赖 user-select 的默认值
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.suspended = true
    this.scenes.clear()
    this.glassDependencies.clear()
    this.renderedGlassThisFrame.clear()
    this.relevantPriorGlass.length = 0
    this.defaultScene = []
    this.deferred.clear()
    this.pendingSizeSync.clear()
    this.pendingConfigOwners.clear()
    this.sizeObserver?.disconnect()
    this.visibilityObserver?.disconnect()
    this.visibleGlass.clear()
    this.scrollFrameVisible.clear()
    this.scrollFrameUsesRect = false
    window.removeEventListener('scroll', this.onWindowScroll, { capture: true })
    this.internals.destroy()
  }

  /** 注册一个玻璃元素及其场景;重复注册视为更新场景 */
  addGlass(el: HTMLElement, layers: SceneLayer[] | null): void {
    if (layers) this.scenes.set(el, layers)
    else this.scenes.delete(el)
    this.syncGlassDependencies(el, layers)
    if (this.internals.glassSet.has(el)) return
    this.internals.glassSet.add(el)
    this.setupGlassElement(el)
    this.internals._sortedChildren = this.internals._getSortedChildren()
    this.internals.markChanged()
  }

  removeGlass(el: HTMLElement): void {
    const canvas = this.internals.glassCanvases.get(el)
    canvas?.remove()
    el.style.removeProperty('position')
    this.internals.glassCanvases.delete(el)
    this.internals.glassSet.delete(el)
    this.scenes.delete(el)
    this.glassDependencies.delete(el)
    this.renderedGlassThisFrame.delete(el)
    this.deferred.delete(el)
    this.pendingSizeSync.delete(el)
    this.pendingConfigOwners.delete(el)
    this.sizeObserver?.unobserve(el)
    this.visibilityObserver?.unobserve(el)
    this.visibleGlass.delete(el)
    this.scrollFrameVisible.delete(el)
    this.internals._glassDirty.delete(el)
    this.internals._glassCache.delete(el)
    this.internals.capture.invalidateCache(el)
    this.internals._sortedChildren = this.internals._getSortedChildren()
    this.internals.markChanged()
  }

  /** 更新某个玻璃的场景,并重画它 */
  setScene(el: HTMLElement, layers: SceneLayer[]): void {
    this.scenes.set(el, layers)
    this.syncGlassDependencies(el, layers)
    this.internals.markChanged(el)
  }

  setDefaultScene(layers: SceneLayer[]): void {
    this.defaultScene = layers
  }

  /** 写入 per-element 配置(库通过 data-config + MutationObserver 感知变化并重画) */
  setConfig(el: HTMLElement, config: Partial<GlassConfig>): void {
    const next = JSON.stringify(config)
    if (el.dataset.config === next) return
    el.dataset.config = next
  }

  /** 重画全部玻璃(背景图换代、遮罩淡入淡出等全局变化时用) */
  markAll(): void {
    this.internals.markChanged()
  }

  /** 场景来源元素画面变化:丢缓存并重画(html-to-image 缓存按元素大小判断新鲜度) */
  invalidateScene(el: HTMLElement | null): void {
    if (el) this.internals.capture.invalidateCache(el)
    this.internals.markChanged()
  }

  /** F9 隐藏界面等场景下暂停画面渲染(保留脏标记,恢复时统一补画) */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return
    this.suspended = suspended
    if (!suspended) {
      this.internals._globalDirty = true
    }
  }

  get fps(): number {
    return this.instance.fps
  }

  /** 当前注册在册的玻璃元素数量(诊断用) */
  get glassCount(): number {
    return this.internals.glassSet.size
  }

  // ──────────────────────────────── 内部实现 ────────────────────────────────

  private setupGlassElement(el: HTMLElement): void {
    if (!this.internals.glassCanvases.has(el)) {
      this.removeOrphanCanvases(el)
      if (window.getComputedStyle(el).position === 'static') {
        el.style.position = 'relative'
      }
      const canvas = document.createElement('canvas')
      canvas.dataset.liquidGlassCanvas = ''
      canvas.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;'
      el.insertBefore(canvas, el.firstChild)
      this.internals.glassCanvases.set(el, canvas)
      this.internals._updateGlassCanvasSize(el)
    }
    this.sizeObserver?.observe(el)
    this.visibilityObserver?.observe(el)
    // 只观察 data-config:子树内容变化不参与渲染,不再触发重渲染(见 start 的说明)
    this.internals._glassSubtreeObserver?.observe(el, {
      attributes: true,
      attributeFilter: ['data-config']
    })
  }

  /** 从显式场景来源生成依赖集;非 overlay 的默认背景场景没有级联依赖 */
  private syncGlassDependencies(el: HTMLElement, layers: SceneLayer[] | null): void {
    if (!layers || layers.length === 0) {
      this.glassDependencies.delete(el)
      return
    }
    const dependencies = new Set<HTMLElement>()
    for (const layer of layers) {
      if ('el' in layer) dependencies.add(layer.el)
    }
    if (dependencies.size > 0) this.glassDependencies.set(el, dependencies)
    else this.glassDependencies.delete(el)
  }

  /** 清理元素上遗留的旧引擎画布(实例被替换/热更新时可能残留,重叠的孤儿画布会扰乱显示) */
  private removeOrphanCanvases(el: HTMLElement): void {
    for (const orphan of Array.from(el.querySelectorAll(':scope > canvas[data-liquid-glass-canvas]'))) {
      orphan.remove()
    }
  }

  private patchInternals(): void {
    const internals = this.internals
    const engine = this
    /** 原型上的原始方法(覆写前先留好引用) */
    const proto = Object.getPrototypeOf(this.instance) as unknown as GlassInternals

    // 1) 不再要求玻璃是 root 的直接子元素;也不强改元素自身的 overflow
    internals._setupGlassElements = function (this: GlassInternals) {
      for (const el of this.glassSet) {
        // 已有画布(启动前经 addGlass 建过)则复用;否则先清掉遗留孤儿再建,
        // 保证每个元素只保留本实例的一张画布
        if (this.glassCanvases.has(el)) continue
        engine.removeOrphanCanvases(el)
        if (window.getComputedStyle(el).position === 'static') {
          el.style.position = 'relative'
        }
        const canvas = document.createElement('canvas')
        canvas.dataset.liquidGlassCanvas = ''
        canvas.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;'
        el.insertBefore(canvas, el.firstChild)
        this.glassCanvases.set(el, canvas)
      }
    }

    // 2) 绘制顺序 = 玻璃集合的 DOM 顺序
    internals._getSortedChildren = function (this: GlassInternals) {
      return sortByDocumentOrder(Array.from(this.glassSet))
    }

    // 3) 场景由显式来源决定:先画各层(元素或纯色),玻璃元素额外把已渲染画布叠进去
    internals._composeSceneForGlass = function (
      this: GlassInternals,
      currentGlass: HTMLElement,
      sampleRect: LayerRect,
      rootRect: DOMRect,
      dpr: number
    ) {
      // 场景画布按玻璃画布的像素尺寸准备(而非 ±1px 舍入过的采样窗口):尺寸精确
      // 对齐后上传可直接复用场景画布,跳过 crop 中转;外圈 ±1px 差异只落在阴影
      // padding 区,不可见
      const glassCanvas = this.glassCanvases.get(currentGlass)
      this._prepareSceneCanvas(
        glassCanvas?.width || sampleRect.w,
        glassCanvas?.height || sampleRect.h
      )
      const engine = engineByInstance.get(this)
      const layers =
        engine?.scenes.get(currentGlass) ?? engine?.defaultScene ?? ([] as SceneLayer[])
      const ctx = this._sceneCtx
      for (const layer of layers) {
        const alpha = layer.alpha ?? 1
        if (alpha <= 0) continue
        if ('color' in layer) {
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.fillStyle = layer.color
          ctx.fillRect(0, 0, sampleRect.w, sampleRect.h)
          ctx.restore()
          continue
        }
        if ('paint' in layer) {
          ctx.save()
          ctx.globalAlpha = alpha
          // 场景画布的原点对应采样窗口左上角;平移到"视口原点",
          // 让 paint 指令可以直接用视口坐标作画(与 DOM 层几何一致)
          ctx.translate(
            -(sampleRect.x + rootRect.left * dpr),
            -(sampleRect.y + rootRect.top * dpr)
          )
          layer.paint(ctx)
          ctx.restore()
          continue
        }
        const el = layer.el
        if (!el || el === currentGlass || !el.isConnected) continue
        const faded = alpha < 1
        if (faded) {
          ctx.save()
          ctx.globalAlpha = alpha
        }
        if (this.glassSet.has(el)) {
          this._drawPriorGlassToScene(el, sampleRect, rootRect, dpr)
        } else {
          this._drawNonGlassChildToScene(el, sampleRect, rootRect, dpr)
        }
        if (faded) ctx.restore()
      }
    }

    // 4) 预抓取只针对场景来源(避免去抓整个应用树)
    internals._prewarmStaticCaptures = async function (this: GlassInternals) {
      const engine = engineByInstance.get(this)
      if (!engine) return
      const seen = new Set<HTMLElement>()
      const warm = async (layers: SceneLayer[]) => {
        for (const layer of layers) {
          if ('color' in layer || 'paint' in layer) continue
          const el = layer.el
          if (!el || seen.has(el) || this.glassSet.has(el) || !el.isConnected) continue
          seen.add(el)
          const tag = el.tagName
          if (tag === 'CANVAS' || tag === 'IMG' || tag === 'VIDEO') continue
          try {
            await this.capture.captureElement(el, false)
          } catch (error) {
            console.warn('[liquid-glass] 场景预抓取失败', el, error)
          }
        }
      }
      await warm(engine.defaultScene)
      for (const layers of engine.scenes.values()) await warm(layers)
    }

    // 5) 不做玻璃内容抓取:本应用的玻璃内容始终是活的 DOM,只有画布参与折射合成
    internals._captureGlassContent = async function (this: GlassInternals) {
      this._glassContentDirty.clear()
    }

    // 6) 动态内容检测由调用方显式驱动(应用里没有 data-dynamic/video 场景)
    internals._detectDynamic = function () {
      return false
    }

    // 6.5) 倒角深度按元素尺寸收口:库的 zRadius 是「玻璃厚度」,默认值(40px)对
    // 大面积面板合适;但细长控件(工具栏、按钮、输入框)的半高不足 20px,整块玻璃
    // 都会落在棱面上——Fresnel 与内沿高光被放大成一片白雾。按最短边的一半收口,
    // 让棱边只占边缘一小圈,中心是平的
    const originalGetConfig = proto._getConfig.bind(this.instance)
    internals._getConfig = function (this: GlassInternals, el: HTMLElement): GlassConfig {
      const config = originalGetConfig(el)
      const shortest = Math.min(el.offsetWidth, el.offsetHeight)
      if (shortest > 0) {
        const cap = Math.max(3, shortest * 0.35)
        if (config.zRadius > cap) config.zRadius = cap
      }
      return config
    }

    // 6.5b) 画布尺寸同步守卫:赋值 canvas.width/height(即使同值)会清空像素并重分配
    // 后备存储,因此只有尺寸/样式确有变化时才动画布;返回是否实际变化,供尺寸消费
    // 路径(6.6)决定是否清缓存、标脏补画
    internals._updateGlassCanvasSize = function (
      this: GlassInternals,
      el: HTMLElement
    ): boolean {
      const canvas = this.glassCanvases.get(el)
      if (!canvas) return false
      const dpr = window.devicePixelRatio || 1
      const elW = Math.round(el.offsetWidth)
      const elH = Math.round(el.offsetHeight)
      const cssW = elW + SHADOW_PAD * 2
      const cssH = elH + SHADOW_PAD * 2
      const pixelW = Math.round(cssW * dpr)
      const pixelH = Math.round(cssH * dpr)
      if (
        canvas.width === pixelW &&
        canvas.height === pixelH &&
        canvas.style.left === `${-SHADOW_PAD}px` &&
        canvas.style.top === `${-SHADOW_PAD}px` &&
        canvas.style.width === `${cssW}px` &&
        canvas.style.height === `${cssH}px`
      ) {
        this._glassLastSize.set(el, { w: elW, h: elH })
        return false
      }
      canvas.width = pixelW
      canvas.height = pixelH
      canvas.style.cssText = [
        'position:absolute',
        `left:${-SHADOW_PAD}px`,
        `top:${-SHADOW_PAD}px`,
        `width:${cssW}px`,
        `height:${cssH}px`,
        'pointer-events:none',
        'z-index:-1'
      ].join(';') + ';'
      this._glassLastSize.set(el, { w: elW, h: elH })
      return true
    }

    // 6.6) 尺寸变化检测改为 ResizeObserver 驱动(观察器在 start / 注册时挂上):
    // 渲染循环每帧从「全量读 35×2 次 offsetWidth」(240Hz 下每秒近两万次布局读取)
    // 变为「消费尺寸变化队列」,空闲帧零布局读取;尺寸真变时重建画布(像素被清空)
    // 并清缓存、标脏,交给同一帧的渲染循环补画。保留低频全量兜底检测防御 RO 漏报,
    // 无 ResizeObserver 的环境退化为高频检测。
    internals._checkGlassSizeChanges = function (this: GlassInternals) {
      let changed = false
      for (const el of engine.pendingSizeSync) {
        if (this.glassSet.has(el) && engine.syncCanvasSize(el)) changed = true
      }
      engine.pendingSizeSync.clear()

      const fallbackInterval = engine.sizeObserver
        ? SIZE_FALLBACK_INTERVAL_MS
        : SIZE_FALLBACK_INTERVAL_NO_RO_MS
      const now = performance.now()
      if (now - engine.lastSizeFallbackAt >= fallbackInterval) {
        engine.lastSizeFallbackAt = now
        for (const el of this.glassSet) {
          if (engine.syncCanvasSize(el)) changed = true
        }
      }
      return changed
    }

    // 7) 不可见/暂停时跳过渲染,但保留脏标记
    const originalRenderGlass = proto._renderGlassElement.bind(this.instance)
    const originalRenderFrame = proto._renderFrame.bind(this.instance)
    const self = this

    internals._renderGlassElement = function (
      this: GlassInternals,
      child: HTMLElement,
      rootRect: DOMRect,
      dpr: number,
      isDragging: boolean,
      dirtyTargets: Set<HTMLElement>,
      _renderedThisFrame: Array<{ rect: LayerRect }>
    ) {
      if (self.suspended || !self.isOnScreen(child)) {
        // 只有「带脏标记但没画成」的玻璃需要保留待重试(可见时由 IO 唤醒补画);
        // 单纯遍历到的干净玻璃不进集合,避免唤醒时把干净玻璃也重画。
        // F9 隐藏(suspended)期间的暂停不依赖该集合:恢复时走 globalDirty 全量补画
        if (!self.suspended && dirtyTargets.has(child)) self.deferred.add(child)
        return
      }
      self.deferred.delete(child)
      // 只把当前玻璃显式场景依赖的已重绘玻璃交给库。默认背景场景不会
      // 因上方的卡片或侧边栏刷新而级联;overlay 玻璃仍会跟随父玻璃。
      const dependencies = self.glassDependencies.get(child)
      const priorGlass = self.relevantPriorGlass
      priorGlass.length = 0
      if (dependencies) {
        for (const [renderedEl, rect] of self.renderedGlassThisFrame) {
          if (!dependencies.has(renderedEl)) continue
          priorGlass.push({ rect })
        }
      }
      const priorCount = priorGlass.length
      originalRenderGlass(child, rootRect, dpr, isDragging, dirtyTargets, priorGlass)
      if (priorGlass.length > priorCount) {
        self.renderedGlassThisFrame.set(child, priorGlass[priorGlass.length - 1].rect)
      }
    }

    internals._renderFrame = function (this: GlassInternals) {
      self.renderedGlassThisFrame.clear()
      // 滚动活跃期间:位置发生变化的玻璃逐帧标脏,折射画面跟随滚动位移。
      // 滚动不产生任何布局/尺寸事件,若不主动刷新,画布内容会停在滚动起点
      // 的采样上(卡片移动但画面错位)。
      //
      // IO 的可见集合在 rAF 之后才更新。若直接沿用它,快速滚动时刚进入
      // 视口的卡片会来不及标脏,当帧仍按上一位置采样。滚动活跃期因此改
      // 用同一帧的实测矩形重建可见集,并且只刷新位移超过半像素的元素;
      // 静止后仍由 IO 负责,不承担长期开销。
      const scrollActive = self.isScrollActive() && !self.suspended
      self.scrollFrameUsesRect = scrollActive
      if (scrollActive) {
        const visible = self.scrollFrameVisible
        visible.clear()
        const rootRect = this.root.getBoundingClientRect()
        for (const el of this.glassSet) {
          const rect = el.getBoundingClientRect()
          if (!self.isRectOnScreen(rect)) continue
          visible.add(el)
          // 只重画发生位移的玻璃。侧边栏外框、工具栏等位置不变的大面板
          // 不因内部内容滚动而重采样;随内容移动的卡片与选中指示条才刷新。
          const cached = this._glassCache.get(el)
          const centerX = rect.left - rootRect.left + rect.width / 2
          const centerY = rect.top - rootRect.top + rect.height / 2
          if (
            !cached ||
            Math.abs(cached.centerX - centerX) > 0.5 ||
            Math.abs(cached.centerY - centerY) > 0.5
          ) {
            this._glassDirty.add(el)
          }
        }
      } else {
        self.scrollFrameVisible.clear()
      }
      try {
        originalRenderFrame()
      } finally {
        self.scrollFrameUsesRect = false
      }
      // 离屏玻璃的脏标记不每帧重塞回脏集合;可见性变化由 visibilityObserver
      // 唤醒,滚动进入的玻璃由滚动刷新窗口与 posChanged 判定覆盖
    }
  }

  /** 滚动刷新窗口内视为"滚动活跃"(scroll 事件高频,窗口期即滚动进行中) */
  private isScrollActive(): boolean {
    return performance.now() - this.lastScrollAt < SCROLL_REFRESH_WINDOW_MS
  }

  /**
   * 玻璃元素(含影子外扩)是否落在视口内;隐藏界面态(ui-fade-hidden)也算不可见。
   * 视口判定优先用 IntersectionObserver 维护的可见集(O(1) 查询,零布局读取);
   * IO 首次回调之前用 rect 兜底,环境无 IO 时全程走 rect(等价旧实现)。
   */
  private isOnScreen(el: HTMLElement): boolean {
    let onScreen: boolean
    if (this.scrollFrameUsesRect) {
      onScreen = this.scrollFrameVisible.has(el)
    } else if (this.visibilityObserver && this.visibilityReady) {
      onScreen = this.visibleGlass.has(el)
    } else {
      onScreen = this.isOnScreenByRect(el)
    }
    if (!onScreen) return false
    return !el.closest('.ui-fade-hidden')
  }

  /** rect 兜底判定(旧实现;IO 就绪后仅首帧用到) */
  private isOnScreenByRect(el: HTMLElement): boolean {
    return this.isRectOnScreen(el.getBoundingClientRect())
  }

  private isRectOnScreen(rect: DOMRect): boolean {
    if (rect.width <= 0 || rect.height <= 0) return false
    return (
      rect.bottom > -SHADOW_PAD &&
      rect.top < window.innerHeight + SHADOW_PAD &&
      rect.right > -SHADOW_PAD &&
      rect.left < window.innerWidth + SHADOW_PAD
    )
  }

  /**
   * 把元素当前尺寸同步到玻璃画布:尺寸/样式未变时原样跳过(赋值 canvas.width
   * 会清空像素并重分配后备存储),实际变化时清渲染缓存并标脏补画。
   * 供尺寸消费路径(ResizeObserver 队列与兜底检测)使用。
   */
  private syncCanvasSize(el: HTMLElement): boolean {
    const internals = this.internals
    if (!internals._updateGlassCanvasSize(el)) return false
    internals._glassCache.delete(el)
    internals.capture.invalidateCache(el)
    internals._glassDirty.add(el)
    return true
  }

  /**
   * 把库的子树观察器替换为只盯 data-config 的窄观察器。
   *
   * 库的默认设计里,玻璃的「内容图」(html-to-image 快照)参与渲染,所以子树
   * 变化需要重抓内容并重画;本应用覆写了 _captureGlassContent,内容图不参与
   * 渲染(内容始终是活 DOM),子树/文本变化不影响任何画布输出。继续让它们触发
   * 重渲染会把「日志视图每秒数十条推送」「按钮文字切换」之类变成高频全管线
   * 重画,却不改变任何像素。替换后仅 data-config(玻璃参数)变化触发标脏。
   */
  private installConfigObserver(): void {
    const internals = this.internals
    internals._glassSubtreeObserver?.disconnect()
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes') continue
        const owner = internals._closestGlassAncestor(mutation.target)
        if (owner) this.pendingConfigOwners.add(owner)
      }
      this.flushConfigOwnerMarks()
    })
    internals._glassSubtreeObserver = observer
    for (const el of internals.glassSet) {
      observer.observe(el, { attributes: true, attributeFilter: ['data-config'] })
    }
  }

  /**
   * config 变化的批量标脏:去重后少量玻璃走「自身 + 相交级联」的精确标脏;
   * 数量接近全量(如设置滑块的实时预览一次改全部玻璃的 data-config)时,
   * 逐个做 O(n²) 相交检测已无意义,直接全量重画一帧,最终渲染集一致。
   */
  private flushConfigOwnerMarks(): void {
    if (this.pendingConfigOwners.size === 0) return
    const owners = Array.from(this.pendingConfigOwners)
    this.pendingConfigOwners.clear()
    const internals = this.internals
    if (owners.length >= CONFIG_MERGE_ABS || owners.length * 3 >= internals.glassSet.size) {
      internals.markChanged()
      return
    }
    for (const owner of owners) {
      internals._markGlassAndDependents(owner)
    }
  }

}

export function createGlassEngine(options: GlassEngineOptions): GlassEngine {
  const engine = new GlassEngine(options)
  engineByInstance.set(engine.instance as unknown as object, engine)
  return engine
}
