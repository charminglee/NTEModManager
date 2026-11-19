import { createWriteStream, existsSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { net } from 'electron'
import type {
  GameBananaDownloadTask,
  GameBananaComment,
  GameBananaCommentsPage,
  GameBananaAuthor,
  GameBananaFile,
  GameBananaMod,
  GameBananaScreenshot,
  GameBananaUpdate,
  OperationResult
} from '../shared/types'
import * as repository from './repository'
import { installModExclusively } from './operations'
import { getAppConfig } from './config'
import { describeError, logger } from './logger'

const API_BASE = 'https://api.gamebanana.com'
const NTE_GAME_ID = 23012
const POST_STATUS_TRASHED = 3
const MOD_FIELDS = [
  'name',
  'authors',
  'Credits().aAuthors()',
  'Credits().ssvAuthorNames()',
  'Game().name',
  'downloads',
  'likes',
  'views',
  'postcount',
  'date',
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

export function updateTask(id: string, patch: Partial<GameBananaDownloadTask>): GameBananaDownloadTask {
  const current = tasks.get(id)
  if (!current) {
    throw new Error(`找不到下载任务：${id}`)
  }
  const next = { ...current, ...patch }
  tasks.set(id, next)
  publish(next)
  return next
}

async function requestJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = path.startsWith('/Core/')
    ? new URL(path, API_BASE)
    : new URL(`https://gamebanana.com/apiv11${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await net.fetch(url.href)
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

function parseAuthorEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => Array.isArray(entry) ? entry[0] : null)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim())
}

function parseAuthors(
  authorEntries: unknown,
  authorNames: unknown,
  legacyAuthors: unknown
): string {
  const names = parseAuthorEntries(authorEntries)
  if (names.length > 0) {
    return names.join('、')
  }

  if (typeof authorNames === 'string' && authorNames.trim().length > 0) {
    return authorNames.trim()
  }

  if (typeof legacyAuthors === 'string' && legacyAuthors.trim().length > 0) {
    try {
      const parsed = JSON.parse(legacyAuthors) as Record<string, unknown>
      const legacyNames = Object.values(parsed).flatMap(parseAuthorEntries)
      if (legacyNames.length > 0) {
        return legacyNames.join('、')
      }
    } catch {
      return legacyAuthors.trim()
    }
  }

  return '未知作者'
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
    uploadedAt: Number(file._tsDateAdded ?? 0),
    version: String(file._sVersion ?? ''),
    description: String(file._sDescription ?? ''),
    archived: Boolean(file._bIsArchived),
    downloadUrl: String(file._sDownloadUrl ?? ''),
    md5: typeof file._sMd5Checksum === 'string' ? file._sMd5Checksum : undefined
  })).filter((file) => file.id.length > 0 && /^https?:\/\//i.test(file.downloadUrl))
}

function parseAuthor(value: unknown): GameBananaAuthor {
  const author = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    name: String(author._sName ?? '未知作者'),
    avatarUrl: String(author._sAvatarUrl ?? ''),
    profileUrl: String(author._sProfileUrl ?? '')
  }
}

function parseScreenshots(value: unknown): GameBananaScreenshot[] {
  if (!value || typeof value !== 'object') return []
  const media = value as Record<string, unknown>
  const images = Array.isArray(media._aImages) ? media._aImages : []
  return images.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const image = entry as Record<string, unknown>
    const baseUrl = String(image._sBaseUrl ?? '').replace(/\/$/, '')
    const file = String(image._sFile ?? '')
    if (!baseUrl || !file) return []
    return [{
      url: `${baseUrl}/${file}`,
      thumbnailUrl: `${baseUrl}/${String(image._sFile220 ?? file)}`,
      width: Number(image._wFile530 ?? 0),
      height: Number(image._hFile530 ?? 0)
    }]
  })
}

function getRecordsPage<T>(path: string, page: number) {
  return requestJson<{ _aRecords: T[]; _aMetadata: { _bIsComplete: boolean } }>(path, {
    _nPage: String(page),
    _nPerpage: '50'
  })
}

async function getAllRecords<T>(path: string): Promise<T[]> {
  const records: T[] = []
  for (let page = 1; ; page += 1) {
    const result = await getRecordsPage<T>(path, page)
    records.push(...result._aRecords)
    if (result._aRecords.length === 0 || result._aMetadata._bIsComplete) return records
  }
}

function parseUpdates(records: Record<string, unknown>[]): GameBananaUpdate[] {
  return records.map((record) => ({
    id: String(record._idRow ?? ''),
    name: String(record._sName ?? ''),
    version: String(record._sVersion ?? ''),
    uploadedAt: Number(record._tsDateAdded ?? 0),
    modifiedAt: Number(record._tsDateModified ?? 0),
    description: String(record._sText ?? ''),
    changes: Array.isArray(record._aChangeLog)
      ? record._aChangeLog.map((change) => {
        const item = change as Record<string, unknown>
        return { category: String(item.cat ?? ''), text: String(item.text ?? '') }
      })
      : []
  }))
}

async function parseComments(records: Record<string, unknown>[]): Promise<GameBananaComment[]> {
  const threads = await Promise.all(records.map(async (record) => {
    const replies = Number(record._nReplyCount ?? 0) > 0
      ? await parseComments(await getAllRecords<Record<string, unknown>>(`/Post/${record._idRow}/Posts`))
      : []
    if (Number(record._nStatus) === POST_STATUS_TRASHED) return replies
    return [{
      id: String(record._idRow ?? ''),
      author: parseAuthor(record._aPoster),
      uploadedAt: Number(record._tsDateAdded ?? 0),
      editedAt: Number(record._tsDateModified ?? 0),
      content: String(record._sText ?? ''),
      replies
    }]
  }))
  return threads.flat()
}

function parseMod(id: number, value: Record<string, unknown>): GameBananaMod {
  return {
    id,
    name: String(value.name ?? `Mod ${id}`),
    authors: parseAuthors(
      value['Credits().aAuthors()'],
      value['Credits().ssvAuthorNames()'],
      value.authors
    ),
    gameName: String(value['Game().name'] ?? 'Neverness To Everness'),
    downloads: Number(value.downloads ?? 0),
    likes: Number(value.likes ?? 0),
    views: Number(value.views ?? 0),
    comments: Number(value.postcount ?? 0),
    uploadedAt: Number(value.date ?? 0),
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
    files: parseFiles(value['Files().aFiles()']).filter((file) => !file.archived),
    author: { name: '', avatarUrl: '', profileUrl: '' },
    modifiedAt: 0,
    version: '',
    archivedFiles: [],
    screenshots: []
  }
}

export async function listMods(page: number): Promise<GameBananaMod[]> {
  const rows = await requestJson<unknown[][]>('/Core/List/New', {
    itemtype: 'Mod',
    gameid: String(NTE_GAME_ID),
    page: String(Math.max(1, page)),
    include_updated: '1',
    format: 'json_min'
  })
  const ids = rows
    .filter((row) => row[0] === 'Mod' && Number.isInteger(Number(row[1])))
    .map((row) => Number(row[1]))
  return Promise.all(ids.map((id) => getModSummary(id)))
}

export async function getModSummary(id: number): Promise<GameBananaMod> {
  const value = await requestJson<Record<string, unknown>>('/Core/Item/Data', {
    itemtype: 'Mod',
    itemid: String(id),
    fields: MOD_FIELDS.join(','),
    return_keys: '1',
    format: 'json_min',
    flags: 'JSON_UNESCAPED_SLASHES'
  })
  const mod = parseMod(id, value)
  return {
    ...mod,
    author: { name: mod.authors, avatarUrl: '', profileUrl: '' },
    modifiedAt: mod.updatedAt,
    version: '',
    archivedFiles: parseFiles(value['Files().aFiles()']).filter((file) => file.archived),
    screenshots: mod.previewUrl ? [{ url: mod.previewUrl, thumbnailUrl: mod.previewUrl, width: 0, height: 0 }] : []
  }
}

export async function getMod(id: number): Promise<GameBananaMod> {
  const value = await requestJson<Record<string, unknown>>(`/Mod/${id}/ProfilePage`, {})
  const files = Array.isArray(value._aFiles) ? value._aFiles : []
  const archivedFiles = Array.isArray(value._aArchivedFiles) ? value._aArchivedFiles : []
  const screenshots = parseScreenshots(value._aPreviewMedia)
  const credits = Array.isArray(value._aCredits)
    ? value._aCredits.flatMap((entry) => {
      const group = entry as Record<string, unknown>
      return Array.isArray(group._aAuthors)
        ? (group._aAuthors as Record<string, unknown>[]).map((author) => String(author._sName ?? ''))
        : []
    }).filter(Boolean)
    : []
  const author = parseAuthor(value._aSubmitter)
  return {
    id,
    name: String(value._sName ?? `Mod ${id}`),
    authors: credits.join('、') || author.name,
    author,
    gameName: 'Neverness To Everness',
    downloads: Number(value._nDownloadCount ?? 0),
    likes: Number(value._nLikeCount ?? 0),
    views: Number(value._nViewCount ?? 0),
    comments: Number(value._nPostCount ?? 0),
    uploadedAt: Number(value._tsDateAdded ?? 0),
    modifiedAt: Number(value._tsDateModified ?? 0),
    updatedAt: Number(value._tsDateUpdated ?? 0),
    version: String(value._sVersion ?? ''),
    description: String(value._sText ?? ''),
    previewUrl: screenshots[0]?.thumbnailUrl ?? null,
    profileUrl: String(value._sProfileUrl ?? `https://gamebanana.com/mods/${id}`),
    downloadUrl: typeof value._sDownloadUrl === 'string' ? value._sDownloadUrl : null,
    installInstructions: '',
    files: parseFiles(files.filter((file) => !(file as Record<string, unknown>)._bIsArchived)),
    archivedFiles: parseFiles([
      ...archivedFiles,
      ...files.filter((file) => (file as Record<string, unknown>)._bIsArchived)
    ]),
    screenshots
  }
}

export async function getModUpdates(id: number): Promise<GameBananaUpdate[]> {
  const records = await getAllRecords<Record<string, unknown>>(`/Mod/${id}/Updates`)
  return parseUpdates(records).sort((a, b) => b.uploadedAt - a.uploadedAt)
}

export async function getModComments(id: number, page: number): Promise<GameBananaCommentsPage> {
  const result = await getRecordsPage<Record<string, unknown>>(`/Mod/${id}/Posts`, page)
  return {
    comments: await parseComments(result._aRecords),
    nextPage: result._aRecords.length === 0 || result._aMetadata._bIsComplete ? null : page + 1
  }
}

function validCustomName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[<>:"/\\|?*]/.test(name)
}

function archiveExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase()
  if (!['.zip', '.rar', '.7z'].includes(extension)) {
    throw new Error(`模组文件格式不受支持：${fileName}`)
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
  mod: Pick<GameBananaMod, 'id' | 'name'>,
  file: Pick<GameBananaFile, 'name' | 'sizeBytes'>,
  customName: string,
  source: GameBananaDownloadTask['source'] = 'gamebanana'
): string {
  const normalizedName = customName.trim()
  if (!validCustomName(normalizedName)) {
    throw new Error('模组名称不能为空，且不能包含 Windows 文件名中的无效字符。')
  }
  const task: GameBananaDownloadTask = {
    id: randomUUID(),
    source,
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
  mod: Pick<GameBananaMod, 'id' | 'name'>,
  file: Pick<GameBananaFile, 'name' | 'sizeBytes' | 'downloadUrl'>,
  installAfterDownload: boolean,
  appDirectory: string,
  transfer: (taskId: string, url: string, targetPath: string) => Promise<void> = downloadArchive
): Promise<OperationResult> {
  const task = tasks.get(taskId)
  if (!task) {
    return { success: false, message: `找不到下载任务：${taskId}` }
  }
  try {
    const extension = archiveExtension(file.name)
    const downloadDirectory = join(getAppConfig().backupsDirectory, `.${task.source}-downloads`)
    const archivePath = join(downloadDirectory, `${task.customName}${extension}`)
    await mkdir(downloadDirectory, { recursive: true })
    if (existsSync(archivePath)) {
      rmSync(archivePath, { force: true })
    }
    updateTask(taskId, { message: '正在下载' })
    await transfer(taskId, file.downloadUrl, archivePath)
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
    updateTask(taskId, { status: 'completed', message })
    logger.info(`${task.source === 'ayakamods' ? 'AyakaMods' : 'GameBanana'} 下载完成：${mod.name} → ${task.customName}`)
    return { success: true, message }
  } catch (error) {
    return updateFailed(taskId, describeError(error))
  }
}

function updateFailed(taskId: string, message: string): OperationResult {
  updateTask(taskId, { status: 'failed', message })
  logger.error(`模组下载失败：${message}`)
  return { success: false, message }
}
