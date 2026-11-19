import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { YoudaoCredentialsInput, YoudaoCredentialsStatus } from '../shared/types'
import { logger } from './logger'

const TRANSLATION_URL = 'https://openapi.youdao.com/proxy/http/llm-trans'
const MAX_HTML_LENGTH = 5000

interface StoredCredentials {
  appId: string
  appSecret: string
}

interface YoudaoTranslationMessage {
  code: string
  message: string
  successful: boolean
  data?: { transFull?: string }
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

export async function translateYoudaoHtml(html: string): Promise<string> {
  if (html.length > MAX_HTML_LENGTH) throw new Error(`原文 HTML 超过有道大模型翻译的单次上限（${MAX_HTML_LENGTH} 字符）。`)
  const credentials = readCredentials()
  if (!credentials) throw new Error('请先在设置中的「有道翻译」填写已开通大模型翻译服务的应用 ID 和应用密钥。')

  const salt = randomUUID()
  const curtime = String(Math.floor(Date.now() / 1000))
  const input = html.length <= 20 ? html : `${html.slice(0, 10)}${html.length}${html.slice(-10)}`
  const sign = createHash('sha256').update(`${credentials.appId}${input}${salt}${curtime}${credentials.appSecret}`, 'utf8').digest('hex')
  const response = await fetch(TRANSLATION_URL, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      appKey: credentials.appId,
      salt,
      curtime,
      signType: 'v3',
      sign,
      i: html,
      from: 'auto',
      to: 'zh-CHS',
      streamType: 'full',
      handleOption: '0',
      prompt: '将 HTML 的可见正文翻译为简体中文。遇到中外文混排时，保留现有中文，并翻译其中的外文段落、列表项和句子。原样保留标签、属性、链接、图片、样式、代码及标记为不翻译的内容。仅输出译后的 HTML，不添加说明或 Markdown 代码围栏。'
    }),
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`有道大模型翻译请求失败（HTTP ${response.status}）。`)

  let translation = ''
  for (const line of (await response.text()).split(/\r?\n/u)) {
    const event = line.trim()
    const payload = event.startsWith('data:') ? event.slice(5).trim() : event
    if (!payload.startsWith('{')) continue

    const message = JSON.parse(payload) as YoudaoTranslationMessage
    if (message.code === '110') throw new Error('当前有道应用未开通大模型翻译服务，请在有道智云控制台开通后再试。')
    if (message.code !== '0' || message.successful === false) {
      throw new Error(`有道大模型翻译失败（${message.code}）：${message.message}`)
    }
    if (typeof message.data?.transFull === 'string') translation = message.data.transFull
  }
  if (!translation.trim()) throw new Error('有道大模型翻译未返回有效的译文。')
  if (translation.trim() === html.trim()) throw new Error('有道返回了原文，请重试翻译。')
  return translation
}
