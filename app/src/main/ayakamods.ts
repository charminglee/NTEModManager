import type { DownloadItem, Session, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { AyakaModsDownloadRequest } from '../shared/types'
import { getAppConfig } from './config'
import { createDownloadTask, executeDownloadTask, updateTask } from './gamebanana'
import { describeError, logger } from './logger'

interface PendingDownload {
  request: AyakaModsDownloadRequest
  item: DownloadItem
  path: string
  finished: Promise<string>
  state: string
  downloadedBytes: number
}

const pending = new Map<string, PendingDownload>()

export function getPendingDownloads(): AyakaModsDownloadRequest[] {
  return [...pending.values()].map(({ request }) => ({ ...request }))
}

export function registerAyakaModsDownloads(
  session: Session,
  mainContents: () => WebContents | undefined
): void {
  session.on('will-download', (event, item, contents) => {
    const owner = mainContents()
    const fileName = item.getFilename()
    if (!owner || contents.getType() !== 'webview' || !['.zip', '.rar', '.7z'].includes(extname(fileName).toLowerCase())) {
      event.preventDefault()
      logger.warning(`AyakaMods 下载已取消，文件格式不受支持或页面已关闭：${fileName}`)
      return
    }
    const request = { id: randomUUID(), fileName, sizeBytes: item.getTotalBytes() }
    const path = join(getAppConfig().backupsDirectory, '.ayakamods-downloads', `${request.id}${extname(fileName)}`)
    item.setSavePath(path)
    item.pause()
    const download: PendingDownload = {
      request,
      item,
      path,
      state: 'progressing',
      downloadedBytes: item.getReceivedBytes(),
      finished: new Promise((resolve) => {
        item.once('done', (_event, state) => {
          download.downloadedBytes = item.getReceivedBytes()
          download.state = state
          resolve(state)
        })
      })
    }
    item.on('updated', (_event, state) => {
      download.downloadedBytes = item.getReceivedBytes()
      if (state === 'interrupted') item.cancel()
    })
    pending.set(request.id, download)
    owner.send('ayakamods:download-request', request)
    logger.info(`已拦截 AyakaMods 模组下载：${fileName}`)
  })
}

export async function cancelDownload(id: string): Promise<void> {
  const download = pending.get(id)
  if (!download) return
  pending.delete(id)
  if (download.state === 'progressing') download.item.cancel()
  await download.finished
  await rm(download.path, { force: true })
  logger.info(`已取消 AyakaMods 模组下载：${download.request.fileName}`)
}

export function prepareDownload(id: string, customName: string, installAfterDownload: boolean, appDirectory: string) {
  const download = pending.get(id)
  if (!download) throw new Error('找不到 AyakaMods 下载请求，请重新点击站内下载。')
  const file = { name: download.request.fileName, sizeBytes: download.request.sizeBytes, downloadUrl: '' }
  const mod = { id: 0, name: file.name.slice(0, -extname(file.name).length) }
  const taskId = createDownloadTask(mod, file, customName, 'ayakamods')
  pending.delete(id)
  return {
    taskId,
    async execute() {
      try {
        return await executeDownloadTask(taskId, mod, file, installAfterDownload, appDirectory, async (_id, _url, targetPath) => {
          const reportProgress = () => updateTask(taskId, {
            status: 'downloading',
            downloadedBytes: download.downloadedBytes,
            totalBytes: download.request.sizeBytes || null
          })
          reportProgress()
          download.item.on('updated', reportProgress)
          if (download.state === 'progressing') download.item.resume()
          const state = await download.finished
          if (state !== 'completed') throw new Error(`AyakaMods 文件下载未完成：${state}`)
          updateTask(taskId, { downloadedBytes: download.downloadedBytes })
          await rename(download.path, targetPath)
        })
      } finally {
        if (download.state === 'progressing') download.item.cancel()
        await download.finished
        await rm(download.path, { force: true })
      }
    }
  }
}

export function cancelPendingDownloads(): void {
  for (const id of pending.keys()) {
    void cancelDownload(id).catch((error) => logger.error(`清理 AyakaMods 下载失败：${describeError(error)}`))
  }
}
