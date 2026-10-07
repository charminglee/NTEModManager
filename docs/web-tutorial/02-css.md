# 第 2 章 · CSS:网页的外观

> 对照文件:`app/src/renderer/src/index.css`

## 2.1 CSS 是什么

CSS(Cascading Style Sheets,层叠样式表)回答一个问题:**页面上每个元素长什么样**——颜色、大小、位置、边框、阴影、动画,全部由它管。

CSS 的基本单元是**规则(rule)**,由**选择器 + 一组声明**构成:

```css
选择器 {
  属性: 值;
  属性: 值;
}
```

比如“让所有段落文字变红”:

```css
p {
  color: red;
}
```

## 2.2 三种“选中元素”的方式

CSS 最核心的问题是:**这条规则作用于谁?**

### ① 按标签名

```css
button {
  font-size: 14px;
}
```
选中页面上**所有** `<button>`。范围太大,实际项目很少单独用。

### ② 按类名(class)—— 最重要的方式

HTML 里给元素挂类名:`<button class="primary big">`,CSS 里用点号选中:

```css
.primary {
  background: #7c5cff;
}
.big {
  padding: 12px 24px;
}
```

一个元素可以挂多个类(空格分隔),一个类也可以被无数元素复用——这是 CSS 设计的精髓:**样式与结构解耦**。

### ③ 按 id

`<div id="root">` 对应 `#root { ... }`。id 在页面里必须唯一,所以只用于“全页面就这一个”的东西。

## 2.3 必须掌握的常用属性

先有个印象即可,后面写多了自然记住:

```css
.card {
  /* 尺寸与间距 */
  width: 300px;            /* 宽 */
  height: 64px;            /* 高 */
  padding: 16px;           /* 内边距:边框到内容的距离 */
  margin: 8px;             /* 外边距:与相邻元素的距离 */

  /* 外观 */
  background: rgba(30, 30, 40, 0.7);  /* 背景(支持半透明) */
  color: #f0f0f5;                     /* 文字颜色 */
  border-radius: 12px;                /* 圆角 */
  border: 1px solid #333;             /* 边框 */

  /* 文字 */
  font-size: 14px;         /* 字号 */
  font-weight: 600;        /* 字重(400 常规 / 600 半粗 / 700 粗) */

  /* 布局:让子元素排队 */
  display: flex;
  gap: 12px;               /* 子元素之间的间距 */
}
```

### 颜色的三种常见写法

```css
color: red;                            /* 预设名,项目里基本不用 */
color: #7c5cff;                        /* 十六进制 */
color: hsl(258 90% 66%);               /* 色相/饱和度/亮度 —— 本项目的主题色就用它 */
color: hsl(var(--primary) / 0.2);      /* 借助 CSS 变量 + 透明度,项目里到处都是 */
```

### 最重要的布局工具:flex(弹性盒)

现代界面布局九成靠 `display: flex`。它让容器**的子元素**沿一行(或一列)排列,并能控制对齐和伸缩。看 `mod-card.tsx` 卡片头部那一行的真实写法:

```tsx
<div className="relative flex items-center gap-3 px-4 py-3">
```

翻译成原生 CSS 就是:这个容器启用 flex 布局,子元素垂直居中(`items-center`),彼此间隔 12px(`gap-3`),容器自身左右内边距 16px、上下 12px。flex 详细规则在 [MDN 的 flexbox 指南](https://developer.mozilla.org/zh-CN/docs/Learn/CSS/CSS_layout/Flexbox) 里,先理解“它能让一排东西整齐排队并居中”就够往下学了。

## 2.4 CSS 变量:本项目的主题系统

CSS 允许定义变量,以 `--` 开头,用 `var()` 取用:

```css
:root {
  --primary: 258 90% 66%;   /* 主题紫色 */
}
.button {
  background: hsl(var(--primary));
}
```

最大的价值:**一处定义,全局引用**。想换主题色只改一行。

打开 `app/src/renderer/src/index.css` 的 `@layer base` 段(约 108 行起),你会看到整个项目的调色板就是这么定义的:

```css
:root {
  --background: 240 16% 5%;      /* 页面底色:近黑的深蓝 */
  --foreground: 240 10% 96%;     /* 前景文字:近白 */
  --primary: 258 90% 66%;        /* 主题紫色 */
  --radius: 16px;                /* 全局圆角 */
  ...
}
```

再往下看这些变量被 `@theme` 段映射成工具类可用的名字(`--color-primary: hsl(var(--primary))` 等),于是代码里就能写 `text-primary`、`bg-background` 这样的类名——这是第 9 章 Tailwind 的内容,这里只需记住因果链:

> **`:root` 里的变量(第 2 章)→ 被映射进主题(第 9 章)→ 变成界面上一片片颜色。**
> 顺带一提:设置界面里那个“全局圆角”滑杆,改的就是 `--radius` 这一个变量,全 UI 的圆角随之联动——CSS 变量威力的实证。

## 2.5 层叠:当多条规则撞车听谁的

CSS 的“C”就是 Cascade(层叠)。多条规则命中同一元素时,按优先级取胜:

1. **越具体越强**:`.card .title` 强于 `.title` 强于 `div`;
2. **同权重时,后写的赢**;
3. 内联 `style="..."` 属性最强,`!important` 是掀桌子的王炸(能不用就不用)。

工程上真正管理优先级的手段是 `@layer`。本项目 `index.css` 里所有规则都收在层里:

```css
@layer base {
  :root { --background: 240 16% 5%; /* ... */ }
}
```

层与层之间有明确的强弱顺序,避免“组件样式”和“基础样式”打架。现在记住“`@layer base` 里放全局基础样式”即可。

## 动手练习

1. 给第 1 章的 `hello.html` 加一个 `<style>` 块(放在 `<head>` 里),把 `h1` 改成紫色、`button` 加圆角和内边距:

   ```html
   <style>
     h1 { color: hsl(258 90% 66%); }
     button {
       padding: 8px 16px;
       border-radius: 8px;
       border: none;
       background: hsl(258 90% 66%);
       color: white;
     }
   </style>
   ```
2. 在浏览器 F12 的 Elements 面板选中某个元素,在右侧 Styles 面板里勾选/取消它的样式,直观感受“层叠”。
3. 打开本项目,在 `index.css` 的 `:root` 里把 `--primary: 258 90% 66%` 改成 `--primary: 160 84% 39%`(绿色),保存,观察浏览器热更新后整个应用从紫变绿。改完记得还原。

## 自测

- 类选择器和 id 选择器写法上、语义上有什么区别?
- `padding` 和 `margin` 分别是哪两个边界之间的距离?
- CSS 变量怎么定义、怎么取用?本项目哪个设置项是靠它实现“一处改、全局变”的?
- 两条规则冲突时,一般谁赢?

下一章:[第 3 章 · JavaScript:让网页活起来](03-javascript.md)
