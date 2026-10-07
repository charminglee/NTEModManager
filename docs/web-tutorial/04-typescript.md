# 第 4 章 · TypeScript:给 JavaScript 加上类型护栏

> 对照文件:`app/src/shared/types.ts`

## 4.1 为什么需要 TS

JavaScript 是“动态类型”语言:一个变量一会儿装字符串、一会儿装数字,完全合法,直到某天你在运行时才发现 `mod.nmae` 拼错了——返回 `undefined`,界面默默坏掉,没有一句提示。

**TypeScript = JavaScript + 类型系统。** 你写的仍是 JS,只是额外标注了“这个变量应该是什么”;于是:

1. **写错立刻被揪出**:VS Code 里拼错属性名直接红色波浪线,根本跑不起来;
2. **自动补全变神**:输入 `mod.` 编辑器立刻列出所有可用字段和注释;
3. **重构不心虚**:改一个类型定义,所有不兼容的地方全部标红。

TS 不能在浏览器里直接运行——构建工具(第 6 章 Vite)会先把它**编译**成纯 JS。类型标注只是开发时的护栏,不会拖慢最终程序。

项目里**所有** `.ts` / `.tsx` 文件都是 TypeScript。读本项目代码,80% 的类型知识来自下面四节。

## 4.2 基础标注:给变量和函数贴标签

在第 3 章 `formatFileSize` 里你已经见过它们了:

```ts
function formatFileSize(byteCount: number): string {
  // 参数 byteCount 是 number;函数返回 string
}

let expanded = false              // TS 自动推断为 boolean,不必手写
const sizeBytes: number = 123     // 显式标注(能推断时通常省略)
```

经验法则:**TS 的推断很强,能不写就不写;但函数的参数和返回值,项目规范是写明**——它们是函数的“合同”。

## 4.3 interface:描述一个对象的形状

打开 `app/src/shared/types.ts`,第一个重要定义:

```ts
export interface ModInfo {
  name: string
  sourcePath: string
  sizeBytes: number
  files: ModFileEntry[]
  /** ISO 8601(本地时间) */
  importedAt: string
  installed: boolean
  invalid: boolean
}
```

读法:“一个模组信息对象,必须长这样:名字是字符串、大小是数字、文件列表是 ModFileEntry 数组……”。`/** */` 是文档注释,会悬浮显示在编辑器里——项目里的注释质量很高,读代码时多把鼠标悬上去。

interface 只存在于编译期,**编译后消失**,不产生任何运行时代价。

### 字段后加 `?`:可有可无

```ts
export interface OperationResult {
  success: boolean
  message: string
  cancelled?: boolean     // 问号:这个字段可以不存在
}
```

取用可空字段时 TS 会强制你先判空——这正是护栏在起作用。

### 联合类型:二选一或多选一

```ts
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'
```

读法:LogLevel 类型的值只能是这四个字符串之一。写 `logLevel = 'warn'`(拼错)立刻报错。同理,`App.tsx` 里的

```ts
const [view, setView] = useState<'mods' | 'logs'>('mods')
```

保证界面视图只能在“模组列表”和“日志”两态间切换。

### 什么时候用 interface,什么时候用 type?

描述对象形状两者皆可,本项目惯例:对象用 `interface`,别名/联合用 `type`。照抄即可,不必纠结。

## 4.4 泛型:类型的“函数”

第一次见泛型都会懵,用一个最常遇到的例子讲透。`useState` 是 React 存状态的函数,我们希望它“装什么类型的值,取出来就是什么类型”:

```ts
const [config, setConfig] = useState<AppConfigData | null>(null)
//            ↑ 泛型参数:<...> 像给容器贴标签:这个容器装 AppConfigData 或 null
```

之后无论 `config` 被传到哪里,TS 都知道“它可能是 AppConfigData,也可能还没加载(null)”,任何在判空之前就读 `config.gameDirectory` 的代码都会被标红。**泛型 = 类型的参数**,让同一个容器/函数能安全地装不同类型。

## 4.5 枚举:给魔法数字起名字

项目 `types.ts` 里有个“排序方式”:

```ts
export enum SortOrder {
  InstalledFirst = 0,      // 默认:已安装优先
  NameAscending = 1,       // 名称 A→Z
  NameDescending = 2,
  ImportedNewestFirst = 3,
  ...
}
```

没有枚举的话代码里会散落 `if (order === 3)`,没人记得 3 是什么;有了枚举,`SortOrder.ImportedNewestFirst` 自带文档、改错即报错。这种“底层是数字、面上是名字”的设计让排序方式在配置文件里存的是稳定数字(见该文件上方注释)——真实项目里配置格式一旦发布就要长期稳定,是常态。

## 4.6 shared 目录:一份合同管两个世界

现在回答一个架构问题:`src/shared/` 为什么单独存在?

回忆项目地图:这个应用有两个隔离的代码世界——浏览器侧的 `renderer`(界面)和 Node.js 侧的 `main`(读写磁盘、扫模组)。它们之间通过消息通信(第 10 章细讲)。消息的两端必须对数据格式达成一致:主进程发来的“模组列表”里有哪些字段?渲染端能用哪些?

答案就是 `shared/types.ts` 里的 `ModInfo` 等定义——**两端 import 同一份类型文件,合同单点维护**。主进程少给一个字段、渲染端读错一个名字,编译期当场报错。这是“类型护栏”在架构层面的应用,也是 TS 项目最常见的设计模式之一。

## 4.7 怎么验证类型没错

项目 `package.json` 里预置了命令:

```bash
npm run typecheck
```

它调用 TS 编译器做纯检查(`tsc --noEmit`:只查类型、不产出文件)。**提交代码前跑一遍是本项目的规矩**,第 11 章实战会用到。

## 动手练习

1. 打开 `shared/types.ts` 找到 `ModFileEntry`,注意它的 `children` 字段类型是 `ModFileEntry[]`——**接口在自己的定义里引用了自己**(递归类型)。想想为什么合理:文件夹里可以有子文件夹,子文件夹里还可以有。
2. 改坏实验:在 `App.tsx` 里把某处 `setSearch(search)` 临时改成 `setSearch(123)`,保存,观察编辑器红线和终端报错;读懂报错后改回来。**主动制造一次类型错误并读懂它,是学 TS 最快的路径。**
3. 运行 `npm run typecheck`,确认项目当前是绿的。

## 自测

- TS 编译后类型信息去哪了?会影响运行速度吗?
- `interface` 里 `name?: string` 和 `name: string` 的区别?
- `'mods' | 'logs'` 这种联合类型防住了什么错误?
- 为什么 `shared/types.ts` 要放在 main 和 renderer 都能引用的公共位置?

下一章:[第 5 章 · Node.js 与 npm](05-node-npm.md)
