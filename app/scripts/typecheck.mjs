import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 主进程与渲染进程的类型检查互相独立,串行跑纯属浪费时间(实测 1.3s + 1.4s),
// 这里并行跑两个 tsc 子进程,输出原样透传,任一失败即整体失败。
const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const targets = ['tsconfig.node.json', 'tsconfig.web.json']
// 直接跑 node_modules 里的 tsc,省掉 npx/shell 的启动开销(每次约 0.3s)
const tsc = join(appDir, 'node_modules', 'typescript', 'bin', 'tsc')

function run(configFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsc, '--noEmit', '-p', configFile], {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (out += chunk))
    child.on('error', (error) => resolve({ configFile, code: 1, out: `${out}${error.message}\n` }))
    child.on('close', (code) => resolve({ configFile, code: code ?? 1, out }))
  })
}

const results = await Promise.all(targets.map(run))
let failed = false
for (const { configFile, code, out } of results) {
  if (out.trim()) {
    process.stdout.write(`\n[${configFile}]\n${out}`)
  }
  if (code !== 0) {
    failed = true
  }
}
console.log(failed ? '\n类型检查失败' : '\n类型检查通过(node + web)')
process.exit(failed ? 1 : 0)
