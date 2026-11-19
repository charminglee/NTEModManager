import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describeError, logger } from './logger'

const cachePath = () => join(app.getPath('userData'), 'gamebanana-download-marks.json')

export function getGameBananaDownloadMarks(): Record<string, string> {
  try {
    const saved = JSON.parse(readFileSync(cachePath(), 'utf8')) as unknown
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new Error('模组文件标记格式无效。')
    }
    const marks: Record<string, string> = {}
    for (const [modId, fileId] of Object.entries(saved)) {
      if (/^[1-9]\d*$/u.test(modId) && typeof fileId === 'string' && fileId) marks[modId] = fileId
    }
    return marks
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warning(`读取 GameBanana 下载标记缓存失败：${describeError(error)}`)
    }
    return {}
  }
}

export function recordGameBananaDownload(modId: number, fileId: string): Record<string, string> | null {
  const path = cachePath()
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    const marks = getGameBananaDownloadMarks()
    marks[modId] = fileId
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(marks), 'utf8')
    renameSync(temporaryPath, path)
    return marks
  } catch (error) {
    logger.warning(`保存 GameBanana 下载标记缓存失败：${describeError(error)}`)
    try {
      rmSync(temporaryPath, { force: true })
    } catch (cleanupError) {
      logger.warning(`清理 GameBanana 下载标记临时文件失败：${describeError(cleanupError)}`)
    }
    return null
  }
}

export function getGameBananaDownloadCacheSize(): number {
  const entry = lstatSync(cachePath(), { throwIfNoEntry: false })
  return entry?.isFile() ? entry.size : 0
}

export function clearGameBananaDownloadCache(): void {
  try {
    rmSync(cachePath(), { force: true })
  } catch (error) {
    logger.error(`清除 GameBanana 下载标记缓存失败：${describeError(error)}`)
    throw error
  }
}
