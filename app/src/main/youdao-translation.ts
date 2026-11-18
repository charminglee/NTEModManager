import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { YoudaoCredentialsInput, YoudaoCredentialsStatus } from '../shared/types'
import { logger } from './logger'

const TRANSLATION_URL = 'https://openapi.youdao.com/proxy/http/llm-trans'
const MAX_TEXT_LENGTH = 5000

interface StoredCredentials {
  appId: string
  appSecret: string
}

interface YoudaoMessage {
  code?: string
  message?: string
  successful?: boolean
  data?: {
    transFull?: string
    transIncre?: string
  }
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

function splitText(text: string): string[] {
  const characters = Array.from(text)
  const chunks: string[] = []
  let start = 0
  while (start < characters.length) {
    let end = Math.min(start + MAX_TEXT_LENGTH, characters.length)
    if (end < characters.length) {
      const minimumBoundary = start + Math.floor(MAX_TEXT_LENGTH / 2)
      const separators = ['\n', '。', '！', '？', '.', '!', '?', ' ']
      let boundary = -1
      for (const separator of separators) {
        const index = characters.lastIndexOf(separator, end - 1)
        if (index >= minimumBoundary && index > boundary) boundary = index
      }
      if (boundary >= minimumBoundary) end = boundary + 1
    }
    chunks.push(characters.slice(start, end).join(''))
    start = end
  }
  return chunks
}

function signature(appId: string, text: string, salt: string, curtime: string, appSecret: string): string {
  const input = text.length <= 20 ? text : `${text.slice(0, 10)}${text.length}${text.slice(-10)}`
  return createHash('sha256').update(`${appId}${input}${salt}${curtime}${appSecret}`, 'utf8').digest('hex')
}

function parseMessages(responseText: string): YoudaoMessage[] {
  const payloads = responseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:') || line.startsWith('{'))
    .map((line) => line.startsWith('data:') ? line.slice(5).trim() : line)
  if (payloads.length === 0) throw new Error('有道翻译没有返回可识别的结果。')
  return payloads.map((payload) => {
    try {
      return JSON.parse(payload) as YoudaoMessage
    } catch {
      throw new Error('有道翻译返回的数据无法解析。')
    }
  })
}

async function translateChunk(text: string, credentials: StoredCredentials, prompt?: string): Promise<string> {
  const salt = randomUUID()
  const curtime = String(Math.floor(Date.now() / 1000))
  const parameters = new URLSearchParams({
    appKey: credentials.appId,
    salt,
    curtime,
    signType: 'v3',
    sign: signature(credentials.appId, text, salt, curtime, credentials.appSecret),
    i: text,
    from: 'auto',
    to: 'zh-CHS',
    streamType: 'full',
    handleOption: '0'
  })
  if (prompt) parameters.set('prompt', prompt)
  const response = await fetch(TRANSLATION_URL, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: parameters,
    signal: AbortSignal.timeout(30_000)
  })

  const responseText = await response.text()
  if (!response.ok) {
    let detail = responseText.trim()
    try {
      const errorMessage = (JSON.parse(detail) as { message?: string }).message
      if (errorMessage) detail = errorMessage
    } catch {
      detail = detail.replace(/<[^>]*>/g, '').trim()
    }
    if (detail.length > 300) detail = `${detail.slice(0, 300)}…`
    throw new Error(`有道翻译请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}。`)
  }

  const messages = parseMessages(responseText)
  let fullTranslation = ''
  let incrementalTranslation = ''
  for (const message of messages) {
    if (message.code && message.code !== '0') {
      throw new Error(`有道翻译失败（${message.code}）：${message.message ?? '服务返回错误'}`)
    }
    if (message.successful === false) {
      throw new Error(`有道翻译失败：${message.message ?? '服务返回错误'}`)
    }
    if (typeof message.data?.transFull === 'string') fullTranslation = message.data.transFull
    if (typeof message.data?.transIncre === 'string') incrementalTranslation += message.data.transIncre
  }
  const translation = fullTranslation || incrementalTranslation
  if (!translation) throw new Error('有道翻译返回了空译文。')
  return translation
}

export async function translateYoudaoText(text: string, prompt?: string): Promise<string> {
  if (typeof text !== 'string' || !text.trim()) throw new Error('没有可翻译的文字。')
  const credentials = readCredentials()
  if (!credentials) throw new Error('请先在设置中的「有道翻译」填写应用 ID 和应用密钥。')
  const chunks = splitText(text)
  const translations: string[] = []
  for (const chunk of chunks) translations.push(await translateChunk(chunk, credentials, prompt))
  return translations.join('\n').trim()
}
