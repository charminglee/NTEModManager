# 第 1 章 · Web 是如何工作的 & HTML 入门

> 对照文件:`app/src/renderer/index.html`

## 1.1 浏览器到底在干什么

你在浏览器里看到的每一个网页,本质上都是浏览器**下载了几个文本文件,然后把它们“画”出来**。这三个核心文本文件是:

| 文件 | 语言 | 职责 | 类比 |
|---|---|---|---|
| `.html` | HTML | 描述页面**有什么内容、什么结构** | 房子的承重墙和房间格局 |
| `.css` | CSS | 描述内容**长什么样子** | 装修:墙漆、地板、家具风格 |
| `.js` | JavaScript | 描述内容**如何行为、如何响应操作** | 电路:开关灯、电梯、门铃 |

当你在地址栏输入网址回车后:

1. 浏览器向服务器发送一个请求(“把这个网址的内容给我”);
2. 服务器返回一个 HTML 文件;
3. 浏览器**逐行解析** HTML,遇到 `<link>` 就去下载 CSS,遇到 `<script>` 就去下载 JS;
4. 浏览器把 HTML 解析成一棵树(称为 **DOM**,Document Object Model),再根据 CSS 把每个节点画到屏幕上,根据 JS 让它响应点击、输入等事件。

> **本项目的特别之处**:NTE 模组管理器最终是一个桌面应用,但它的界面就是一个网页——由 Electron 这个“壳”内嵌的浏览器(Chromium)渲染。所以在第 10 章之前,你学的一切都是纯 Web 知识,完全通用。

## 1.2 打开项目里的第一个 HTML

用 VS Code 打开 `app/src/renderer/index.html`,全文只有 16 行:

```html
<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' media: blob: data:; font-src 'self' data:; connect-src 'self'"
    />
    <title>NTE 模组管理器</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

就这么短的文件,却是整个应用的起点。逐行拆解:

### `<!doctype html>`
声明“这是一份现代 HTML5 文档”。固定写法,必须是第一行。

### `<html lang="zh-CN" class="dark">`
整个页面的根元素。两个知识点:

- `lang="zh-CN"` 告诉浏览器和搜索引擎“页面内容是简体中文”(影响翻译提示、朗读发音);
- `class="dark"` 是一个 CSS 类名。本项目是深色主题,就是在根元素上挂了 `dark` 类,让所有深色样式生效——第 2 章讲 CSS 类时会回来对照。

### `<head>`:给浏览器看的“元信息”,不显示在页面上

- `<meta charset="UTF-8" />`:字符编码。没有它,中文可能显示成乱码。**每个项目都必须有**。
- `<meta name="viewport" ...>`:移动端适配声明,规定页面宽度跟随设备宽度。桌面项目也习惯性带上。
- `<meta http-equiv="Content-Security-Policy" ...>`:**安全策略**,内容较多,现在只需知道它的作用——限制页面只能加载哪些来源的资源(脚本只能来自自己、图片可以来自 `media:` 协议等),防止被注入恶意脚本。Electron 官方强烈建议桌面应用的界面加上它,第 10 章会再提到。
- `<title>NTE 模组管理器</title>`:显示在浏览器标签页上的标题。

### `<body>`:页面上真正显示的内容

关键只有两行:

```html
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```

第一行是一个**空的** `<div>`,只有一个 `id="root"` 作为门牌号。

第二行加载了一个脚本。注意它的路径指向的是 `.tsx` 而不是 `.js`——这在纯 HTML 时代不可能,因为浏览器不认识 `.tsx`。这正是现代开发工具链(第 6 章的 Vite)的魔法:**开发时 Vite 会在幕后把 TypeScript/JSX 实时翻译成浏览器能懂的 JavaScript**。

`<div id="root">` 为什么是空的?因为第 7 章的 React 会接管一切:**JavaScript 代码会动态地把整个界面“塞进”这个 div 里**。现代前端应用的 HTML 往往就这么一个空壳,界面全部由 JS 生成——这种应用叫 **SPA(Single-Page Application,单页应用)**。

## 1.3 HTML 核心概念:标签、属性、嵌套

不依赖任何工具,你现在就可以体验 HTML。在桌面新建 `hello.html`,写入:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>我的第一个网页</title>
  </head>
  <body>
    <h1>你好,Web 世界</h1>
    <p>这是一个段落。</p>
    <button>点我</button>
  </body>
</html>
```

双击文件用浏览器打开,你会看到一个大标题、一段文字和一个按钮。**你刚刚写出了网页的三件套之一。**

### 语法规则(就这么多)

1. **标签(tag)**:尖括号包裹的关键字,如 `<h1>`、`<p>`。大多数成对出现:`<p>内容</p>`,斜杠表示结束。
2. **自闭合标签**:没有内容的标签可以写成 `<meta ... />`(如 meta、img、br)。
3. **属性(attribute)**:标签上的额外信息,写在开始标签里,格式为 `名字="值"`。例如 `<html lang="zh-CN">` 里的 `lang`,以及最常见的 `class` 和 `id`。
4. **嵌套**:标签里可以套标签,像俄罗斯套娃。**必须正确闭合、不许交叉**,例如 `<p><b>粗体</b></p>` 合法,`<p><b>粗体</p></b>` 非法。
5. **缩进**:HTML 不在乎缩进,但每嵌套一层缩进一格(2 空格)是全行业的强制习惯,本项目所有文件都严格遵守。

### 常用标签速查(本项目用到的)

| 标签 | 用途 | 项目里的例子 |
|---|---|---|
| `div` | 通用容器,划区布局 | `index.html` 的 `#root` |
| `span` | 行内小容器,包裹一段文字 | `fps-counter.tsx` 的整个返回值 |
| `button` | 按钮 | `mod-card.tsx` 里的安装按钮 |
| `input` | 输入框 | 搜索框、重命名框 |
| `h1`~`h6` / `p` | 标题与段落 | 弹窗里的标题与说明 |
| `ul` / `li` | 列表 | 下拉菜单本质就是列表的变体 |

看一眼 `app/src/renderer/src/components/fps-counter.tsx` 的返回部分(现在看不懂 import 没关系,那是 JS,第 3 章讲):

```tsx
return (
  <span className="shrink-0 tabular-nums">
    {fps} FPS
  </span>
)
```

这就是一个 `span` 标签,带一个 `className` 属性(注意:React 里写 `className` 而不是 HTML 的 `class`,因为 `class` 在 JS 里是保留字)。`{fps}` 是“把 JS 变量的值填进这里”的语法,第 7 章展开。

## 1.4 DOM:浏览器眼里的页面

浏览器解析 HTML 后,会在内存里构建一棵**树**,每个标签是一个节点。上面 hello.html 的树长这样:

```
document
└─ html
   ├─ head
   │  ├─ meta
   │  └─ title → "我的第一个网页"
   └─ body
      ├─ h1 → "你好,Web 世界"
      ├─ p → "这是一个段落。"
      └─ button → "点我"
```

这棵树叫 **DOM**。之所以重要,是因为 JavaScript 操作网页,本质就是**增删改这棵树上的节点**。你可以在浏览器里亲眼看到它:打开任意网页按 `F12`,`Elements`(元素)面板展示的就是 live 的 DOM。

## 动手练习

1. 写出你的 `hello.html`,要求:标题是你的名字,含一个段落和一个按钮;把 `class="dark"` 加到 `<html>` 上(暂时看不出变化,正常,还没有 CSS)。
2. 用 F12 打开**本项目管理器**(先 `npm run dev`)的页面,在 Elements 面板里找到 `<div id="root">`,展开它——你会看到成百上千个节点,全部由 React 生成,而 `index.html` 里它是空的。
3. 在 F12 的 Elements 面板里,双击某个节点文字直接改掉它,观察页面即时变化。这就是“JS 改 DOM”能达成效果的图形化版本。

## 自测

- HTML、CSS、JS 各自负责什么?
- `index.html` 里 `#root` 那个 div 为什么是空的?
- 标签的“属性”是什么?举出两个本项目出现过的属性。
- 什么是 DOM?为什么它重要?

下一章:[第 2 章 · CSS:网页的外观](02-css.md)
