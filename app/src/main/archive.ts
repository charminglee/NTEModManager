import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import iconv from 'iconv-lite'

function findExecutable(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function searchPath(command: string): string | null {
  const pathVar = process.env.PATH ?? ''
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
  for (const dir of pathVar.split(';')) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, `${command}${ext.toLowerCase()}`)
      if (existsSync(candidate)) {
        return candidate
      }
      const candidateUpper = join(dir, `${command}${ext}`)
      if (existsSync(candidateUpper)) {
        return candidateUpper
      }
    }
  }
  return null
}

export function find7ZipExecutable(appDir: string): string | null {
  const configured = process.env.NTE_7ZIP_PATH
  if (configured && existsSync(configured)) {
    return configured
  }

  const bundled = findExecutable([join(appDir, '7z.exe'), join(appDir, '7zz.exe')])
  if (bundled) {
    return bundled
  }

  for (const command of ['7z', '7z.exe', '7zz', '7zz.exe']) {
    const found = searchPath(command)
    if (found) {
      return found
    }
  }

  return findExecutable([
    'C:/7-Zip/7z.exe',
    'C:/Program Files/7-Zip/7z.exe',
    'C:/Program Files (x86)/7-Zip/7z.exe'
  ])
}

/** 优先按 UTF-8 解码,失败时回退 GBK(中文 Windows 下 7z/cmd 输出为 OEM 代码页)。 */
function decodeConsoleOutput(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return iconv.decode(data, 'gbk')
  }
}

export interface ExtractOptions {
  sevenZipPath: string
  archivePath: string
  destinationPath: string
}

export function extractArchive(options: ExtractOptions): Promise<void> {
  const { sevenZipPath, archivePath, destinationPath } = options
  return run7Zip(sevenZipPath, ['x', '-y', '-aoa', `-o${destinationPath}`, archivePath], '解压')
}

export async function createZipArchive(
  sevenZipPath: string,
  sourcePath: string,
  archivePath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const sourceDirectory = await realpath(sourcePath)
  const targetDirectory = await realpath(dirname(archivePath))
  const relativeDirectory = relative(sourceDirectory, targetDirectory)
  if (
    !isAbsolute(relativeDirectory) &&
    relativeDirectory !== '..' &&
    !relativeDirectory.startsWith(`..${sep}`)
  ) {
    throw new Error('请选择模组源目录以外的位置保存压缩包。')
  }

  const temporaryPath = join(targetDirectory, `.ntemm-export-${randomUUID()}.tmp`)
  try {
    await run7Zip(
      resolve(sevenZipPath),
      ['a', '-tzip', '-mcu=on', '-spd', '-bsp1', '-bso2', '--', temporaryPath, `.${sep}${basename(sourcePath)}`],
      '压缩',
      dirname(sourcePath),
      onProgress
    )
    await rename(temporaryPath, join(targetDirectory, basename(archivePath)))
  } finally {
    await rm(temporaryPath, { force: true })
  }
  onProgress(100)
}

function run7Zip(
  sevenZipPath: string,
  args: string[],
  action: string,
  cwd?: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZipPath, args, { cwd, windowsHide: true })
    const output: Buffer[] = []
    let progressLine = ''
    let lastPercent = -1
    child.stdout.on('data', (chunk: Buffer) => {
      if (!onProgress) {
        output.push(chunk)
        return
      }

      // 7-Zip 用回车或退格重绘进度，百分比也可能跨两个输出块。
      const lines = (progressLine + chunk.toString('latin1')).split(/[\r\n\b]/)
      progressLine = lines[lines.length - 1]
      for (const line of lines) {
        const match = /^[ \t]*(\d{1,2})%/.exec(line)
        if (!match) continue
        const percent = Number(match[1])
        if (percent <= lastPercent) continue
        lastPercent = percent
        onProgress(percent)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output.push(chunk)
    })
    child.on('error', (error) => {
      reject(new Error(`无法启动 7-Zip：${error.message}`))
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const text = decodeConsoleOutput(Buffer.concat(output)).trim()
        reject(new Error(`${action}失败：${text || `7-Zip 异常退出（退出码 ${code ?? 'unknown'}）`}`))
      }
    })
  })
}
