import { createElement, useEffect, useRef, useState } from 'react'
import type { ModelViewerElement } from '@google/model-viewer'
import { LoaderCircle } from 'lucide-react'
import type { AssetEntry, AssetPreview } from '@shared/workbench-assets'
import modelLight from '../assets/workbench-model-light.hdr?url'
import modelSky from '../assets/workbench-model-sky.jpg'
import WorkbenchJsonPreview from './workbench-json-preview'

type Preview = Pick<AssetPreview, 'format' | 'name'> & { value: string }

export default function WorkbenchAssetPreview({ entry }: { entry: AssetEntry }) {
  const canPreview = /\.(?:uasset|umap|json)$/i.test(entry.path)
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState('')
  const modelViewer = useRef<ModelViewerElement>(null)

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

  useEffect(() => {
    const viewer = modelViewer.current
    if (!viewer) return

    const fitScene = async () => {
      if (!viewer.loaded) return
      const { x, y, z } = viewer.getDimensions()
      const extent = Math.max(x, y, z)
      if (extent > 0) viewer.skyboxHeight = `${extent}m`
      // 等天空投影生效后再更新相机的裁剪距离。
      await viewer.updateComplete
      if (viewer.isConnected) await viewer.updateFraming()
    }
    viewer.addEventListener('load', fitScene)
    viewer.addEventListener('environment-change', fitScene)
    void fitScene()
    return () => {
      viewer.removeEventListener('load', fitScene)
      viewer.removeEventListener('environment-change', fitScene)
    }
  }, [preview])

  if (!canPreview) return <WorkbenchJsonPreview value={JSON.stringify(entry, null, 4)} />

  return <>
    {error && <p role="alert" className="shrink-0 break-all px-4 py-2 text-sm text-destructive">{error}</p>}
    {!preview && !error && <div role="status" className="grid min-h-0 flex-1 place-items-center text-muted-foreground">
      <LoaderCircle size={28} className="motion-safe:animate-spin" aria-hidden="true" />
      <span className="sr-only">正在读取资源……</span>
    </div>}
    {preview?.format === 'json' && <WorkbenchJsonPreview value={preview.value} />}
    {preview?.format === 'texture' && <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      <img className="max-h-full max-w-full object-contain" src={preview.value} alt={preview.name} />
    </div>}
    {preview?.format === 'model' && createElement('model-viewer', {
      ref: modelViewer, src: preview.value, alt: preview.name, 'camera-controls': true,
      'skybox-image': modelSky, 'skybox-height': '1m', 'environment-image': modelLight,
      'camera-orbit': '0deg 82deg auto',
      onError: () => setError('模型渲染失败。'), class: 'block min-h-0 w-full flex-1'
    })}
  </>
}
