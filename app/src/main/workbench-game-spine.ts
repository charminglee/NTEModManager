import { dialog } from 'electron'
import { spawn } from 'node:child_process'
import { link, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { basename, join, posix, relative, sep } from 'node:path'
import type { SpineFile } from '../shared/workbench-spine'
import { getAppConfig } from './config'
import { decodeGameTexture } from './workbench-assets'
import { bundledToolsDirectory } from './bundled-tools'

async function stageContainers(content: string, staging: string): Promise<void> {
  const directories = await readdir(content)
  const sources = new Map<string, string>()
  // 先登记基础容器，再由热更新目录替换同名项（包括 global 容器）。
  for (const group of ['Paks', 'PatchPaks', 'TagPatchPaks']) {
    if (group !== 'Paks' && !directories.includes(group)) continue
    const directory = join(content, group)
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && /\.(utoc|ucas)$/i.test(entry.name)) {
        sources.set(entry.name.toLowerCase(), join(directory, entry.name))
      }
    }
  }
  if (!sources.has('global.utoc') || !sources.has('global.ucas')) throw new Error('未找到完整的游戏 global 容器。')
  await mkdir(staging)
  for (const source of sources.values()) await link(source, join(staging, basename(source)))
}

async function extract(filter: string, staging: string, output: string, key: string) {
  const tools = join(bundledToolsDirectory(), 'retoc')
  const args = ['-a', key, 'to-legacy', '--version', 'UE5_6', '--no-shaders', '--no-script-objects',
    '--filter', filter, staging, output]
  await new Promise<void>((resolve, reject) => {
    // 进程的命令行含 AES。只报告退出状态，避免错误对象或工具输出回显参数。
    const child = spawn(join(tools, 'retoc.exe'), args, { cwd: tools, windowsHide: true, stdio: 'ignore' })
    child.once('error', () => reject(new Error('无法启动内置 retoc，请检查 libs/retoc 目录。')))
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`retoc 读取游戏资源失败（退出码 ${code}），请检查工作台的 AES 密钥及游戏容器。`))
    })
  })
}

function atlasText(body: Buffer): string {
  const invalid = () => new Error('原生 Spine 图集的导出布局无效。')
  if (body.length < 14 || body.readUInt16LE() !== 0x0700 || body.readUInt32LE(body.length - 4) !== 0x9e2a83c1) throw invalid()
  const field = 6 + 4 * body.readUInt32LE(2)
  if (field + 4 > body.length - 4) throw invalid()
  const length = body.readInt32LE(field)
  const start = field + 4
  const end = start + length
  if (length < 2 || end > body.length - 4 || body[end - 1] !== 0) throw invalid()
  return body.toString('utf8', start, end - 1)
}

// UE 5.6 的 SpineAtlasAsset 将按页排序的纹理对象引用放在图集文本前面。
// FPackageIndex 指向 Texture2D，OuterIndex 指向其包。FName 的数字后缀单独存储。
function texturePackages(header: Buffer, body: Buffer): (string | null)[] {
  const pathLength = header.readInt32LE(52)
  const fields = 56 + (pathLength < 0 ? -2 * pathLength : pathLength)
  let cursor = header.readUInt32LE(fields + 8)
  const names: string[] = []
  const nameCount = header.readUInt32LE(fields + 4)
  for (let i = 0; i < nameCount; i++) {
    const length = header.readInt32LE(cursor)
    const end = cursor + 4 + (length < 0 ? -2 * length : length)
    if (!length || end + 4 > header.length) throw new Error('图集名称表无效。')
    names.push(header.toString(length < 0 ? 'utf16le' : 'utf8', cursor + 4, end - (length < 0 ? 2 : 1)))
    cursor = end + 4
  }
  const nameAt = (offset: number) => {
    const text = names[header.readUInt32LE(offset)]
    const number = header.readUInt32LE(offset + 4)
    if (text === undefined) throw new Error('图集名称索引无效。')
    return number ? text + '_' + (number - 1) : text
  }
  const count = header.readUInt32LE(fields + 36)
  const imports = header.readUInt32LE(fields + 40)
  const importAt = (index: number) => {
    if (index >= 0 || -index > count) throw new Error('图集纹理导入索引无效。')
    return imports + (-index - 1) * 32
  }
  const paths: (string | null)[] = []
  for (let i = 0; i < body.readUInt32LE(2); i++) {
    const reference = body.readInt32LE(6 + i * 4)
    if (!reference) {
      paths.push(null)
      continue
    }
    const texture = importAt(reference)
    if (nameAt(texture + 8) !== 'Texture2D') throw new Error('图集引用的对象类型不是 Texture2D。')
    const outer = importAt(header.readInt32LE(texture + 16))
    const pkg = nameAt(outer + 20)
    paths.push(pkg.startsWith('/Game/') ? 'HT/Content/' + pkg.slice(6) + '.uasset' : null)
  }
  return paths
}

async function pageImage(page: string, texturePath: string): Promise<SpineFile> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await decodeGameTexture(texturePath)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('游戏中未找到资源')) {
      throw new Error(`解码图集页「${page}」失败，请检查工作台映射文件和纹理解析器。`)
    }
    const hint = `游戏中缺少图集页「${page}」，请选择对应的 PNG 文件。`
    const choice = await dialog.showOpenDialog({ title: hint, properties: ['openFile'],
      filters: [{ name: 'PNG 贴图', extensions: ['png'] }] })
    if (choice.canceled) throw new Error(hint)
    bytes = new Uint8Array(await readFile(choice.filePaths[0]))
  }
  if (!Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`图集页「${page}」需要 PNG 图片。`)
  return { name: page, bytes }
}

export async function loadGameSpine(name: string): Promise<SpineFile[]> {
  if (typeof name !== 'string' || !/^[\p{L}\p{N}_-]{1,240}_Data$/iu.test(name)) {
    throw new Error('请输入完整骨架资源名，例如 SP_YEMJX_Data。')
  }
  const config = getAppConfig()
  if (!/^(?:0x)?[0-9a-f]{64}$/i.test(config.workbenchAesKey)) throw new Error('请在工作台设置中填写有效的游戏 AES 密钥。')
  const content = join(config.gameDirectory, 'Client/WindowsNoEditor/HT/Content')
  const temp = await mkdtemp(join(content, '.ntemm-spine-'))
  try {
    const staging = join(temp, 'containers')
    const output = join(temp, 'legacy')
    await stageContainers(content, staging)
    await mkdir(output)
    await extract('/' + name + '.uasset', staging, output, config.workbenchAesKey)
    const entries = await readdir(output, { recursive: true, withFileTypes: true })
    const matches = entries.filter(f => f.isFile() && f.name === name + '.uasset')
    if (matches.length !== 1) {
      throw new Error(matches.length ? `多个目录含有同名骨架「${name}」。` : `未找到骨架「${name}」，请核对资源名的大小写。`)
    }
    const dir = matches[0].parentPath
    const folder = relative(output, dir).split(sep).join('/')
    const atlas = name.slice(0, -5)
    await extract(`/${folder}/${atlas}.uasset`, staging, output, config.workbenchAesKey)
    const extracted = await readdir(dir)
    if (!extracted.includes(atlas + '.uasset') || !extracted.includes(atlas + '.uexp')) {
      throw new Error(`骨架目录中缺少完整的原生图集「${atlas}」。`)
    }
    const [header, body, atlasHeader, atlasBody] = await Promise.all([
      readFile(join(dir, name + '.uasset')), readFile(join(dir, name + '.uexp')),
      readFile(join(dir, atlas + '.uasset')), readFile(join(dir, atlas + '.uexp'))
    ])
    if (!header.includes('SpineSkeletonDataAsset\0') || !atlasHeader.includes('SpineAtlasAsset\0')) {
      throw new Error('资源类型与原生 Spine 骨架及图集不匹配。')
    }
    const text = atlasText(atlasBody)
    const pages = text.trim().split(/\r?\n\s*\r?\n/).map(block => block.split(/\r?\n/, 1)[0].trim())
    const files: SpineFile[] = [
      { name: name + '.uasset', bytes: new Uint8Array(header) },
      { name: name + '.uexp', bytes: new Uint8Array(body) },
      { name: atlas + '.atlas', bytes: new TextEncoder().encode(text) }
    ]
    const textures = texturePackages(atlasHeader, atlasBody)
    if (new Set(pages).size !== pages.length) throw new Error('图集包含重复的页名。')
    for (const [index, page] of pages.entries()) {
      if (!/\.png$/i.test(page)) throw new Error(`图集页「${page}」不是 PNG 贴图。`)
      const texture = pages.length === 1 ? atlas : posix.parse(page).name
      const conventional = posix.join(folder, 'Textures', texture + '.uasset')
      const referenced = textures[index]
      const file = referenced && referenced.toLowerCase() !== conventional.toLowerCase() ? referenced : conventional
      files.push(await pageImage(page, file))
    }
    return files
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 3 })
  }
}
