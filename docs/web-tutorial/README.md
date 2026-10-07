# Web 开发零基础教程 —— 以 NTE 模组管理器为教材

这是一份面向**零基础读者**的 Web 开发完整教程。它不空讲理论,而是以本仓库的 `app/` 目录(NTE 模组管理器 2.0,一个 Electron + React 桌面应用)作为唯一的“实物教材”:每一章讲一个技术点,都会打开项目里的真实文件,看这个知识点在工业级代码里是怎么用的。

学完本教程,你将能看懂这个项目的全部前端代码,并且有能力亲手给它加功能。

## 网页版

本教程有**单章翻页浏览**的网页版:[site/index.html](site/index.html)(单文件,双击即可在浏览器打开;深浅色跟随系统)。支持侧边栏切章、上一章/下一章按钮、键盘 ←/→ 翻章、代码高亮与一键复制。

它由 `app/scripts/build-tutorial.mjs` 从本章的 Markdown 源文件自动编译而成。**修改教程内容请改 `.md` 文件**,然后重新生成:

```bash
cd app
npm run docs:tutorial
```

## 这份教程适合谁

- 完全没写过代码,或者只写过一点点,想系统学 Web 开发的人;
- 想通过“一个真实项目从上到下拆开看”来学习,而不是做一堆孤零零小练习的人;
- 最终目标是自己能开发网页,甚至开发像本项目管理器这样的**桌面应用**的人。

## 学习路线图

现代 Web 开发的知识栈是一层叠一层的,本教程严格按照依赖顺序排列,**请按章节顺序学习,不要跳章**:

```
学习路线自上而下,与章节编号一致:

【语言层】网页由什么构成
   ├─ 第 1 章  HTML:网页的骨架
   ├─ 第 2 章  CSS:控制外观
   ├─ 第 3 章  JavaScript:让网页活起来
   └─ 第 4 章  TypeScript:给 JavaScript 加上类型护栏

【工具层】一切运行在它之上
   ├─ 第 5 章  Node.js 与 npm:运行和安装一切的地基
   └─ 第 6 章  Vite:现代开发的工具链

【框架与样式】把界面真正搭起来
   ├─ 第 7 章  React 入门:组件与 JSX
   ├─ 第 8 章  React 进阶:状态与 Hooks
   └─ 第 9 章  Tailwind CSS 4 与 shadcn/ui:界面样式体系

【桌面形态】本项目的最终样子
   └─ 第 10 章 Electron:把网页变成桌面应用

【毕业】
   └─ 第 11、12 章  实战演练、调试与打包发布
```

一句话概括各层的关系:**HTML 是骨架,CSS 是皮肤,JavaScript 是肌肉;TypeScript 给肌肉装上“防拉伤”检查;React 告诉你怎么把成千上万块肌肉组织成一个人;Tailwind/shadcn 是现成的高质量皮肤库;Vite 和 npm 是健身房和器械;Electron 最后给这个人穿上一身铠甲,让他脱离浏览器作为桌面程序运行。**

## 环境准备(开始前必读)

### 1. 安装 Node.js

到 [https://nodejs.org](https://nodejs.org) 下载 **LTS 版本**并安装(一路下一步即可)。安装完打开终端验证:

```bash
node -v    # 输出版本号,如 v22.x.x
npm -v     # 输出版本号,如 10.x.x
```

> 国内网络如果访问 GitHub 经常超时,可以先给 npm 配置国内镜像:
> ```bash
> npm config set registry https://registry.npmmirror.com
> ```

### 2. 安装编辑器

推荐 [VS Code](https://code.visualstudio.com/)(免费)。装好后再在扩展商店里安装:

- **ESLint**:代码规范检查
- **Prettier**:自动格式化
- **Tailwind CSS IntelliSense**:写样式类名时自动补全(第 9 章会用到)

### 3. 把项目跑起来

```bash
cd app
npm install     # 第一次需要,下载所有依赖(可能要几分钟)
npm run dev     # 启动开发模式,会自动打开浏览器
```

看到“NTE 模组管理器”界面出现在浏览器里,环境就绪。以后**所有练习和验证都用 `npm run dev`**,改完代码浏览器会自动刷新(这个机制叫热更新,第 6 章详讲)。

> `npm run dev:electron` 是完整的桌面模式(连 Electron 外壳一起跑)。日常学习用浏览器模式就够了,界面代码完全相同。

### 4. 项目地图(建议打印或放在第二块屏幕上)

```
app/
├─ package.json              ← 第 5 章:项目清单(名字、依赖、命令)
├─ web.vite.config.ts        ← 第 6 章:浏览器模式的构建配置
├─ electron.vite.config.ts   ← 第 6 章:桌面模式的构建配置
└─ src/
   ├─ renderer/              ← "前端"本体,浏览器里跑的部分
   │  ├─ index.html          ← 第 1 章:整个页面的入口 HTML
   │  └─ src/
   │     ├─ main.tsx         ← 第 7 章:React 的启动入口
   │     ├─ App.tsx          ← 第 8 章:整个应用的根组件
   │     ├─ index.css        ← 第 2、9 章:全局样式与主题
   │     ├─ components/      ← 第 7-9 章:一个个 UI 零件
   │     │  ├─ mod-card.tsx      (模组卡片)
   │     │  ├─ sidebar.tsx       (左侧分类栏)
   │     │  ├─ fps-counter.tsx   (FPS 角标,全项目最简单的组件)
   │     │  └─ ui/               (shadcn/ui 基础零件库)
   │     └─ lib/             ← 工具函数(format.ts、utils.ts)
   ├─ main/                  ← 第 10 章:Electron 主进程(Node.js 环境)
   ├─ preload/               ← 第 10 章:连接两个世界的桥梁
   └─ shared/                ← 第 4 章:两边共用的类型定义
```

## 学习方法建议

1. **每章 30~90 分钟**,看完概念后一定动手:打开对照的文件,改一行,看浏览器变化,再改回来。
2. 每章末尾有**自测题**,答不上来说明该回头重读。
3. 看不懂某个概念很正常——Web 开发的知识是环环相扣的,第一遍允许“知道有这么个东西”,第二遍回头再看会豁然开朗。
4. 遇到报错先完整读一遍错误信息,80% 的错误信息里直接写了原因和文件行号。

## 目录

| 章节 | 内容 | 对照的项目文件 |
|---|---|---|
| [第 1 章](01-html.md) | Web 如何工作 & HTML 入门 | `src/renderer/index.html` |
| [第 2 章](02-css.md) | CSS:网页的外观 | `src/renderer/src/index.css` |
| [第 3 章](03-javascript.md) | JavaScript:让网页活起来 | `src/renderer/src/lib/format.ts` |
| [第 4 章](04-typescript.md) | TypeScript:给 JS 加上类型护栏 | `src/shared/types.ts` |
| [第 5 章](05-node-npm.md) | Node.js 与 npm | `app/package.json` |
| [第 6 章](06-vite.md) | Vite 与现代工程化 | `web.vite.config.ts` / `electron.vite.config.ts` |
| [第 7 章](07-react-basics.md) | React 入门:组件与 JSX | `main.tsx` / `fps-counter.tsx` |
| [第 8 章](08-react-state.md) | React 进阶:状态与 Hooks | `mod-card.tsx` / `App.tsx` |
| [第 9 章](09-tailwind-shadcn.md) | Tailwind CSS 4 与 shadcn/ui | `index.css` / `ui/button.tsx` |
| [第 10 章](10-electron.md) | Electron:桌面应用 | `main/index.ts` / `preload/index.ts` |
| [第 11 章](11-practice.md) | 实战:给项目加一个新功能 | `mod-card.tsx` 等 |
| [第 12 章](12-next-steps.md) | 调试、打包与后续学习路线 | `electron-builder.yml` 等 |
