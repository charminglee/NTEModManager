export interface IniFile {
  [section: string]: { [key: string]: string }
}

const sectionName = (line: string) => /^\[(.+)\]$/.exec(line)?.[1].trim()

export function parseIni(text: string, strict = false): IniFile {
  const result: IniFile = Object.create(null)
  let current: Record<string, string> = Object.create(null)
  result[''] = current

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue
    }
    const section = sectionName(line)
    if (section !== undefined && (!strict || section)) {
      current = result[section] ?? (result[section] = Object.create(null))
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      if (strict) throw new Error(`第 ${index + 1} 行格式无效，请使用 [节名] 或 键=值。`)
      continue
    }
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    current[key] = value
  }
  return result
}

function formatValue(value: string): string {
  return /^[;#\s]|[\s;]$/.test(value) || value.includes('\n') ? JSON.stringify(value) : value
}

export function serializeIni(ini: IniFile): string {
  const lines: string[] = []
  const writeSection = (name: string, entries: { [key: string]: string }) => {
    if (name) {
      lines.push(`[${name}]`)
    }
    for (const [key, value] of Object.entries(entries)) {
      lines.push(`${key}=${formatValue(value)}`)
    }
    lines.push('')
  }

  const anonymous = ini['']
  if (anonymous && Object.keys(anonymous).length > 0) {
    writeSection('', anonymous)
  }
  for (const [name, entries] of Object.entries(ini)) {
    if (name && Object.keys(entries).length > 0) {
      writeSection(name, entries)
    }
  }
  return lines.join('\n')
}

/** 将结构化设置写回原文，保留未修改的行。 */
export function updateIniText(text: string, next: IniFile): string {
  const before = parseIni(text)
  const pending = new Map(Object.entries(next).map(([name, entries]) => [name, new Map(Object.entries(entries))]))
  const lastLine = new Map<string, number>()
  let section = ''
  const lines = (text ? text.split(/\r?\n/) : []).map((raw, index) => {
    const line = raw.trim()
    const header = sectionName(line)
    if (header !== undefined) {
      section = header
      lastLine.set(section, index)
      return pending.has(section) ? raw : null
    }
    const eq = line.indexOf('=')
    if (eq <= 0 || line.startsWith(';') || line.startsWith('#')) return raw

    const key = line.slice(0, eq).trim()
    const entries = next[section]
    if (!entries || !Object.hasOwn(entries, key)) return null
    const value = entries[key]
    lastLine.set(section, index)
    pending.get(section)?.delete(key)
    if (value === before[section]?.[key]) return raw
    const endOfKey = raw.indexOf('=') + 1
    const valueIndent = raw.slice(endOfKey).match(/^\s*/)?.[0] ?? ''
    return raw.slice(0, endOfKey) + valueIndent + formatValue(value)
  })

  const newSections: string[] = []
  const insertions = new Map<number, string[]>()
  for (const [name, entries] of pending) {
    if (!entries.size) continue
    const properties = [...entries].map(([key, value]) => `${key}=${formatValue(value)}`)
    const index = lastLine.get(name)
    if (index !== undefined) insertions.set(index, properties)
    else if (name) newSections.push(`[${name}]`, ...properties, '')
    else insertions.set(-1, properties)
  }

  const result = [
    ...(insertions.get(-1) ?? []),
    ...lines.flatMap((line, index) => line === null ? [] : [line, ...(insertions.get(index) ?? [])])
  ]
  if (newSections.length) {
    if (result.at(-1)) result.push('')
    result.push(...newSections)
  }
  return result.join(text.includes('\r\n') ? '\r\n' : '\n')
}

export function splitList(value: string | undefined): string[] {
  if (!value) {
    return []
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}
