import { lazy, Suspense, useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { AssetEntry, AssetPreview } from '@shared/workbench-assets'
import WorkbenchJsonPreview from './workbench-json-preview'

type Preview = Pick<AssetPreview, 'format' | 'name'> & { value: string }
const loadModelPreview = () => import('./workbench-model-preview')
const WorkbenchModelPreview = lazy(loadModelPreview)

export default function WorkbenchAssetPreview({ entry }: { entry: AssetEntry }) {
  const canPreview = /\.(?:uasset|umap|json)$/i.test(entry.path)
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!canPreview) return
    let active = true
    let objectUrl: string | undefined
    const timer = setTimeout(async () => {
      try {
        const { format, name: previewName, bytes } = await window.api.workbenchAssetPreview(entry)
        if (format === 'model' && active) await loadModelPreview()
        if (!active) return
        if (format !== 'json') {
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
  }, [entry, canPreview])

  if (!canPreview) return <WorkbenchJsonPreview value={JSON.stringify(entry, null, 4)} />

  const loading = <div role="status" className="grid min-h-0 flex-1 place-items-center text-muted-foreground">
    <LoaderCircle size={28} className="motion-safe:animate-spin" aria-hidden="true" />
    <span className="sr-only">正在读取资源……</span>
  </div>

  return <>
    {error && <p role="alert" className="shrink-0 break-all px-4 py-2 text-sm text-destructive">{error}</p>}
    {!preview && !error && loading}
    {preview?.format === 'json' && <WorkbenchJsonPreview value={preview.value} />}
    {preview?.format === 'texture' && <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <img className="max-h-full max-w-full object-contain" src={preview.value} alt={preview.name} />
    </div>}
    {preview?.format === 'model' && <Suspense fallback={loading}>
      <WorkbenchModelPreview src={preview.value} name={preview.name} onError={() => setError('模型渲染失败。')} />
    </Suspense>}
  </>
}
