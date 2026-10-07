# 第 12 章 · 调试、打包与后续学习路线

> 涉及文件:Vite/electron-vite 的 dev 与 build 命令、`electron-builder.yml`

## 12.1 调试:你的三块仪表盘

### ① DevTools(F12)——最常用

`npm run dev` 的浏览器窗口里按 F12,四个面板解决九成问题:

- **Console**:所有 `console.log(...)` 的输出、红色报错都在这。**调试第一定律:先读 Console,再读终端**。你可以把它当草稿本,直接输入表达式试验(第 3 章练过);
- **Elements**:实时 DOM 树(第 1 章)。选中元素 → 右侧看它的 class 与生效 CSS(第 2、9 章),勾选/改值即时生效——排查“样式为什么没生效”的主战场;
- **Network**:页面加载了哪些资源、接口请求的参数与响应。本项目浏览器模式下这里能看到 `/test-images/` 等请求(第 6 章那个插件伺服的);
- **Sources**:源码打断点。或在代码里写一行 `debugger;`,程序跑到那会自动停下,可逐行步进、查看每个变量。比 `console.log` 撒一地体面得多。

React 专属推荐:浏览器装 **React Developer Tools** 扩展,可直接查看组件树、每个组件的 props 与 state——第 8 章的“状态提升”看得见摸得着。

### ② 终端

Vite/TS 的**编译期**错误(类型错、import 路径错)只出现在终端里。改完没反应?先瞄终端。IPC 这边的问题(`No handler registered for ...`)也会打到主进程日志里。

### ③ 有效提问的姿势

报错解决不了时,把**完整报错文本 + 最近改动**拿去搜或问 AI,比“我这里不对了”有效一百倍。90% 的报错信息里直接写着文件名和行号。

### 常见“灵异事件”排查单

| 症状 | 先检查 |
|---|---|
| 改了代码界面没变 | 文件保存了吗?终端有报错吗?浏览器硬刷新(Ctrl+Shift+R) |
| 组件该显示却没显示 | Console 有没有红字?条件渲染的条件是不是 false?列表 `key` 唯一吗? |
| 样式完全没生效 | 类名拼对了吗?动态类名过 `cn()` 了吗?浏览器模式 mock 是否在报错中断了渲染 |
| `window.api` 报 undefined | 你在浏览器模式调了 mock 没有的接口(第 11 章练习 C 的体验) |
| typecheck 过了运行还是错 | 那是运行时逻辑问题——回 DevTools 断点排查 |

## 12.2 打包发布:从源码到安装包

开发态(`npm run dev`)的一切便利——HMR、未压缩源码、dev server——都不能带给用户。发布走两条构建流水线:

```
npm run build                 → electron-vite build
   三段配置各自打包(第 6 章的表):main/preload → out/main|preload,renderer → out/renderer
npm run dist                  → scripts/dist.mjs 编排:build + electron-builder
   electron-builder(配置在 electron-builder.yml)把 out/ + Electron 运行时
   打成 Windows 安装包,产物在 app/dist/ 目录
```

期间发生的本质是:**把你写的源码翻译成优化过的静态文件,连同整个 Chromium+Node 运行时一起装进安装包**——这就是 Electron 应用体积大的原因,也是“用户无需装 Node.js 和浏览器”的原因。

初次体验打包注意两点:第一次构建要下载 Electron 二进制,国内网络较慢属正常;打包版与 dev 行为有差异(资源路径、安全策略更严格),所以本项目有条测试铁律——**开发验证一律走 `npm run dev` 族,打包版只用于发布前冒烟**。

> 本项目还有个进阶产物:`npm run dist:bg-server` 会额外打包一个无界面的背景图服务进程(见 `docs/background-image-service.md`),属于“Electron 也能写后台服务”的实例,学完本书有余力可去读 `src/bg-server/`。

## 12.3 本书没讲、但很快会遇到的

诚实地列出来,给你下一步的地图(按遇到的概率排序):

| 主题 | 一句话解释 | 什么时候需要 |
|---|---|---|
| HTTP 与网络请求 | 浏览器怎么和服务器交换数据(`fetch`) | 一旦你的应用要联网 |
| 路由(routing) | SPA 里“多个页面”的实现(`react-router`) | 做多页面网站时 |
| 全局状态管理 | 跨组件共享状态的进阶方案(zustand、Redux) | 应用大了、props 层层传太深时 |
| 测试 | 用代码验证代码(Vitest、Testing Library) | 团队协作、重构前 |
| 后端开发 | 服务器端的 API 怎么写(Node.js + Express/Nest) | 想做全栈 |
| Git 版本控制 | 代码的“存档/回滚/协作”系统 | 立刻、马上 |
| 无障碍(a11y) | 让读屏器等辅助工具能用的界面 | 商业项目的基本要求 |

## 12.4 推荐资源(都是免费、官方、中文友好)

- **MDN Web Docs**(developer.mozilla.org)——HTML/CSS/JS 的权威字典,本书多章引用过,遇到任何 Web API 先查它;
- **React 官方文档**(react.dev,有中文)——质量极高,本书第 7、8 章的官方延伸阅读;
- **TypeScript 官方手册**(typescriptlang.org/docs)——第 4 章之后想深入类型系统看它;
- **Tailwind CSS 文档**(tailwindcss.com/docs)——当词典用:想知道“间距 12px 的类名是什么”,搜它;
- **shadcn/ui 文档**(ui.shadcn.com)——想给项目添加新基础组件(如 checkbox、tabs)时按文档操作;
- **Electron 官方文档**(electronjs.org/docs)——第 10 章所有 API 的权威出处,安全清单必读。

## 12.5 结业清单

全部打勾,说明你已经具备独立开发 Web/桌面应用的基础能力:

- [ ] 能手写一个含 HTML/CSS/JS 的静态页面(第 1~3 章练习)
- [ ] 能读懂 `interface`/泛型/枚举,会跑 `npm run typecheck`(第 4 章)
- [ ] 能解释 package.json 每一段的作用,会装包、会跑 scripts(第 5 章)
- [ ] 理解 dev/build 两种模式的区别,会读 Vite 报错(第 6 章)
- [ ] 能从 import 列表画出组件树,会写带 props 的组件(第 7 章)
- [ ] 会用 useState/useEffect/useRef,理解状态提升与单向数据流(第 8 章)
- [ ] 能读懂本项目任意 className,理解主题变量链与 shadcn 三模式(第 9 章)
- [ ] 能完整讲出一次点击从卡片到磁盘的 IPC 旅程(第 10 章)
- [ ] 独立完成第 11 章主任务与至少练习 A、B(第 11 章)
- [ ] 会用 DevTools 四面板与断点定位问题(第 12 章)

## 12.6 毕业建议:接下来做什么项目

学习编程的唯一捷径是**做项目**。由近及远三个建议:

1. **继续深耕本仓库**:第 11 章的练习做完后,挑一个真实痛点做完整功能(先在 issue 里描述设计再动手)——给真实项目贡献代码是最快的成长方式;
2. **做一个纯网页小应用**(不依赖 Electron):比如个人书签管理、番茄钟。技术栈完全复用:Vite + React + TS + Tailwind + shadcn/ui,你会惊讶于“第 10 章以外的所有知识原样通用”;
3. **给书签应用补一个后端**:Node.js + Express 存数据,从此理解“前后端分离”里两端各自的角色——你就真正走完 Web 开发的第一圈了。

遇到问题就回来翻对应章节——这份教程的每一章都锚定着本仓库里活生生的代码,它们不会过期。

[返回目录](README.md)
