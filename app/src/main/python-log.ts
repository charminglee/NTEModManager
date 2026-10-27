import type { LogLevel } from '../shared/types'

interface PythonLogMessage {
  type: 'log'
  version: 1
  timestamp: string
  level: LogLevel
  logger: string
  message: string
  exception?: string
  stack?: string
}

function parseMessage(line: string): PythonLogMessage | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    record.type !== 'log' ||
    record.version !== 1 ||
    typeof record.timestamp !== 'string' ||
    typeof record.logger !== 'string' ||
    typeof record.message !== 'string' ||
    !['debug', 'info', 'warning', 'error'].includes(record.level as string) ||
    (record.exception !== undefined && typeof record.exception !== 'string') ||
    (record.stack !== undefined && typeof record.stack !== 'string')
  ) {
    return null
  }
  return value as PythonLogMessage
}

/** stderr 专用日志通道，支持分片、连续消息和退出前没有换行的尾行。 */
export class PythonLogReceiver {
  private buffer = ''

  constructor(private readonly emit: (level: LogLevel, message: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      this.forward(this.buffer.slice(0, index))
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
    }
  }

  end(): void {
    this.forward(this.buffer)
    this.buffer = ''
  }

  private forward(line: string): void {
    const text = line.trim()
    if (!text) return
    const record = parseMessage(text)
    const message = record
      ? [record.message, record.exception, record.stack].filter(Boolean).join('\n')
      : text
    for (const part of message.split(/\r\n|\n|\r/)) {
      if (part) this.emit(record?.level ?? 'warning', `[Python] ${part}`)
    }
  }
}
