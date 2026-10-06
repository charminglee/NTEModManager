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
  }
  // live 缺失时不动 stash:那可能是上次打包失败中断留下的唯一副本,删掉就永久丢失配置。
  // 首次打包(从未有过配置)时 stash 本就不存在,restore 对缺失 stash 是空操作。
} else if (command === 'restore') {
  if (existsSync(stashPath)) {
    if (!existsSync(liveConfig)) {
      // 打包中途失败时 dist/win-unpacked 可能尚未创建,先补齐目录再回填
      mkdirSync(dirname(liveConfig), { recursive: true })
      copyFileSync(stashPath, liveConfig)
    }
    rmSync(stashPath)
  }
} else {
  console.error('用法: node scripts/preserve-config.mjs <stash|restore>')
  process.exit(1)
}
