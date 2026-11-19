import { ipcRenderer } from 'electron'
import type { SpineFile } from '../shared/workbench-spine'

export const workbenchSpineApi = {
  saveSpineFiles: (files: SpineFile[]): Promise<string | null> =>
    ipcRenderer.invoke('workbench-spine:save', files)
}
