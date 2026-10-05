export interface IniFile {
  [section: string]: { [key: string]: string }
}

export function parseIni(text: string): IniFile {
  const result: IniFile = {}
  let current: { [key: string]: string } = {}
  result[''] = current

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue
    }
    const sectionMatch = /^\[(.+)\]$/.exec(line)
    if (sectionMatch) {
      const section = sectionMatch[1].trim()
      current = result[section] ?? (result[section] = {})
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    current[key] = value
  }
  return result
}

function needsQuoting(value: string): boolean {
  return /^[;#\s]|[\s;]$/.test(value) || value.includes('\n')
}

export function serializeIni(ini: IniFile): string {
  const lines: string[] = []
  const writeSection = (name: string, entries: { [key: string]: string }) => {
    if (name) {
      lines.push(`[${name}]`)
    }
    for (const [key, value] of Object.entries(entries)) {
      lines.push(`${key}=${needsQuoting(value) ? JSON.stringify(value) : value}`)
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
