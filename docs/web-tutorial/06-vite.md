# 第 6 章 · Vite 与现代工程化

> 对照文件:`app/web.vite.config.ts` 与 `app/electron.vite.config.ts`

## 6.1 浏览器不认识你的源码:为什么需要构建工具

前几章你写的 `.tsx`、`import ... from '@shared/types'`、CSS 里的 `@theme`,浏览器一概看不懂:

- 浏览器只懂 JS,不懂 **TypeScript**(类型标注要删掉);
- 不懂 **JSX**(`<div className=...>` 要变成函数调用);
- 不懂 `@` **路径别名**;
- 不认识 npm 包的裸名 `import ... from 'react'`;
- Tailwind 的工具类要**现场生成** CSS。

**构建工具(bundler)**的任务就是:把你成百上千个源文件,翻译、拼装、优化成浏览器能直接跑的少数几个文件。现代事实标准是 **Vite**(法语“快”,读 /vit/),本项目用它,配置就在仓库根上的两个文件里。

## 6.2 Vite 的两种面孔:dev 服务器 & 打包器

### 开发时:一个很快的本地服务器

`npm run dev` 实际执行 `vite --config web.vite.config.ts --open`,做三件事:

1. 在本机起一个 HTTP 服务器(如 `http://localhost:5173`);
2. 浏览器打开后请求页面,Vite **现场按需**把请求到的 `.tsx` 翻译成 JS——注意是“请求哪个翻译哪个”,不是全量,所以启动飞快;
3. **监听你的源码文件**,你一保存,浏览器立刻热替换改动的模块——**HMR(Hot Module Replacement,热更新)**,不用手动刷新,页面状态大多还能保留。

### 发布时:一次深度打包

`npm run build` 则把全部源码翻译合并、压缩混淆、拆分按需加载,产出 `out/` 目录里最精简的静态文件。开发要“快和好调试”,发布要“小和快”,两种模式各司其职。

## 6.3 读懂本项目的 Vite 配置

打开 `web.vite.config.ts`(浏览器 dev 模式用),核心就这几段:

```ts
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),        // ① 网站的根目录在哪
  publicDir: resolve(__dirname, '../img/bg'),      // ② 原样伺服的静态资源目录
  plugins: [react(), tailwindcss(), serveTestImages()],  // ③ 插件
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),     // ④ 路径别名
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
```

- **③ 插件**是 Vite 的扩展机制:`react()` 让它认识 JSX/TSX,`tailwindcss()` 让它处理 Tailwind。第 2 章见过的 `serveTestImages()` 就写在同文件上方——一个 dev 专用插件,把测试图集目录挂载成 `/test-images/...` 网址。以后你听到“加个 Vite 插件”,意思就是往 `plugins` 数组里塞一个函数返回值。
- **④ 路径别名**:为什么代码里能写 `import { cn } from '@/lib/utils'` 而不必 `../../../lib/utils`?就是这条 `@` 定义的。`@shared` 则让两端(renderer 和 main)都能干净地引用第 4 章的公共类型。

再看 `electron.vite.config.ts`(桌面模式用),它把同一套配置**分成三份**:

```ts
export default defineConfig({
  main:     { plugins: [externalizeDepsPlugin()], resolve: { alias: { '@shared': ... } } },
  preload:  { plugins: [externalizeDepsPlugin()], resolve: { alias: { '@shared': ... } } },
  renderer: { plugins: [react(), tailwindcss()],  resolve: { alias: { '@': ..., '@shared': ... } } }
})
```

main / preload / renderer 三部分分别打包——这正是第 10 章 Electron 的三进程架构在**构建层**的投影。现在记住这张对应关系表:

| 配置段 | 打包谁的代码 | 运行在什么环境 |
|---|---|---|
| `main` | `src/main/` | Node.js(有完整系统能力) |
| `preload` | `src/preload/` | 渲染窗口里的特殊隔离层 |
| `renderer` | `src/renderer/` | 就是个网页(Chromium) |

## 6.4 模块化的拼图:import 树

Vite 从 `index.html` 里的 `<script src="/src/main.tsx">` 出发,顺着每条 `import` 语句递归,把整棵“依赖树”上的文件都纳入翻译范围。所以:

- 新建了组件文件却没被任何地方 import,它就不存在于产物里;
- import 路径写错,dev 时终端立刻红字报错——**读 Vite 的报错信息是日常功课**,它通常直接写明“Failed to resolve import”和完整路径。

## 6.5 工程化的其他成员(点到为止)

“工程化”是个大词,除了 Vite 还包括本项目已配好的这些,混个脸熟:

- **TypeScript 检查**:`npm run typecheck`(第 4 章),CI 和提交前的静态体检;
- **代码规范**:团队约定缩进、引号、命名等,由 ESLint/Prettier 类工具自动检查/格式化;
- **打包发布**:electron-builder 把 `out/` 组装成安装包(第 12 章)。

初学阶段你只需要熟练一件事:**改代码 → 浏览器 HMR 自动更新 → 报错就读终端**。这套循环转熟了,工程化的其他成员自然会进入视野。

## 动手练习

1. 跑起 `npm run dev`,故意把 `App.tsx` 里某处 `@shared/types` 改成 `@shared/typo`,保存,读一遍终端报错,改回。
2. 在 `web.vite.config.ts` 的 `serveTestImages` 里给响应加一行 `res.setHeader('X-My-First-Plugin', 'hello')`,重启 dev,浏览器 F12 → Network 面板选中一张 `/test-images/` 图 → Response Headers 里找到你加的头。**你刚改了一个真实的构建插件。**改完还原。
3. 打开 `electron.vite.config.ts`,对着 6.3 的表格说出三个配置段各打包哪个目录、跑在哪个环境。

## 自测

- 开发时 Vite 和发布时 Vite 的任务有何不同?
- HMR 是什么?它如何改变你的开发手感?
- `@` 别名定义在哪个文件?不带它,`import App from './App'` 里的 `./` 又是相对谁?
- 为什么 Electron 项目要三份构建配置?

下一章:[第 7 章 · React 入门:组件与 JSX](07-react-basics.md)
