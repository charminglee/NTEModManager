# 第 8 章 · React 进阶:状态与 Hooks

> 对照文件:`src/renderer/src/components/mod-card.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/components/fps-counter.tsx`

## 8.1 useState:让组件“记住”事

第 7 章的组件是“死”的——props 不变,画面永远一样。**状态(state)**是组件私有的、可变的记忆,它一变,React 自动重渲染该组件。

```tsx
const [expanded, setExpanded] = useState(false)
//     ↑读值        ↑写值函数        ↑初始值
```

`useState(false)` 返回一对值(所以用数组解构接):当前状态和更新函数。**唯一合法的改状态方式是调 set 函数**——直接 `expanded = true` 不但无效还违纪,因为 React 靠 set 函数感知变化。

`mod-card.tsx` 卡片展开/收起的真实代码,三行讲完一个交互:

```tsx
const [expanded, setExpanded] = useState(false)

<button onClick={() => setExpanded((value) => !value)}>
```

点击 → set 函数触发 → React 用新值重渲染卡片 → 展开区那段的 className 变了 → 界面出现文件树。全程没有一行“操作 DOM”的代码。

> **set 函数的函数式写法**:`setExpanded((value) => !value)` 基于“上一个值”算新值,比 `setExpanded(!expanded)` 安全(避免连续 set 时拿到旧值)。新值由旧值计算时,一律用这种写法。

### 状态变化 → 重渲染,是“重新执行整个函数”

心智模型很重要:状态一变,React **把这个组件函数从头再执行一遍**(返回新的 JSX),然后和上一轮比对,只把差异补进 DOM。所以:

- 函数体里**不要做昂贵计算**(每次渲染都会重跑;要缓存见 8.4);
- 变量不会在两次渲染之间保留——要保留,放 state 或 ref。

## 8.2 useEffect:与“外部世界”同步

组件函数管“渲染”,但还有些事发生在渲染之外:订阅推送、启动定时器、读写外部系统。**useEffect 专门干这个**:告诉 React“渲染完成后,顺手做这件事”。

本项目最教学友好的例子是 `fps-counter.tsx`(去掉细节注释):

```tsx
useEffect(() => {
  let raf = 0
  const loop = (now: number) => {
    // ...统计这一秒的帧数,每 500ms 调一次 setFps(...)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return () => cancelAnimationFrame(raf)   // 清理函数
}, [])
```

结构三件套:

1. **副作用函数**:起一个 `requestAnimationFrame` 循环持续统计帧率;
2. **清理函数**(return 的那个):组件从界面移除时 React 会调用它,取消循环。**起了什么就得收什么**,否则内存泄漏;
3. **依赖数组** `[]`:空数组 = “只在挂载时执行一次、卸载时清理一次”。

### 依赖数组的几种形态

```tsx
useEffect(() => {...}, [])          // 挂载后执行一次(订阅一次推送、启动一次轮询)
useEffect(() => {...}, [search])    // search 变化后执行(防抖保存搜索词等)
useEffect(() => {...})              // 每次渲染后都执行(极少用,写错容易死循环)
```

`App.tsx` 里有个更“业务”的例子——订阅主进程的日志推送,组件卸载时退订:

```tsx
useEffect(() => {
  const unsubscribe = window.api.onLogEntry((entry) => {
    setLogs((prev) => [...prev, entry])
  })
  return unsubscribe      // onLogEntry 返回的正是退订函数,直接当清理函数
}, [])
```

这段还演示了**数组展开**: `[...prev, entry]` 生成“旧日志 + 新一条”的新数组。**React 里改数组必须给新数组**(`setLogs(新数组)`),原地 `prev.push(entry)` 不算变化,React 察觉不到。

## 8.3 useRef:不触发重渲染的记忆

有的值要跨渲染保留,但**不该**引起界面刷新(比如“现在是否正在忙”的标记)。`useRef` 就是个可变的小盒子:

```tsx
const busyRef = useRef(false)

busyRef.current = true     // 改 .current,界面纹丝不动
```

`App.tsx` 的 `withBusy` 用它防止并发操作:上一次操作没结束( `busyRef.current === true`),再点按钮直接弹 toast “已有操作正在进行中”。state 也能存这个标记,但 state 变化会触发重渲染——用 ref 表达“与画面无关的运行时事实”更准确、更省。

## 8.4 三对性能搭档:useCallback / memo / useMemo

先说结论:**初学阶段不用主动用它们,但要看得懂**。它们解决同一个问题——React 默认“父渲染则子全部重渲染”,界面元素一多(本项目上百张玻璃卡片)就需要精准跳过无关渲染。

- `useCallback(fn, [deps])`:把一个函数**记住**,依赖不变就返回同一个函数实例。`App.tsx` 把传给所有卡片的一堆操作函数都包了它,避免“每次渲染都造新函数 → 所有卡片被迫重渲染”。
- `memo(组件)`:给组件加“props 没变就跳过渲染”的护盾,`mod-card.tsx` 最后一行 `export default memo(ModCard)`。它和 useCallback 是配套的——App 那边不把函数记住,这边的 props 永远“变了”,memo 形同虚设。
- `useMemo(() => 计算结果, [deps])`:把**计算结果**记住。`App.tsx` 里过滤+排序后的模组列表、分类统计都包了它:模组几百个时,不相关的状态(比如日志推了一条)不该让全列表重算。

**优化铁律:先写对,量小不优化;出现卡顿,再上这三件套。** 本项目给它们写了不少注释,以后读代码时顺带体会“为什么要在这里包一层”。

## 8.5 状态提升:兄弟组件怎么共享数据

经典问题:侧边栏点了分类,卡片列表要跟着筛——两个兄弟组件,数据放谁的 state 里都不对。

答案:**把状态提到最近的共同父级(App),通过 props 下发**。App.tsx 顶上那排 useState 就是全应用的心脏:

```tsx
const [mods, setMods] = useState<ModInfo[]>([])          // 全部模组
const [currentCategory, setCurrentCategory] = useState(ALL_CATEGORY)  // 当前分类
const [search, setSearch] = useState('')                  // 搜索词
const [busy, setBusy] = useState(false)                   // 是否操作中
```

然后单向流下去:

```
App(持有 mods/currentCategory/search)
│  props 下发
├─ Sidebar      ← currentCategory,onChange={setCurrentCategory}
└─ 列表区        ← 过滤排序后的 mods
```

Sidebar 里点分类 → 调 props 里的 `onChange('角色扮演')` → App 的 state 变了 → 重渲染 → 列表自动变成新分类的内容。**数据永远从上往下流,事件从下往上报告**——React 应用的全部架构,一句话。

`mod-card.tsx` 的 `ModCardActions` 接口是“事件向上报告”的合同:卡片自己不会安装/删除模组,只回调 App 传下来的 `actions.onToggleInstall(mod)`,由 App 统一执行并更新数据。子组件保持“傻”,架构就简单。

### 受控输入

搜索框是状态提升的日常形态:

```tsx
const [search, setSearch] = useState('')
<input value={search} onChange={(e) => setSearch(e.target.value)} />
```

输入框的值**由 state 驱动**(value 绑 state),每次击键经 onChange 写回 state。数据单向闭环,永远以 state 为准——这叫**受控组件**,React 处理一切输入框的标准姿势。

## 8.6 自定义 Hook:复用“带状态的逻辑”

当一段“useState+useEffect 组合拳”要在多处使用,就把它抽成自定义 Hook——**名字以 use 开头的普通函数,内部调用其他 Hook**。本项目 `App.tsx` 里的 `refreshMods` 就是一例(把“扫描模组 + 写入 state”打包):

```tsx
const refreshMods = useCallback(async (): Promise<ModInfo[]> => {
  const scanned = await window.api.scanMods()
  setMods(scanned)
  return scanned
}, [])
```

规则两条:**只在组件(或其他 Hook)顶层调用 Hook**;**名字必须 use 开头**(lint 靠名字识别违规,比如把 Hook 写进 if 分支会漏挂载)。

## 8.7 读大组件的路线图

现在你可以正面强攻 `App.tsx` 了(1000+ 行,本项目唯一的大文件)。推荐读法:

1. **先读顶部 useState 群**(58~82 行附近):这一屏就是应用的全部“心脏”,每个 state 猜测它管什么画面;
2. **再读每个 `useCallback`/普通函数**:都是“改心脏”的动作(导入、安装、删除、重命名……),命名即文档;
3. **最后读 return 的 JSX**:纯粹是把上面的数据往第 7 章那棵组件树上挂。

看不懂某行就顺着 import 跳进对应组件——你现在已经有完整的能力读懂本项目渲染端的每一行了。

## 动手练习

1. **计数器**(经典热身):新建 `practice-counter.tsx`,做一个按钮,显示“点了 N 次”,点击 +1。只用 useState 和 onClick。
2. **秒表**:在 1 的基础上加 useEffect + `setInterval`,每秒让另一个数字 +1;再加一个“清零”按钮。记得 return 清理函数。
3. **可控输入**:做一个输入框 + 实时回显“你输入了:N 个字”(提示:`value.length`)。
4. **读代码**:打开 `mod-card.tsx`,回答:哪个 state 管展开?`useEffect` 在等什么?为什么最后要 `memo`?
5. 练习文件用完删除,App.tsx 里临时加的行还原。

## 自测

- state 和 props 的本质区别?为什么不能直接改 state?
- useEffect 的依赖数组三种写法各意味着什么?清理函数防什么?
- ref 和 state 都能“记住”,选哪个的判断标准是什么?
- 两个兄弟组件要共享数据,标准的解决模式叫什么?数据怎么流?
- `setMods([...prev, m])` 里 `[...prev, m]` 是什么操作?为什么不 `prev.push(m)`?

下一章:[第 9 章 · Tailwind CSS 4 与 shadcn/ui](09-tailwind-shadcn.md)
