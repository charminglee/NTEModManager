import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  BACKGROUND_MASK_OPACITY_DEFAULT,
  type BackgroundRect,
  type BackgroundState
} from '@shared/types'
import { useGlassScene } from '@/components/liquid-glass'
import type { SceneLayer } from '@/lib/liquid-glass/engine'
import { cn } from '@/lib/utils'

interface BackgroundSlotView {
  generation: number
  url: string
  imageWidth: number
  imageHeight: number
  crop: BackgroundRect
  overlayUrl: string | null
}

/** 交叉淡化时长(ms),与 index.css 的 nte-bg-crossfade 动画保持一致 */
const CROSSFADE_MS = 900
/** 玻璃场景更新节流(ms):淡化期间按 ~24fps 步进,避免每帧都让全部玻璃重画 */
const SCENE_STEP_MS = 42

/** 与 nte-bg-crossfade 的 cubic-bezier(0.645,0.045,0.355,1) 同曲线 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** 主题背景色的 HSL 分量(如 "222.2 84% 4.9%"),供 CSS 与画布渐变共用 */
function themeBackgroundHsl(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim() ||
    '0 0% 100%'
  )
}

/** 无背景图时的兜底底色:取主题背景色 token,避免玻璃折射到白底 */
function themeBackgroundColor(): string {
  return `hsl(${themeBackgroundHsl()})`
}

/**
 * 单个背景槽位:源图与调试线框按裁剪矩形几何铺满视口。
 * 裁剪矩形与视口同比例,故用纯百分比定位即可,无需监听窗口尺寸。
 * 通过 key=generation 保证换代时元素重挂载,交叉淡化动画每次都会重放。
 */
function SlotLayer({
  slot,
  fadingIn,
  imageRef,
  overlayRef
}: {
  slot: BackgroundSlotView
  fadingIn: boolean
  imageRef?: React.Ref<HTMLImageElement>
  overlayRef?: React.Ref<HTMLImageElement>
}) {
  const { crop } = slot
  if (crop.width <= 0 || crop.height <= 0) {
    return null
  }
  const geometry: CSSProperties = {
    width: `${(slot.imageWidth / crop.width) * 100}%`,
    height: `${(slot.imageHeight / crop.height) * 100}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`
  }
  return (
    <div
      className={cn(
        'absolute inset-0 overflow-hidden',
        fadingIn && 'opacity-0 [animation:nte-bg-crossfade_0.9s_cubic-bezier(0.645,0.045,0.355,1)_forwards]'
      )}
    >
      <img
        ref={imageRef}
        src={slot.url}
        alt=""
        draggable={false}
        decoding="async"
        // 背景图会被画进玻璃的场景画布,必须带 CORS 加载,否则画布被标记污染,
        // WebGL 纹理上传会抛 SecurityError(media:// 协议已配 CORS 响应头)
        crossOrigin="anonymous"
        className="absolute max-w-none select-none"
        style={geometry}
      />
      {slot.overlayUrl && (
        <img
          ref={overlayRef}
          src={slot.overlayUrl}
          alt=""
          draggable={false}
          decoding="async"
          crossOrigin="anonymous"
          className="absolute max-w-none select-none"
          style={geometry}
        />
      )}
    </div>
  )
}

/** 调试线框 PNG 转 blob URL;换代后延迟回收旧 URL。 */
function overlayUrlFor(state: BackgroundState, store: Map<number, string>): string | null {
  for (const [generation, url] of store) {
    if (generation !== state.generation) {
      store.delete(generation)
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
  }
  if (!state.debugOverlay || state.debugOverlay.byteLength === 0) {
    return null
  }
  const existing = store.get(state.generation)
  if (existing) {
    return existing
  }
  const url = URL.createObjectURL(new Blob([state.debugOverlay], { type: 'image/png' }))
  store.set(state.generation, url)
  return url
}

/**
 * 应用背景层:由主进程轮播推送(随机选图 → Python AI 识别完成后才推送换代),
 * 渲染端再等图片解码完成才切入,并以 900ms 交叉淡化覆盖旧图;
 * 同代更新(检测结果/线框)即时生效。
 *
 * 同时它还是液态玻璃的「场景来源」:背景图与两层遮罩按绘制顺序注册给玻璃引擎,
 * 玻璃折射的正是这些元素当前渲染出的画面。交叉淡化期间按同一缓动步进 alpha,
 * 使玻璃里的背景与玻璃外的背景同步过渡,而不是各切各的。
 */
export default function BackgroundLayer({
  masked = true,
  maskOpacity = BACKGROUND_MASK_OPACITY_DEFAULT
}: {
  masked?: boolean
  /** 背景颜色遮罩不透明度(%):0=无遮罩,100=最初的完整强度 */
  maskOpacity?: number
}) {
  const scene = useGlassScene()
  const [current, setCurrent] = useState<BackgroundSlotView | null>(null)
  const [previous, setPrevious] = useState<BackgroundSlotView | null>(null)
  /** 交叉淡化进度(0 = 旧图,1 = 新图);无淡化时为 1 */
  const [fade, setFade] = useState(1)
  /** 遮罩显隐(F9)过渡的实时进度 0..1:rAF 跟踪 CSS opacity,同步给画布渐变 */
  const [veilAlpha, setVeilAlpha] = useState(masked ? 1 : 0)
  const [imageNonce, setImageNonce] = useState(0)
  const currentRef = useRef<BackgroundSlotView | null>(null)
  const overlayUrlsRef = useRef(new Map<number, string>())
  const currentImageRef = useRef<HTMLImageElement | null>(null)
  const previousImageRef = useRef<HTMLImageElement | null>(null)
  const currentOverlayRef = useRef<HTMLImageElement | null>(null)
  const previousOverlayRef = useRef<HTMLImageElement | null>(null)
  const veilRef = useRef<HTMLDivElement | null>(null)
  const veilRadialRef = useRef<HTMLDivElement | null>(null)
  /**
   * 衬底遮罩的烘焙画布:线性 + 径向两层渐变合绘到一张视口大小的画布,
   * 玻璃场景合成时按局部裁剪直接 drawImage,不再每玻璃每轮重建渐变并重光栅化
   */
  const veilBakeRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const commit = (slot: BackgroundSlotView) => {
      const previousSlot = currentRef.current
      currentRef.current = slot
      if (previousSlot && previousSlot.generation !== slot.generation) {
        setPrevious(previousSlot)
        // 交叉淡化 900ms 结束后释放旧图层,避免两张全屏图长期叠加合成
        window.setTimeout(() => {
          setPrevious((prev) => (prev?.generation === previousSlot.generation ? null : prev))
        }, 1000)
      }
      setCurrent(slot)
    }
    const handleState = (state: BackgroundState | null) => {
      // 背景图目录被改空/不可用:主进程推送 null,清空全部图层回到纯底色
      if (!state) {
        currentRef.current = null
        setCurrent(null)
        setPrevious(null)
        return
      }
      const slot: BackgroundSlotView = {
        generation: state.generation,
        url: state.url,
        imageWidth: state.imageWidth,
        imageHeight: state.imageHeight,
        crop: state.crop,
        overlayUrl: overlayUrlFor(state, overlayUrlsRef.current)
      }
      const previousSlot = currentRef.current
      if (previousSlot && previousSlot.generation === slot.generation) {
        // 同代更新(识别结果/线框就绪):即时生效
        currentRef.current = slot
        setCurrent(slot)
        return
      }
      if (previousSlot && slot.generation < previousSlot.generation) {
        return
      }
      // 换代:等图片加载完成再切入,避免显示半加载状态。解码交给 img 的
      // decoding="async"(渲染端异步解码);不挂 decode() 承诺链——它偶发不
      // settle,一旦挂起整个背景就永远空白,风险远大于省下的一次首帧解码
      const image = new Image()
      image.onload = () => {
        if (currentRef.current && slot.generation <= currentRef.current.generation) {
          return
        }
        commit(slot)
      }
      image.src = slot.url
    }
    // 先订阅再拉取,避免错过挂载前推送的帧;同代重复帧幂等
    const unsubscribe = window.api.onBackgroundState(handleState)
    void window.api.getCurrentBackgroundState().then((state) => {
      if (state) {
        handleState(state)
      }
    })
    return unsubscribe
  }, [])

  // 交叉淡化:用与 CSS 动画同一曲线的 rAF 步进,把进度喂给玻璃场景
  useEffect(() => {
    if (!previous || !current) {
      setFade(1)
      return
    }
    const startedAt = performance.now()
    let raf = 0
    let lastStep = -Infinity
    setFade(0)
    const step = (now: number) => {
      const elapsed = now - startedAt
      const progress = easeInOutCubic(Math.min(1, elapsed / CROSSFADE_MS))
      if (elapsed - lastStep >= SCENE_STEP_MS || progress >= 1) {
        lastStep = elapsed
        setFade(progress)
      }
      if (progress < 1) {
        raf = requestAnimationFrame(step)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [previous, current])

  // 图片尚未解码完成时晚一帧再发布场景,避免玻璃里出现空一帧
  useEffect(() => {
    const images = [
      previousImageRef.current,
      currentImageRef.current,
      currentOverlayRef.current,
      previousOverlayRef.current
    ].filter((img): img is HTMLImageElement => Boolean(img) && !img!.complete)
    if (images.length === 0) return
    let cancelled = false
    const onLoad = () => {
      if (!cancelled) setImageNonce((n) => n + 1)
    }
    for (const img of images) img.addEventListener('load', onLoad, { once: true })
    return () => {
      cancelled = true
      for (const img of images) img.removeEventListener('load', onLoad)
    }
  }, [current, previous, imageNonce])

  // 遮罩的显隐是 DOM 侧 300ms CSS 过渡;rAF 跟踪其实际进度同步给画布渐变,
  // 让玻璃里的遮罩浓度与玻璃外保持一致
  useEffect(() => {
    const el = veilRef.current
    if (!el) return
    let raf = 0
    const step = () => {
      const current = Number(getComputedStyle(el).opacity)
      setVeilAlpha((prev) => (Math.abs(prev - current) > 0.01 ? current : prev))
      if (Math.abs(current - (masked ? 1 : 0)) > 0.01) {
        raf = requestAnimationFrame(step)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [masked])

  /** 遮罩浓度是否为可见态(0.001 以下视为关闭,与旧 paint 指令的阈值一致) */
  const veilVisible = veilAlpha > 0.001

  // 烘焙衬底遮罩:线性 + 径向两层渐变合绘到一张视口大小的画布(坐标系与旧的
  // paint 指令一致:设备像素、原点在视口左上)。浓度或窗口尺寸变化时重烘一张,
  // 替代「每玻璃每轮重建渐变 + 全屏重光栅化」——原来是 35 个玻璃 × 每轮 2 次,
  // 现在整帧最多 1 次。画布内容变化后 invalidateScene 让玻璃补画。
  useEffect(() => {
    const canvas = veilBakeRef.current
    if (!canvas) return
    const bake = () => {
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(window.innerWidth * dpr))
      const h = Math.max(1, Math.round(window.innerHeight * dpr))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      if (veilVisible) {
        const bgHsl = themeBackgroundHsl()
        const gradient = ctx.createLinearGradient(0, 0, 0, h)
        gradient.addColorStop(0, `hsl(${bgHsl} / ${maskAlpha(0.75) * veilAlpha})`)
        gradient.addColorStop(0.5, `hsl(${bgHsl} / ${maskAlpha(0.45) * veilAlpha})`)
        gradient.addColorStop(1, `hsl(${bgHsl} / ${maskAlpha(0.85) * veilAlpha})`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)
        // 与 CSS radial-gradient(ellipse at top, transparent, …) 等价:
        // 椭圆中心在顶边中点,半径取"盒子宽高比 + 过最远角"的默认尺寸
        const farthestCornerScale = Math.sqrt(5) / 2
        const rx = w * farthestCornerScale
        const ry = h * farthestCornerScale
        const stretch = rx / ry
        ctx.save()
        ctx.translate(w / 2, 0)
        ctx.scale(stretch, 1)
        const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, ry)
        radial.addColorStop(0, `hsl(${bgHsl} / 0)`)
        radial.addColorStop(1, `hsl(${bgHsl} / ${maskAlpha(0.55) * veilAlpha})`)
        ctx.fillStyle = radial
        ctx.fillRect(-w / 2 / stretch, 0, w / stretch, h)
        ctx.restore()
      }
      // 画布内容已更新:让玻璃补画一次(场景采样的是这张画布)
      scene.invalidateScene(canvas)
    }
    bake()
    window.addEventListener('resize', bake)
    return () => window.removeEventListener('resize', bake)
  }, [scene, veilAlpha, veilVisible, maskOpacity])

  // 注册玻璃场景:底色 → 旧图 → 新图(带淡化 alpha) → 衬底遮罩(烘焙画布)。
  // 遮罩层的可见性(增删)由浓度是否为零决定;浓度过渡的连续变化由上面的
  // 烘焙 effect 以 invalidateScene 驱动补画,无需重建场景链
  useEffect(() => {
    const layers: SceneLayer[] = [{ color: themeBackgroundColor() }]
    if (previous) {
      if (previousImageRef.current) layers.push({ el: previousImageRef.current })
      if (previousOverlayRef.current) layers.push({ el: previousOverlayRef.current })
    }
    if (current) {
      const alpha = previous ? fade : 1
      if (currentImageRef.current) layers.push({ el: currentImageRef.current, alpha })
      if (currentOverlayRef.current) layers.push({ el: currentOverlayRef.current, alpha })
    }
    const veilCanvas = veilBakeRef.current
    if (veilCanvas && veilVisible) {
      layers.push({ el: veilCanvas })
    }
    scene.setBackgroundLayers(layers)
  }, [scene, current, previous, fade, imageNonce, veilVisible])

  /** 遮罩强度换算:各层 alpha = 完整强度 × 比例(完整强度即最初的 75/45/85 与径向 55%) */
  const maskScale = Math.min(1, Math.max(0, maskOpacity / 100))
  const maskAlpha = (full: number): number => Number((full * maskScale).toFixed(4))

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background">
      {previous && (
        <SlotLayer
          key={`prev-${previous.generation}`}
          slot={previous}
          fadingIn={false}
          imageRef={previousImageRef}
          overlayRef={previousOverlayRef}
        />
      )}
      {current && (
        <SlotLayer
          key={current.generation}
          slot={current}
          fadingIn
          imageRef={currentImageRef}
          overlayRef={currentOverlayRef}
        />
      )}
      {/* 衬底遮罩的烘焙画布(供玻璃场景采样):visibility:hidden 保留几何尺寸,
          glass 引擎按 rect 取用;不参与视觉呈现与指针交互 */}
      <canvas
        ref={veilBakeRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ visibility: 'hidden' }}
      />
      {/* 衬托 UI 的暗化遮罩(浓度可在设置里调);隐藏 UI(F9)时随界面一同淡出,让背景完整露出 */}
      <div
        ref={veilRef}
        className={cn(
          'absolute inset-0 transition-opacity duration-300',
          !masked && 'opacity-0'
        )}
        style={{
          backgroundImage: `linear-gradient(to bottom, hsl(var(--background) / ${maskAlpha(0.75)}), hsl(var(--background) / ${maskAlpha(0.45)}), hsl(var(--background) / ${maskAlpha(0.85)}))`
        }}
      />
      <div
        ref={veilRadialRef}
        className={cn(
          'absolute inset-0 transition-opacity duration-300',
          !masked && 'opacity-0'
        )}
        style={{
          backgroundImage: `radial-gradient(ellipse at top, transparent 0%, hsl(var(--background) / ${maskAlpha(0.55)}) 100%)`
        }}
      />
    </div>
  )
}
