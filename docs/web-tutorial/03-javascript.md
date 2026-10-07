# 第 3 章 · JavaScript:让网页活起来

> 对照文件:`app/src/renderer/src/lib/format.ts`(本教程最友好的真实教材,全文 32 行)

## 3.1 JS 在哪里运行

JavaScript 是一门编程语言,主要有两种运行环境:

1. **浏览器**:操作网页(DOM)、响应用户操作、发网络请求;
2. **Node.js**:脱离浏览器,在操作系统里跑(能读写文件、起服务器)——第 5 章详讲。

同一门语言,两个舞台。本项目的界面逻辑跑在浏览器(Electron 内嵌 Chromium)里,扫描磁盘上的模组文件夹则跑在 Node.js 里。

## 3.2 变量与常量

```js
let count = 10        // 变量:可以重新赋值
count = 20            // OK

const name = 'NTE'    // 常量:赋值后不可重新赋值
name = 'other'        // ❌ 报错
```

**行业规范:默认一律用 `const`,只有确实需要重新赋值时才用 `let`。** 项目里你几乎见不到 `var`(老式声明,有坑,已被淘汰)。

## 3.3 数据类型

```js
// 基础类型
const n = 1024                  // 数字(不区分整数浮点)
const s = '模组名'               // 字符串,单双引号皆可,习惯单引号
const ok = true                 // 布尔
const nothing = null            // "刻意为空"
let x                            // 未赋值时是 undefined

// 两个核心复合类型
const mod = {                   // 对象:键值对的集合,像一张登记表
  name: '风灵月影',
  sizeBytes: 52428800,
  installed: true
}
mod.name                        // 取值:'风灵月影'(点号)
mod['sizeBytes']                // 也可以方括号取值

const mods = [mod1, mod2, mod3] // 数组:有序列表
mods.length                     // 元素个数
mods[0]                         // 第一个元素(从 0 数起)
```

## 3.4 函数:打包一段可复用的逻辑

打开 `lib/format.ts`,看第一个函数:

```js
export function formatFileSize(byteCount: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = byteCount
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const precision = unitIndex === 0 ? 0 : size < 10 ? 1 : 0
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}
```

忽略 `: number`、`: string` 这些类型标注(第 4 章讲)和开头的 `export`,这是一个非常典型的函数,值得逐行吃透:

- `function formatFileSize(...)` **定义**了一个名叫 `formatFileSize` 的函数;括号里是**参数**(进去的原料)。
- `units` 是一个**数组字面量**;`mod` 那样的对象字面量同理。
- `while` 循环:字节数每除以一次 1024 就升一档单位,直到小于 1024。这就是“52428800 → 50 MB”的全部秘密。
- `const precision = A ? B : C` 是**三元表达式**:`A` 为真取 `B` 否则取 `C`。连续的三元是嵌套的,等价于 if/else 链。
- 最后的 `` `${……}` `` 是**模板字符串**:反引号包裹,`${}` 里可以填任何表达式,结果拼进字符串。
- `return` 把结果交还给调用者。

**调用**它:`formatFileSize(52428800)` 返回 `'50 MB'`。模组卡片上“128.5 MB · 导入于 2026-10-01 12:30”那行小字,前半截就出自它,后半截出自同文件的 `formatImportedAt`。

### 箭头函数:现代 JS 的日常写法

```js
// 这两种写法完全等价:
function double(x) { return x * 2 }
const double = (x) => x * 2     // 箭头函数:更短;函数体只有一句时可省略 return 和花括号
```

项目里箭头函数随处可见,比如 `mod-card.tsx` 里的 `onClick={() => setExpanded(...)}` ——“点击时,执行 setExpanded(……)”。**看到 `() =>` 就读作“一个函数”**。

## 3.5 数组的三个神器:map / filter / find

React 世界每天打交道的三件套:

```js
const mods = [
  { name: 'A', installed: true },
  { name: 'B', installed: false },
  { name: 'C', installed: true }
]

// map:每个元素加工一遍,返回新数组(长度不变)
mods.map((m) => m.name)                    // → ['A', 'B', 'C']

// filter:按条件筛选,返回新数组
mods.filter((m) => m.installed)            // → [A, C]

// find:返回第一个满足条件的元素,找不到返回 undefined
mods.find((m) => m.name === 'B')           // → { name: 'B', installed: false }
```

它们都接收一个**函数**作为参数(“对每个元素做什么”)。这就是第 7 章 React 渲染模组列表的核心手段:`mods.map((m) => <ModCard mod={m} />)`。

## 3.6 异步:Promise 与 await

读写文件、网络请求这类操作需要时间,JS 的处理方式是**先承诺(Promise)后兑现**:

```js
// scanMods() 立刻返回一个 Promise 对象 —— 一张"取货凭证"
// 函数前面的 await 意思是:在这行等结果落地,再继续往下走
const mods = await window.api.scanMods()
setMods(mods)
```

要点:

- `await` 只能写在 `async` 标记的函数里(项目里的 `refreshMods` 就标着 `async`);
- await 期间**不会卡死界面**,JS 会先去干别的(这就是所谓“异步不阻塞”);
- `Promise` 还有失败态,配 `try { ... } catch (err) { ... }` 捕获。

不需要更深了。现在能读懂“`await 某函数()` = 等它完成并拿返回值”即可,第 8、10 章会反复见到。

## 3.7 事件:网页如何响应操作

浏览器里 JS 与用户交互的基本模型是**事件监听**:“当 X 发生时,执行函数 Y”。

原生写法(了解即可,React 会包一层):

```js
button.addEventListener('click', () => {
  alert('被点了!')
})
```

React 里的等价物(先混个脸熟,第 7 章正式讲):

```tsx
<button onClick={() => setExpanded((value) => !value)}>
```

本项目里你能找到的事件:点击(`onClick`,卡片、按钮)、拖放(`onDragOver`/`onDrop`,把压缩包拖进窗口即导入)、键盘(`onKeyDown`)。它们全是同一个模型。

## 3.8 模块:现代 JS 的组织单位

代码多了必须分文件。JS 用 `import` / `export` 组织:

```ts
// format.ts 里:
export function formatFileSize(...) { ... }   // export = 对外公开

// mod-card.tsx 里:
import { formatFileSize } from '@/lib/format' // import = 从别处拿来用
```

两点须知:

- `@/lib/format` 里的 `@` 是项目配置的**路径别名**(指代 `src/renderer/src`,见 `web.vite.config.ts` 的 `alias` 段),让 import 语句不必写一长串 `../../..`;
- 一个文件**默认导出**的东西用 `import X from '...'` 引入(如每个组件文件末尾的 `export default`),**具名导出**用 `import { X } from '...'`。本项目两种都在用。

## 动手练习

1. 打开浏览器 F12 的 **Console(控制台)**面板,把它当计算器和试验场,逐行输入并观察:

   ```js
   const units = ['B', 'KB', 'MB', 'GB']
   units.length
   units[2]
   `大小是 ${1024 * 5} 字节`
   [1, 2, 3, 4].map((x) => x * 10)
   [1, 2, 3, 4].filter((x) => x > 2)
   ```
2. 在控制台里把 `formatFileSize` 的逻辑重写一遍(抄上面 3.4 的代码,去掉 `: number`/`: string` 和 `export`),然后调用 `formatFileSize(1048576)` 验证输出 `1.0 MB`。
3. 打开 `lib/format.ts` 里的 `formatImportedAt`,逐行读懂它:入参是什么格式?`pad` 那个内嵌小函数干了什么?为什么月份要 `+1`?(提示:JS 的 `getMonth()` 返回 0~11)

## 自测

- `const` 和 `let` 怎么选?为什么项目里几乎不用 `var`?
- `map`、`filter`、`find` 各返回什么?
- `await` 在等什么?等的时候界面会卡住吗?
- `` `共 ${n} 个模组` `` 这是什么语法?和 `'共 ' + n + ' 个模组'` 有何不同?
- `import { a } from 'x'` 和 `import a from 'x'` 的区别?

下一章:[第 4 章 · TypeScript:给 JS 加上类型护栏](04-typescript.md)
