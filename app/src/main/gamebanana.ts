import { createWriteStream, existsSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  GameBananaDownloadTask,
  GameBananaFile,
  GameBananaMod,
  OperationResult
} from '../shared/types'
import * as repository from './repository'
import { installModExclusively } from './operations'
import { getAppConfig } from './config'
import { describeError, logger } from './logger'

const API_BASE = 'https://api.gamebanana.com'
const NTE_GAME_ID = 23012
const MOD_FIELDS = [
  'name',
  'authors',
  'Game().name',
  'downloads',
  'likes',
  'views',
  'udate',
  'description',
  'Files().aFiles()',
  'Preview().sSubFeedImageUrl()',
  'Url().sDownloadUrl()',
  'Url().sProfileUrl()',
  'install_instructions'
]

type TaskBroadcaster = (task: GameBananaDownloadTask) => void

let taskBroadcaster: TaskBroadcaster | null = null
const tasks = new Map<string, GameBananaDownloadTask>()

export function setTaskBroadcaster(broadcaster: TaskBroadcaster): void {
  taskBroadcaster = broadcaster
}

export function getTasks(): GameBananaDownloadTask[] {
  return [...tasks.values()].map((task) => ({ ...task }))
}

function publish(task: GameBananaDownloadTask): void {
  taskBroadcaster?.({ ...task })
}

function updateTask(id: string, patch: Partial<GameBananaDownloadTask>): GameBananaDownloadTask {
  const current = tasks.get(id)
  if (!current) {
    throw new Error(`找不到 GameBanana 下载任务：${id}`)
  }
  const next = { ...current, ...patch }
  tasks.set(id, next)
  publish(next)
  return next
}

async function requestJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GameBanana API 请求失败（${response.status}）：${text.slice(0, 240)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`GameBanana API 返回了无法解析的数据：${text.slice(0, 240)}`)
  }
}

function parseAuthors(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '未知作者'
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const first = Object.keys(parsed)[0]
    return first || '未知作者'
  } catch {
    return value
  }
}

function parseFiles(value: unknown): GameBananaFile[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.values(value as Record<string, Record<string, unknown>>).map((file) => ({
    id: String(file._idRow ?? ''),
    name: String(file._sFile ?? '未知文件'),
    sizeBytes: Number(file._nFilesize ?? 0),
    downloadCount: Number(file._nDownloadCount ?? 0),
    downloadUrl: String(file._sDownloadUrl ?? ''),
    md5: typeof file._sMd5Checksum === 'string' ? file._sMd5Checksum : undefined
  })).filter((file) => file.id.length > 0 && /^https?:\/\//i.test(file.downloadUrl))
}

function parseMod(id: number, value: Record<string, unknown>): GameBananaMod {
  return {
    id,
    name: String(value.name ?? `Mod ${id}`),
    authors: parseAuthors(value.authors),
    gameName: String(value['Game().name'] ?? 'Neverness To Everness'),
    downloads: Number(value.downloads ?? 0),
    likes: Number(value.likes ?? 0),
    views: Number(value.views ?? 0),
    updatedAt: Number(value.udate ?? 0),
    description: String(value.description ?? ''),
    previewUrl: typeof value['Preview().sSubFeedImageUrl()'] === 'string'
      ? value['Preview().sSubFeedImageUrl()']
      : null,
    profileUrl: String(value['Url().sProfileUrl()'] ?? `https://gamebanana.com/mods/${id}`),
    downloadUrl: typeof value['Url().sDownloadUrl()'] === 'string'
      ? value['Url().sDownloadUrl()']
      : null,
    installInstructions: String(value.install_instructions ?? ''),
    files: parseFiles(value['Files().aFiles()'])
  }
}

export async function listMods(page: number): Promise<GameBananaMod[]> {
  const rows = await requestJson<unknown[][]>('/Core/List/New', {
    itemtype: 'Mod',
    gameid: String(NTE_GAME_ID),
    page: String(Math.max(1, page)),
    format: 'json_min'
  })
  const ids = rows
    .filter((row) => row[0] === 'Mod' && Number.isInteger(Number(row[1])))
    .map((row) => Number(row[1]))
  return Promise.all(ids.map((id) => getMod(id)))
}

export async function getMod(id: number): Promise<GameBananaMod> {
  const value = await requestJson<Record<string, unknown>>('/Core/Item/Data', {
    itemtype: 'Mod',
    itemid: String(id),
    fields: MOD_FIELDS.join(','),
    return_keys: '1',
    format: 'json_min',
    flags: 'JSON_UNESCAPED_SLASHES'
  })
  return parseMod(id, value)
}

function validCustomName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[<>:"/\\|?*]/.test(name)
}

function archiveExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase()
  if (!['.zip', '.rar', '.7z'].includes(extension)) {
    throw new Error(`GameBanana 文件格式不受支持：${fileName}`)
  }
  return extension
}

function writeChunk(writer: ReturnType<typeof createWriteStream>, chunk: Uint8Array): Promise<void> {
  if (writer.write(Buffer.from(chunk))) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      writer.removeListener('error', onError)
      resolve()
    }
    const onError = (error: Error) => {
      writer.removeListener('drain', onDrain)
      reject(error)
    }
    writer.once('drain', onDrain)
    writer.once('error', onError)
  })
}

async function downloadArchive(
  taskId: string,
  url: string,
  targetPath: string
): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('下载地址不是 HTTP 或 HTTPS 地址。')
  }
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`下载文件失败（${response.status}）。`)
  }
  const totalBytes = Number(response.headers.get('content-length') ?? 0) || null
  updateTask(taskId, { status: 'downloading', totalBytes })
  const writer = createWriteStream(targetPath)
  const reader = response.body.getReader()
  let downloadedBytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      await writeChunk(writer, chunk.value)
      downloadedBytes += chunk.value.byteLength
      updateTask(taskId, { downloadedBytes })
    }
    await new Promise<void>((resolve, reject) => {
      writer.once('error', reject)
      writer.end(() => resolve())
    })
  } catch (error) {
    writer.destroy()
    throw error
  }
}

export function createDownloadTask(
  mod: GameBananaMod,
  file: GameBananaFile,
  customName: string
): string {
  const normalizedName = customName.trim()
  if (!validCustomName(normalizedName)) {
    throw new Error('模组名称不能为空，且不能包含 Windows 文件名中的无效字符。')
  }
  const task: GameBananaDownloadTask = {
    id: randomUUID(),
    modId: mod.id,
    modName: mod.name,
    fileName: file.name,
    customName: normalizedName,
    status: 'queued',
    downloadedBytes: 0,
    totalBytes: file.sizeBytes || null,
    message: '等待下载',
    createdAt: new Date().toISOString()
  }
  tasks.set(task.id, task)
  publish(task)
  return task.id
}

export async function executeDownloadTask(
  taskId: string,
  mod: GameBananaMod,
  file: GameBananaFile,
  installAfterDownload: boolean,
  appDirectory: string
): Promise<OperationResult> {
  const task = tasks.get(taskId)
  if (!task) {
    return { success: false, message: `找不到 GameBanana 下载任务：${taskId}` }
  }
  const extension = archiveExtension(file.name)
  const downloadDirectory = join(getAppConfig().backupsDirectory, '.gamebanana-downloads')
  const archivePath = join(downloadDirectory, `${task.customName}${extension}`)
  try {
    await mkdir(downloadDirectory, { recursive: true })
    if (existsSync(archivePath)) {
      rmSync(archivePath, { force: true })
    }
    updateTask(taskId, { message: '正在下载' })
    await downloadArchive(taskId, file.downloadUrl, archivePath)
    updateTask(taskId, { status: 'extracting', message: '正在解压并保存到备份目录' })
    const imported = await repository.importArchive(archivePath, appDirectory)
    if (!imported.success) {
      return updateFailed(taskId, imported.message)
    }
    let message = imported.message
    if (installAfterDownload) {
      const importedName = imported.message.startsWith('已导入 ')
        ? imported.message.slice('已导入 '.length)
        : task.customName
      const importedMod = (await repository.scan()).find((item) => item.name === importedName)
      if (!importedMod) {
        return updateFailed(taskId, `已下载并导入，但找不到待安装的模组：${importedName}`)
      }
      updateTask(taskId, { status: 'installing', message: '正在按同组规则安装' })
      const config = getAppConfig()
      const installed = await installModExclusively(
        importedMod,
        config.categories,
        config.exclusiveInstallExemptGroups,
        (progress) => updateTask(taskId, { message: progress })
      )
      if (!installed.success) {
        return updateFailed(taskId, `已下载并导入，但安装失败：${installed.message}`)
      }
      message = `${imported.message}，${installed.message}`
    }
    updateTask(taskId, { status: 'completed', message, downloadedBytes: file.sizeBytes || task.downloadedBytes })
    logger.info(`GameBanana 下载完成：${mod.name} → ${task.customName}`)
    return { success: true, message }
  } catch (error) {
    return updateFailed(taskId, describeError(error))
  }
}

function updateFailed(taskId: string, message: string): OperationResult {
  updateTask(taskId, { status: 'failed', message })
  logger.error(`GameBanana 下载失败：${message}`)
  return { success: false, message }
}
