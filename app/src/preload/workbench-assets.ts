import { ipcRenderer } from 'electron'
import type { AssetDirectory, AssetExportRequest, AssetExportResult, AssetPreview, AssetPreviewMode, AssetQuery, AssetReference, AssetState } from '../shared/workbench-assets'

export const workbenchAssetsApi = {
  workbenchAssetState: (): Promise<AssetState> => ipcRenderer.invoke('assets:state'),
  workbenchAssetIndex: (): Promise<AssetState> => ipcRenderer.invoke('assets:index'),
  workbenchAssetSnapshot: (): Promise<AssetState> => ipcRenderer.invoke('assets:snapshot'),
  workbenchAssetQuery: (query: AssetQuery): Promise<AssetDirectory> =>
    ipcRenderer.invoke('assets:query', query),
  workbenchAssetPreview: (entry: AssetReference, mode: AssetPreviewMode): Promise<AssetPreview> =>
    ipcRenderer.invoke('assets:preview', entry, mode),
  workbenchAssetExport: (request: AssetExportRequest): Promise<AssetExportResult | null> =>
    ipcRenderer.invoke('assets:export', request)
}
