import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BackgroundRect, BackgroundState } from '@shared/types'
import { cn } from '@/lib/utils'

interface BackgroundSlotView {
  generation: number
  url: string
  imageWidth: number
  imageHeight: number
  crop: BackgroundRect
  overlayUrl: string | null
}

/**
 * 单个背景槽位:源图与调试线框按裁剪矩形几何铺满视口。
 * 裁剪矩形与视口同比例,故用纯百分比定位即可,无需监听窗口尺寸。
 * 通过 key=generation 保证换代时元素重挂载,交叉淡化动画每次都会重放。
 */
function SlotLayer({ slot, fadingIn }: { slot: BackgroundSlotView; fadingIn: boolean }) {
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
        src={slot.url}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        style={geometry}
      />
      {slot.overlayUrl && (
        <img
          src={slot.overlayUrl}
          alt=""
          draggable={false}
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
 */
export default function BackgroundLayer({ masked = true }: { masked?: boolean }) {
  const [current, setCurrent] = useState<BackgroundSlotView | null>(null)
  const [previous, setPrevious] = useState<BackgroundSlotView | null>(null)
  const currentRef = useRef<BackgroundSlotView | null>(null)
  const overlayUrlsRef = useRef(new Map<number, string>())

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
    const handleState = (state: BackgroundState) => {
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
      // 换代:等图片完全解码后再切入,避免显示半加载状态
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

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background">
      {previous && <SlotLayer key={`prev-${previous.generation}`} slot={previous} fadingIn={false} />}
      {current && <SlotLayer key={current.generation} slot={current} fadingIn />}
      {/* 衬托 UI 的暗化遮罩;隐藏 UI(F11)时随界面一同淡出,让背景完整露出 */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-b from-background/75 via-background/45 to-background/85 transition-opacity duration-300',
          !masked && 'opacity-0'
        )}
      />
      <div
        className={cn(
          'absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,hsl(var(--background)/0.55)_100%)] transition-opacity duration-300',
          !masked && 'opacity-0'
        )}
      />
    </div>
  )
}
