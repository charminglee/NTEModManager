import { createElement, useEffect, useRef } from 'react'
import '@google/model-viewer'
import type { ModelViewerElement } from '@google/model-viewer'
import { $scene } from '@google/model-viewer/lib/model-viewer-base.js'
import type { ModelScene } from '@google/model-viewer/lib/three-components/ModelScene.js'
import { GridHelper } from 'three'
import modelLight from '../assets/workbench-model-light.hdr?url'
import modelSky from '../assets/workbench-model-sky.jpg'

export default function WorkbenchModelPreview({ src, name, onError }: { src: string; name: string; onError: () => void }) {
  const modelViewer = useRef<ModelViewerElement>(null)

  useEffect(() => {
    const viewer = modelViewer.current!
    const scene = Reflect.get(viewer, $scene) as ModelScene
    const grid = new GridHelper(6, 24, 0x4f5864, 0x727a83)
    grid.material.transparent = true
    grid.material.opacity = 0.55
    grid.material.depthWrite = false
    grid.userData.noHit = true
    grid.visible = false
    scene.target.add(grid)

    const fitScene = async () => {
      if (!viewer.loaded) return
      const { x, y, z } = viewer.getDimensions()
      const extent = Math.max(x, y, z)
      if (extent > 0) {
        const center = viewer.getBoundingBoxCenter()
        viewer.skyboxHeight = `${extent}m`
        grid.position.set(center.x, 0, center.z)
        grid.scale.setScalar(extent)
        grid.visible = true
        scene.queueRender()
      }
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
      grid.removeFromParent()
      grid.dispose()
    }
  }, [src])

  return createElement('model-viewer', {
    ref: modelViewer, src, alt: name, 'camera-controls': true,
    'skybox-image': modelSky, 'skybox-height': '1m', 'environment-image': modelLight,
    'camera-orbit': '0deg 82deg auto',
    onError, class: 'block min-h-0 w-full flex-1'
  })
}
