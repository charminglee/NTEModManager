import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, copyFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MANIFEST_FILE_NAME, type ModFileEntry, type ModInfo, type OperationResult } from '../shared/types'
import { find7ZipExecutable, extractArchive } from './archive'
import { getAppConfig } from './config'
import { logger } from './logger'

const IGNORED_COPY_EXTENSIONS = new Set(['zip', 'txt', 'png', 'jpg', 'md', 'json'])
const PACKAGE_EXTENSIONS = ['pak', 'ucas', 'utoc'] as const
const SUPPORTED_ARCHIVE_EXTENSIONS = ['zip', 'rar', '7z']

export function modsDirectory(): string {
  return getAppConfig().modsDirectory
}

export function backupsDirectory(): string {
  return getAppConfig().backupsDirectory
}

export function manifestPath(): string {
  return join(backupsDirectory(), MANIFEST_FILE_NAME)
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase()
}

export function isSupportedArchive(archivePath: string): boolean {
  return SUPPORTED_ARCHIVE_EXTENSIONS.includes(extensionOf(archivePath))
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function toNativeSeparators(path: string): string {
  return path.replace(/\//g, '\\')
}

function failure(message: string): OperationResult {
  return { success: false, message }
}

function success(message = ''): OperationResult {
  return { success: true, message }
}

function sanitizeDirectoryName(name: string): string {
  const replaced = name.replace(/[<>:"/\\|?*]/g, '_').trim()
  let result = replaced
  while (result.endsWith('.')) {
    result = result.slice(0, -1)
  }
  return result.length === 0 ? 'Imported Mod' : result
}

function sanitizeFileName(name: string): string {
  const replaced = name.replace(/[<>:"/\\|?*]/g, '_')
  let result = replaced
  while (result.endsWith('.')) {
    result = result.slice(0, -1)
  }
  return result
}

function isPackageExtension(extension: string): boolean {
  return (PACKAGE_EXTENSIONS as readonly string[]).includes(extension)
}

async function directorySize(path: string): Promise<number> {
  let total = 0
  const stack = [path]
  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = join(current, entry)
      try {
        const info = await stat(entryPath)
        if (info.isDirectory()) {
          stack.push(entryPath)
        } else if (info.isFile()) {
          total += info.size
        }
      } catch {
        // 文件在扫描过程中被移除时忽略。
      }
    }
  }
  return total
}

async function scanDirectoryEntry(directoryPath: string): Promise<ModFileEntry> {
  const entry: ModFileEntry = {
    name: basename(directoryPath),
    sizeBytes: 0,
    directory: true,
    children: []
  }
  let childNames: string[]
  try {
    childNames = await readdir(directoryPath)
  } catch {
    return entry
  }
  const dirs: string[] = []
  const files: string[] = []
  for (const childName of childNames) {
    const childPath = join(directoryPath, childName)
    if (isDirectory(childPath)) {
      dirs.push(childName)
    } else {
      files.push(childName)
    }
  }
  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  dirs.sort(collator.compare)
  files.sort(collator.compare)
  for (const dirName of dirs) {
    const child = await scanDirectoryEntry(join(directoryPath, dirName))
    entry.sizeBytes += child.sizeBytes
    entry.children.push(child)
  }
  for (const fileName of files) {
    const filePath = join(directoryPath, fileName)
    const size = (await stat(filePath)).size
    entry.children.push({ name: fileName, sizeBytes: size, directory: false, children: [] })
    entry.sizeBytes += size
  }
  return entry
}

async function copyDirectory(sourcePath: string, targetPath: string): Promise<OperationResult> {
  if (!isDirectory(sourcePath)) {
    return failure(`模组源文件夹不存在：${sourcePath}`)
  }
  try {
    await mkdir(targetPath, { recursive: true })
  } catch {
    return failure(`无法创建模组安装目录：${targetPath}`)
  }

  const copyRecursive = async (current: string, relative: string): Promise<OperationResult> => {
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      return failure(`无法读取目录：${relative || current}`)
    }
    for (const entryName of entries) {
      const entryPath = join(current, entryName)
      const relativePath = relative ? `${relative}\\${entryName}` : entryName
      const targetEntryPath = join(targetPath, relativePath)
      if (isDirectory(entryPath)) {
        try {
          await mkdir(targetEntryPath, { recursive: true })
        } catch {
          return failure(`无法创建目录：${relativePath}`)
        }
        const nested = await copyRecursive(entryPath, relativePath)
        if (!nested.success) {
          return nested
        }
      } else {
        if (IGNORED_COPY_EXTENSIONS.has(extensionOf(entryName))) {
          continue
        }
        try {
          await copyFile(entryPath, targetEntryPath)
        } catch {
          return failure(`无法复制文件：${relativePath}`)
        }
      }
    }
    return success()
  }

  const result = await copyRecursive(sourcePath, '')
  if (!result.success) {
    rmSync(targetPath, { recursive: true, force: true })
  }
  return result
}

async function mergeDirectory(sourcePath: string, targetPath: string): Promise<OperationResult> {
  if (!isDirectory(sourcePath)) {
    return failure(`解压后的模组文件夹不存在：${sourcePath}`)
  }
  try {
    await mkdir(targetPath, { recursive: true })
  } catch {
    return failure(`无法创建模组源文件夹：${targetPath}`)
  }

  const mergeRecursive = async (current: string, relative: string): Promise<OperationResult> => {
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      return failure(`无法读取目录：${relative || current}`)
    }
    for (const entryName of entries) {
      const entryPath = join(current, entryName)
      const relativePath = relative ? `${relative}\\${entryName}` : entryName
      const targetEntryPath = join(targetPath, relativePath)
      if (isDirectory(entryPath)) {
        if (existsSync(targetEntryPath) && !isDirectory(targetEntryPath)) {
          return failure(`无法创建目录：目标已是文件 ${relativePath}`)
        }
        try {
          await mkdir(targetEntryPath, { recursive: true })
        } catch {
          return failure(`无法创建目录：${relativePath}`)
        }
        const nested = await mergeRecursive(entryPath, relativePath)
        if (!nested.success) {
          return nested
        }
      } else {
        try {
          await mkdir(join(targetEntryPath, '..'), { recursive: true })
        } catch {
          return failure(`无法创建目录：${relativePath}`)
        }
        if (existsSync(targetEntryPath) && isDirectory(targetEntryPath)) {
          return failure(`无法覆盖目录：${relativePath}`)
        }
        try {
          if (existsSync(targetEntryPath)) {
            rmSync(targetEntryPath)
          }
          await copyFile(entryPath, targetEntryPath)
        } catch {
          return failure(`无法复制文件：${relativePath}`)
        }
      }
    }
    return success()
  }

  return mergeRecursive(sourcePath, '')
}

function removeInstalledModDirectory(installPath: string): OperationResult {
  if (!isDirectory(installPath)) {
    return failure(`目标不是可删除的模组目录：${installPath}`)
  }
  try {
    rmSync(installPath, { recursive: true })
  } catch {
    return failure(`无法删除已安装的模组文件：${installPath}`)
  }
  return success()
}

function uniqueDirectoryName(preferredName: string): string {
  const backupRoot = backupsDirectory()
  let candidate = preferredName
  let copyNumber = 2
  while (existsSync(join(backupRoot, candidate))) {
    candidate = `${preferredName} (${copyNumber++})`
  }
  return candidate
}

async function ensureWritableDirectory(directoryPath: string, displayName: string): Promise<OperationResult> {
  try {
    await mkdir(directoryPath, { recursive: true })
  } catch {
    return failure(`无法创建${displayName}:${directoryPath}`)
  }
  const probePath = join(directoryPath, `.nte-write-test-${randomUUID()}`)
  try {
    await mkdir(probePath)
  } catch {
    return failure(
      `无法写入${displayName}：${directoryPath}。请修改 NteModManager.ini 中的 Paths/backups_directory，或以管理员身份运行程序。`
    )
  }
  try {
    rmSync(probePath, { recursive: true })
  } catch {
    return failure(`无法清理${displayName}的写入测试目录：${probePath}`)
  }
  return success()
}

function moveDirectory(sourcePath: string, targetPath: string): OperationResult {
  try {
    renameSync(sourcePath, targetPath)
    return success()
  } catch (error) {
    return failure(`移动解压后的模组失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

interface ManifestMod {
  importedAt?: string
  lastInstalledAt?: string
  lastUninstalledAt?: string
  status?: string
  invalid?: boolean
  lastPackagingPath?: string
  history?: { action: string; at: string }[]
}

interface Manifest {
  version: number
  mods: Record<string, ManifestMod>
}

function loadManifest(): Manifest {
  const filePath = manifestPath()
  try {
    const document = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<Manifest>
    if (document && typeof document === 'object') {
      return { version: document.version ?? 1, mods: document.mods ?? {} }
    }
  } catch {
    // 清单不存在或损坏时按空清单处理。
  }
  return { version: 1, mods: {} }
}

function saveManifest(manifest: Manifest): OperationResult {
  const filePath = manifestPath()
  const temporaryPath = `${filePath}.tmp`
  try {
    mkdirSync(backupsDirectory(), { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2), 'utf-8')
    rmSync(filePath, { force: true })
    renameSync(temporaryPath, filePath)
    return success()
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // 忽略临时文件清理失败。
    }
    return failure(`无法保存状态清单：${error instanceof Error ? error.message : String(error)}`)
  }
}

function recordAction(modName: string, action: 'imported' | 'installed' | 'uninstalled'): OperationResult {
  const manifest = loadManifest()
  const mod: ManifestMod = manifest.mods[modName] ?? {}
  const now = new Date().toISOString()

  if (action === 'imported') {
    mod.importedAt = now
  } else if (action === 'installed') {
    mod.lastInstalledAt = now
  } else if (action === 'uninstalled') {
    mod.lastUninstalledAt = now
  }
  mod.status = action === 'installed' ? 'installed' : 'not-installed'

  mod.history = [...(mod.history ?? []), { action, at: now }]
  manifest.mods[modName] = mod
  manifest.version = 1
  return saveManifest(manifest)
}

function removeManifestEntry(modName: string): OperationResult {
  const manifest = loadManifest()
  delete manifest.mods[modName]
  return saveManifest(manifest)
}

function renameManifestEntry(oldName: string, newName: string): OperationResult {
  const manifest = loadManifest()
  if (manifest.mods[newName] !== undefined) {
    return failure(`状态清单中已存在同名模组：${newName}`)
  }
  const mod = manifest.mods[oldName]
  if (mod === undefined) {
    return saveManifest(manifest)
  }
  delete manifest.mods[oldName]
  manifest.mods[newName] = mod
  return saveManifest(manifest)
}

export async function initialize(): Promise<OperationResult> {
  const backupDirectory = await ensureWritableDirectory(backupsDirectory(), '模组备份目录')
  if (!backupDirectory.success) {
    return backupDirectory
  }

  const installDir = modsDirectory()
  const paksDirectory = join(installDir, '..')
  if (!existsSync(paksDirectory)) {
    return failure(`找不到游戏 Paks 目录：${paksDirectory}`)
  }
  if (!existsSync(installDir)) {
    try {
      await mkdir(installDir)
    } catch {
      return failure(`无法创建模组安装目录：${installDir}`)
    }
  }
  return success()
}

export async function scan(): Promise<ModInfo[]> {
  const manifest = loadManifest()
  const backupRoot = backupsDirectory()
  let directoryNames: string[]
  try {
    directoryNames = await readdir(backupRoot)
  } catch {
    return []
  }

  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  const result: ModInfo[] = []
  for (const name of directoryNames.filter((n) => !n.startsWith('.'))) {
    const sourcePath = join(backupRoot, name)
    if (!isDirectory(sourcePath)) {
      continue
    }
    const metadata = manifest.mods[name] ?? {}
    const installedPath = join(modsDirectory(), name)
    let importedAt = metadata.importedAt ?? ''
    if (!importedAt) {
      try {
        const info = await stat(sourcePath)
        importedAt = (info.birthtime.getTime() > 0 ? info.birthtime : info.mtime).toISOString()
      } catch {
        importedAt = new Date(0).toISOString()
      }
    }

    const files: ModFileEntry[] = []
    try {
      const childNames = await readdir(sourcePath)
      const dirs: string[] = []
      const fileNames: string[] = []
      for (const childName of childNames) {
        if (isDirectory(join(sourcePath, childName))) {
          dirs.push(childName)
        } else {
          fileNames.push(childName)
        }
      }
      dirs.sort(collator.compare)
      fileNames.sort(collator.compare)
      for (const dirName of dirs) {
        files.push(await scanDirectoryEntry(join(sourcePath, dirName)))
      }
      for (const fileName of fileNames) {
        files.push({
          name: fileName,
          sizeBytes: (await stat(join(sourcePath, fileName))).size,
          directory: false,
          children: []
        })
      }
    } catch {
      // 目录不可读时按空文件列表处理。
    }

    result.push({
      name,
      sourcePath,
      sizeBytes: await directorySize(sourcePath),
      files,
      importedAt,
      installed: isDirectory(installedPath),
      invalid: metadata.invalid === true
    })
  }
  // 与原版一致:已安装的模组排在前面(稳定排序)。
  const withIndex = result.map((mod, index) => ({ mod, index }))
  withIndex.sort((a, b) => Number(b.mod.installed) - Number(a.mod.installed) || a.index - b.index)
  return withIndex.map((item) => item.mod)
}

interface StagingResult {
  ok: true
  stagingPath: string
  extractedRoot: string
}

async function extractToStaging(
  archivePath: string,
  stagingPrefix: string,
  appDir: string
): Promise<StagingResult | { ok: false; result: OperationResult }> {
  if (!isFile(archivePath)) {
    return { ok: false, result: failure(`找不到压缩包：${archivePath}`) }
  }
  if (!isSupportedArchive(archivePath)) {
    return {
      ok: false,
      result: failure(`只支持 .zip、.rar 和 .7z 压缩包：${basename(archivePath)}`)
    }
  }

  const extractor = find7ZipExecutable(appDir)
  if (!extractor) {
    return {
      ok: false,
      result: failure('未找到 7-Zip。请安装 7-Zip，或设置环境变量 NTE_7ZIP_PATH 指向 7z.exe。')
    }
  }

  const stagingPath = join(backupsDirectory(), `.${stagingPrefix}-${randomUUID()}`)
  try {
    await mkdir(stagingPath, { recursive: true })
  } catch {
    return { ok: false, result: failure(`无法创建临时解压目录：${stagingPath}`) }
  }

  try {
    await extractArchive({
      sevenZipPath: extractor,
      archivePath,
      destinationPath: toNativeSeparators(stagingPath)
    })
  } catch (error) {
    rmSync(stagingPath, { recursive: true, force: true })
    return {
      ok: false,
      result: failure(error instanceof Error ? error.message : String(error))
    }
  }

  const entries = await readdir(stagingPath)
  if (entries.length === 0) {
    rmSync(stagingPath, { recursive: true, force: true })
    return { ok: false, result: failure('压缩包中没有可导入的文件。') }
  }

  let extractedRoot = stagingPath
  if (entries.length === 1 && isDirectory(join(stagingPath, entries[0]))) {
    extractedRoot = join(stagingPath, entries[0])
  }
  return { ok: true, stagingPath, extractedRoot }
}

function baseNameWithoutExtension(filePath: string): string {
  const name = basename(filePath)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export async function importArchive(archivePath: string, appDir: string): Promise<OperationResult> {
  if (!isFile(archivePath)) {
    return failure(`找不到压缩包：${archivePath}`)
  }
  if (!isSupportedArchive(archivePath)) {
    return failure(`只支持 .zip、.rar 和 .7z 压缩包：${basename(archivePath)}`)
  }

  const initialization = await initialize()
  if (!initialization.success) {
    return initialization
  }

  const staging = await extractToStaging(archivePath, 'import', appDir)
  if (!staging.ok) {
    return staging.result
  }

  const modName = uniqueDirectoryName(sanitizeDirectoryName(baseNameWithoutExtension(archivePath)))
  const targetPath = join(backupsDirectory(), modName)
  const moved = moveDirectory(staging.extractedRoot, targetPath)
  if (staging.extractedRoot !== staging.stagingPath) {
    rmSync(staging.stagingPath, { recursive: true, force: true })
  }
  if (!moved.success) {
    rmSync(staging.stagingPath, { recursive: true, force: true })
    return moved
  }

  const stateSaved = recordAction(modName, 'imported')
  if (!stateSaved.success) {
    return failure(`模组已导入，但状态记录失败：${stateSaved.message}`)
  }
  try {
    rmSync(archivePath, { force: true })
  } catch {
    return failure(`模组已导入，但无法永久删除原压缩包：${basename(archivePath)}`)
  }
  logger.info(`导入压缩包完成：${modName}`)
  return success(`已导入 ${modName}`)
}

export async function importPackagedMod(modName: string, packageDirectory: string): Promise<OperationResult> {
  if (modName.trim().length === 0) {
    return failure('模组名称不能为空。')
  }
  const sanitizedName = sanitizeDirectoryName(modName)
  if (sanitizedName !== modName.trim()) {
    return failure('模组名称包含无效字符。')
  }

  const initialization = await initialize()
  if (!initialization.success) {
    return initialization
  }

  const targetPath = join(backupsDirectory(), sanitizedName)
  if (existsSync(targetPath)) {
    return failure(`已存在同名模组文件夹：${sanitizedName}`)
  }

  const packageFiles = ['Mod_P.pak', 'Mod_P.ucas', 'Mod_P.utoc']
  for (const packageFile of packageFiles) {
    if (!isFile(join(packageDirectory, packageFile))) {
      return failure(`找不到打包产物：${join(packageDirectory, packageFile)}`)
    }
  }

  try {
    await mkdir(targetPath, { recursive: true })
    for (const packageFile of packageFiles) {
      await copyFile(join(packageDirectory, packageFile), join(targetPath, packageFile))
    }
  } catch {
    rmSync(targetPath, { recursive: true, force: true })
    return failure('无法复制打包产物。')
  }

  const stateSaved = recordAction(sanitizedName, 'imported')
  if (!stateSaved.success) {
    rmSync(targetPath, { recursive: true, force: true })
    return failure(`模组文件已复制，但状态记录失败：${stateSaved.message}`)
  }
  return success(`已导入 ${sanitizedName}`)
}

export async function replacePackagedMod(mod: ModInfo, packageDirectory: string): Promise<OperationResult> {
  if (!isDirectory(mod.sourcePath)) {
    return failure(`模组源文件夹不存在：${mod.sourcePath}`)
  }

  let sourceFileNames: string[]
  try {
    sourceFileNames = await readdir(mod.sourcePath)
  } catch {
    return failure(`模组源文件夹不存在：${mod.sourcePath}`)
  }

  const targetFiles: string[] = []
  for (const extension of PACKAGE_EXTENSIONS) {
    const matching = sourceFileNames.filter(
      (name) => extensionOf(name) === extension && isFile(join(mod.sourcePath, name))
    )
    if (matching.length === 0) {
      return failure(`模组源文件夹中找不到对应的 .${extension} 文件。 `)
    }
    if (matching.length > 1) {
      return failure(`模组源文件夹中存在多个 .${extension} 文件，无法确定替换目标。 `)
    }
    targetFiles.push(matching[0])
  }

  const packagedFiles = ['Mod_P.pak', 'Mod_P.ucas', 'Mod_P.utoc']
  for (let index = 0; index < packagedFiles.length; index++) {
    const packageFile = packagedFiles[index]
    const sourcePath = join(packageDirectory, packageFile)
    if (!isFile(sourcePath)) {
      return failure(`找不到打包产物：${sourcePath}`)
    }

    const targetPath = join(mod.sourcePath, targetFiles[index])
    const temporaryPath = `${targetPath}.repack.tmp`
    try {
      rmSync(temporaryPath, { force: true })
      await copyFile(sourcePath, temporaryPath)
      if (existsSync(targetPath)) {
        rmSync(targetPath)
      }
      renameSync(temporaryPath, targetPath)
    } catch {
      rmSync(temporaryPath, { force: true })
      return failure(`无法替换源文件：${packageFile}`)
    }
  }

  return success(`已重新打包并替换 ${mod.name} 的源文件`)
}

export function lastPackagingPath(modName: string): string {
  if (modName.trim().length === 0) {
    return ''
  }
  return (loadManifest().mods[modName]?.lastPackagingPath ?? '').replace(/\\/g, '/').trim()
}

export function setLastPackagingPath(modName: string, path: string): OperationResult {
  if (modName.trim().length === 0) {
    return failure('无法保存空的模组名称。')
  }
  const manifest = loadManifest()
  const metadata: ManifestMod = manifest.mods[modName] ?? {}
  if (path.trim().length === 0) {
    delete metadata.lastPackagingPath
  } else {
    metadata.lastPackagingPath = path.replace(/\\/g, '/').trim()
  }
  manifest.mods[modName] = metadata
  manifest.version = 1
  return saveManifest(manifest)
}

export async function addFromArchive(mod: ModInfo, archivePath: string, appDir: string): Promise<OperationResult> {
  if (!isSupportedArchive(archivePath)) {
    return failure(`只支持 .zip、.rar 和 .7z 压缩包：${basename(archivePath)}`)
  }
  if (!isDirectory(mod.sourcePath)) {
    return failure(`模组源文件夹不存在：${mod.sourcePath}`)
  }

  const initialization = await initialize()
  if (!initialization.success) {
    return initialization
  }

  const staging = await extractToStaging(archivePath, 'add', appDir)
  if (!staging.ok) {
    return staging.result
  }

  const merged = await mergeDirectory(staging.extractedRoot, mod.sourcePath)
  rmSync(staging.stagingPath, { recursive: true, force: true })
  if (!merged.success) {
    return merged
  }

  if (mod.installed) {
    const installPath = join(modsDirectory(), mod.name)
    if (existsSync(installPath)) {
      const deletedInstall = removeInstalledModDirectory(installPath)
      if (!deletedInstall.success) {
        return deletedInstall
      }
    }
    const copied = await copyDirectory(mod.sourcePath, installPath)
    if (!copied.success) {
      return copied
    }
  }

  try {
    rmSync(archivePath, { force: true })
  } catch {
    return failure(`模组已添加文件，但无法永久删除原压缩包：${basename(archivePath)}`)
  }
  return success(`已向 ${mod.name} 添加文件`)
}

export async function replaceFromArchive(mod: ModInfo, archivePath: string, appDir: string): Promise<OperationResult> {
  const archiveName = basename(archivePath)
  if (!isSupportedArchive(archivePath)) {
    return failure(`只支持 .zip、.rar 和 .7z 压缩包：${archiveName}`)
  }
  if (!isDirectory(mod.sourcePath)) {
    return failure(`模组源文件夹不存在：${mod.sourcePath}`)
  }

  const initialization = await initialize()
  if (!initialization.success) {
    return initialization
  }

  const staging = await extractToStaging(archivePath, 'replace', appDir)
  if (!staging.ok) {
    return staging.result
  }

  // 替换模组源文件夹内容:先清空再移入解压结果。
  try {
    rmSync(mod.sourcePath, { recursive: true })
  } catch {
    rmSync(staging.stagingPath, { recursive: true, force: true })
    return failure(`无法清空原模组源文件夹：${mod.sourcePath}`)
  }
  try {
    await mkdir(mod.sourcePath, { recursive: true })
  } catch {
    rmSync(staging.stagingPath, { recursive: true, force: true })
    return failure(`无法重建模组源文件夹：${mod.sourcePath}`)
  }
  const moved = moveDirectory(staging.extractedRoot, mod.sourcePath)
  if (staging.extractedRoot !== staging.stagingPath) {
    rmSync(staging.stagingPath, { recursive: true, force: true })
  }
  if (!moved.success) {
    rmSync(staging.stagingPath, { recursive: true, force: true })
    return moved
  }

  // 如已安装,同步替换安装目录中的模组文件。
  if (mod.installed) {
    const installPath = join(modsDirectory(), mod.name)
    if (existsSync(installPath)) {
      const deletedInstall = removeInstalledModDirectory(installPath)
      if (!deletedInstall.success) {
        return deletedInstall
      }
    }
    const copied = await copyDirectory(mod.sourcePath, installPath)
    if (!copied.success) {
      return copied
    }
  }

  try {
    rmSync(archivePath, { force: true })
  } catch {
    return failure(`模组已更新，但无法永久删除原压缩包：${archiveName}`)
  }
  return success(`已更新 ${mod.name} 的源文件`)
}

export async function install(mod: ModInfo): Promise<OperationResult> {
  if (!isDirectory(mod.sourcePath)) {
    return failure(`模组源文件夹不存在：${mod.name}`)
  }

  const initialization = await initialize()
  if (!initialization.success) {
    return initialization
  }

  const installPath = join(modsDirectory(), mod.name)
  if (existsSync(installPath)) {
    if (isDirectory(installPath)) {
      return success('模组已经安装。')
    }
    return failure(`安装目录中存在同名文件，已停止以保护该文件：${mod.name}`)
  }

  const copied = await copyDirectory(mod.sourcePath, installPath)
  if (!copied.success) {
    return copied
  }
  const recorded = recordAction(mod.name, 'installed')
  if (!recorded.success) {
    return failure(`模组文件已复制，但状态记录失败：${recorded.message}`)
  }
  return success(`已安装 ${mod.name}`)
}

export async function uninstall(mod: ModInfo): Promise<OperationResult> {
  const installPath = join(modsDirectory(), mod.name)
  if (!existsSync(installPath)) {
    return success('模组未安装。')
  }

  const deleted = removeInstalledModDirectory(installPath)
  if (!deleted.success) {
    return deleted
  }
  const recorded = recordAction(mod.name, 'uninstalled')
  if (!recorded.success) {
    return failure(`已复制的模组文件已删除，但状态记录失败：${recorded.message}`)
  }
  return success(`已卸载 ${mod.name}`)
}

export async function setInvalid(mod: ModInfo, invalid: boolean): Promise<OperationResult> {
  const manifest = loadManifest()
  const metadata: ManifestMod = manifest.mods[mod.name] ?? {}
  metadata.invalid = invalid
  manifest.mods[mod.name] = metadata
  manifest.version = 1

  const saved = saveManifest(manifest)
  if (!saved.success) {
    return saved
  }
  return success(invalid ? `已将 ${mod.name} 标记为失效` : `已取消 ${mod.name} 的失效标记`)
}

export async function rename(mod: ModInfo, newName: string): Promise<OperationResult> {
  if (newName.trim().length === 0) {
    return failure('模组名称不能为空。')
  }
  const sanitizedName = sanitizeDirectoryName(newName)
  if (sanitizedName !== newName.trim()) {
    return failure('模组名称包含无效字符，无法重命名。')
  }
  if (sanitizedName === mod.name) {
    return success('模组名称未变更。')
  }
  if (!isDirectory(mod.sourcePath)) {
    return failure(`模组源文件夹不存在：${mod.name}`)
  }

  const targetPath = join(backupsDirectory(), sanitizedName)
  if (existsSync(targetPath)) {
    return failure(`已存在同名模组文件夹：${sanitizedName}`)
  }
  if (loadManifest().mods[sanitizedName] !== undefined) {
    return failure(`状态清单中已存在同名模组：${sanitizedName}`)
  }

  const oldInstallPath = join(modsDirectory(), mod.name)
  const newInstallPath = join(modsDirectory(), sanitizedName)
  if (mod.installed && existsSync(newInstallPath)) {
    return failure(`安装目录中已存在同名项目：${sanitizedName}`)
  }

  const moved = moveDirectory(mod.sourcePath, targetPath)
  if (!moved.success) {
    return failure(`重命名模组失败：${moved.message}`)
  }

  if (mod.installed) {
    const movedInstallation = moveDirectory(oldInstallPath, newInstallPath)
    if (!movedInstallation.success) {
      moveDirectory(targetPath, mod.sourcePath)
      return failure(`重命名模组失败：无法更新已安装文件：${movedInstallation.message}`)
    }
  }

  const manifestRenamed = renameManifestEntry(mod.name, sanitizedName)
  if (!manifestRenamed.success) {
    if (mod.installed) {
      moveDirectory(newInstallPath, oldInstallPath)
    }
    moveDirectory(targetPath, mod.sourcePath)
    return failure(`重命名模组失败：${manifestRenamed.message}`)
  }

  return success(`已将 ${mod.name} 重命名为 ${sanitizedName}`)
}

interface FileRenameOperation {
  oldPath: string
  newPath: string
}

function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot <= 0 ? fileName : fileName.slice(0, dot)
}

function dirnameRelative(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index <= 0 ? '' : relativePath.slice(0, index)
}

export function renameFile(
  mod: ModInfo,
  relativeFilePath: string,
  newFileName: string
): OperationResult {
  const cleanRelativePath = relativeFilePath.replace(/\\/g, '/')
  if (
    relativeFilePath.trim().length === 0 ||
    /^[a-zA-Z]:/.test(cleanRelativePath) ||
    cleanRelativePath === '..' ||
    cleanRelativePath.startsWith('../')
  ) {
    return failure('无法重命名无效的模组文件路径。')
  }

  const oldFilePath = join(mod.sourcePath, cleanRelativePath)
  if (!isFile(oldFilePath)) {
    return failure(`模组文件不存在：${relativeFilePath}`)
  }

  const oldFileName = basename(oldFilePath)
  let targetFileName = newFileName.trim()
  if (targetFileName.length === 0) {
    return failure('文件名不能为空。')
  }
  if (targetFileName.includes('/') || targetFileName.includes('\\')) {
    return failure('文件名不能包含路径。')
  }

  const sanitizedName = sanitizeFileName(targetFileName)
  if (sanitizedName !== targetFileName || targetFileName === '.' || targetFileName === '..') {
    return failure('文件名包含无效字符，无法重命名。')
  }

  const oldExtension = extensionOf(oldFileName)
  const packageFile = isPackageExtension(oldExtension)
  const enteredExtension = extensionOf(targetFileName)
  if (enteredExtension.length === 0) {
    const originalSuffix = oldFileName.slice(oldFileName.lastIndexOf('.') + 1)
    targetFileName = `${targetFileName}.${originalSuffix}`
  } else if (packageFile && !isPackageExtension(enteredExtension)) {
    return failure('pak、ucas 和 utoc 文件只能保留这三种后缀。')
  }

  const targetStem = stemOf(targetFileName)
  if (packageFile && !targetStem.endsWith('_P')) {
    return failure('文件名后缀名前必须以“_P”结尾，已取消重命名。')
  }
  if (targetFileName === oldFileName) {
    return success('文件名未变更。')
  }

  const relativeDirectory = dirnameRelative(cleanRelativePath)
  const relativePathForName = (fileName: string): string =>
    relativeDirectory === '' ? fileName : `${relativeDirectory}/${fileName}`

  const relativeRenames: { from: string; to: string }[] = []
  if (packageFile) {
    const oldStem = stemOf(oldFileName)
    for (const extension of PACKAGE_EXTENSIONS) {
      const oldRelativePath = relativePathForName(`${oldStem}.${extension}`)
      if (!isFile(join(mod.sourcePath, oldRelativePath))) {
        return failure('文件组不完整，必须同时存在同名的 .pak、.ucas 和 .utoc 文件。')
      }
      relativeRenames.push({
        from: oldRelativePath,
        to: relativePathForName(`${targetStem}.${extension}`)
      })
    }
  } else {
    relativeRenames.push({ from: cleanRelativePath, to: relativePathForName(targetFileName) })
  }

  const operations: FileRenameOperation[] = []
  const appendOperations = (
    rootPath: string,
    rootDescription: string,
    allowMissing: boolean
  ): OperationResult => {
    for (const fileRename of relativeRenames) {
      const oldPath = join(rootPath, fileRename.from)
      const newPath = join(rootPath, fileRename.to)
      if (!isFile(oldPath)) {
        if (allowMissing) {
          continue
        }
        return failure(`${rootDescription}中缺少文件：${fileRename.from}`)
      }
      if (existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
        return failure(`${rootDescription}中已存在同名文件：${fileRename.to}`)
      }
      operations.push({ oldPath, newPath })
    }
    return success()
  }

  const sourceOperations = appendOperations(mod.sourcePath, '模组源文件夹', false)
  if (!sourceOperations.success) {
    return sourceOperations
  }
  if (mod.installed) {
    const installedRoot = join(modsDirectory(), mod.name)
    const installedOperations = appendOperations(installedRoot, '已安装模组文件夹', !packageFile)
    if (!installedOperations.success) {
      return installedOperations
    }
  }

  const completed: FileRenameOperation[] = []
  for (const operation of operations) {
    try {
      renameSync(operation.oldPath, operation.newPath)
    } catch {
      let rollbackSucceeded = true
      for (const done of [...completed].reverse()) {
        try {
          renameSync(done.newPath, done.oldPath)
        } catch {
          rollbackSucceeded = false
        }
      }
      const rollbackMessage = rollbackSucceeded
        ? '已回滚已完成的文件操作。'
        : '部分文件无法回滚，请检查源文件夹和安装文件夹。 '
      return failure(
        `重命名模组文件失败：无法将 ${operation.oldPath} 重命名为 ${operation.newPath}。${rollbackMessage}`
      )
    }
    completed.push(operation)
  }

  const oldDisplayName = oldFileName
  const newDisplayName = packageFile ? `${targetStem}.${extensionOf(oldFileName)}` : targetFileName
  return success(`已将 ${oldDisplayName} 重命名为 ${newDisplayName}`)
}

export async function remove(mod: ModInfo): Promise<OperationResult> {
  const installPath = join(modsDirectory(), mod.name)
  if (existsSync(installPath)) {
    const deletedInstallation = removeInstalledModDirectory(installPath)
    if (!deletedInstallation.success) {
      return deletedInstallation
    }
  }

  if (isDirectory(mod.sourcePath)) {
    try {
      rmSync(mod.sourcePath, { recursive: true })
    } catch {
      return failure(`无法删除模组备份文件夹：${mod.name}`)
    }
  }

  const stateRemoved = removeManifestEntry(mod.name)
  if (!stateRemoved.success) {
    return failure(`模组文件已删除，但无法更新状态清单：${stateRemoved.message}`)
  }
  return success(`已删除 ${mod.name}`)
}
