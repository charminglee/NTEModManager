import { dialog, ipcMain } from 'electron'
import { basename, join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { SpineFile } from '../shared/workbench-spine'
import { defaultWorkbenchExportDirectory } from './config'

export function registerWorkbenchSpine() {
  ipcMain.handle('workbench-spine:save', async (_, files: SpineFile[]) => {
    if (
      !Array.isArray(files) ||
      !files.length ||
      files.length > 2 ||
      files.some(
        (file) =>
          !/^[\w\p{L} -][\w\p{L} .-]*\.(uasset|uexp|skel|json)$/iu.test(file.name) ||
          /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(file.name) ||
          !(file.bytes instanceof Uint8Array)
      )
    )
      throw new Error('Spine 输出文件无效。')
    const result = await dialog.showOpenDialog({
      title: '选择 Spine 导出位置',
      defaultPath: defaultWorkbenchExportDirectory(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    const parent = result.filePaths[0]
    await mkdir(parent, { recursive: true })
    const folder = await mkdtemp(join(parent, basename(files[0].name).replace(/\.[^.]+$/, '') + '-'))
    try {
      for (const file of files) await writeFile(join(folder, file.name), file.bytes, { flag: 'wx' })
    } catch (error) {
      await rm(folder, { recursive: true, force: true })
      throw error
    }
    return folder
  })
}
