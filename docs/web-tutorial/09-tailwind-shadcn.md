# 第 9 章 · Tailwind CSS 4 与 shadcn/ui

> 对照文件:`src/renderer/src/index.css`(Tailwind 4 配置与主题)、`src/renderer/src/components/ui/button.tsx`(shadcn 组件)、`src/renderer/src/lib/utils.ts`(cn 函数)

## 9.1 Tailwind:把 CSS 搬进 className

**Tailwind CSS** 是“原子化 CSS”框架:它不让你写 `.card { ... }` 规则,而是提供海量超小工具类,直接在元素的 class 里拼装样式:

```tsx
<div className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
```

每个类只干一件小事:`flex`=弹性布局、`items-center`=垂直居中、`gap-3`=子元素间距 12px、`px-4 py-3`=内边距 16/12px、`text-sm`=小号字、`text-muted-foreground`=主题里的“次要文字色”。

对比第 2 章的传统写法,优劣一眼见:

| | 传统 CSS | Tailwind |
|---|---|---|
| 心智 | 起名、找文件、防冲突 | 就地拼装,所见即所得 |
| 改样式 | 跳到 CSS 文件找规则 | 当场改 className |
| 删元素 | CSS 可能留孤儿 | 类名随元素一起消失 |
| 门槛 | 要懂 CSS 体系 | 还是要懂 CSS 概念,只是换了个写法 |

最后一行是关键:**Tailwind 不会让你免学 CSS**——第 2 章的盒模型、flex、颜色、层叠,一个都少不了;它只是把“写规则”变成“挑词”。

## 9.2 Tailwind 4 在本项目怎么配置

Tailwind 4 的配置方式:CSS 文件即配置。本项目全部配置就在 `index.css` 开头几行:

```css
@import "tailwindcss";        /* 引入 Tailwind 本体(4.0 起不再需要 tailwind.config.js) */
@import "tw-animate-css";     /* 动画工具类补充包 */

@theme inline {
  --color-primary: hsl(var(--primary));   /* 主题映射:工具类 text-primary 从哪取色 */
  --color-card: hsl(var(--card));
  --radius-lg: var(--radius);             /* 圆角刻度:全部指向全局 --radius */
  ...
}
```

第 2 章埋的线头在这里收口:

> `:root` 里的 CSS 变量(`--primary: 258 90% 66%`)→ `@theme` 映射成 Tailwind 主题色(`--color-primary`)→ 生成工具类 `text-primary` / `bg-primary` / `border-primary`。

于是整个链路变成:**设置界面改 `--radius` → 全 UI 圆角联动;改 `--primary` → 全 UI 主题色联动**。这套“变量单点派生”的设计就是这个项目换肤、改圆角滑杆能即时生效的原理。

Vite 那边的配合只有一处:`electron.vite.config.ts` renderer 段的 `plugins: [react(), tailwindcss()]`——`tailwindcss()` 插件让 Vite 扫描所有源码里出现的类名、现场生成对应 CSS。

## 9.3 工具类速读:能看懂本项目每一行 className

本项目 className 密度很高,拿真句子练. 逐个词拆 `mod-card.tsx` 的安装按钮:

```tsx
'group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3.5 text-xs
 font-semibold transition-all duration-150 active:scale-95 ...'
```

| 类 | 意思 |
|---|---|
| `group` | 给自己挂牌“我是 group”,子孙可用 `group-hover:` 响应我的悬停 |
| `relative` | `position: relative`,作子元素定位的参照系 |
| `flex items-center gap-1.5` | 弹性布局、垂直居中、子项间距 6px |
| `h-8 shrink-0 px-3.5` | 高 32px、flex 收缩时不许变窄、左右内边距 14px |
| `rounded-md` | 圆角 = 主题 `--radius`(被 @theme 重定向了) |
| `text-xs font-semibold` | 12px 字号、半粗字重 |
| `transition-all duration-150` | 一切属性变化加 150ms 过渡 |
| `active:scale-95` | **被按下时**缩到 95%(前缀=伪类/状态修饰) |

### 状态前缀与响应式前缀

```tsx
disabled:pointer-events-none disabled:opacity-100   // 禁用时:不响应鼠标
hover:bg-secondary                                  // 悬停时:换底色
group-disabled:opacity-50                           // 祖先 group 被禁用时:内容淡出
dark:text-amber-400                                 // 深色模式下:换琥珀色
```

前缀就是第 2 章“选择器越具体越强”的工程化包装:`hover:bg-x` 编译后即 `.x:hover`。

### 任意值与透明度修饰

```tsx
h-4 w-4                    // 16px(数字 × 4px 是尺寸刻度)
text-[15px]                // 方括号=任意值:刻度表里没有的 15px
grid-rows-[1fr]            // 任意 grid 行高(卡片展开动画用)
bg-primary/80              // 主题色 + 80% 不透明度
border-foreground/[0.08]   // 8% 不透明度的描边
```

### cn():条件拼类名的标配

类名经常需要“基础 + 条件附加”:

```tsx
className={cn(
  'h-4 w-4 shrink-0 transition-transform duration-200',
  !expanded && '-rotate-90'      // 收起时逆时针转 90°(箭头朝右)
)}
```

`cn` 定义在 `lib/utils.ts`,全文 6 行:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

两个包各司其职:`clsx` 把各种输入(字符串、false、undefined、条件表达式)拼成一条;`twMerge` 解决“后者覆盖前者”——同时出现 `px-4 px-2` 时保留后者,否则 Tailwind 里两个都生效、谁赢看运气。**项目里所有动态类名一律走 `cn()`**,这也解释了为什么每个组件都 import 它。

## 9.4 shadcn/ui:不是组件库,是“源码自提柜”

传统 UI 库(如 antd)是 `npm install` 后引包,样式藏在黑盒里,定制要靠它的配置项往外抠。**shadcn/ui 走了相反的路:运行 `npx shadcn add button`,它把按钮组件的完整源码直接复制进你的项目**(`components/ui/button.tsx`),从 此归你所有,想怎么改就怎么改。

本项目的 `components/ui/` 目录就是这样一个“自提柜”,存放着 button、dialog、dropdown-menu、select、switch、slider、tooltip 等十余个基础件。它们共同的模式值得掌握:

### 模式一:cva 管理变体

打开 `ui/button.tsx` 看 `buttonVariants`:

```tsx
const buttonVariants = cva(
  'inline-flex items-center ... active:scale-[0.98]',   // 所有变体共有的基础类
  {
    variants: {
      variant: {
        default:   'bg-primary/80 text-primary-foreground ...',   // 主按钮:实底紫
        destructive:'bg-destructive/80 ...',                       // 危险操作:红
        outline:   'border border-border bg-transparent ...',      // 描边按钮
        ghost:     'hover:bg-secondary/60 ...',                    // 幽灵:无底色
        glass:     'text-foreground',                              // 本项目自定义的玻璃按钮
        link:      'text-primary underline-offset-4 hover:underline'
      },
      size: { default: 'h-9 px-4 py-2', sm: 'h-8 ...', lg: 'h-10 ...', icon: 'h-9 w-9' }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)
```

**cva(class-variance-authority)把“一个组件的多种外观”组织成查表**:使用处一句 `<Button variant="ghost" size="icon" />`,不需要自己拼类名。这是管理 UI 变体的标准模式,你以后会在各种项目里反复见到。

### 模式二:Radix 管行为,shadcn 管皮肤

`ui/` 里的组件全部 import 自 `@radix-ui/react-*` 包。**Radix 是“无头组件”(headless)**:它把弹层定位、焦点管理、键盘导航(Esc 关弹窗、方向键切选项)、ARIA 无障碍属性这些**最难写对的行为**全包了,但不渲染任何像素;shadcn 在它外面套上带 Tailwind 类的壳。本项目下拉菜单的用法:

```tsx
<DropdownMenu>                          {/* Radix:管开合、管焦点 */}
  <DropdownMenuTrigger asChild>        {/* 触发器,asChild=不额外包一层元素,直接修饰子元素 */}
    <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-48">
    <DropdownMenuItem onClick={() => actions.onRename(mod)}>
      <Pencil /> 重命名...
    </DropdownMenuItem>
    ...
    <DropdownMenuItem destructive onClick={() => actions.onDelete(mod)}>
      <Trash2 /> 删除
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

对照第 7 章的组件树:**Radix 提供骨架与大脑,shadcn/ui 提供皮肤,你的业务组件再把它们组装进界面**。分层清晰,各改各的。

### 模式三:forwardRef 与 asChild(看懂即可)

`ui/button.tsx` 里有两个 shadcn 全家桶的固定动作:

- `React.forwardRef(...)`:让父组件能拿到底层真实 DOM 的 ref——`mod-card.tsx` 里 `useRef` + `ref` 传给组件就是这么接上的;
- `asChild` 属性(基于 `@radix-ui/react-slot`):`<DropdownMenuTrigger asChild><Button/></DropdownMenuTrigger>` 表示“别给我额外包一层 div,把触发行为直接注入 Button”。好处是 DOM 结构干净、样式不串位。

初学不必会写,见到不慌即可。

## 9.5 图标:lucide-react

项目里所有图标(`ChevronDown`、`Trash2`、`Package`……)来自 `lucide-react`,本质是几千个现成的 SVG 组件:

```tsx
import { Trash2 } from 'lucide-react'
<Trash2 className="h-4 w-4" />     {/* 图标=普通组件,用 Tailwind 定尺寸 */}
```

## 动手练习

1. 打开本项目,`npm run dev` 后在 `index.css` 里实验(改完还原):
   - 把 `--radius` 改成 `4px`,观察全 UI 变“方”;再改成 `32px`,变“果冻”。
   - 把 `--primary` 换个色相,观察全应用换肤。
2. **改造 hello 组件**(第 7 章练过):用纯 Tailwind 重写,不许写一行 CSS:

   ```tsx
   export default function Hello() {
     return (
       <div className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
         <span className="text-primary font-semibold">你好 Tailwind!</span>
         <span className="ml-2 text-xs text-muted-foreground hover:text-foreground">
           悬停试试
         </span>
       </div>
     )
   }
   ```
3. 在 F12 里检查你写的元素,点开其 class 列表,再在 Styles 面板找到 Tailwind 为 `rounded-lg` 生成的真实 CSS 规则——把“工具类”和“编译产物”对上号。
4. 练完删除,项目还原。

## 自测

- Tailwind 和传统 CSS 各自的工作流是什么?它取代了第 2 章的哪些知识、没取代哪些?
- 从设置里改“全局圆角”到界面生效,中间经过哪条变量链?
- `cn()` 解决哪两个问题?为什么动态类名必须用它而不是字符串模板?
- shadcn/ui 和传统 npm 组件库的本质区别?
- Radix 在 `ui/` 组件里承担哪半边工作?

下一章:[第 10 章 · Electron:把网页变成桌面应用](10-electron.md)
