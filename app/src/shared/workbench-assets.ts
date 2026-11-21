export type AssetMode = 'all' | 'new' | 'modified' | 'unpatched'
export type AssetExportKind = 'texture' | 'model' | 'blueprint' | 'animation' | 'audio'
export type AssetPreviewMode = 'auto' | 'json' | 'blueprint'
export type AssetReference = Pick<AssetEntry, 'path' | 'archive'>

export type AssetExportRequest =
  | { entries: AssetReference[] }
  | { folder: AssetQuery; kind: AssetExportKind }

export interface AssetExportResult {
  directory: string
  exported: number
  failures: string[]
}

export interface AssetEntry {
  path: string
  archive: string
  size: number
  encrypted: boolean
  order: number
  assetClass?: string
}

export interface AssetQuery {
  mode: AssetMode
  archives: string[]
  snapshot: string
  search: string
  directory: string
  onlyHtContent: boolean
}

export interface AssetDirectory {
  count: number
  folders: string[]
  rows: AssetEntry[]
}

export interface AssetState {
  count: number
  archives: string[]
  snapshots: string[]
}

export interface AssetPreview {
  format: 'json' | 'texture' | 'model' | 'blueprint'
  name: string
  bytes: Uint8Array
}

export function isBlueprintClass(assetClass?: string): boolean {
  return !!assetClass && /Blueprint(?:GeneratedClass|FunctionLibrary|Interface)?$/i.test(assetClass)
}

export function assetExportKind({ assetClass, path }: AssetReference & Pick<AssetEntry, 'assetClass'>): AssetExportKind | undefined {
  if (isBlueprintClass(assetClass)) return 'blueprint'
  if (assetClass?.match(/^(?:Texture|VirtualTexture|LightMapTexture|ShadowMapTexture)/)) return 'texture'
  if (assetClass?.match(/^(?:StaticMesh|SkeletalMesh|GeometryCollection)$/)) return 'model'
  if (assetClass?.match(/^(?:AnimSequence|AnimMontage|AnimComposite|AnimStreamable|BlendSpace|AimOffsetBlendSpace|PoseAsset)/)) return 'animation'
  if (assetClass?.match(/^(?:SoundWave|SoundNodeWave|AkMediaAsset)/) || /\.(?:wav|wem|ogg|mp3|flac|opus|aac|acb|awb)$/i.test(path)) return 'audio'
}
