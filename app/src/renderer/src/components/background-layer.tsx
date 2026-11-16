import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  BACKGROUND_MASK_OPACITY_DEFAULT,
  type BackgroundRect,
  type BackgroundState
} from '@shared/types'
interface Slot {
  generation: number
  url: string
  imageWidth: number
  imageHeight: number
  crop: BackgroundRect
  overlayUrl: string | null
}
function BackgroundSlot({ slot, incoming }: { slot: Slot; incoming?: boolean }) {
  if (slot.crop.width <= 0 || slot.crop.height <= 0) return null
  const geometry: CSSProperties = {
    width: `${(slot.imageWidth / slot.crop.width) * 100}%`,
    height: `${(slot.imageHeight / slot.crop.height) * 100}%`,
    left: `${(-slot.crop.x / slot.crop.width) * 100}%`,
    top: `${(-slot.crop.y / slot.crop.height) * 100}%`
  }
  return (
    <div className={incoming ? 'background-slot is-incoming' : 'background-slot'}>
      <img src={slot.url} alt="" draggable={false} style={geometry} />
      {slot.overlayUrl && <img src={slot.overlayUrl} alt="" draggable={false} style={geometry} />}
    </div>
  )
}
/** 背景轮播仅负责图像显示，不再维护面板渲染画布。 */
export default function BackgroundLayer({
  masked = true,
  maskOpacity = BACKGROUND_MASK_OPACITY_DEFAULT
}: {
  masked?: boolean
  maskOpacity?: number
}) {
  const [current, setCurrent] = useState<Slot | null>(null)
  const [previous, setPrevious] = useState<Slot | null>(null)
  const currentRef = useRef<Slot | null>(null)
  useEffect(() => {
    let live = true
    let request = 0
    let latestGeneration = -1
    const overlays = new Map<number, string>()
    const handleState = (state: BackgroundState | null) => {
      if (!live) return
      if (!state) {
        request++
        latestGeneration = -1
        currentRef.current = null
        setCurrent(null)
        setPrevious(null)
        return
      }
      if (state.generation < latestGeneration) return
      latestGeneration = state.generation
      let overlayUrl = state.debugOverlay?.byteLength
        ? (overlays.get(state.generation) ?? null)
        : null
      if (state.debugOverlay?.byteLength && !overlayUrl) {
        overlayUrl = URL.createObjectURL(new Blob([state.debugOverlay], { type: 'image/png' }))
        overlays.set(state.generation, overlayUrl)
      }
      const slot: Slot = {
        generation: state.generation,
        url: state.url,
        imageWidth: state.imageWidth,
        imageHeight: state.imageHeight,
        crop: state.crop,
        overlayUrl
      }
      if (currentRef.current?.generation === state.generation) {
        currentRef.current = slot
        setCurrent(slot)
        return
      }
      const token = ++request
      const image = new Image()
      image.onload = () => {
        if (!live || token !== request) return
        setPrevious(currentRef.current)
        currentRef.current = slot
        setCurrent(slot)
        for (const [generation, url] of overlays)
          if (generation < slot.generation - 1) {
            URL.revokeObjectURL(url)
            overlays.delete(generation)
          }
      }
      image.src = state.url
    }
    const unsubscribe = window.api.onBackgroundState(handleState)
    void window.api.getCurrentBackgroundState().then((state) => {
      if (state) handleState(state)
    })
    return () => {
      live = false
      unsubscribe()
      for (const url of overlays.values()) URL.revokeObjectURL(url)
    }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => setPrevious(null), 1000)
    return () => window.clearTimeout(timer)
  }, [current?.generation])
  return (
    <div className="app-background" aria-hidden>
      {previous && <BackgroundSlot key={`previous-${previous.generation}`} slot={previous} />}
      {current && <BackgroundSlot key={current.generation} slot={current} incoming />}
      <div className="background-mask" style={{ opacity: masked ? maskOpacity / 100 : 0 }} />
    </div>
  )
}
