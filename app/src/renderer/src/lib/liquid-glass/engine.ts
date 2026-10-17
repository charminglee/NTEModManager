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
/** 高斯模糊迭代数(与库 defaults.ts 的 BLUR_ITERATIONS 一致;库 1.0.3 未导出该常量) */
const BLUR_ITERATIONS = 6
/**
 * 模糊链路降采样倍数:blurA/blurB 在 1/N 分辨率上做模糊(1 = 不降采样)。
 * 模糊本身是低通,半分辨率处理后线性放大,半径(以原图像素计)保持不变,
 * 视觉近似无损,12 个模糊 pass 的像素量降到 1/4。
 */
const BLUR_DOWNSCALE = 2
/** FBO 缓存组数软上限与像素预算(每组含 bg 全尺寸 + blurA/blurB 降采样共 3 张纹理) */
const FBO_CACHE_MAX_SETS = 48
const FBO_CACHE_PIXEL_BUDGET = 8_000_000
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

/** 渲染器内部成员视图(仅声明本适配层用到的部分;库升级时签名变化会在这里报错) */
interface RendererFBO {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}

interface RendererFBOSet {
  bg: RendererFBO
  blurA: RendererFBO
  blurB: RendererFBO
}

interface GlassRendererInternals {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  contextLost: boolean
  width: number
  height: number
  fboCache: Map<string, RendererFBOSet>
  activeFBOs: RendererFBOSet | null
  cropCanvas: HTMLCanvasElement
  cropCtx: CanvasRenderingContext2D
  bgTex: WebGLTexture | null
  blitP: WebGLProgram
  blitU: Record<string, WebGLUniformLocation | null>
  blurP: WebGLProgram
  blurU: Record<string, WebGLUniformLocation | null>
  quadBuf: WebGLBuffer
  _setActiveSize(w: number, h: number): boolean
  _makeFBO(w: number, h: number): RendererFBO
  _freeFBOSet(set: RendererFBOSet): void
  _drawQuad(prog: WebGLProgram, buf: WebGLBuffer): void
  uploadAndBlur(
    sourceCanvas: HTMLCanvasElement,
    sourceX: number,
    sourceY: number,
    width: number,
    height: number,
    blurAmount: number
  ): void
}

/**
 * 库实例的内部成员视图。这里只声明本适配层真正用到的部分;库升级时若签名变化,
 * TypeScript 会在这里报错,便于定位。
 */
interface GlassInternals {
  glassSet: Set<HTMLElement>
  glassCanvases: Map<HTMLElement, HTMLCanvasElement>
  _glassContentDirty: Set<HTMLElement>
  _glassCache: Map<HTMLElement, unknown>
  _glassLastSize: Map<HTMLElement, { w: number; h: number }>
  _closestGlassAncestor(node: Node): HTMLElement | null
  _markGlassAndDependents(element: HTMLElement, rectOverride?: DOMRect): void
  markChanged(element?: HTMLElement): void
  capture: {
    invalidateCache(element: HTMLElement): void
    captureElement(element: HTMLElement, force?: boolean): Promise<void>
  }
  renderer: GlassRendererInternals
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

/**
 * 创建库实例,并顺带把 WebGL 上下文从库写死的 preserveDrawingBuffer=true
 * 改为 false。
 *
 * readback(drawImage 取 WebGL 画布)发生在库渲染循环的同一同步任务里
 * (renderGlassPanel 之后立刻 drawImage),不依赖「保留上一帧的缓冲」,
 * 关掉该标志可省去驱动层每帧保留后备缓冲的成本(Windows/ANGLE 下尤其明显)。
 * 库 1.0.3 把该参数写死在构造器里,只能在其构造窗口内临时拦截 getContext 改参;
 * 构造是同步的,窗口内不会有其他代码并发创建上下文。
 */
function createGlassInstance(options: {
  root: HTMLElement
  glassElements: HTMLElement[]
  defaults?: Partial<GlassConfig>
}): LiquidGlass {
  const proto = HTMLCanvasElement.prototype
  const originalGetContext = proto.getContext
  proto.getContext = function patchedGetContext(
    this: HTMLCanvasElement,
    contextId: string,
    attrs?: unknown
  ): unknown {
    // 还原原型:本拦截只为玻璃渲染器服务,恢复后其余调用保持原生行为
    proto.getContext = originalGetContext
    if (contextId === 'webgl' || contextId === 'experimental-webgl') {
      const merged = {
        ...(typeof attrs === 'object' && attrs !== null ? attrs : {}),
        preserveDrawingBuffer: false
      }
      return originalGetContext.call(this, contextId, merged)
    }
    return originalGetContext.call(this, contextId, attrs as never)
  } as unknown as typeof proto.getContext
  try {
    return new LiquidGlass(options as ConstructorParameters<typeof LiquidGlass>[0])
  } finally {
    proto.getContext = originalGetContext
  }
}

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
  private defaultScene: SceneLayer[] = []
  private suspended = false
  /** 因不可见/暂停而跳过的玻璃:保留脏标记,下帧继续试探,可见即补画 */
  private readonly deferred = new Set<HTMLElement>()
  /** 正在做 CSS transform 动画的玻璃(由组件侧登记):每帧检测位移并标脏,让画面跟随移动 */
  private readonly motionTracked = new Set<HTMLElement>()
  /** 追踪元素的上一帧中心点(视口坐标);无记录=首帧先按当前位置画一帧对齐 */
  private readonly motionCenter = new Map<HTMLElement, { x: number; y: number }>()
  /** ResizeObserver 尺寸变化队列:下一帧渲染循环统一消费,避免每帧全量读 offsetWidth */
  private readonly pendingSizeSync = new Set<HTMLElement>()
  /** 尺寸监听器;环境缺失时退化为周期性兜底检测 */
  private readonly sizeObserver: ResizeObserver | null
  /**
   * 视口可见性跟踪:IntersectionObserver 维护,替代渲染循环对全部玻璃每帧做
   * getBoundingClientRect 检查(大列表上百张卡时是每秒数万次布局读取,且让
   * 渲染循环因「离屏玻璃保留脏标记」永不空闲)
   */
  private readonly visibleGlass = new Set<HTMLElement>()
  private readonly visibilityObserver: IntersectionObserver | null
  /** IO 首次回调前用 rect 兜底判可见,避免首帧把可见玻璃全判成离屏 */
  private visibilityReady = false
  /** 上次尺寸兜底检测的时间戳 */
  private lastSizeFallbackAt = 0
  /** 最近一次 scroll 事件时间戳:窗口期内视口内玻璃每帧标脏,画面逐帧跟随滚动 */
  private lastScrollAt = -Infinity
  /** 全局滚动监听(capture:内层 overflow 容器的 scroll 不冒泡,须在捕获阶段收) */
  private readonly onWindowScroll: () => void
  /** data-config 突变的去重集合(observer 回调内批量合并,见 flushConfigOwnerMarks) */
  private readonly pendingConfigOwners = new Set<HTMLElement>()

  constructor({ root, defaults }: GlassEngineOptions) {
    this.instance = createGlassInstance({ root, glassElements: [], defaults })
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
                  // 带挂起脏标记(deferred)的玻璃回到视口:唤醒补画。
                  // 注:滚动进入的玻璃同时会因位置变化被渲染循环判为
                  // posChanged,这里只兜底「位置未变但内容已过期」的场景
                  if (!wasVisible && this.deferred.delete(el)) {
                    this.internals._glassDirty.add(el)
                  }
                } else {
                  this.visibleGlass.delete(el)
                }
              }
            },
            // 与 isOnScreen 的 SHADOW_PAD 语义对齐;宁可比判定边界多算几个,
            // 不多占渲染,也不能让边缘玻璃迟画
            { rootMargin: '40px' }
          )
    this.patchInternals()
    this.patchRendererInternals()
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
    this.trimRendererCache()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.suspended = true
    this.scenes.clear()
    this.defaultScene = []
    this.deferred.clear()
    this.motionTracked.clear()
    this.motionCenter.clear()
    this.pendingSizeSync.clear()
    this.pendingConfigOwners.clear()
    this.sizeObserver?.disconnect()
    this.visibilityObserver?.disconnect()
    this.visibleGlass.clear()
    window.removeEventListener('scroll', this.onWindowScroll, { capture: true })
    this.internals.destroy()
  }

  /** 注册一个玻璃元素及其场景;重复注册视为更新场景 */
  addGlass(el: HTMLElement, layers: SceneLayer[] | null): void {
    if (layers) this.scenes.set(el, layers)
    else this.scenes.delete(el)
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
    this.deferred.delete(el)
    this.motionTracked.delete(el)
    this.motionCenter.delete(el)
    this.pendingSizeSync.delete(el)
    this.pendingConfigOwners.delete(el)
    this.sizeObserver?.unobserve(el)
    this.visibilityObserver?.unobserve(el)
    this.visibleGlass.delete(el)
    this.internals._glassDirty.delete(el)
    this.internals._glassCache.delete(el)
    this.internals.capture.invalidateCache(el)
    this.internals._sortedChildren = this.internals._getSortedChildren()
    this.internals.markChanged()
  }

  /** 更新某个玻璃的场景,并重画它 */
  setScene(el: HTMLElement, layers: SceneLayer[]): void {
    this.scenes.set(el, layers)
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

  /**
   * 登记/结束一处「正在做 CSS transform 动画」的玻璃。
   *
   * transform 动不了布局:不触发 resize/scroll/尺寸检查,渲染循环平时感知不到,
   * 玻璃折射的画面会停在动画起点的采样上(列表卡片的滑入动画就因此错位;
   * 长列表靠离屏玻璃的补脏侥幸每帧渲染,短列表则动画结束后仍残留错位)。
   * 登记后每帧检测元素位移,超过半像素即标脏重画,画面逐帧跟随;结束时
   * (moving=false)额外标脏一次,把最终静止位置画正后停止追踪。
   */
  trackMotion(el: HTMLElement, moving: boolean): void {
    if (moving) {
      if (this.motionTracked.has(el)) return
      this.motionTracked.add(el)
      // 无基线:首帧先按当前位置标脏画一帧,再逐帧比较
      this.motionCenter.delete(el)
      return
    }
    if (!this.motionTracked.delete(el)) return
    this.motionCenter.delete(el)
    if (this.internals.glassSet.has(el)) this.internals._glassDirty.add(el)
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
      renderedThisFrame: Array<{ rect: LayerRect }>
    ) {
      if (self.suspended || !self.isOnScreen(child)) {
        // 只有「带脏标记但没画成」的玻璃需要保留待重试(可见时由 IO 唤醒补画);
        // 单纯遍历到的干净玻璃不进集合,避免唤醒时把干净玻璃也重画。
        // F9 隐藏(suspended)期间的暂停不依赖该集合:恢复时走 globalDirty 全量补画
        if (!self.suspended && dirtyTargets.has(child)) self.deferred.add(child)
        return
      }
      self.deferred.delete(child)
      originalRenderGlass(child, rootRect, dpr, isDragging, dirtyTargets, renderedThisFrame)
    }

    internals._renderFrame = function (this: GlassInternals) {
      // 动画追踪先于渲染:位移检测标出的脏标记要在同一帧被消费,
      // 否则元素已移到下一帧、画面却按上一帧的位置采样
      self.sampleTrackedMotion()
      // 滚动活跃期间:视口内玻璃每帧标脏,折射画面逐帧跟随滚动位移。
      // 滚动不产生任何布局/尺寸事件,若不主动刷新,画布内容会停在滚动起点
      // 的采样上(卡片移动但画面错位);精确限定在可见集内,替代旧实现
      // 「每帧把全部离屏玻璃重塞回脏集合」的做法——那个让渲染循环永不空闲、
      // 每帧对全部玻璃做 rect 检查,大列表下每秒数万次布局读取
      if (self.isScrollActive()) {
        if (self.visibilityReady) {
          for (const el of self.visibleGlass) {
            if (this.glassSet.has(el)) this._glassDirty.add(el)
          }
        } else {
          // IO 首次回调前(启动瞬间)没有可见集可用,退化为全量一帧
          this._globalDirty = true
        }
      }
      originalRenderFrame()
      // 离屏玻璃的脏标记不每帧重塞回脏集合;可见性变化由 visibilityObserver
      // 唤醒,滚动进入的玻璃由滚动刷新窗口与 posChanged 判定覆盖
      self.trimRendererCache()
    }
  }

  /** 滚动刷新窗口内视为"滚动活跃"(scroll 事件高频,窗口期即滚动进行中) */
  private isScrollActive(): boolean {
    return performance.now() - this.lastScrollAt < SCROLL_REFRESH_WINDOW_MS
  }

  /** 追踪中的玻璃逐帧位置检测:位移过半像素即标脏,渲染循环同帧重画 */
  private sampleTrackedMotion(): void {
    if (this.motionTracked.size === 0) return
    for (const el of this.motionTracked) {
      if (!el.isConnected || !this.internals.glassSet.has(el)) {
        this.motionTracked.delete(el)
        this.motionCenter.delete(el)
        continue
      }
      const rect = el.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const last = this.motionCenter.get(el)
      if (last && Math.abs(last.x - x) <= 0.5 && Math.abs(last.y - y) <= 0.5) continue
      this.motionCenter.set(el, { x, y })
      this.internals._glassDirty.add(el)
    }
  }

  /**
   * 玻璃元素(含影子外扩)是否落在视口内;隐藏界面态(ui-fade-hidden)也算不可见。
   * 视口判定优先用 IntersectionObserver 维护的可见集(O(1) 查询,零布局读取);
   * IO 首次回调之前用 rect 兜底,环境无 IO 时全程走 rect(等价旧实现)。
   */
  private isOnScreen(el: HTMLElement): boolean {
    const onScreen =
      this.visibilityObserver && this.visibilityReady
        ? this.visibleGlass.has(el)
        : this.isOnScreenByRect(el)
    if (!onScreen) return false
    return !el.closest('.ui-fade-hidden')
  }

  /** rect 兜底判定(旧实现;IO 就绪后仅首帧用到) */
  private isOnScreenByRect(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect()
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

  /**
   * 渲染器侧覆写(FBO 分配与上传/模糊管线),全部为行为等价或视觉近似等价优化:
   *   1. blurA/blurB 使用降采样尺寸(BLUR_DOWNSCALE),12 个模糊 pass 的像素量
   *      降为 1/N²;步长按降采样空间折算,模糊物理半径(原图像素计)不变;
   *   2. FBO 缓存交给「像素预算 + 最久未用先释放」策略(trimRendererCache),
   *      _setActiveSize 命中时把条目挪到 Map 末尾,维持 LRU 顺序;
   *   3. uploadAndBlur:场景画布与目标尺寸一致时跳过 crop 中转直传;crop 兜底
   *      路径也把无条件重建画布改为条件赋值。
   * 库升级时需复核(方法名与内部状态依赖见 GlassRendererInternals)。
   */
  private patchRendererInternals(): void {
    const renderer = this.internals.renderer

    renderer._setActiveSize = function (
      this: GlassRendererInternals,
      w: number,
      h: number
    ): boolean {
      if (w <= 0 || h <= 0) return false
      this.width = w
      this.height = h
      // WebGL 画布只扩容不缩容(缩容由 resize() 统一处理,避免反复清空缓冲)
      if (this.canvas.width < w || this.canvas.height < h) {
        this.canvas.width = Math.max(this.canvas.width, w)
        this.canvas.height = Math.max(this.canvas.height, h)
      }
      const key = `${w}x${h}`
      let fboSet = this.fboCache.get(key)
      if (fboSet) {
        // LRU:命中的条目挪到 Map 末尾(trimRendererCache 从头部释放)
        this.fboCache.delete(key)
        this.fboCache.set(key, fboSet)
      } else {
        const blurW = Math.max(1, Math.ceil(w / BLUR_DOWNSCALE))
        const blurH = Math.max(1, Math.ceil(h / BLUR_DOWNSCALE))
        fboSet = {
          bg: this._makeFBO(w, h),
          blurA: this._makeFBO(blurW, blurH),
          blurB: this._makeFBO(blurW, blurH)
        }
        this.fboCache.set(key, fboSet)
      }
      this.activeFBOs = fboSet
      return true
    }

    renderer.uploadAndBlur = function (
      this: GlassRendererInternals,
      sourceCanvas: HTMLCanvasElement,
      sourceX: number,
      sourceY: number,
      width: number,
      height: number,
      blurAmount: number
    ): void {
      if (this.contextLost) return
      const gl = this.gl
      if (!this._setActiveSize(width, height)) return
      const W = this.width
      const H = this.height
      const fboSet = this.activeFBOs!

      // 源画布与目标尺寸精确一致(本应用的场景画布已与玻璃画布对齐)时跳过
      // crop 中转直传;兜底路径也只在实际换尺寸时重建 crop 画布
      let uploadSource = sourceCanvas
      if (
        !(sourceX === 0 && sourceY === 0 && sourceCanvas.width === W && sourceCanvas.height === H)
      ) {
        const crop = this.cropCanvas
        if (crop.width !== W) crop.width = W
        if (crop.height !== H) crop.height = H
        this.cropCtx.clearRect(0, 0, W, H)
        this.cropCtx.drawImage(sourceCanvas, -sourceX, -sourceY)
        uploadSource = crop
      }

      if (!this.bgTex) {
        this.bgTex = gl.createTexture()
      }
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true as unknown as number)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false as unknown as number)

      // 全尺寸拷贝到 bgFBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboSet.bg.fbo)
      gl.viewport(0, 0, W, H)
      gl.useProgram(this.blitP)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex)
      gl.uniform1i(this.blitU.u_tex, 0)
      gl.uniform2f(this.blitU.u_scale, 1, 1)
      gl.uniform2f(this.blitU.u_offset, 0, 0)
      this._drawQuad(this.blitP, this.quadBuf)

      // 降采样拷贝 bgFBO → blurA(LINEAR 采样即 2×2 盒式近似)
      const bw = fboSet.blurA.w
      const bh = fboSet.blurA.h
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboSet.blurA.fbo)
      gl.viewport(0, 0, bw, bh)
      gl.bindTexture(gl.TEXTURE_2D, fboSet.bg.tex)
      this._drawQuad(this.blitP, this.quadBuf)

      // 多轮高斯模糊(在降采样空间执行;步长按降采样空间折算,原图物理半径不变)
      if (blurAmount > 0) {
        const spread = (blurAmount * 2.5) / BLUR_DOWNSCALE
        gl.useProgram(this.blurP)
        gl.uniform1i(this.blurU.u_tex, 0)
        for (let i = 0; i < BLUR_ITERATIONS; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fboSet.blurB.fbo)
          gl.viewport(0, 0, bw, bh)
          gl.bindTexture(gl.TEXTURE_2D, fboSet.blurA.tex)
          gl.uniform2f(this.blurU.u_dir, spread / bw, 0)
          this._drawQuad(this.blurP, this.quadBuf)

          gl.bindFramebuffer(gl.FRAMEBUFFER, fboSet.blurA.fbo)
          gl.bindTexture(gl.TEXTURE_2D, fboSet.blurB.tex)
          gl.uniform2f(this.blurU.u_dir, 0, spread / bh)
          this._drawQuad(this.blurP, this.quadBuf)
        }
      }
    }
  }

  /**
   * FBO 缓存按「像素预算 + 组数上限、最久未用先释放」修剪。
   * 旧实现上限 8 组、按插入序释放,而应用有 35 种玻璃尺寸,每轮全量渲染都要
   * 重建约 27 组纹理(81 次分配/销毁,连续淡化一轮两秒内上千次,是驱动层的
   * 大头);现在常用尺寸都留在缓存里,只在超预算时释放最久未用的一端。
   */
  private trimRendererCache(): void {
    const renderer = this.internals.renderer
    const cache = renderer.fboCache
    if (!cache || cache.size === 0) return
    let budgetPixels = 0
    for (const set of cache.values()) {
      budgetPixels += set.bg.w * set.bg.h
    }
    if (cache.size <= FBO_CACHE_MAX_SETS && budgetPixels <= FBO_CACHE_PIXEL_BUDGET) return
    for (const [key, set] of cache) {
      if (cache.size <= FBO_CACHE_MAX_SETS && budgetPixels <= FBO_CACHE_PIXEL_BUDGET) break
      if (cache.size <= 1) break
      cache.delete(key)
      budgetPixels -= set.bg.w * set.bg.h
      try {
        renderer._freeFBOSet(set)
      } catch {
        // 释放失败不影响渲染正确性,忽略
      }
    }
  }
}

export function createGlassEngine(options: GlassEngineOptions): GlassEngine {
  const engine = new GlassEngine(options)
  engineByInstance.set(engine.instance as unknown as object, engine)
  return engine
}
