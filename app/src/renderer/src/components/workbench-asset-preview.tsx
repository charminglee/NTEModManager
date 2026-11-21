import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { AssetEntry, AssetPreview, AssetPreviewMode } from '@shared/workbench-assets'
import WorkbenchJsonPreview from './workbench-json-preview'

type Preview = Pick<AssetPreview, 'format' | 'name'> & { value: string }
const loadModelPreview = () => import('./workbench-model-preview')
const WorkbenchModelPreview = lazy(loadModelPreview)

function WorkbenchTexturePreview({ src, name }: { src: string; name: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current!
    const image = imageRef.current!
    let zoom = 1
    let x = 0
    let y = 0

    function onWheel(event: WheelEvent) {
      if (!image.naturalWidth || !event.deltaY) return
      event.preventDefault()
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1
      const nextZoom = Math.min(16, Math.max(1, zoom * Math.exp(-event.deltaY * multiplier / 500)))
      if (nextZoom === zoom) return
      if (nextZoom === 1) {
        x = y = 0
      } else {
        const bounds = image.getBoundingClientRect()
        const ratio = nextZoom / zoom
        const limitX = Math.abs(viewport.clientWidth - bounds.width * ratio) / 2
        const limitY = Math.abs(viewport.clientHeight - bounds.height * ratio) / 2
        x += (event.clientX - bounds.left - bounds.width / 2) * (1 - ratio)
        y += (event.clientY - bounds.top - bounds.height / 2) * (1 - ratio)
        x = Math.max(-limitX, Math.min(limitX, x))
        y = Math.max(-limitY, Math.min(limitY, y))
      }
      zoom = nextZoom
      image.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  return <div ref={viewportRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
    <img ref={imageRef} className="max-h-full max-w-full object-contain" src={src} alt={name} />
  </div>
}

export default function WorkbenchAssetPreview({ entry, mode }: { entry: AssetEntry; mode: AssetPreviewMode }) {
  const canPreview = /\.(?:uasset|umap)$/i.test(entry.path) || mode === 'auto' && /\.json$/i.test(entry.path)
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!canPreview) return
    let active = true
    let objectUrl: string | undefined
    const timer = setTimeout(async () => {
      try {
        const { format, name: previewName, bytes } = await window.api.workbenchAssetPreview(entry, mode)
        if (format === 'model' && active) await loadModelPreview()
        if (!active) return
        if (format === 'texture' || format === 'model') {
          objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {
            type: format === 'model' ? 'model/gltf-binary' : 'image/png'
          }))
        }
        setPreview({ name: previewName, format, value: objectUrl ?? new TextDecoder().decode(bytes) })
      } catch (reason) {
        if (active) setError(String(reason))
      }
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry, mode, canPreview])

  if (!canPreview) return <WorkbenchJsonPreview value={JSON.stringify(entry, null, 4)} />

  const loading = <div role="status" className="grid min-h-0 flex-1 place-items-center text-muted-foreground">
    <LoaderCircle size={28} className="motion-safe:animate-spin" aria-hidden="true" />
    <span className="sr-only">正在读取资源……</span>
  </div>

  return <>
    {error && <p role="alert" className="shrink-0 break-all px-4 py-2 text-sm text-destructive">{error}</p>}
    {!preview && !error && loading}
    {(preview?.format === 'json' || preview?.format === 'blueprint') &&
      <WorkbenchJsonPreview value={preview.value} code={preview.format === 'blueprint'} />}
    {preview?.format === 'texture' && <WorkbenchTexturePreview key={preview.value} src={preview.value} name={preview.name} />}
    {preview?.format === 'model' && <Suspense fallback={loading}>
      <WorkbenchModelPreview src={preview.value} name={preview.name} onError={() => setError('模型渲染失败。')} />
    </Suspense>}
  </>
}
