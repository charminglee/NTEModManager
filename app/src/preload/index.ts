import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppConfigData,
  AppConfigPatch,
  BackgroundState,
  ImportResult,
  LogEntry,
  ModInfo,
  OperationResult,
  SortOrder
} from '../shared/types'

export interface BootstrapPayload {
  config: AppConfigData
  mods: ModInfo[]
  logs: LogEntry[]
  initialization: OperationResult
  /** 冒烟测试用:启动时自动打开设置界面 */
  autoOpenSettings: boolean
}

const api = {
  bootstrap: (): Promise<BootstrapPayload> => ipcRenderer.invoke('app:bootstrap'),
  scanMods: (): Promise<ModInfo[]> => ipcRenderer.invoke('mods:scan'),

  importArchives: (archivePaths: string[]): Promise<ImportResult[]> =>
    ipcRenderer.invoke('mods:import', archivePaths),
  installMod: (name: string): Promise<OperationResult> => ipcRenderer.invoke('mods:install', name),
  uninstallMod: (name: string): Promise<OperationResult> => ipcRenderer.invoke('mods:uninstall', name),
  removeMod: (name: string): Promise<OperationResult> => ipcRenderer.invoke('mods:remove', name),
  renameMod: (oldName: string, newName: string): Promise<OperationResult> =>
    ipcRenderer.invoke('mods:rename', oldName, newName),
  setModInvalid: (name: string, invalid: boolean): Promise<OperationResult> =>
    ipcRenderer.invoke('mods:setInvalid', name, invalid),
  renameModFile: (name: string, relativePath: string, newFileName: string): Promise<OperationResult> =>
    ipcRenderer.invoke('mods:renameFile', name, relativePath, newFileName),
  addModArchive: (name: string, archivePath: string): Promise<OperationResult> =>
    ipcRenderer.invoke('mods:addArchive', name, archivePath),
  replaceModArchive: (name: string, archivePath: string): Promise<OperationResult> =>
    ipcRenderer.invoke('mods:replaceArchive', name, archivePath),
  installAll: (category: string): Promise<{ result: OperationResult }> =>
    ipcRenderer.invoke('mods:installAll', category),
  uninstallAll: (category: string): Promise<{ result: OperationResult }> =>
    ipcRenderer.invoke('mods:uninstallAll', category),

  runPackager: (sourceDirectory?: string): Promise<OperationResult> =>
    ipcRenderer.invoke('package:run', sourceDirectory),
  getLastPackagingPath: (name: string): Promise<string> =>
    ipcRenderer.invoke('package:lastPath', name),
  setLastPackagingPath: (name: string, path: string): Promise<OperationResult> =>
    ipcRenderer.invoke('package:setLastPath', name, path),
  importPackagedMod: (modName: string): Promise<OperationResult> =>
    ipcRenderer.invoke('package:import', modName),
  repackageMod: (name: string): Promise<OperationResult> =>
    ipcRenderer.invoke('package:repackage', name),

  getConfig: (): Promise<AppConfigData> => ipcRenderer.invoke('config:get'),
  updateConfig: (patch: AppConfigPatch): Promise<AppConfigData> =>
    ipcRenderer.invoke('config:update', patch),
  openConfigFile: (): Promise<OperationResult> => ipcRenderer.invoke('config:open'),
  setSortOrder: (sortOrder: SortOrder): Promise<OperationResult> =>
    ipcRenderer.invoke('config:setSortOrder', sortOrder),
  setCategoryOrder: (order: string[]): Promise<OperationResult> =>
    ipcRenderer.invoke('config:setCategoryOrder', order),

  pickArchive: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickArchive'),
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDirectory', defaultPath),
  pickFile: (options?: { title?: string; extensions?: string[]; defaultPath?: string }): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFile', options),

  openPath: (path: string): Promise<OperationResult> => ipcRenderer.invoke('path:open', path),
  showInFolder: (path: string): Promise<OperationResult> => ipcRenderer.invoke('path:showInFolder', path),

  launchGame: (): Promise<OperationResult> => ipcRenderer.invoke('launcher:run'),

  getLogEntries: (): Promise<LogEntry[]> => ipcRenderer.invoke('log:entries'),

  nextBackground: (): Promise<OperationResult> => ipcRenderer.invoke('background:next'),
  toggleBackgroundDebugMode: (): Promise<OperationResult> =>
    ipcRenderer.invoke('background:toggleDebugMode'),
  getCurrentBackgroundPath: (): Promise<string | null> =>
    ipcRenderer.invoke('background:currentPath'),
  getCurrentBackgroundState: (): Promise<BackgroundState | null> =>
    ipcRenderer.invoke('background:currentState'),
  onBackgroundState: (callback: (state: BackgroundState) => void): (() => void) => {
    const listener = (_event: unknown, state: BackgroundState) => callback(state)
    ipcRenderer.on('background:state', listener)
    return () => ipcRenderer.removeListener('background:state', listener)
  },
  getCategoryImage: (category: string): Promise<string | null> =>
    ipcRenderer.invoke('category:image', category),
  getAppIcon: (): Promise<string | null> => ipcRenderer.invoke('app:icon'),

  /** 拖放的 File 对象转本地路径(Electron ≥ 32 移除了 File.path)。 */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  onProgress: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: unknown, message: string) => callback(message)
    ipcRenderer.on('op:progress', listener)
    return () => ipcRenderer.removeListener('op:progress', listener)
  },
  onLogEntry: (callback: (entry: LogEntry) => void): (() => void) => {
    const listener = (_event: unknown, entry: LogEntry) => callback(entry)
    ipcRenderer.on('log:entry', listener)
    return () => ipcRenderer.removeListener('log:entry', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
