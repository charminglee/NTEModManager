import type { BrowserWindow } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '../shared/types'

const MAX_MEMORY_ENTRIES = 4000

const LEVEL_NAMES: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR'
}

type Broadcaster = (entry: LogEntry) => void

class Logger {
  private entries: LogEntry[] = []
  private filePath: string | null = null
  private broadcasters = new Set<Broadcaster>()

  /** 目录不存在时自动创建;主程序与背景服务共用 ~/.ntemm/logs 但各写各的文件 */
  initialize(directory: string, fileName: string): void {
    try {
      mkdirSync(directory, { recursive: true })
      this.filePath = join(directory, fileName)
    } catch {
      this.filePath = null
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

  private append(level: LogLevel, message: string): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_MEMORY_ENTRIES)
    }
    if (this.filePath) {
      try {
        appendFileSync(
          this.filePath,
          `[${new Date().toISOString()}] [${LEVEL_NAMES[level]}] ${message}\n`,
          'utf-8'
        )
      } catch {
        // 磁盘写入失败时保持静默,避免日志器自身造成崩溃。
      }
    }
    for (const broadcast of this.broadcasters) {
      broadcast(entry)
    }
  }
}

export const logger = new Logger()
