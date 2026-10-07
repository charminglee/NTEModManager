# 第 11 章 · 实战:给项目加一个新功能

> 涉及文件:`mod-card.tsx`、`App.tsx`、`ipc.ts`、`preload/index.ts`、`settings-dialog.tsx`

前三步(主任务)是**手把手**的完整演示,请务必亲手敲一遍;后面 A/B/C 是**独立练习**,附提示与验收标准,难度递进,C 是贯穿三层的全栈练习。

开工前老规矩:`cd app && npm run dev`,所有改动都用浏览器模式验证;每完成一步按 `Ctrl+S` 看 HMR 效果。

## 主任务:给模组卡片加“复制模组名称”

**需求**:卡片右上角的“⋯”菜单里加一项“复制名称”,点击后模组名进剪贴板,并弹 toast 提示。

**动工前先做设计决策**(真实项目里这一步比写代码重要):这个行为放在哪?

- 选项一:卡片组件内部直接 `navigator.clipboard.writeText(...)`,自给自足;
- 选项二:遵循项目现有惯例——卡片只**报告意图**(`actions.onCopyName(mod)`),行为统一由 App 实现。

回忆第 8 章的架构原则(“子组件保持傻,行为统一在 App”),选二。于是改动清单:**两处组件文件,零新依赖**。

### 第 1 步:扩展卡片的行为合同(`mod-card.tsx`)

找到文件顶部的 `ModCardActions` 接口(约 31 行),在 `onRename` 旁边加一行:

```ts
export interface ModCardActions {
  onToggleInstall: (mod: ModInfo) => void
  onReinstall: (mod: ModInfo) => void
  onRename: (mod: ModInfo) => void
  onCopyName: (mod: ModInfo) => void      // ← 新增
  ...
}
```

保存。此刻 App.tsx 立刻标红:它实现的 `modCardActions` 缺了新方法——**第 4 章的类型护栏第一次实战护住了你**,TS 把“该改哪”直接指给你看。

### 第 2 步:加菜单项(`mod-card.tsx`)

在文件顶部 `lucide-react` 的 import 里补一个 `Copy` 图标,然后在 `DropdownMenuContent` 里、`重命名...` 那一项下面照葫芦画瓢:

```tsx
<DropdownMenuItem onClick={() => actions.onCopyName(mod)}>
  <Copy />
  复制名称
</DropdownMenuItem>
```

保存,HMR 生效。现在点开“⋯”菜单能看到新项,但点了没反应(合同有了、实现还没写)——注意菜单项**没有被红色报错卡住**,因为接口层面它已经合法。这种“两端各自合法、中间悬空”的状态是联调期的常态,靠类型系统的下一步提示来收口。

### 第 3 步:实现行为(`App.tsx`)

找到 `modCardActions = useMemo<ModCardActions>(...)`(约 455 行),在对象里补上实现:

```tsx
onCopyName: (mod) => {
  void navigator.clipboard.writeText(mod.name)
  toast.success(`已复制:${mod.name}`)
},
```

三个知识点现场用上:

- `navigator.clipboard.writeText()` 是浏览器标准 API,**返回 Promise**,所以前面挂 `void`(表示“我知道这是异步、故意不等它”,项目里到处是这个写法);
- `toast.success(...)` 来自第 5 章依赖表里的 `sonner` 库——App.tsx 顶部已 import,直接用;
- 回忆第 10 章浏览器模式:剪贴板是浏览器能力,不走 `window.api`,所以 mock 无关,浏览器和桌面两端都天然可用。

### 第 4 步:验证与收尾

1. 浏览器里点开某卡片“⋯”→ 复制名称 → 看到 toast,在任意输入框 `Ctrl+V` 验证剪贴板;
2. 终端跑 `npm run typecheck`,确认全绿;
3. `git diff` 看一眼:总共 3 个文件里 10 行上下的改动——真实项目的功能迭代,大多就是这个体量。

### 复盘:这 10 行穿过了几章的知识

| 改动 | 用到的知识 |
|---|---|
| `ModCardActions` 加方法 | 第 4 章 interface、类型护栏报错 |
| 菜单项 JSX | 第 7 章 JSX、第 9 章 Radix/shadcn |
| `onClick={() => actions.onCopyName(mod)}` | 第 3 章箭头函数、第 8 章回调上行 |
| `navigator.clipboard` + `void` | 第 3 章 Promise、项目惯例 |
| `toast.success` | 依赖管理、App 统一处理反馈 |
| HMR 全程验证 | 第 6 章开发循环 |

**以后你接到任何“加个按钮”的需求,走的都是这条完全相同的路。**

## 练习 A(纯展示):卡片副标题显示文件数

**需求**:卡片副标题现在是 `大小 · 导入于 时间`,改成 `大小 · N 个文件 · 导入于 时间`。

- 位置:`mod-card.tsx` 里那行 `formatFileSize(mod.sizeBytes) · 导入于 ...`;
- 提示:`mod.files` 是数组(第 3 章 `.length`);文件数为 0 时显示“空文件夹”而不是“0 个文件”(第 7 章三元);
- 验收:两种卡片状态显示正确,typecheck 绿。

## 练习 B(读 App 的数据):加“复制安装路径”

**需求**:菜单再加一项“复制安装路径”,内容为 `modsDirectory/模组名`。

- 难点:路径目录在**配置**里。回忆第 8 章状态提升——`config` 是 App 的 state,`modCardActions` 的闭包能直接读到;若 `config` 还是 null(启动瞬间)就 `return`;
- 拼路径用现成工具:`import { joinPath } from '@/lib/format'`(第 3 章读过它怎么处理 `/` 和 `\`);
- 提示:路径不存在安装概念(未安装时 `sourcePath` 也可复制),不必纠结语义,重点是**在回调里读到 App 的另一个 state**;
- 验收:复制出的路径粘贴到资源管理器能定位(如果已安装该模组)。

## 练习 C(全栈):设置弹窗显示应用版本号

**需求**:设置弹窗标题“设置”旁边显示当前应用版本(如“设置 · 2.0.0”)。版本号只有主进程知道(在 `package.json` 里),所以要**新开一条 IPC 频道**——完整穿过 Electron 三层:

1. **主进程** `src/main/ipc.ts`:顶部 import 里补上 `app`(`import { app, dialog, ... } from 'electron'`),在 `registerIpcHandlers` 里挑个顺眼位置加:

   ```ts
   ipcMain.handle('app:version', () => app.getVersion())
   ```

2. **桥梁** `src/preload/index.ts`:在 `api` 对象里加:

   ```ts
   getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
   ```

   保存后注意:`window.api` 的类型**自动**长出了新方法——因为 `types/api.d.ts` 是直接从 preload 的 `Api` 类型推导的(第 4 章“一份合同”的机制红利)。
3. **界面** `settings-dialog.tsx`:它已 import 了 `useState`/`useEffect`/`toast`,在组件体内加:

   ```tsx
   const [version, setVersion] = useState<string | null>(null)
   useEffect(() => {
     void window.api.getAppVersion().then(setVersion)
   }, [])
   ```

   然后把 `<DialogTitle>设置</DialogTitle>` 改成:

   ```tsx
   <DialogTitle>设置{version ? ` · ${version}` : ''}</DialogTitle>
   ```

4. **验证**:浏览器模式下 mock 没有 `getAppVersion` 会报错——这本身就是教学点:mock 是接口的另一份实现,**接口长了他没长**。去 `lib/browser-api-mock.ts` 给 mock 对象补一个假实现(返回任意字符串)即可;真正验收用 `npm run dev:electron` 看真实版本号。
5. 顺手理解:为什么浏览器模式这里会“假数据”、桌面模式“真数据”,而界面代码一行没改?(第 10 章:界面只依赖接口形状。)

**验收**:两种模式设置弹窗都显示版本;`npm run typecheck` 与 `npm run typecheck:node` 全绿。

## 收尾纪律(真实工程习惯)

每完成一个练习,把改动**安全地**收起来,别让练习残留污染工作区:

```bash
git stash push -m "web教程练习A"   # 把当前改动暂存起来,工作区恢复干净
git stash list                     # 以后想回看:git stash list / git stash pop
```

> ⚠️ **不要用 `git checkout -- src` 这类“整体还原”命令**:它们会把工作区里**所有**未提交改动(包括你自己正在进行的工作)一并丢弃,不可恢复。练习改的文件少且明确,更稳妥的做法是只还原你动过的那几个文件:
>
> ```bash
> git checkout -- src/renderer/src/components/mod-card.tsx src/renderer/src/App.tsx
> ```
>
> 开始做练习前,如果工作区已有进行中的修改,建议先 `git stash` 或提交一次,给练习一个干净的起点。

**练习的价值在过程,不在把仓库改得到处是练习残留。**下一章我们聊怎么调试、怎么打包,以及学完之后往哪走。

上一章:[第 10 章 · Electron](10-electron.md) · 下一章:[第 12 章 · 调试、打包与后续路线](12-next-steps.md)
