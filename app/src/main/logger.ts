import type { BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '../shared/types'

const MAX_MEMORY_ENTRIES = 4000
/** 单个日志文件上限:超过后把当前文件轮转为 .old(只保留一份),当前文件重新开始 */
const MAX_FILE_BYTES = 5 * 1024 * 1024
/** 相同级别+内容的日志在该时间窗内只记录一次,防止循环里的失败刷屏 */
const DUPLICATE_SUPPRESS_MS = 1500
/** 日志文件不可用时内存中最多缓冲的待写行数 */
const MAX_PENDING_LINES = 2000

const LEVEL_NAMES: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR'
}

const CONSOLE_METHODS: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error'
}

type Broadcaster = (entry: LogEntry) => void

/** 把任意抛出的值规整成一行可读文本 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

class Logger {
  private entries: LogEntry[] = []
  private filePath: string | null = null
  private broadcasters = new Set<Broadcaster>()
  /** initialize 之前累积的文件行,初始化后一次性回填,启动早期(迁移/配置)日志不丢 */
  private pendingLines: string[] = []
  /** 当前日志文件已写入字节数(近似),用于判断轮转 */
  private writtenBytes = 0
  private lastKey: string | null = null
  private lastKeyAt = 0

  /** 目录不存在时自动创建;主程序与背景服务共用 ~/.ntemm/logs 但各写各的文件 */
  initialize(directory: string, fileName: string): void {
    if (this.filePath) {
      return
    }
    try {
      mkdirSync(directory, { recursive: true })
    } catch (error) {
      this.filePath = null
      // 日志文件不可用时至少让终端能看到原因
      console.error('[NTEMM] 日志文件初始化失败:', describeError(error))
      return
    }
    this.filePath = join(directory, fileName)
    // 首次启动文件尚不存在时从 0 计数;已有文件超限时先轮转
    try {
      this.writtenBytes = statSync(this.filePath).size
      if (this.writtenBytes > MAX_FILE_BYTES) {
        this.rotate()
      }
    } catch {
      this.writtenBytes = 0
    }
    if (this.pendingLines.length > 0) {
      const buffered = this.pendingLines.splice(0)
      try {
        appendFileSync(this.filePath, buffered.join(''), 'utf-8')
        this.writtenBytes += buffered.reduce((total, line) => total + Buffer.byteLength(line), 0)
      } catch {
        // 回填失败时保持静默,避免日志器自身造成崩溃
      }
    }
  }

  getFilePath(): string | null {
    return this.filePath
  }

  addBroadcaster(getWindow: () => BrowserWindow | null): void {
    this.broadcasters.add((entry) => {
      const window = getWindow()
      if (window && !window.isDestroyed()) {
        window.webContents.send('log:entry', entry)
      }
    })
  }

  debug(message: string): void {
    this.append('debug', message)
  }

  info(message: string): void {
    this.append('info', message)
  }

  warning(message: string): void {
    this.append('warning', message)
  }

  error(message: string): void {
    this.append('error', message)
  }

  getEntries(): LogEntry[] {
    return this.entries
  }

  private rotate(): void {
    if (!this.filePath) {
      return
    }
    const backupPath = `${this.filePath}.old`
    try {
      rmSync(backupPath, { force: true })
      renameSync(this.filePath, backupPath)
      this.writtenBytes = 0
    } catch {
      // 轮转失败(文件被占用等)时继续追加,下次再试
    }
  }

  private append(level: LogLevel, message: string): void {
    // 循环里的重复失败(如每次扫描都读不到同一目录)在时间窗内只记一条
    const key = `${level}\n${message}`
    const now = Date.now()
    if (key === this.lastKey && now - this.lastKeyAt < DUPLICATE_SUPPRESS_MS) {
      return
    }
    this.lastKey = key
    this.lastKeyAt = now

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_MEMORY_ENTRIES)
    }
    this.writeToFile(`[${new Date().toISOString()}] [${LEVEL_NAMES[level]}] ${message}\n`)
    this.mirrorToConsole(level, message)
    for (const broadcast of this.broadcasters) {
      broadcast(entry)
    }
  }

  private mirrorToConsole(level: LogLevel, message: string): void {
    // debug 只进文件;info 及以上镜像到控制台,开发时终端可实时看到操作结果
    if (level === 'debug') {
      return
    }
    console[CONSOLE_METHODS[level]](`[${LEVEL_NAMES[level]}] ${message}`)
  }

  private writeToFile(line: string): void {
    if (!this.filePath) {
      this.pendingLines.push(line)
      // 日志文件长期不可用时(目录只读等)限制缓冲,避免内存无限增长
      if (this.pendingLines.length > MAX_PENDING_LINES) {
        this.pendingLines.splice(0, this.pendingLines.length - MAX_PENDING_LINES)
      }
      return
    }
    try {
      if (this.writtenBytes + Buffer.byteLength(line) > MAX_FILE_BYTES) {
        this.rotate()
      }
      appendFileSync(this.filePath, line, 'utf-8')
      this.writtenBytes += Buffer.byteLength(line)
    } catch {
      // 磁盘写入失败时保持静默,避免日志器自身造成崩溃。
    }
  }
}

export const logger = new Logger()
