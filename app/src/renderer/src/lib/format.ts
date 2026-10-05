export function formatFileSize(byteCount: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = byteCount
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const precision = unitIndex === 0 ? 0 : size < 10 ? 1 : 0
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

export function formatImportedAt(isoTime: string): string {
  const date = new Date(isoTime)
  if (Number.isNaN(date.getTime())) {
    return isoTime
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function basenameWithoutExtension(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function joinPath(directory: string, name: string): string {
  const separator = directory.includes('\\') || /^[a-zA-Z]:/.test(directory) ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`
}
