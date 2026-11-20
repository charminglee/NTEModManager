import { createElement, useEffect, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { formatFileSize } from '@/lib/format'
import type { AssetEntry, AssetPreview } from '@shared/workbench-assets'

type Preview = Pick<AssetPreview, 'format' | 'name'> & { value: string }

export default function WorkbenchAssetPreview({ entry }: { entry: AssetEntry }) {
  const name = entry.path.slice(entry.path.lastIndexOf('/') + 1)
  const canPreview = /\.(?:uasset|umap|json)$/i.test(name)
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!canPreview) return
    let active = true
    let objectUrl: string | undefined
    const timer = setTimeout(async () => {
      try {
        const { format, name: previewName, bytes } = await window.api.workbenchAssetPreview(entry)
        if (format === 'model' && active) await import('@google/model-viewer')
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

  return <>
    <div className="min-w-0 shrink-0 border-b border-border px-4 py-3">
      <p className="truncate text-sm font-semibold" title={entry.path}>{name}</p>
      <p className="truncate text-xs text-muted-foreground select-text" title={entry.path}>{entry.path}</p>
      <p className="truncate text-xs text-muted-foreground select-text" title={entry.archive}>
        {entry.archive} · {formatFileSize(entry.size)}
      </p>
    </div>
    {error && <p role="alert" className="shrink-0 break-all px-4 py-2 text-sm text-destructive">{error}</p>}
    {canPreview && !preview && !error && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">正在读取资源……</p>}
    {preview?.format === 'json' && <pre className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4 text-xs select-text">{preview.value}</pre>}
    {preview?.format === 'texture' && <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <img className="max-h-full max-w-full object-contain" src={preview.value} alt={preview.name} />
    </div>}
    {preview?.format === 'model' && createElement('model-viewer', {
      src: preview.value, alt: preview.name, 'camera-controls': true,
      onError: () => setError('模型渲染失败。'), class: 'block min-h-0 w-full flex-1'
    })}
    {!canPreview && <div className="workbench-assets-empty">
      <PackageOpen size={24} aria-hidden="true" />
      <p>此文件格式暂不支持预览。</p>
    </div>}
  </>
}
