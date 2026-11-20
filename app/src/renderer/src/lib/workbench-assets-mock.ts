import type { workbenchAssetsApi } from '../../../preload/workbench-assets'
import type { AssetEntry, AssetFormat } from '../../../shared/workbench-assets'
import { assetResults, effectiveAssets } from '../../../shared/workbench-assets-filter'

const base = 'Paks/pakchunk0-Windows.utoc'
const patch = 'PatchPaks/pakchunk0-Windows_0_P.utoc'
const rows: AssetEntry[] = [
  { path: 'HT/Content/Demo/SM_Triangle.uasset', archive: base, size: 4096, encrypted: true, order: 3 },
  { path: 'HT/Content/Demo/T_Palette.uasset', archive: base, size: 2048, encrypted: true, order: 3 },
  { path: 'HT/Content/Demo/T_Palette.uasset', archive: patch, size: 3072, encrypted: true, order: 103 },
  { path: 'HT/Content/Demo/UI_Style.uasset', archive: patch, size: 512, encrypted: true, order: 103 }
]
let indexed = false
const snapshots = new Map([['示例旧版本', effectiveAssets(rows.slice(0, 2))]])
const state = () => ({ count: indexed ? rows.length : 0, archives: indexed ? [base, patch] : [], snapshots: [...snapshots.keys()].reverse() })

async function sample(entry: AssetEntry, format: AssetFormat) {
  const name = entry.path.split('/').pop()!.replace('.uasset', '')
  if (format === 'texture' && name.startsWith('T_')) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const brush = canvas.getContext('2d')!
    const color = brush.createLinearGradient(0, 0, 128, 128)
    color.addColorStop(0, '#84afa8')
    color.addColorStop(1, '#383254')
    brush.fillStyle = color
    brush.fillRect(0, 0, 128, 128)
    const image = await new Promise<Blob>((done, fail) => canvas.toBlob(b => b ? done(b) : fail(new Error('生成示例贴图失败。'))))
    return { name: name + '.png', bytes: new Uint8Array(await image.arrayBuffer()) }
  }
  if (format === 'model' && name.startsWith('SM_')) {
    const positions = new Float32Array([-1, -0.5, 0, 1, -0.5, 0, 0, 1, 0])
    const doc = {
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: positions.byteLength }],
      bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -0.5, 0], max: [1, 1, 0] }]
    }
    const json = JSON.stringify(doc)
    const header = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4))
    const bytes = new Uint8Array(28 + header.length + positions.byteLength)
    const view = new DataView(bytes.buffer)
    const words = [0x46546c67, 2, bytes.length, header.length, 0x4e4f534a]
    words.forEach((n, i) => view.setUint32(i * 4, n, true))
    bytes.set(header, 20)
    view.setUint32(20 + header.length, positions.byteLength, true)
    view.setUint32(24 + header.length, 0x004e4942, true)
    bytes.set(new Uint8Array(positions.buffer), 28 + header.length)
    return { name: name + '.glb', bytes }
  }
  if (format !== 'json') throw new Error('此示例没有该格式的数据。')
  return { name: name + '.json', bytes: new TextEncoder().encode(JSON.stringify({ Name: name, Path: entry.path,
    Source: entry.archive, Size: entry.size }, null, 2)) }
}

export const workbenchAssetsMock = {
  async workbenchAssetState() { return state() },
  async workbenchAssetIndex() { indexed = true; return state() },
  async workbenchAssetSnapshot() {
    snapshots.set(new Date().toISOString(), effectiveAssets(rows))
    return state()
  },
  async workbenchAssetQuery(query) {
    const selected = query.mode === 'all' ? rows : [...effectiveAssets(rows).values()]
    return assetResults(indexed ? selected : [], query, snapshots.get(query.snapshot))
  },
  workbenchAssetPreview: sample,
  async workbenchAssetExport(entry, format) {
    if (format === 'raw') throw new Error('浏览器示例仅提供预览格式，原始包导出需使用桌面版。')
    const file = await sample(entry, format)
    const url = URL.createObjectURL(new Blob([file.bytes]))
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return '浏览器下载目录／' + file.name
  }
} satisfies typeof workbenchAssetsApi
