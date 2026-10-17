import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 渲染层 alias 用数组 + 正则:只替换裸包名 `lucide-react` 本身,
 * 让 icons.ts 内部的 `lucide-react/dist/esm/icons/*.js` 深路径照常解析到真实包
 * (对象写法是前缀匹配,会把深路径也一起改写掉)。详见 src/renderer/src/lib/icons.ts。
 */
const rendererAlias = [
  { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
  { find: '@', replacement: resolve(__dirname, 'src/renderer/src') },
  { find: /^lucide-react$/, replacement: resolve(__dirname, 'src/renderer/src/lib/icons.ts') }
]

/**
 * 渲染层关掉 rollup 的 tree-shaking —— 这是打包耗时最大的单项。
 * 实测(本机 Ryzen 9 9950X,1689 模块):渲染层 7.2s → 1.8s,产物 487KB → 494KB。
 * 开销几乎全在 react-dom:它的 react-dom.production.min.js(131KB)单独 tree-shaking
 * 要 3.3s,而 `rollup --no-treeshake` 只要 95ms —— 是 rollup 的算法病态开销,
 * 并未换来体积收益(该依赖几乎全被用到,关掉只多 7KB)。
 * 代价:未使用的导出、以及 node_modules 里 `NODE_ENV !== 'production'` 的死分支
 * 不再被剔除。换用重依赖(大 barrel 包)时留意产物体积 ——
 * 图标类 barrel 已由 icons.ts 收敛。需要恢复完整 tree-shaking:设 NTEMM_TREESHAKE=1。
 */
const rendererTreeshake = process.env.NTEMM_TREESHAKE === '1'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: rendererAlias
    },
    build: {
      rollupOptions: {
        treeshake: rendererTreeshake
      }
    }
  }
})
