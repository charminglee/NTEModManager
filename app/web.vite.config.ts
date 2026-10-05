import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** 调试图集目录(npm run dev 浏览器测试模式的全屏背景图来源) */
const TEST_IMAGES_DIR = 'D:/pictures/test'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** dev-only:经 /test-images/<文件名> 伺服调试图集;/@fs/ 对带盘符的绝对路径
 *  会被 SPA fallback 吃掉(index.html),不可用 */
function serveTestImages(): Plugin {
  return {
    name: 'nte-serve-test-images',
    configureServer(server) {
      server.middlewares.use('/test-images', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        const full = resolve(TEST_IMAGES_DIR, name)
        if (!full.startsWith(resolve(TEST_IMAGES_DIR) + sep) || !existsSync(full) || !statSync(full).isFile()) {
          next()
          return
        }
        res.setHeader('Content-Type', MIME[extname(full).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(full).pipe(res)
      })
    }
  }
}

/**
 * 浏览器测试版 dev 配置(npm run dev):只起渲染层 dev 服务器并打开浏览器,
 * 不编译主进程/preload、不启动 Electron。window.api 缺失时由
 * src/renderer/src/lib/browser-api-mock.ts 注入内存 mock。
 * publicDir 指向仓库 img/bg(侧边栏分类缩略图),背景图走 serveTestImages 插件。
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, '../img/bg'),
  plugins: [react(), serveTestImages()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
