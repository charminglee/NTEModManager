import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GameBananaTranslationRequest } from '../shared/types'
import { describeError, logger } from './logger'
import { translateYoudaoParagraphs } from './youdao-translation'

const CACHE_VERSION = 1

interface CachedTranslation {
  version: number
  updatedAt: number
  sourceHash: string
  translations: string[]
}

const pending = new Map<string, { revision: string; result: Promise<(string | null)[]> }>()

function readCache(path: string, updatedAt: number, sourceHash: string, count: number): string[] | null {
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as CachedTranslation | null
    if (entry?.version === CACHE_VERSION && entry.updatedAt === updatedAt && entry.sourceHash === sourceHash &&
      Array.isArray(entry.translations) && entry.translations.length === count &&
      entry.translations.every((text) => typeof text === 'string' && text.trim())) {
      return entry.translations
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

export async function translateGameBanana({ modId, section, html, updatedAt, paragraphs }: GameBananaTranslationRequest) {
  const cacheKey = createHash('sha256').update(JSON.stringify([modId, section])).digest('hex')
  const path = join(app.getPath('userData'), 'gamebanana-translations', `${cacheKey}.json`)
  const sourceHash = createHash('sha256').update(JSON.stringify([html, paragraphs])).digest('hex')
  const revision = `${updatedAt}:${sourceHash}`
  const count = paragraphs.reduce((total, paragraph) => total + paragraph.length, 0)
  const cached = readCache(path, updatedAt, sourceHash, count)
  if (cached) return cached

  const existing = pending.get(path)
  if (existing?.revision === revision) return existing.result

  const result = translateYoudaoParagraphs(paragraphs)
  pending.set(path, { revision, result })
  try {
    const translations = await result
    if (pending.get(path)?.result === result && translations.every((text) => text !== null)) {
      writeCache(path, { version: CACHE_VERSION, updatedAt, sourceHash, translations })
    }
    return translations
  } finally {
    if (pending.get(path)?.result === result) pending.delete(path)
  }
}
