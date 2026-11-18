import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GameBananaTranslationRequest } from '../shared/types'
import { describeError, logger } from './logger'
import { translateYoudaoHtml } from './youdao-translation'

const CACHE_VERSION = 2

interface CachedTranslation {
  version: number
  updatedAt: number
  sourceHash: string
  translatedHtml: string
}

const pending = new Map<string, { revision: string; result: Promise<string> }>()

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

export async function translateGameBanana({ modId, section, html, updatedAt, sourceLanguage }: GameBananaTranslationRequest) {
  if (sourceLanguage !== 'en' && sourceLanguage !== 'ru') throw new Error('请选择英语或俄语作为原文语言。')
  if (typeof html !== 'string' || !html.trim()) throw new Error('没有可翻译的原文 HTML。')
  const cacheKey = createHash('sha256').update(JSON.stringify([modId, section, sourceLanguage])).digest('hex')
  const path = join(app.getPath('userData'), 'gamebanana-translations', `${cacheKey}.json`)
  const sourceHash = createHash('sha256').update(html).digest('hex')
  const revision = `${updatedAt}:${sourceHash}`
  const cached = readCache(path, updatedAt, sourceHash)
  if (cached) return cached

  const existing = pending.get(path)
  if (existing?.revision === revision) return existing.result

  const result = translateYoudaoHtml(html, sourceLanguage)
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
