import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// 背景图服务构建:仅主进程(src/bg-server),无 preload/renderer;
// 产物输出到 out/bg-server,由 electron-builder.bg-server.yml 单独打包为 NteModBgServer.exe
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      outDir: 'out/bg-server',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/bg-server/index.ts')
        }
      }
    }
  }
})
