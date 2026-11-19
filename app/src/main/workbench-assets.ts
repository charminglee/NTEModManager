import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { getAppConfig } from './config'
import { logger } from './logger'
import { ntemmCacheDir } from './ntemm-paths'
import { builtInPackagerDirectory } from './packager'
import { assetResults, effectiveAssets } from '../shared/workbench-assets-filter'
import type { AssetEntry, AssetFormat, AssetPreview, AssetQuery, AssetState } from '../shared/workbench-assets'

function context() {
  const config = getAppConfig()
  const paks = join(config.gameDirectory, 'Client', 'WindowsNoEditor', 'HT', 'Content', 'Paks')
  const game = createHash('sha256').update(resolve(paks).toLowerCase()).digest('hex')
  const root = join(ntemmCacheDir(), 'assets', game)
  return { config, paks, root }
}

type Context = ReturnType<typeof context>
let index: { paks: string; key: string; rows: AssetEntry[]; effective: AssetEntry[]; archives: string[] } | undefined
let baseline: { file: string; entries: Map<string, AssetEntry> } | undefined
const current = (ctx: Context) => index?.paks === ctx.paks && index.key === ctx.config.workbenchAesKey ? index : undefined

async function parse(ctx: Context, action: AssetFormat | 'index', output: string, entry?: { path: string; archive?: string }, preview = false) {
  const tool = app.isPackaged ? join(process.resourcesPath, 'workbench-assets', 'WorkbenchAssets.exe')
    : join(app.getAppPath(), '..', '.tmp', 'assets', 'publish', 'WorkbenchAssets.exe')
  if (!existsSync(tool)) throw new Error('缺少资源解析器，请先构建 WorkbenchAssets。')
  const request = {
    action, preview, paks: ctx.paks, output, key: ctx.config.workbenchAesKey, mapping: ctx.config.workbenchMapping,
    oodle: join(builtInPackagerDirectory(), 'oo2core_9_win64.dll'), path: entry?.path, archive: entry?.archive
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

async function state(ctx: Context): Promise<AssetState> {
  await mkdir(ctx.root, { recursive: true })
  const cached = current(ctx)
  return {
    count: cached?.rows.length ?? 0, archives: cached?.archives ?? [],
    snapshots: (await readdir(ctx.root)).filter(file => file.endsWith('.snapshot.json')).sort().reverse()
  }
}

async function convert(entry: AssetEntry, format: AssetFormat, preview: boolean): Promise<AssetPreview | string> {
  const ctx = context()
  const asset = current(ctx)?.rows.find(row => row.path === entry.path && row.archive === entry.archive)
  if (!asset) throw new Error('资源索引已失效，请重新建立索引。')
  if (!['raw', 'texture', 'model', 'json'].includes(format)) throw new Error('未知的资源格式。')
  const root = preview ? ctx.root : ctx.config.workbenchExportDirectory
  if (!root) throw new Error('请先设置工作台导出目录。')
  await mkdir(root, { recursive: true })
  const stage = await mkdtemp(join(root, '.ntemm-'))
  try {
    await parse(ctx, format, stage, asset, preview)
    const files = (await readdir(stage, { recursive: true, withFileTypes: true })).filter(f => f.isFile())
    if (!files.length) throw new Error('解析器未生成文件。')
    if (preview) {
      const ext = { json: '.json', texture: '.png', model: '.glb', raw: '' }[format]
      const f = files.find(file => extname(file.name).toLowerCase() === ext)
      if (!f) throw new Error('资源中没有可预览的对象。')
      return { name: f.name, bytes: await readFile(join(f.parentPath, f.name)) }
    }
    const target = join(root, `${basename(asset.path, extname(asset.path))}-${randomUUID().slice(0, 8)}`)
    await rename(stage, target)
    logger.info(`资源已导出：${target}`)
    return target
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
      index = { paks: ctx.paks, key: ctx.config.workbenchAesKey, rows, effective: [...effectiveAssets(rows).values()],
        archives: [...new Set(rows.map(row => row.archive))].sort() }
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
    const ctx = context()
    const cached = current(ctx)
    if (!cached) return { rows: [], count: 0 }
    let previous: Map<string, AssetEntry> | undefined
    if (query.mode === 'new' || query.mode === 'modified') {
      if (!/^\d{4}-[\dT.Z-]+[a-f\d]{8}\.snapshot\.json$/.test(query.snapshot)) throw new Error('请选择对比快照。')
      const file = join(ctx.root, query.snapshot)
      if (baseline?.file !== file) baseline = { file, entries: effectiveAssets(JSON.parse(await readFile(file, 'utf8'))) }
      previous = baseline.entries
    }
    return assetResults(query.mode === 'multiple' || query.mode === 'all' ? cached.rows : cached.effective, query, previous)
  })
  ipcMain.handle('assets:preview', (_event, entry, format) => convert(entry, format, true))
  ipcMain.handle('assets:export', (_event, entry, format) => convert(entry, format, false))
}
