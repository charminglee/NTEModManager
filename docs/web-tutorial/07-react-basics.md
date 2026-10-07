# 第 7 章 · React 入门:组件与 JSX

> 对照文件:`src/renderer/src/main.tsx`(启动入口)、`src/renderer/src/components/fps-counter.tsx`(最简组件)

## 7.1 为什么需要 React

回想第 3 章:操作网页就是手动改 DOM——列表多一项就 `appendChild`,改个标题就找节点改 `textContent`。界面简单还行;本项目界面上有上百张卡片、设置面板、日志流,手动管理 DOM 很快会变成“哪里该更新、更新几次、更新顺序”的噩梦。

**React 的核心思想:界面 = 状态的函数。** 你不再手动改 DOM,而是:

1. 描述“界面在任意状态下**应该长什么样**”(组件代码);
2. 状态(当前模组列表、搜索词、某卡片是否展开)变化时,React 自动算出新样子,只把差异应用到 DOM。

你声明“是什么”,React 负责“怎么改”——所以 React 类框架也叫**声明式 UI**。

## 7.2 启动入口:main.tsx

打开 `src/renderer/src/main.tsx`,全文 17 行:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserApiMock } from './lib/browser-api-mock'
import './index.css'

// 浏览器测试模式(npm run dev):不经 Electron 时 preload 不存在,注入内存 mock
if (import.meta.env.DEV && !window.api) {
  installBrowserApiMock()
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

这就是第 1 章“空的 `#root` 如何被填满”的答案(全文 16 行):

- `import './index.css'`:全局样式从这里注入;
- `document.getElementById('root')`:抓走 HTML 里那个空 div;
- `.render(<App />)`:把名为 `App` 的组件渲染进去——**整个应用是 App 这一个组件,其他所有组件都是它的子孙**;
- `if (import.meta.env.DEV ...)`:只在开发环境生效的一小段逻辑,给浏览器模式补一个假的“后端”(第 10 章会理解为什么需要);
- `<React.StrictMode>`:开发期的“严格教练”,主动多渲染一次来暴露不规范的写法,不影响生产。

## 7.3 组件:一个返回界面的函数

**组件(component)= 一个名字大写开头、返回界面描述的函数。** 看全项目最简单的组件 `fps-counter.tsx`:

```tsx
import { useEffect, useState } from 'react'

export default function FpsCounter() {
  const [fps, setFps] = useState('--')

  useEffect(() => {
    // ...每秒统计渲染帧数,略,第 8 章讲 useEffect
  }, [])

  return (
    <span className="shrink-0 tabular-nums">
      {fps} FPS
    </span>
  )
}
```

剥掉暂时不讲的 `useState`/`useEffect`,骨架就是:**一个函数,返回一段 JSX**。就这么简单。规模不同、复杂度不同的所有组件——sidebar、settings-dialog、mod-card——本质都是“函数返回 JSX”。

## 7.4 JSX:在 JS 里写“HTML”

JSX 是 React 发明的语法扩展,**长得像 HTML,实际是 JS 表达式**。规则不多,逐条记:

### ① 就是你已经会的 HTML 标签

```tsx
return <button>点我</button>
```

### ② `{}` 花括号:JS 世界的大门

花括号里可以放**任何 JS 表达式**,结果渲染到那个位置:

```tsx
<span>{fps} FPS</span>                 {/* 变量 */}
<div>{formatFileSize(mod.sizeBytes)}</div>   {/* 函数调用 */}
<span>{mod.installed ? '已安装' : '未安装'}</span>  {/* 三元:条件渲染 */}
```

`mod-card.tsx` 里真实的一行——文件大小那行小字:

```tsx
<div className="mt-0.5 text-xs text-muted-foreground">
  {formatFileSize(mod.sizeBytes)} · 导入于 {formatImportedAt(mod.importedAt)}
</div>
```

第 3 章读过的两个工具函数,在这里被装配进了界面。

### ③ 属性用驼峰,值可以是任意表达式

```tsx
<button onClick={() => ...} disabled={busy}>
```

`class` → `className`(JS 保留字冲突)、`onclick` → `onClick`。这是 HTML 和 JSX 最容易搞混的两处。

### ④ 条件渲染的两种惯用法

```tsx
{/* A. 短路:为真才渲染(不渲染 = DOM 里根本没有这个元素) */}
{mod.invalid && <TriangleAlert className="h-4 w-4" />}

{/* B. 三元:二选一 */}
{mod.installed ? '已安装' : '未安装'}
```

`mod-card.tsx` 里失效模组头上的 ⚠️ 图标就是 A 写法。

### ⑤ 列表渲染:map 出一切

```tsx
{mods.map((m) => (
  <ModCard key={m.name} mod={m} />
))}
```

把对象数组 map 成 JSX 数组,React 就把它们依次渲染。**每个列表项必须给唯一 `key`**(告诉 React 哪个是哪个,更新时才能精准复用),通常用稳定不变的 id 或名字,不要用数组下标。

### ⑥ 只能返回一个根元素

函数返回的 JSX 必须单根。需要多个并列元素时用空标签包裹:`<>{...}</>`。

## 7.5 Props:父传子的数据通道

组件要复用,就不能写死数据。**props(属性)是父组件传给子组件的只读参数**,和函数参数是同一件事——组件本来就是函数。

`App.tsx` 里渲染每张卡片:

```tsx
<ModCard mod={mod} actions={actions} disabled={busy} />
```

`mod-card.tsx` 里声明自己接收什么:

```tsx
interface ModCardProps {
  mod: ModInfo
  actions: ModCardActions
  disabled: boolean
  uiHidden?: boolean
}

function ModCard({ mod, actions, disabled, uiHidden }: ModCardProps) {
  // 参数解构:直接拿到 mod、actions、disabled、uiHidden 四个局部量
```

看懂这个闭环,你就读懂了 React 数据流的半壁江山:

> **App 持有数据(模组列表)→ 用 props 分发给每张卡片 → 卡片只管“给我什么我显示什么”。**
> props 是只读的:子组件绝不直接修改 props,想改,往上看第 8 章。

注意 `interface ModCardProps` —— 第 4 章的类型系统在这里上岗:props 传错立刻编译报错。

## 7.6 import 组装:组件树

每个组件一个文件、默认导出,用 import 组装成树:

```
App
├─ BackgroundLayer        (背景层)
├─ Sidebar                (分类侧栏)
├─ ModListHeader          (搜索/排序工具栏)
├─ ModCard × N            (每张模组卡片)
│  ├─ LiquidGlass         (玻璃效果)
│  ├─ FileTree            (文件树)
│  ├─ Tooltip / DropdownMenu / Badge  (ui/ 基础件)
│  └─ ...
├─ LogView                (日志面板)
├─ SettingsDialog         (设置弹窗)
└─ Toaster                (toast 通知出口)
```

`mod-card.tsx` 顶部十几行 import 就是这棵树的“进货单”。**读陌生 React 项目的标准姿势:从入口的 import 列表画出组件树,再逐个击破叶子。**

## 动手练习

1. 在 `src/renderer/src/components/` 新建 `hello.tsx`:

   ```tsx
   export default function Hello() {
     const name = 'NTE'
     return <div style={{ padding: 8 }}>你好,{name}!现在是练习组件。</div>
   }
   ```
2. 在 `App.tsx` 里 `import Hello from '@/components/hello'`,把 `<Hello />` 插到 return 的某个可见位置,保存,HMR 会立刻显示它。
3. 给 Hello 加一个 props 练习:改成 `function Hello({ place }: { place: string })`,渲染 `你好,{place}!`,然后在 App 里传 `<Hello place="侧边栏" />`。
4. 练完**删除你添加的所有代码**,保持项目原状(后续章节的练习还要用它)。

## 自测

- 用一句话说出 React 和“手动改 DOM”的思路区别。
- `{}` 里能放什么?写出一个条件渲染和列表渲染的例子。
- props 能被子组件修改吗?数据从哪流向哪?
- `key` 是干什么的?为什么不该用数组下标?

下一章:[第 8 章 · React 进阶:状态与 Hooks](08-react-state.md)
