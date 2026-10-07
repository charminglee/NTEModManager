import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// dist 链路编排:stash → electron-vite build → electron-builder → restore → 启动 exe。
// 之前用 npm script 的 && 串联,build/builder 中途失败时 restore 永远不会执行,
// 配置会一直留在暂存处(结合旧版 stash 的清理逻辑甚至会被删掉,导致用户设置永久丢失)。
// 这里用 try/finally 保证 restore 总是执行;exitCode 在 finally 之后才落地。
//
// 用法:node scripts/dist.mjs [app|bg-server]
// - app(默认):主程序 NteModManager.exe,打包完成后启动验证;
// - bg-server:无界面背景图服务 NteModBgServer.exe,独立配置/独立输出目录,
//   打包后不自动启动(服务常驻,阻塞等待无意义)。

const mode = process.argv[2] === 'bg-server' ? 'bg-server' : 'app'
const isBgServer = mode === 'bg-server'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDir = join(appDir, isBgServer ? 'dist-bg-server' : 'dist')
const unpackedDir = join(outputDir, 'win-unpacked')
const exeName = isBgServer ? 'NteModBgServer.exe' : 'NteModManager.exe'

// Electron 压缩包镜像:与 install-electron 共享 %LOCALAPPDATA%\electron\Cache
// (缓存键=下载 URL 哈希,镜像不同则每次打包都重新下载);yml 里的 electronDownload.mirror
// 已配置同一镜像,这里兜底覆盖 @electron/get 的环境变量检查
process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'

function runStep(command, args, { cwd = appDir } = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd, shell: false })
  if (result.error) {
    console.error(`无法启动 ${command}:${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

/** npx 在 Windows 上是 .cmd,须走 shell;其余步骤直接 spawn。 */
function runNpx(args) {
  const result = spawnSync(`npx ${args.join(' ')}`, {
    stdio: 'inherit',
    cwd: appDir,
    shell: process.platform === 'win32'
  })
  if (result.error) {
    console.error(`无法启动 npx:${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

let failed = false
try {
  failed =
    runStep(process.execPath, [
      join(appDir, 'scripts', 'preserve-config.mjs'),
      'stash',
      join(unpackedDir, 'NteModManager.ini')
    ]) !== 0
  if (!failed) {
    failed = runNpx(
      isBgServer
        ? ['electron-vite', 'build', '-c', 'electron.vite.bg-server.config.ts']
        : ['electron-vite', 'build']
    ) !== 0
  }
  if (!failed) {
    failed = runNpx(
      isBgServer
        ? ['electron-builder', '--dir', '--config', 'electron-builder.bg-server.yml']
        : ['electron-builder', '--dir']
    ) !== 0
  }
} finally {
  runStep(process.execPath, [
    join(appDir, 'scripts', 'preserve-config.mjs'),
    'restore',
    join(unpackedDir, 'NteModManager.ini')
  ])
}

if (failed) {
  process.exit(1)
}

const exePath = join(unpackedDir, exeName)
if (!existsSync(exePath)) {
  console.error(`找不到打包产物:${exePath}`)
  process.exit(1)
}

if (isBgServer) {
  console.log(`背景图服务打包完成：${exePath}`)
  console.log('静默运行,无界面;与主程序 exe 同目录时自动共用 NteModManager.ini,')
  console.log('否则用 NteModBgServer.exe --config=<主程序 ini 路径> 指定。')
  process.exit(0)
}

// 与原链路一致:阻塞到应用退出
const app = spawnSync(exePath, { stdio: 'ignore', cwd: unpackedDir })
process.exit(app.status ?? 0)
