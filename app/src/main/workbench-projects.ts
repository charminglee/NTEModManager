import { app, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { workbenchToolsDirectory } from './workbench-tools'
import { describeError, logger } from './logger'
import { buildProject, editorCommand, validateAsset } from './workbench-projects-build'
import type { ProjectCommand, WorkbenchProject } from '../shared/workbench-projects'

const manifest = 'ntemm-project.json'
let current: WorkbenchProject | null = null
let busy = false

function active(): WorkbenchProject {
  if (!current) throw new Error('请先打开模组项目。')
  return current
}

async function filesDirectory(project: WorkbenchProject): Promise<string> {
  const folder = path.join(project.directory, 'Files')
  await fs.mkdir(folder, { recursive: true })
  if (await fs.realpath(folder) !== folder) throw new Error('素材目录必须位于当前项目中。')
  return folder
}

async function refresh(project: WorkbenchProject): Promise<WorkbenchProject> {
  const entries = await fs.readdir(await filesDirectory(project), { withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()
  return { ...project, files }
}

function bindingFile(directory: string): string {
  const key = createHash('sha256').update(directory.toLowerCase()).digest('hex')
  return path.join(app.getPath('userData'), 'workbench-projects', key + '.json')
}

async function writeJson(file: string, data: object): Promise<void> {
  const temp = file + '.' + randomUUID()
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { flag: 'wx' })
  await fs.rename(temp, file)
}

async function save(project: WorkbenchProject, create = false): Promise<WorkbenchProject> {
  const target = path.join(project.directory, manifest)
  const data = { version: 1, assets: project.assets }
  if (create) {
    await fs.writeFile(target, JSON.stringify(data, null, 2), { flag: 'wx' })
  } else if (project.assets !== current?.assets) {
    await writeJson(target, data)
  }
  if (create || project.engine !== current?.engine || project.uproject !== current?.uproject) {
    const binding = bindingFile(project.directory)
    await fs.mkdir(path.dirname(binding), { recursive: true })
    await writeJson(binding, { engine: project.engine, uproject: project.uproject })
  }
  current = project
  return current
}

async function selectProject(command: ProjectCommand): Promise<WorkbenchProject | null> {
  if (command === 'create' || command === 'open') {
    const create = command === 'create'
    const choice = await dialog.showOpenDialog({
      title: create ? '为新项目选择空目录' : '打开模组项目目录',
      properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory']
    })
    if (choice.canceled) return current
    const directory = await fs.realpath(choice.filePaths[0])
    if (create) {
      if ((await fs.readdir(directory)).length) throw new Error('新项目需要一个空目录。')
      const engine = 'E:\\NteMod\\UE_5.6'
      const installed = existsSync(path.join(engine, 'Engine/Build/Build.version'))
      return save(await refresh({ directory, engine: installed ? engine : '', uproject: '', assets: [], files: [] }), true)
    }
    const data = JSON.parse(await fs.readFile(path.join(directory, manifest), 'utf8'))
    if (data.version !== 1 || !Array.isArray(data.assets) || data.assets.length !== new Set(data.assets).size) {
      throw new Error('模组项目清单格式错误。')
    }
    data.assets.forEach(validateAsset)
    const binding = bindingFile(directory)
    const local = existsSync(binding)
      ? JSON.parse(await fs.readFile(binding, 'utf8'))
      : { engine: '', uproject: '' }
    current = await refresh({ directory, engine: local.engine, uproject: local.uproject, assets: data.assets, files: [] })
    return current
  }
  const project = active()
  if (command === 'engine') {
    const choice = await dialog.showOpenDialog({ title: '选择 UE 5.6 安装目录', properties: ['openDirectory'] })
    if (choice.canceled) return project
    await editorCommand(choice.filePaths[0])
    return save({ ...project, engine: choice.filePaths[0] })
  }
  if (command === 'uproject') {
    const choice = await dialog.showOpenDialog({ title: '绑定虚幻工程', properties: ['openFile'], filters: [{ name: '虚幻工程', extensions: ['uproject'] }] })
    if (choice.canceled || project.uproject === choice.filePaths[0]) return project
    if (project.uproject && project.assets.length) throw new Error('请先从打包清单中移除旧工程的资源。')
    return save({ ...project, uproject: choice.filePaths[0] })
  }
  if (command === 'add') {
    if (!project.uproject) throw new Error('请先绑定虚幻工程。')
    const content = await fs.realpath(path.join(path.dirname(project.uproject), 'Content'))
    const choice = await dialog.showOpenDialog({ title: '添加工程 Content 内要打包的资源', defaultPath: content,
      properties: ['openFile', 'multiSelections'], filters: [{ name: '虚幻资源', extensions: ['uasset', 'umap'] }] })
    if (choice.canceled) return project
    const assets = new Set(project.assets)
    for (const file of choice.filePaths) {
      const asset = path.relative(content, await fs.realpath(file)).split(path.sep).join('/')
      validateAsset(asset)
      assets.add(asset)
    }
    return save({ ...project, assets: [...assets].sort() })
  }
  if (command !== 'import') throw new Error('未知的项目操作。')
  const choice = await dialog.showOpenDialog({ title: '导入素材', properties: ['openFile', 'multiSelections'] })
  if (choice.canceled) return project
  const folder = await filesDirectory(project)
  const copied: string[] = []
  try {
    for (const file of choice.filePaths) {
      const destination = path.join(folder, path.basename(file))
      await fs.copyFile(file, destination, constants.COPYFILE_EXCL)
      copied.push(destination)
    }
  } catch (error) {
    for (const file of copied) await fs.unlink(file)
    throw error
  }
  current = await refresh(project)
  return current
}

async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('项目操作正在进行。')
  busy = true
  try {
    return await operation()
  } catch (error) {
    logger.error(`工作台项目操作失败：${describeError(error)}`)
    throw error
  } finally {
    busy = false
  }
}

export function registerWorkbenchProjects(): void {
  ipcMain.handle('workbench-projects:current', async () => current ? refresh(current) : null)
  ipcMain.handle('workbench-projects:select', (_, command) => exclusive(() => selectProject(command)))
  ipcMain.handle('workbench-projects:remove', (_, asset) => exclusive(async () => {
    const project = active()
    return save({ ...project, assets: project.assets.filter(file => file !== asset) })
  }))
  ipcMain.handle('workbench-projects:trash', (_, file) => exclusive(async () => {
    const project = await refresh(active())
    if (!project.files.includes(file)) throw new Error('素材文件不存在。')
    await shell.trashItem(path.join(await filesDirectory(project), file))
    current = await refresh(project)
    return current
  }))
  ipcMain.handle('workbench-projects:folder', async (_, target) => {
    const project = active()
    const folders: Record<string, string> = { project: project.directory, files: path.join(project.directory, 'Files'),
      builds: path.join(project.directory, 'Builds'), content: project.uproject && path.join(path.dirname(project.uproject), 'Content') }
    if (!Object.hasOwn(folders, target) || !folders[target]) throw new Error('项目目录尚未设置。')
    if (target === 'builds') await fs.mkdir(folders[target], { recursive: true })
    if (!(await fs.stat(folders[target])).isDirectory()) throw new Error('找不到该目录。')
    const error = await shell.openPath(folders[target])
    if (error) throw new Error(error)
  })
  ipcMain.handle('workbench-projects:build', () => exclusive(async () => {
    const result = await buildProject(active(), workbenchToolsDirectory(), message => logger.info(message))
    logger.info(`模组已烘焙并完成容器校验：${result}`)
    return result
  }))
}
