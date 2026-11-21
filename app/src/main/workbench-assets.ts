import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { getAppConfig } from './config'
import { logger } from './logger'
import { ntemmCacheDir } from './ntemm-paths'
import { bundledToolsDirectory } from './bundled-tools'
import { assetResults, effectiveAssets, matchingAssets } from '../shared/workbench-assets-filter'
import { assetExportKind, type AssetEntry, type AssetExportKind, type AssetExportRequest,
  type AssetExportResult, type AssetPreview, type AssetPreviewMode, type AssetQuery, type AssetReference, type AssetState } from '../shared/workbench-assets'

function context() {
  const config = getAppConfig()
  const paks = join(config.gameDirectory, 'Client', 'WindowsNoEditor', 'HT', 'Content', 'Paks')
  const game = createHash('sha256').update(resolve(paks).toLowerCase()).digest('hex')
  const root = join(ntemmCacheDir(), 'assets', game)
  return { config, paks, root }
}

type Context = ReturnType<typeof context>
let index: { paks: string; key: string; rows: AssetEntry[]; effective: AssetEntry[] } | undefined
let baseline: { file: string; entries: Map<string, AssetEntry> } | undefined
const current = (ctx: Context) => index?.paks === ctx.paks && index.key === ctx.config.workbenchAesKey ? index : undefined

async function parse(ctx: Context, action: AssetPreviewMode | 'index' | 'texture' | 'export', output: string,
  entry?: { path?: string; archive?: string }, preview = false, items?: { path: string; kind?: AssetExportKind }[]) {
  const tools = bundledToolsDirectory()
  const parser = join(tools, 'cue4parse')
  const tool = join(parser, 'win-x64', 'WorkbenchAssets.exe')
  if (!existsSync(tool)) throw new Error(`缺少工作台资源解析器：${tool}`)
  const mapping = ctx.config.workbenchMapping || join(parser, 'Mappings', 'HT-5.6.1-0+UE5-0196ef29.usmap')
  const request = {
    action, preview, paks: ctx.paks, output, key: ctx.config.workbenchAesKey, mapping,
    oodle: join(tools, 'retoc', 'oo2core_9_win64.dll'), path: entry?.path, archive: entry?.archive, items
  }
  await new Promise<void>((done, fail) => {
    const proc = spawn(tool, [], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    let error = ''
    proc.stderr.setEncoding('utf8').on('data', chunk => { error = (error + chunk).slice(-4096) })
    proc.once('error', fail)
    proc.stdin.once('error', fail)
    proc.once('close', code => {
      if (code === 0) return done()
      const detail = error.trim().replace(/(?:0x)?[a-f0-9]{64}/gi, '〔已隐藏〕') || `解析器退出（${code}）。`
      logger.error(`资源解析失败：${detail}`)
      fail(new Error(detail))
    })
    proc.stdin.end(JSON.stringify(request))
  })
}

async function gameArchives(ctx: Context): Promise<string[]> {
  if (!ctx.config.gameDirectory) return []
  const content = dirname(ctx.paks)
  const directories = await Promise.all(['Paks', 'PatchPaks', 'TagPatchPaks'].map(async directory => {
    const path = join(content, directory)
    const files = await readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      logger.error(`读取游戏包体目录失败：${error.message}`)
      throw error
    })
    return files.filter(file => {
      const name = file.name.toLowerCase()
      return (file.isFile() || file.isSymbolicLink()) && /\.(?:pak|utoc)$/.test(name) && name !== 'global.utoc'
    }).map(file => `${directory}/${file.name}`)
  }))
  return directories.flat().sort()
}

async function state(ctx: Context): Promise<AssetState> {
  await mkdir(ctx.root, { recursive: true })
  const [archives, files] = await Promise.all([gameArchives(ctx), readdir(ctx.root)])
  return {
    count: current(ctx)?.rows.length ?? 0, archives,
    snapshots: files.filter(file => file.endsWith('.snapshot.json')).sort().reverse()
  }
}

async function queryAssets(ctx: Context, query: AssetQuery) {
  const cached = current(ctx)
  if (!cached) return { rows: [] as AssetEntry[] }
  if (query.mode !== 'new' && query.mode !== 'modified') {
    return { rows: query.mode === 'all' ? cached.rows : cached.effective }
  }
  if (!/^\d{4}-[\dT.Z-]+[a-f\d]{8}\.snapshot\.json$/.test(query.snapshot)) throw new Error('请选择对比快照。')
  const file = join(ctx.root, query.snapshot)
  if (baseline?.file !== file) baseline = { file, entries: effectiveAssets(JSON.parse(await readFile(file, 'utf8'))) }
  return { rows: cached.effective, previous: baseline.entries }
}

async function previewAsset(entry: AssetReference, mode: AssetPreviewMode): Promise<AssetPreview> {
  if (!['auto', 'json', 'blueprint'].includes(mode)) throw new Error('未知的预览模式。')
  const ctx = context()
  const asset = current(ctx)?.rows.find(row => row.path === entry.path && row.archive === entry.archive)
  if (!asset) throw new Error('资源索引已失效，请重新加载。')
  const stage = await mkdtemp(join(ctx.root, '.ntemm-'))
  try {
    await parse(ctx, mode, stage, asset, true)
    const files = (await readdir(stage, { recursive: true, withFileTypes: true })).filter(file => file.isFile())
    const formats = { '.glb': 'model', '.png': 'texture', '.json': 'json', '.txt': 'blueprint' } as const
    for (const [extension, format] of Object.entries(formats)) {
      const file = files.find(file => extname(file.name).toLowerCase() === extension)
      if (file) return { format, name: file.name, bytes: await readFile(join(file.parentPath, file.name)) }
    }
    throw new Error('资源中没有可预览的对象。')
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function exportAssets(request: AssetExportRequest): Promise<AssetExportResult> {
  const ctx = context()
  const cached = current(ctx)
  if (!cached) throw new Error('资源索引已失效，请重新加载。')
  const root = ctx.config.workbenchExportDirectory
  if (!root) throw new Error('请先设置工作台导出目录。')

  let entries: AssetEntry[]
  if ('folder' in request) {
    const { rows, previous } = await queryAssets(ctx, request.folder)
    entries = [...matchingAssets(rows, request.folder, previous)].filter(entry => assetExportKind(entry) === request.kind)
  } else {
    const paths = new Map<string, Set<string>>()
    for (const entry of request.entries) {
      if (!paths.has(entry.archive)) paths.set(entry.archive, new Set())
      paths.get(entry.archive)!.add(entry.path)
    }
    entries = cached.rows.filter(entry => paths.get(entry.archive)?.has(entry.path))
    if (entries.length !== request.entries.length) throw new Error('资源索引已失效，请重新加载。')
  }
  if (!entries.length) throw new Error('没有符合所选类型的资源。')

  const groups = new Map<string, { path: string; kind?: AssetExportKind }[]>()
  for (const entry of entries) {
    const items = groups.get(entry.archive) ?? []
    if (!groups.has(entry.archive)) groups.set(entry.archive, items)
    items.push({ path: entry.path, kind: 'folder' in request ? request.kind : assetExportKind(entry) })
  }
  const label = 'folder' in request ? basename(request.folder.directory) : entries.length === 1
    ? basename(entries[0].path, extname(entries[0].path)) : '所选资源'
  await mkdir(root, { recursive: true })
  const stage = await mkdtemp(join(root, '.ntemm-'))
  let exported = 0
  const failures: string[] = []
  logger.info(`正在导出资源：${label}，共 ${entries.length} 项。`)
  try {
    for (const [archive, items] of groups) {
      const output = groups.size === 1 ? stage : join(stage, archive)
      await mkdir(output, { recursive: true })
      await parse(ctx, 'export', output, { archive }, false, items)
      const report = join(output, '.ntemm-export.json')
      const result: Pick<AssetExportResult, 'exported' | 'failures'> = JSON.parse(await readFile(report, 'utf8'))
      await rm(report)
      exported += result.exported
      for (const failure of result.failures) {
        const detail = `${archive}／${failure}`
        failures.push(detail)
        logger.error(`资源导出失败：${detail}`)
      }
    }
    if (!exported) return { directory: '', exported, failures }
    const directory = join(root, `${label}-${randomUUID().slice(0, 8)}`)
    await rename(stage, directory)
    logger.info(`资源已导出：${directory}，共 ${exported} 项。`)
    return { directory, exported, failures }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

export async function decodeGameTexture(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const ctx = context()
  await mkdir(ctx.root, { recursive: true })
  const stage = await mkdtemp(join(ctx.root, 'spine-texture-'))
  try {
    await parse(ctx, 'texture', stage, { path }, true)
    const files = await readdir(stage, { recursive: true, withFileTypes: true })
    const png = files.find(f => f.isFile() && extname(f.name).toLowerCase() === '.png')
    if (!png) throw new Error('游戏资源中没有可解码的贴图。')
    return new Uint8Array(await readFile(join(png.parentPath, png.name)))
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

export function registerWorkbenchAssets() {
  ipcMain.handle('assets:state', () => state(context()))
  ipcMain.handle('assets:index', async () => {
    const ctx = context()
    await mkdir(ctx.root, { recursive: true })
    const stage = await mkdtemp(join(ctx.root, 'index-'))
    try {
      logger.info('正在建立原生资源索引。')
      await parse(ctx, 'index', stage)
      const rows: AssetEntry[] = JSON.parse(await readFile(join(stage, 'index.json'), 'utf8'))
      rows.sort((a, b) => a.path.localeCompare(b.path) || a.archive.localeCompare(b.archive))
      index = { paks: ctx.paks, key: ctx.config.workbenchAesKey, rows, effective: [...effectiveAssets(rows).values()] }
      logger.info(`原生资源索引已就绪，共 ${rows.length} 条。`)
      return await state(ctx)
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  })
  ipcMain.handle('assets:snapshot', async () => {
    const ctx = context()
    const cached = current(ctx)
    if (!cached) throw new Error('请先建立资源索引。')
    const id = new Date().toISOString().replace(/:/g, '-') + '-' + randomUUID().slice(0, 8)
    const stage = join(ctx.root, id + '.part')
    try {
      await writeFile(stage, JSON.stringify(cached.effective))
      await rename(stage, join(ctx.root, id + '.snapshot.json'))
    } finally {
      await rm(stage, { force: true })
    }
    return state(ctx)
  })
  ipcMain.handle('assets:query', async (_event, query: AssetQuery) => {
    const { rows, previous } = await queryAssets(context(), query)
    return assetResults(rows, query, previous)
  })
  ipcMain.handle('assets:preview', (_event, entry, mode) => previewAsset(entry, mode))
  ipcMain.handle('assets:export', (_event, request) => exportAssets(request))
}
