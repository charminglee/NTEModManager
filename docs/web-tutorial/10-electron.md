# 第 10 章 · Electron:把网页变成桌面应用

> 对照文件:`src/main/index.ts`(主进程)、`src/preload/index.ts`(桥梁)、`src/main/ipc.ts`(后端接口)

## 10.1 Electron 是什么

**Electron = Chromium(渲染网页)+ Node.js(系统能力)+ 原生外壳(窗口、托盘、菜单)**。VS Code、Discord、QQ NT 都是 Electron 应用。它让“会 Web 开发”直接等于“会写桌面应用”——本项目管理器就是证据:界面是一个 React 网页,安装模组、扫描文件夹是 Node.js 代码,合起来是个 .exe。

代价也要知道:应用自带一个完整 Chromium,安装包和内存占用都比原生应用大。换来的是一份代码、全平台运行、生态全是 Web 技术。

## 10.2 三个世界:main / preload / renderer

Electron 应用被切分成三个**相互隔离的进程**,对照第 6 章的三段构建配置:

```
┌─────────────────────────────────────────────────┐
│  main 主进程(Node.js)src/main/                │
│  应用的"后端 + 管家":唯一有权碰系统            │
│  建窗口、读写磁盘、扫描模组、弹文件对话框、启动游戏│
└──────────────┬──────────────────────────────────┘
               │ IPC(进程间通信)
┌──────────────┴──────────────────────────────────┐
│  preload 预加载脚本 src/preload/                │
│  "海关":在 renderer 里开一个受控的 API 窗口     │
└──────────────┬──────────────────────────────────┘
               │ window.api.*
┌──────────────┴──────────────────────────────────┐
│  renderer 渲染进程 src/renderer/                │
│  就是一个网页:React 界面,没有任何系统能力      │
└─────────────────────────────────────────────────┘
```

为什么要切?**安全**。网页天然可能被注入恶意内容;如果渲染进程能直接碰磁盘,一个漏洞就能删光用户文件。Electron 的默认架构(本项目严格遵循)是:renderer 是个“裸网页”,**一切系统能力都必须经由主进程代办**。

## 10.3 主进程:创建窗口

看 `src/main/index.ts` 的 `createWindow`(节选):

```ts
import { BrowserWindow, app, protocol } from 'electron'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    name: 'main',
    windowStatePersistence: true,   // Electron 44+:记住窗口位置/大小/最大化
    width: 1315,
    height: 1000,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,      // 安全开关 ①:渲染层与 Electron API 隔离(默认)
      nodeIntegration: false       // 安全开关 ②:网页里不许直接用 Node(默认)
    },
    ...
  })
  // dev 时 ELECTRON_RENDERER_URL 指向 Vite dev server;打包后加载本地文件
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(/* ... */)     // Electron 就绪后建窗口
```

主进程的代码风格就是第 5 章说的“纯 Node”——`app`、`BrowserWindow` 这些来自 `electron` 包,`join`/`existsSync` 来自 Node 内置模块。

这个文件里还有两段值得留意的“加固”代码(初学了解意图即可):

- **GPU 开关**:`app.commandLine.appendSwitch('enable-gpu-rasterization')` 等——本项目界面重度使用玻璃模糊特效,强制走 GPU 光栅化防止掉进软件渲染、帧率崩盘;
- **导航拦截**:`app.on('web-contents-created', ...)` 里把 `window.open` 一律拒绝、把渲染层发起的陌生网址导航拦下——“界面只允许加载本地内容”,这是 Electron 官方安全清单的第一条。

## 10.4 IPC:两个世界怎么说话

renderer 想扫模组文件夹,但它碰不到磁盘;main 能碰磁盘,但看不见界面。**IPC(Inter-Process Communication)** 就是两者之间的电话线,本项目全部采用最常用的一对原语:

- 渲染端:`ipcRenderer.invoke(频道名, 参数)` —— 像发请求,等一个 Promise;
- 主进程:`ipcMain.handle(频道名, 处理函数)` —— 像注册路由,返回结果。

`src/main/ipc.ts` 里注册了 30 多个 handler,格式高度统一(挑最短的两个):

```ts
ipcMain.handle('mods:scan', () => repository.scan())
ipcMain.handle('mods:install', (_event, name: string) => withBusy(name, () => operations.install(name)))
```

频道名约定 `域:动作`(如 `mods:scan`、`config:update`)。invoke 的 Promise 语义和第 3 章的 `await` 无缝衔接——**对前端代码来说,“调 IPC”和“调后端 HTTP 接口”手感完全一样**。

## 10.5 preload 与 contextBridge:受控的 API 窗口

那 renderer 里的 `window.api.scanMods()` 是哪来的?它并不存在——是 preload **暴露**给它的。看 `src/preload/index.ts` 的结构与结尾:

```ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  bootstrap: (): Promise<BootstrapPayload> => ipcRenderer.invoke('app:bootstrap'),
  scanMods: (): Promise<ModInfo[]> => ipcRenderer.invoke('mods:scan'),
  installMod: (name: string): Promise<OperationResult> => ipcRenderer.invoke('mods:install', name),
  // ...约 40 个方法,每个都是对一条 IPC 频道的薄封装
  onLogEntry: (callback: (entry: LogEntry) => void): (() => void) => {
    const listener = (_event: unknown, entry: LogEntry) => callback(entry)
    ipcRenderer.on('log:entry', listener)
    return () => ipcRenderer.removeListener('log:entry', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)   // 把 api 挂到 renderer 的 window.api 上
```

三个要点:

1. **contextBridge 是唯一合法的桥梁**。preload 运行在一个特殊环境里,同时够得到 Node(`ipcRenderer`)和页面(`window`),用 `exposeInMainWorld` 精确地递出一个白名单对象。页面拿不到 `ipcRenderer` 本体,只能调这些预定义方法——**攻击面被压到最小**。
2. **`window.api` 的类型从哪来?** `preload` 里的 `export type Api = typeof api` 加上 `src/renderer/src/types/api.d.ts` 里的全局声明,让 renderer 里写 `window.api.scanMods()` 时 TS 能完整补全和检查——第 4 章“一份合同管两个世界”的又一个实例。
3. **`onLogEntry` 演示了“主进程主动推送”**。invoke 是前端发起、后端应答;反过来(后端事件推给前端)用 `ipcRenderer.on` 订阅。这里包装成“订阅函数返回退订函数”的形态,正好接上第 8 章 useEffect 的清理模式(`return unsubscribe`)。背景图轮播(`onBackgroundState`)同理:主进程每换一张背景,推一帧状态过来。

### 整条链路连起来读一遍

以“点击『已安装』按钮卸载模组”为例,数据流贯穿全书:

```
点击按钮(mod-card.tsx,onClick)
→ actions.onToggleInstall(mod)          (第 7 章 props 回调)
→ App 里的处理函数,await window.api.uninstallMod(name)   (第 8 章)
→ preload:ipcRenderer.invoke('mods:uninstall', name)     (本章,桥梁)
→ ipc.ts:ipcMain.handle('mods:uninstall', ...)           (本章,Node 执行文件操作)
→ 返回 OperationResult → resolve 回 App → setMods 更新列表 → 卡片变回"未安装"
```

## 10.6 浏览器模式:window.api 不存在怎么办

还记得 `main.tsx` 里那段吗?

```ts
if (import.meta.env.DEV && !window.api) {
  installBrowserApiMock()
}
```

`npm run dev` 只起网页、不启动 Electron,`window.api` 天然不存在——于是注入一个**内存版假后端**(`lib/browser-api-mock.ts`):接口签名一模一样,数据存在内存里。这带来本项目最重要的开发体验:

- **日常改界面完全不需要 Electron**,浏览器 dev 即可,热更新照常;
- mock 与真 API 同型,切回 `dev:electron` 无需改一行界面代码。

这是“依赖接口而非实现”在日常开发中的实战价值:界面只认 `window.api` 的**形状**(类型),背后接真后端还是 mock,界面无感。

## 动手练习

1. 打开本项目跑 `dev:electron`(完整桌面模式),F12 打开 devtools,在 Console 输入 `window.api`,展开看看海关递出了什么;再输入 `await window.api.getConfig()` 看真实配置。
2. 在同一 Console 里 `await window.api.scanMods()`,拿到真实模组列表——你刚刚手动走了一遍完整 IPC 链路。
3. 读代码:从 `preload/index.ts` 里挑 `renameMod`,在 `src/main/ipc.ts` 里找到同名 handler,把“invoke → handle”两端连起来讲一遍。若想更深,再跳进 `src/main/operations.ts` 看它真正干了什么。
4. 思考题:为什么 `dialog:pickArchive`(弹系统文件选择框)必须在 main 里做,renderer 做不了?

## 自测

- Electron 三进程各自职责?为什么必须隔离?
- `invoke/handle` 与 `on/send` 各是哪种通信方向?
- contextBridge 暴露 API 时,为什么暴露一个方法白名单比暴露 `ipcRenderer` 本身安全?
- `npm run dev`(浏览器模式)下 `window.api` 是什么?这个设计给开发体验带来什么?

下一章:[第 11 章 · 实战:给项目加一个新功能](11-practice.md)
