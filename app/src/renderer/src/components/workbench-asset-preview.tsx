import { createElement, useEffect, useState } from 'react'
import { Download, PackageOpen } from 'lucide-react'
import { Button } from './ui/button'
import WorkbenchSelect from './workbench-select'
import type { AssetEntry, AssetFormat } from '@shared/workbench-assets'

type PreviewFormat = Exclude<AssetFormat, 'raw'>
type Preview = { format: PreviewFormat; value: string; name: string }

const formats: Record<AssetFormat, string> = { json: 'JSON 属性', texture: 'PNG 贴图', model: 'GLB 模型', raw: '容器原始文件' }

function defaultFormat(name: string): AssetFormat {
  if (/\.(?:uasset|umap)$/i.test(name)) {
    if (/^T_/i.test(name)) return 'texture'
    if (/^(SK|SM)_/i.test(name)) return 'model'
    return 'json'
  }
  return /\.json$/i.test(name) ? 'json' : 'raw'
}

export default function WorkbenchAssetPreview({ entry, autoOpen, disabled }: {
  entry: AssetEntry
  autoOpen: boolean
  disabled: boolean
}) {
  const name = entry.path.slice(entry.path.lastIndexOf('/') + 1)
  const [format, setFormat] = useState(() => defaultFormat(name))
  const [request, setRequest] = useState(() => autoOpen && format !== 'raw' ? { format } : undefined)
  const [preview, setPreview] = useState<Preview>()
  const [loading, setLoading] = useState(!!request)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')

  useEffect(() => {
    if (!request) return
    let active = true
    let objectUrl: string | undefined
    const timer = setTimeout(async () => {
      try {
        const { name: previewName, bytes } = await window.api.workbenchAssetPreview(entry, request.format)
        if (request.format === 'model' && active) await import('@google/model-viewer')
        if (!active) return
        if (request.format !== 'json') {
          objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {
            type: request.format === 'model' ? 'model/gltf-binary' : 'image/png'
          }))
        }
        setPreview({ name: previewName, format: request.format, value: objectUrl ?? new TextDecoder().decode(bytes) })
      } catch (reason) {
        if (active) setError(String(reason))
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => {
      active = false
      clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry, request])

  async function exportAsset() {
    setExporting(true)
    setExportMessage('')
    setError('')
    try {
      setExportMessage('导出目录：' + await window.api.workbenchAssetExport(entry, format))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setExporting(false)
    }
  }

  return <>
    <div className="grid shrink-0 gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" title={entry.path}>{name}</p>
        <p className="truncate text-xs text-muted-foreground select-text" title={entry.path}>{entry.path}</p>
        <p className="truncate text-xs text-muted-foreground select-text" title={entry.archive}>
          {entry.archive} · {entry.size.toLocaleString()} B
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WorkbenchSelect label="资源格式" className="w-auto" disabled={disabled || exporting} options={Object.entries(formats)}
          value={format} onValueChange={value => {
            setFormat(value as AssetFormat)
            setRequest(undefined)
            setPreview(undefined)
            setLoading(false)
            setError('')
            setExportMessage('')
          }} />
        <Button variant="secondary" disabled={format === 'raw' || loading || exporting} onClick={() => {
          if (format === 'raw') return
          setPreview(undefined)
          setError('')
          setLoading(true)
          setRequest({ format })
        }}>预览</Button>
        <Button variant="outline" disabled={exporting} onClick={exportAsset}>
          <Download aria-hidden="true" />{exporting ? '正在导出……' : '导出资源'}
        </Button>
      </div>
    </div>
    {error && <p role="alert" className="shrink-0 break-all px-4 py-2 text-sm text-destructive">{error}</p>}
    {exportMessage && <p role="status" className="shrink-0 break-all px-4 py-2 text-sm select-text">{exportMessage}</p>}
    {loading && <p role="status" className="px-4 py-3 text-sm text-muted-foreground">正在读取资源……</p>}
    {preview?.format === 'json' && <pre className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4 text-xs select-text">{preview.value}</pre>}
    {preview?.format === 'texture' && <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <img className="max-h-full max-w-full object-contain" src={preview.value} alt={preview.name} />
    </div>}
    {preview?.format === 'model' && createElement('model-viewer', {
      src: preview.value, alt: preview.name, 'camera-controls': true,
      onError: () => setError('模型渲染失败。'), class: 'block min-h-0 w-full flex-1'
    })}
    {!loading && !preview && !error && <div className="workbench-assets-empty">
      <PackageOpen size={24} aria-hidden="true" />
      <p>{format === 'raw' ? '此格式可导出原始文件。' : '双击文件或点击「预览」。'}</p>
    </div>}
  </>
}
