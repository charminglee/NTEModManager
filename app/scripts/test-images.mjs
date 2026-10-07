import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// dev 命令自动打开 Debug/test_images(背景图改用 F:/pictures/test 调试图集),
// dist 命令自动关闭,避免调试背景混进正式体验。只改动 app/NteModManager.ini
// 里的 test_images 键,文件其余内容(含注释与空行)原样保留。

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(appDir, 'NteModManager.ini')

const command = process.argv[2]
const value = command === 'on' ? '1' : command === 'off' ? '0' : null
if (value === null) {
  console.error('用法: node scripts/test-images.mjs <on|off>')
  process.exit(1)
}
if (!existsSync(configPath)) {
  // 尚无配置文件:应用首次启动会按默认值(test_images=0)自建,无需处理
  process.exit(0)
}

const content = readFileSync(configPath, 'utf-8')
const line = `test_images=${value}`
let next
if (/^test_images=.*$/m.test(content)) {
  next = content.replace(/^test_images=.*$/m, line)
} else if (/^\[Debug\]\s*$/m.test(content)) {
  next = content.replace(/^\[Debug\]\s*$/m, `[Debug]\n${line}`)
} else {
  next = `${content.trimEnd()}\n\n[Debug]\n${line}\n`
}
if (next !== content) {
  writeFileSync(configPath, next, 'utf-8')
  console.log(`test_images -> ${value}`)
}
