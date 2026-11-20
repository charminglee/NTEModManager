import { ipcRenderer } from 'electron'
import type { AssetDirectory, AssetEntry, AssetFormat, AssetPreview, AssetQuery, AssetState } from '../shared/workbench-assets'

export const workbenchAssetsApi = {
  workbenchAssetState: (): Promise<AssetState> => ipcRenderer.invoke('assets:state'),
  workbenchAssetIndex: (): Promise<AssetState> => ipcRenderer.invoke('assets:index'),
  workbenchAssetSnapshot: (): Promise<AssetState> => ipcRenderer.invoke('assets:snapshot'),
  workbenchAssetQuery: (query: AssetQuery): Promise<AssetDirectory> =>
    ipcRenderer.invoke('assets:query', query),
  workbenchAssetPreview: (entry: AssetEntry, format: Exclude<AssetFormat, 'raw'>): Promise<AssetPreview> =>
    ipcRenderer.invoke('assets:preview', entry, format),
  workbenchAssetExport: (entry: AssetEntry, format: AssetFormat): Promise<string> =>
    ipcRenderer.invoke('assets:export', entry, format)
}
