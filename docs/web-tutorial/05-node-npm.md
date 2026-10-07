# 第 5 章 · Node.js 与 npm:一切的运行地基

> 对照文件:`app/package.json`

## 5.1 Node.js 是什么

第 3 章说过,JS 原本只能在浏览器里跑。2009 年出现的 **Node.js** 把 Chrome 的 V8 引擎(就是执行 JS 的那台“发动机”)单独抽出来装上了操作系统:从此 JS 可以直接读写文件、监听网络端口、执行任意命令——成为一门和 Python、C++ 平起平坐的通用语言。

对本项目,Node.js 身兼两职:

1. **开发工具的运行时**:Vite、TypeScript 编译器、打包器……它们本身就是 Node 程序(你敲的 `npm run dev` 就是用 Node 起的);
2. **应用的一半**:模组管理器里真正扫描文件夹、复制文件、解压缩的那半边代码(`src/main/`、`src/bg-server/`)跑在 Node 环境里,因为浏览器出于安全限制碰不到磁盘,Node 可以。

## 5.2 npm 与“包”

一个函数写得不错,别人也想用——于是大家把可复用的代码打包发布到公共仓库(npm registry,可理解为 JS 世界的应用商店),这个包就叫 **package(包)**。**npm = Node Package Manager**,装包、管包的工具,随 Node.js 一起安装。

现代前端项目 = 你自己写的代码 + 几十个第三方包。本项目(见 `package.json`)用到的包包括:

| 包名 | 作用 | 相关章节 |
|---|---|---|
| `react` / `react-dom` | UI 框架 | 第 7、8 章 |
| `typescript` | TS 编译器 | 第 4 章 |
| `vite` / `electron-vite` | 构建工具 | 第 6 章 |
| `tailwindcss` | 原子化 CSS 引擎 | 第 9 章 |
| `lucide-react` | 图标库(`mod-card.tsx` 顶部的 `ChevronDown` 等全是它) | — |
| `sonner` | 弹 toast 通知的库 | 第 11 章实战会用到 |
| `electron` / `electron-builder` | 桌面壳与打包器 | 第 10、12 章 |

### 常用命令

```bash
npm install          # 按 package.json 装齐所有依赖(新机器第一次必跑)
npm install sonner   # 安装某个新包,并自动写进 package.json
npm run dev          # 执行 package.json 里 scripts 定义的 dev 命令
```

## 5.3 package.json:项目的身份证

打开 `app/package.json`,它是整个项目的清单文件。逐段看:

### 元信息

```json
{
  "name": "nte-mod-manager",
  "version": "2.0.0",
  "description": "NTE 模组管理器",
  "main": "./out/main/index.js",
  "private": true
}
```

`main` 告诉 Electron“应用启动时先加载哪个文件”(第 10 章);`private: true` 表示这个项目不发布到 npm 商店,防止手滑 `npm publish`。

### scripts:项目的一键命令

```json
"scripts": {
  "dev": "node scripts/test-images.mjs on && vite --config web.vite.config.ts --open",
  "dev:electron": "node scripts/test-images.mjs on && electron-vite dev",
  "build": "node scripts/test-images.mjs on && electron-vite build",
  "typecheck": "npm run typecheck:node && npm run typecheck:web"
}
```

`scripts` 定义**命令的别名**:`npm run dev` 实际执行右边那串。好处是“复杂细节收进清单,队友只需记住 `npm run dev`”。

本项目为了教学稳定有个约定:**日常跑界面用 `dev`(浏览器模式),需要验证 Electron 特有能力(窗口、文件对话框)时用 `dev:electron`**。`&&` 表示前一个命令成功后接着跑后一个。

### dependencies 与 devDependencies

```json
"dependencies": {
  "iconv-lite": "^0.6.3",
  ...
},
"devDependencies": {
  "react": "^18.3.1",
  "vite": "^7.3.6",
  ...
}
```

- `dependencies`:**运行时**还需要的包;
- `devDependencies`:只在**开发/构建时**需要的包(编译器、打包器……)。

注意 `react` 也在 devDependencies 里——对这个 Electron 项目而言,React 代码会被**构建进最终产物**,不需要用户机器上另装,所以归入“开发时依赖”。这是桌面应用与网站部署的差异,了解即可。

版本号前的 `^` 读作“这个版本或更高的兼容版本”(`^18.3.1` = 18.x 里 ≥18.3.1 的最新版)。实际锁定到哪个版本,记录在 `package-lock.json` 里——**所以团队协作要把 lock 文件提交进 git**,保证每个人装到一模一样的版本。

### allowScripts:安全闸门

```json
"allowScripts": {
  "electron@44.5.1": true,
  "esbuild@0.21.5": true,
  ...
}
```

npm 新版对“安装包时自动执行脚本”(常见的供应链攻击载体)默认拦截,确需执行的要逐包放行。electron、esbuild 安装时确实需要跑下载脚本,所以这里精确列出了白名单——**看到陌生包要求 allowScripts 时先查它为什么需要,别无脑放行**。

## 5.4 node_modules 与三种“要装的东西”

`npm install` 后项目里多出的 `node_modules/` 文件夹装着所有依赖的实际代码,动辄几百 MB、几万个文件。三条铁律:

1. **永远不手动改 node_modules 里的东西**;
2. **它必须写进 `.gitignore`**(本项目的已如此),git 仓库里只存 `package.json` + `package-lock.json`,谁克隆谁 `npm install`;
3. 依赖装坏了的万能修复:`删掉 node_modules 和 package-lock.json,重新 npm install`(王炸,十管九用)。

## 5.5 Node 端代码长什么样

提前瞄一眼第 10 章的世界。`src/main/` 下的代码是纯 Node,用 Node 内置模块干活:

```ts
import { existsSync, writeFileSync } from 'node:fs'   // fs = 文件系统
import { dirname, join, resolve } from 'node:path'    // path = 路径拼接

// join('C:/Game', 'mods') → 'C:/Game/mods'
// existsSync(路径) → 文件/文件夹是否存在
```

`node:` 前缀表示“Node 内置模块”,不需要 npm 安装。第 1 章说浏览器里的 JS 碰不到磁盘,**能碰磁盘的只有这半边**——这就是本项目“界面在浏览器、脏活在 Node”分工的根源。

## 动手练习

1. 终端执行 `node`,进入交互环境,输入 `1 + 1`、`const fs = require('node:fs'); fs.readdirSync('.')`(列出当前目录),感受“不经过浏览器的 JS”。`Ctrl+C` 两次退出。
2. 打开 `package.json`,找到三个 script(`dev`、`dev:electron`、`typecheck`),口头说出各自干什么、你什么时候会运行它。
3. 在终端跑 `npm run typecheck`,看到 `tsc` 的输出即体验了一次“纯 Node 工具链”。

## 自测

- Node.js 和浏览器里的 JS 是什么关系?本项目哪两处分别用到它们?
- `npm install` 做了什么?克隆项目后第一次必须做什么?
- dependencies 和 devDependencies 的区别?`^18.3.1` 是什么意思?
- 为什么 `package-lock.json` 必须提交到 git?

下一章:[第 6 章 · Vite 与现代工程化](06-vite.md)
