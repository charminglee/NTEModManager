import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// electron-builder 打包前会清空 dist/win-unpacked,exe 旁边的 NteModManager.ini
// (窗口状态、各类路径设置)会一起丢失。打包前 stash、打包后 restore。

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const liveConfig = join(appDir, 'dist', 'win-unpacked', 'NteModManager.ini')
const stashPath = join(appDir, 'node_modules', '.cache', 'NteModManager.ini')

const command = process.argv[2]
if (command === 'stash') {
  if (existsSync(liveConfig)) {
    mkdirSync(dirname(stashPath), { recursive: true })
    copyFileSync(liveConfig, stashPath)
  } else {
    // 当前没有配置(首次打包),清掉历史暂存,避免用过时的旧设置覆盖
    rmSync(stashPath, { force: true })
  }
} else if (command === 'restore') {
  if (existsSync(stashPath)) {
    if (!existsSync(liveConfig)) {
      copyFileSync(stashPath, liveConfig)
    }
    rmSync(stashPath)
  }
} else {
  console.error('用法: node scripts/preserve-config.mjs <stash|restore>')
  process.exit(1)
}
