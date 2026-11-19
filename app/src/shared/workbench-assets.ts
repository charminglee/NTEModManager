export type AssetMode = 'multiple' | 'all' | 'new' | 'modified' | 'unpatched'
export type AssetFormat = 'json' | 'texture' | 'model' | 'raw'

export interface AssetEntry {
  path: string
  archive: string
  size: number
  encrypted: boolean
  order: number
}

export interface AssetQuery {
  mode: AssetMode
  archives: string[]
  snapshot: string
  search: string
  page: number
}

export const assetPageSize = 60

export interface AssetState {
  count: number
  archives: string[]
  snapshots: string[]
}

export interface AssetPreview {
  name: string
  bytes: Uint8Array
}
