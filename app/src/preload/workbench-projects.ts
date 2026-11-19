import { ipcRenderer } from 'electron'
import type { WorkbenchProjectsApi } from '../shared/workbench-projects'

export const workbenchProjectsApi: WorkbenchProjectsApi = {
  currentWorkbenchProject: () => ipcRenderer.invoke('workbench-projects:current'),
  selectWorkbenchProject: (command) => ipcRenderer.invoke('workbench-projects:select', command),
  removeWorkbenchAsset: (asset) => ipcRenderer.invoke('workbench-projects:remove', asset),
  trashWorkbenchFile: (file) => ipcRenderer.invoke('workbench-projects:trash', file),
  showWorkbenchFolder: (target) => ipcRenderer.invoke('workbench-projects:folder', target),
  buildWorkbenchProject: () => ipcRenderer.invoke('workbench-projects:build')
}
