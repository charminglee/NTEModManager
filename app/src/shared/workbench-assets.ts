export type AssetMode = 'all' | 'new' | 'modified' | 'unpatched'
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
  directory: string
  page: number
}

export const assetPageSize = 60

export interface AssetDirectory {
  count: number
  folders: string[]
  rows: AssetEntry[]
  more: boolean
}

export interface AssetState {
  count: number
  archives: string[]
  snapshots: string[]
}

export interface AssetPreview {
  name: string
  bytes: Uint8Array
}
