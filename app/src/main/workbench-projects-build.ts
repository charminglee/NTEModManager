import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import type { WorkbenchProject } from '../shared/workbench-projects'

const execute = promisify(execFile)

export function validateAsset(asset: string): void {
  if (typeof asset !== 'string' || !/\.(uasset|umap)$/i.test(asset) ||
      asset.split('/').some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|+ \x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
    throw new Error(`无效的工程资源路径：${asset}`)
  }
}

export async function editorCommand(engine: string): Promise<string> {
  const version = JSON.parse(await fs.readFile(path.join(engine, 'Engine/Build/Build.version'), 'utf8'))
  if (version.MajorVersion !== 5 || version.MinorVersion !== 6) throw new Error('请选择 UE 5.6 安装目录。')
  const editor = path.join(engine, 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe')
  await fs.access(editor)
  return editor
}

export async function buildProject(project: WorkbenchProject, tools: string, progress: (message: string) => void): Promise<string> {
  const { directory, engine, uproject, assets } = project
  if (!engine || !uproject || !assets.length) throw new Error('请绑定引擎和工程，并添加要打包的资源。')
  const editor = await editorCommand(engine)
  await fs.access(uproject)
  const projectName = path.basename(uproject, path.extname(uproject))
  const content = await fs.realpath(path.join(path.dirname(uproject), 'Content'))
  for (const asset of assets) {
    validateAsset(asset)
    const source = await fs.realpath(path.join(content, asset))
    const relative = path.relative(content, source).split(path.sep).join('/')
    if (relative !== asset) throw new Error(`资源路径已改变：${asset}`)
  }
  const work = await fs.mkdtemp(path.join(directory, '.cook-'))
  const log = path.join(work, 'Cook.log')
  let destination: string
  try {
    progress(`正在烘焙 ${assets.length} 个资源……`)
    const packageList = path.join(work, 'Packages.txt')
    await fs.writeFile(packageList, assets.map(asset =>
      `-PACKAGE=/Game/${asset.slice(0, -path.posix.extname(asset).length)}`
    ).join(' '), 'utf8')
    const args = [uproject, '-run=Cook', '-TargetPlatform=Windows', '-CookSinglePackageNoRefs', '-SkipZenStore',
      '-unattended', '-nop4', '-nosplash', '-nullrhi', '-UTF8Output', `-AbsLog=${log}`,
      '-ini:Game:[/Script/UnrealEd.ProjectPackagingSettings]:bShareMaterialShaderCode=False',
      `-OutputDir=${path.join(work, 'Cooked', '[Platform]')}`, `-CmdLineFile=${packageList}`]
    await execute(editor, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
    const cooked = path.join(work, 'Cooked/Windows', projectName, 'Content')
    const input = path.join(work, 'Input')
    const expected = new Set<string>()
    for (const asset of assets) {
      const relativeDir = path.posix.dirname(asset)
      const base = path.posix.basename(asset, path.posix.extname(asset))
      const files = await fs.readdir(path.join(cooked, relativeDir))
      const parts = files.filter(file => file.startsWith(base + '.'))
      if (!parts.includes(base + '.uexp') || !parts.includes(path.posix.basename(asset))) {
        throw new Error(`烘焙产物不完整：${asset}`)
      }
      for (const file of parts) {
        if (![path.posix.extname(asset), '.uexp', '.ubulk', '.uptnl', '.m.ubulk'].includes(file.slice(base.length))) {
          throw new Error(`不支持的烘焙伴随文件：${file}`)
        }
        const relative = path.posix.join('HT/Content', relativeDir, file)
        const destination = path.join(input, relative)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.copyFile(path.join(cooked, relativeDir, file), destination)
        if (!file.endsWith('.uexp')) expected.add(relative)
      }
    }
    progress('正在生成并校验模组容器……')
    const result = path.join(work, 'Result')
    await fs.mkdir(result)
    const stem = path.join(result, path.basename(directory) + '_P')
    const utoc = stem + '.utoc'
    const retoc = path.join(tools, 'retoc.exe')
    const options = { cwd: tools, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
    await execute(retoc, ['to-zen', '--version', 'UE5_6', input, utoc], options)
    for (const ext of ['.pak', '.ucas', '.utoc']) {
      if ((await fs.stat(stem + ext)).size === 0) throw new Error(`容器为空：${ext}`)
    }
    const pak = await execute(path.join(tools, 'repak.exe'), ['list', stem + '.pak'], options)
    if (pak.stdout.trim()) throw new Error('辅助 pak 中含有意外的文件。')
    await execute(retoc, ['verify', utoc], options)
    const { stdout } = await execute(retoc, ['list', '--path', utoc], options)
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      if (/\bContainerHeader\s+-\s*$/.test(line)) continue
      const match = line.match(/\s\.\.\/\.\.\/\.\.\/(.+)$/)
      if (!match || !expected.delete(match[1])) throw new Error(`容器包含清单外条目：${line}`)
    }
    if (expected.size) throw new Error(`容器缺少条目：${[...expected].join('、')}`)
    const builds = path.join(directory, 'Builds')
    await fs.mkdir(builds, { recursive: true })
    if (await fs.realpath(builds) !== builds) throw new Error('产物目录必须位于当前项目中。')
    destination = path.join(builds, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8))
    await fs.rename(result, destination)
  } catch (error) {
    // 保留原生工具输出供定位失败的资源。
    throw new Error(`${error instanceof Error ? error.message : error}\n构建现场：${work}`)
  }
  await fs.rm(work, { recursive: true, force: true, maxRetries: 3 })
  return destination
}
