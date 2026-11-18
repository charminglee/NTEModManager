import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GameBananaTranslationLanguage, YoudaoCredentialsInput, YoudaoCredentialsStatus } from '../shared/types'
import { logger } from './logger'

const TRANSLATION_URL = 'https://openapi.youdao.com/translate_html'
const MAX_HTML_LENGTH = 1_000_000

interface StoredCredentials {
  appId: string
  appSecret: string
}

interface YoudaoHtmlResponse {
  errorCode?: string
  errorMessage?: string | number
  data?: { translation?: unknown }
}

function credentialsPath(): string {
  return join(app.getPath('userData'), 'youdao-translation.bin')
}

function readCredentials(): StoredCredentials | null {
  const path = credentialsPath()
  if (!existsSync(path)) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密服务暂不可用，无法读取有道翻译凭据。')
  }
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(path))) as StoredCredentials
  } catch (error) {
    logger.error(`有道翻译凭据读取失败：${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

export function getYoudaoCredentialsStatus(): YoudaoCredentialsStatus {
  const credentials = readCredentials()
  return { configured: credentials !== null, appId: credentials?.appId ?? '' }
}

export function saveYoudaoCredentials(input: YoudaoCredentialsInput): YoudaoCredentialsStatus {
  const appId = input.appId.trim()
  const appSecret = input.appSecret.trim()
  const previous = readCredentials()
  if (!appId) throw new Error('请输入有道应用 ID。')
  const storedAppSecret = appSecret || previous?.appSecret
  if (!storedAppSecret) throw new Error('请输入有道应用密钥。')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密服务暂不可用，无法安全保存有道翻译凭据。')
  }

  const credentials: StoredCredentials = {
    appId,
    appSecret: storedAppSecret
  }
  const path = credentialsPath()
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temporaryPath, safeStorage.encryptString(JSON.stringify(credentials)))
    renameSync(temporaryPath, path)
  } catch (error) {
    if (existsSync(temporaryPath)) rmSync(temporaryPath)
    logger.error(`有道翻译凭据保存失败：${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
  logger.info('已加密保存有道翻译凭据。')
  return { configured: true, appId }
}

export function clearYoudaoCredentials(): YoudaoCredentialsStatus {
  const path = credentialsPath()
  try {
    rmSync(path, { force: true })
  } catch (error) {
    logger.error(`有道翻译凭据清除失败：${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
  logger.info('已清除有道翻译凭据。')
  return { configured: false, appId: '' }
}

export async function translateYoudaoHtml(html: string, sourceLanguage: GameBananaTranslationLanguage): Promise<string> {
  if (html.length > MAX_HTML_LENGTH) throw new Error('原文 HTML 超过有道网页翻译的单次长度上限，未拆分提交。')
  const credentials = readCredentials()
  if (!credentials) throw new Error('请先在设置中的「有道翻译」填写已绑定网页翻译服务的应用 ID 和应用密钥。')

  const salt = randomUUID()
  const curtime = String(Math.floor(Date.now() / 1000))
  const input = html.length <= 20 ? html : `${html.slice(0, 10)}${html.length}${html.slice(-10)}`
  const sign = createHash('sha256').update(`${credentials.appId}${input}${salt}${curtime}${credentials.appSecret}`, 'utf8').digest('hex')
  const response = await fetch(TRANSLATION_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      appKey: credentials.appId,
      salt,
      curtime,
      signType: 'v3',
      sign,
      q: html,
      from: sourceLanguage,
      to: 'zh-CHS'
    }),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`有道网页翻译请求失败（HTTP ${response.status}）。`)

  const result = await response.json() as YoudaoHtmlResponse
  if (result.errorCode === '110') throw new Error('当前有道应用未绑定网页翻译服务，请在有道智云控制台绑定后再试。')
  if (String(result.errorMessage) === '31') throw new Error('有道只翻译了部分内容，已保留原文。')
  if (result.errorCode !== '0' || String(result.errorMessage) === '30') {
    throw new Error(`有道网页翻译失败（${result.errorCode ?? '未知错误'}）：${result.errorMessage ?? '服务未返回错误详情'}。`)
  }
  const translation = result.data?.translation
  if (typeof translation !== 'string' || !translation.trim()) throw new Error('有道网页翻译未返回有效的 HTML 译文。')
  return translation
}
