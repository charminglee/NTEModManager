import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// dist 链路编排:stash → electron-vite build → electron-builder → restore → 启动 exe。
// 之前用 npm script 的 && 串联,build/builder 中途失败时 restore 永远不会执行,
// 配置会一直留在暂存处(结合旧版 stash 的清理逻辑甚至会被删掉,导致用户设置永久丢失)。
// 这里用 try/finally 保证 restore 总是执行;exitCode 在 finally 之后才落地。

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))

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
  failed = runStep(process.execPath, [join(appDir, 'scripts', 'preserve-config.mjs'), 'stash']) !== 0
  if (!failed) {
    failed = runNpx(['electron-vite', 'build']) !== 0
  }
  if (!failed) {
    failed = runNpx(['electron-builder', '--dir']) !== 0
  }
} finally {
  runStep(process.execPath, [join(appDir, 'scripts', 'preserve-config.mjs'), 'restore'])
}

if (failed) {
  process.exit(1)
}

const unpackedDir = join(appDir, 'dist', 'win-unpacked')
const exePath = join(unpackedDir, 'NteModManager.exe')
if (!existsSync(exePath)) {
  console.error(`找不到打包产物:${exePath}`)
  process.exit(1)
}
// 与原链路一致:阻塞到应用退出
const app = spawnSync(exePath, { stdio: 'ignore', cwd: unpackedDir })
process.exit(app.status ?? 0)
