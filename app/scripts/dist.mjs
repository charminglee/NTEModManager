import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// dist 链路编排:electron-vite build → electron-builder → 启动 exe。
//
// 用法:node scripts/dist.mjs —— 打包主程序 NteModManager.exe,完成后启动验证。
//
// 配置文件统一在 ~/.ntemm/NteModManager.ini(运行时读写,不在打包产物里),
// 打包不会碰它,也无需像旧版那样在打包前后 stash/restore exe 旁边的 ini。

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const unpackedDir = join(appDir, 'dist', 'win-unpacked')
const exeName = 'NteModManager.exe'

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

let failed = runNpx(['electron-vite', 'build']) !== 0
if (!failed) {
  failed = runNpx(['electron-builder', '--dir']) !== 0
}

if (failed) {
  process.exit(1)
}

const exePath = join(unpackedDir, exeName)
if (!existsSync(exePath)) {
  console.error(`找不到打包产物:${exePath}`)
  process.exit(1)
}

// 与原链路一致:阻塞到应用退出
const app = spawnSync(exePath, { stdio: 'ignore', cwd: unpackedDir })
process.exit(app.status ?? 0)
