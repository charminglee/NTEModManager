import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GameBananaTranslationRequest } from '../shared/types'
import { describeError, logger } from './logger'
import { translateYoudaoHtml } from './youdao-translation'

const CACHE_VERSION = 3

interface CachedTranslation {
  version: number
  updatedAt: number
  sourceHash: string
  translatedHtml: string
}

const pending = new Map<string, { revision: string; result: Promise<string> }>()
const cacheDirectory = () => join(app.getPath('userData'), 'gamebanana-translations')

function readCache(path: string, updatedAt: number, sourceHash: string): string | null {
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as CachedTranslation | null
    if (entry?.version === CACHE_VERSION && entry.updatedAt === updatedAt && entry.sourceHash === sourceHash &&
      typeof entry.translatedHtml === 'string' && entry.translatedHtml.trim()) {
      return entry.translatedHtml
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warning(`读取模组翻译缓存失败：${describeError(error)}`)
    }
  }
  return null
}

function writeCache(path: string, entry: CachedTranslation): void {
  const stagingPath = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(stagingPath, JSON.stringify(entry), 'utf8')
    renameSync(stagingPath, path)
  } catch (error) {
    logger.warning(`保存模组翻译缓存失败：${describeError(error)}`)
    try {
      rmSync(stagingPath, { force: true })
    } catch (cleanupError) {
      logger.warning(`清理模组翻译缓存临时文件失败：${describeError(cleanupError)}`)
    }
  }
}

export function clearGameBananaTranslationCache(): void {
  const directory = cacheDirectory()
  try {
    const entry = lstatSync(directory, { throwIfNoEntry: false })
    if (entry) {
      if (!entry.isDirectory()) throw new Error('翻译缓存路径不是普通目录。')
      for (const name of readdirSync(directory)) {
        if (/^[a-f0-9]{64}\.json(?:\.[a-f0-9-]{36}\.tmp)?$/u.test(name)) {
          rmSync(join(directory, name), { force: true })
        }
      }
    }
    pending.clear()
  } catch (error) {
    logger.error(`清除 GameBanana 翻译缓存失败：${describeError(error)}`)
    throw error
  }
  logger.info('已清除 GameBanana 翻译缓存。')
}

export async function translateGameBanana({ modId, section, html, updatedAt }: GameBananaTranslationRequest) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('没有可翻译的原文 HTML。')
  const cacheKey = createHash('sha256').update(JSON.stringify([modId, section])).digest('hex')
  const path = join(cacheDirectory(), `${cacheKey}.json`)
  const sourceHash = createHash('sha256').update(html).digest('hex')
  const revision = `${updatedAt}:${sourceHash}`
  const cached = readCache(path, updatedAt, sourceHash)
  if (cached) return cached

  const existing = pending.get(path)
  if (existing?.revision === revision) return existing.result

  const result = translateYoudaoHtml(html)
  pending.set(path, { revision, result })
  try {
    const translatedHtml = await result
    if (pending.get(path)?.result === result) {
      writeCache(path, { version: CACHE_VERSION, updatedAt, sourceHash, translatedHtml })
    }
    return translatedHtml
  } finally {
    if (pending.get(path)?.result === result) pending.delete(path)
  }
}
