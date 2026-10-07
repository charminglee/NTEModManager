import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

/**
 * 把 docs/web-tutorial/*.md 编译成单文件静态站点 site/index.html。
 * 视觉体系复用 app/src/renderer/src/index.css 的设计令牌(深浅色跟随系统),
 * 代码块始终深色(编辑器观感),自带轻量语法高亮(零运行时依赖)。
 * 运行:npm run docs:tutorial
 */

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../..')
const docsDir = join(repoRoot, 'docs/web-tutorial')
const outFile = join(docsDir, 'site', 'index.html')

// ---------------------------------------------------------------- 高亮器

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escHtml = (s) => s.replace(/[&<>]/g, (c) => ESC_MAP[c])
const span = (cls, text) => `<span class="tok-${cls}">${escHtml(text)}</span>`

const KEYWORDS = new Set(
  ('const let var function return if else for while do switch case break continue new delete typeof ' +
    'instanceof in of class extends implements interface type enum import export from as async await ' +
    'yield try catch finally throw this super static public private protected readonly keyof void ' +
    'null undefined true false default declare namespace abstract get set is ' +
    'string number boolean any unknown never object symbol bigint').split(' ')
)

// 注释 | 字符串 | 数字 | 标识符(关键字/大写开头类型再细分)
const CLIKE_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b0[xX][\da-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g

function hlClike(code) {
  let out = ''
  let last = 0
  for (const m of code.matchAll(CLIKE_RE)) {
    out += escHtml(code.slice(last, m.index))
    if (m[1]) out += span('c', m[1])
    else if (m[2]) out += span('s', m[2])
    else if (m[3]) out += span('n', m[3])
    else if (KEYWORDS.has(m[4])) out += span('k', m[4])
    else if (/^[A-Z]/.test(m[4])) out += span('t', m[4])
    else out += escHtml(m[4])
    last = m.index + m[0].length
  }
  return out + escHtml(code.slice(last))
}

// HTML:先切出注释/整段标签,标签内部再分:标签名 | 属性字符串 | 属性名 | 结束符
function hlTag(tag) {
  const RE = /(<\/?)([a-zA-Z][\w-]*)|("[^"]*"|'[^']*')|([a-zA-Z-]+)(?==)|(\/?>)/g
  let out = ''
  let last = 0
  for (const m of tag.matchAll(RE)) {
    out += escHtml(tag.slice(last, m.index))
    if (m[1] !== undefined) out += escHtml(m[1]) + span('t', m[2])
    else if (m[3] !== undefined) out += span('s', m[3])
    else if (m[4] !== undefined) out += span('a', m[4])
    else out += escHtml(m[5])
    last = m.index + m[0].length
  }
  return out + escHtml(tag.slice(last))
}

function hlHtmlLang(code) {
  const RE = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][^<>]*>)|(<[!?][^<>]*>)/g
  let out = ''
  let last = 0
  for (const m of code.matchAll(RE)) {
    out += escHtml(code.slice(last, m.index))
    if (m[1] !== undefined) out += span('c', m[1])
    else if (m[2] !== undefined) out += hlTag(m[2])
    else out += span('k', m[3])
    last = m.index + m[0].length
  }
  return out + escHtml(code.slice(last))
}

// CSS:注释 | 字符串 | @规则 | 自定义属性 | 十六进制色 | 数字(含单位) | 函数名
const CSS_RE =
  /(\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(@[\w-]+)|(--[\w-]+)|(#[\da-fA-F]{3,8}\b)|(-?\b\d[\d.]*(?:px|rem|em|%|s|ms|deg|fr|vw|vh|dppx)?\b)|([a-zA-Z-]+(?=\())/g

function hlCss(code) {
  let out = ''
  let last = 0
  for (const m of code.matchAll(CSS_RE)) {
    out += escHtml(code.slice(last, m.index))
    if (m[1] !== undefined) out += span('c', m[1])
    else if (m[2] !== undefined) out += span('s', m[2])
    else if (m[3] !== undefined) out += span('k', m[3])
    else if (m[4] !== undefined) out += span('a', m[4])
    else if (m[5] !== undefined) out += span('n', m[5])
    else if (m[6] !== undefined) out += span('n', m[6])
    else out += span('t', m[7])
    last = m.index + m[0].length
  }
  return out + escHtml(code.slice(last))
}

const BASH_RE =
  /(#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(\$\{?[\w]+\}?)|\b(npm|node|npx|cd|git|echo|export|set|run|install|dist|typecheck|checkout|stash)\b/g

function hlBash(code) {
  let out = ''
  let last = 0
  for (const m of code.matchAll(BASH_RE)) {
    out += escHtml(code.slice(last, m.index))
    if (m[1] !== undefined) out += span('c', m[1])
    else if (m[2] !== undefined) out += span('s', m[2])
    else if (m[3] !== undefined) out += span('a', m[3])
    else out += span('k', m[4])
    last = m.index + m[0].length
  }
  return out + escHtml(code.slice(last))
}

const JSON_RE = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d[\d.]*(?:[eE][+-]?\d+)?)/g

function hlJson(code) {
  let out = ''
  let last = 0
  for (const m of code.matchAll(JSON_RE)) {
    out += escHtml(code.slice(last, m.index))
    if (m[1] !== undefined) out += span('a', m[1]) + escHtml(m[2])
    else if (m[3] !== undefined) out += span('s', m[3])
    else if (m[4] !== undefined) out += span('k', m[4])
    else out += span('n', m[5])
    last = m.index + m[0].length
  }
  return out + escHtml(code.slice(last))
}

const HL_MAP = {
  ts: hlClike, tsx: hlClike, js: hlClike, jsx: hlClike,
  javascript: hlClike, typescript: hlClike, mjs: hlClike,
  html: hlHtmlLang, xml: hlHtmlLang,
  css: hlCss,
  bash: hlBash, sh: hlBash, shell: hlBash,
  json: hlJson
}

const LANG_LABEL = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', mjs: 'ESM',
  html: 'HTML', css: 'CSS', bash: 'Bash', sh: 'Shell', json: 'JSON',
  text: '文本', plain: '文本'
}

function highlight(code, lang) {
  const fn = HL_MAP[lang]
  return fn ? fn(code) : escHtml(code)
}

// ---------------------------------------------------------------- marked 配置

marked.use({
  gfm: true,
  renderer: {
    code(token) {
      const lang = (token.lang || '').trim().split(/\s+/)[0].toLowerCase()
      const label = LANG_LABEL[lang] ?? LANG_LABEL.text
      const body = highlight(token.text, lang)
      return (
        '<div class="codeblock"><div class="code-head"><span class="code-lang">' +
        label +
        '</span><button type="button" class="copy-btn">复制</button></div>' +
        '<pre><code class="language-' +
        escHtml(lang || 'text') +
        '">' +
        body +
        '</code></pre></div>'
      )
    }
  }
})

// ---------------------------------------------------------------- 读取与转换

const mdFiles = readdirSync(docsDir).filter((f) => f.endsWith('.md'))
const ordered = ['README.md', ...mdFiles.filter((f) => f !== 'README.md').sort()]

const chapters = ordered.map((file) => {
  const stem = file.replace(/\.md$/, '')
  const id = 'ch-' + stem.toLowerCase()
  let html = marked.parse(readFileSync(join(docsDir, file), 'utf8'))

  // 章节间互链(.md)→ 页内锚点;外链新标签打开;表格套横向滚动容器
  html = html.replace(/href="([\w./-]+)\.md"/g, (_m, stemRef) => 'href="#ch-' + stemRef.toLowerCase() + '"')
  html = html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noreferrer"')
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  const rawTitle = h1 ? h1[1].replace(/<[^>]+>/g, '').trim() : stem
  const chapMatch = rawTitle.match(/^第\s*(\d+)\s*章\s*·\s*(.+)$/)
  const label = chapMatch ? chapMatch[1] : '序'
  const title = chapMatch ? chapMatch[2].trim() : '教程首页 · 学习路线'

  return { id, label, title, html }
})

// ---------------------------------------------------------------- 页面模板

const PAGE_CSS = `
:root {
  --background: 240 16% 5%;
  --foreground: 240 10% 96%;
  --card: 240 13% 8%;
  --card-foreground: 240 10% 96%;
  --primary: 258 90% 66%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 10% 14%;
  --secondary-foreground: 240 8% 84%;
  --muted: 240 10% 14%;
  --muted-foreground: 240 7% 60%;
  --accent: 258 36% 17%;
  --accent-foreground: 258 90% 86%;
  --success: 152 60% 52%;
  --border: 240 10% 15%;
  --radius: 1rem;
  --app-shadow-card: 0 8px 32px rgba(0, 0, 0, 0.35);
}
@media (prefers-color-scheme: light) {
  :root {
    --background: 260 40% 96%;
    --foreground: 247 25% 13%;
    --card: 0 0% 99%;
    --card-foreground: 247 25% 13%;
    --primary: 258 78% 54%;
    --primary-foreground: 0 0% 100%;
    --secondary: 258 16% 90%;
    --secondary-foreground: 250 14% 30%;
    --muted: 258 16% 90%;
    --muted-foreground: 248 10% 40%;
    --accent: 258 55% 92%;
    --accent-foreground: 258 60% 36%;
    --success: 152 72% 30%;
    --border: 250 16% 85%;
    --app-shadow-card: 0 8px 32px rgba(30, 20, 60, 0.14);
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: 'Segoe UI Variable Display', 'Segoe UI', 'Microsoft YaHei UI', system-ui, sans-serif;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
::selection { background: hsl(var(--primary) / 0.35); }

.bg-blob { position: fixed; border-radius: 50%; filter: blur(110px); pointer-events: none; z-index: 0; }
.blob-a { width: 560px; height: 560px; right: -140px; top: -180px; background: hsl(var(--primary) / 0.16); }
.blob-b { width: 640px; height: 640px; left: -220px; bottom: -260px; background: hsl(220 70% 45% / 0.12); }

#progress {
  position: fixed; top: 0; left: 0; height: 3px; width: 0; z-index: 60;
  background: linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary) / 0.45));
  border-radius: 0 2px 2px 0;
}

.layout { position: relative; z-index: 1; display: flex; align-items: flex-start; }

.sidebar {
  position: sticky; top: 0;
  width: 316px; flex: none; height: 100vh;
  padding: 20px 14px 14px;
  display: flex; flex-direction: column; gap: 14px;
  background: hsl(var(--card) / 0.55);
  backdrop-filter: blur(24px) saturate(1.3);
  -webkit-backdrop-filter: blur(24px) saturate(1.3);
  border-right: 1px solid hsl(var(--foreground) / 0.08);
  overflow-y: auto;
}
.side-head { display: flex; gap: 12px; align-items: center; padding: 4px 8px 14px; border-bottom: 1px solid hsl(var(--foreground) / 0.07); }
.side-logo {
  width: 40px; height: 40px; border-radius: 12px; flex: none;
  display: grid; place-items: center;
  background: linear-gradient(135deg, hsl(var(--primary)), hsl(280 70% 58%));
  color: #fff; box-shadow: 0 4px 20px hsl(var(--primary) / 0.45);
}
.side-title { font-weight: 700; font-size: 15px; line-height: 1.3; }
.side-sub { font-size: 11.5px; color: hsl(var(--muted-foreground)); margin-top: 2px; }
.side-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-link {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 10px;
  text-decoration: none; color: hsl(var(--foreground) / 0.72);
  font-size: 13.5px; line-height: 1.4;
  transition: background 0.15s, color 0.15s;
}
.nav-link:hover { background: hsl(var(--foreground) / 0.05); color: hsl(var(--foreground)); }
.nav-link.active { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
.nav-link .num {
  flex: none; width: 24px; height: 24px; border-radius: 8px;
  display: grid; place-items: center;
  font-size: 11.5px; font-weight: 600;
  background: hsl(var(--foreground) / 0.07); color: hsl(var(--muted-foreground));
  transition: background 0.15s, color 0.15s;
}
.nav-link.active .num { background: hsl(var(--primary) / 0.85); color: hsl(var(--primary-foreground)); }
.side-foot { font-size: 11px; color: hsl(var(--muted-foreground)); padding: 10px 8px 2px; border-top: 1px solid hsl(var(--foreground) / 0.07); }

.main { flex: 1; min-width: 0; max-width: 1020px; margin: 0 auto; padding: 36px 44px 72px; }
.chapter {
  background: hsl(var(--card) / 0.6);
  backdrop-filter: blur(20px) saturate(1.25);
  -webkit-backdrop-filter: blur(20px) saturate(1.25);
  border: 1px solid hsl(var(--foreground) / 0.09);
  border-radius: calc(var(--radius) + 4px);
  box-shadow: var(--app-shadow-card);
  padding: 42px 52px 34px;
  margin-bottom: 36px;
  min-height: 62vh;
}
.ch-eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.ch-chip {
  display: inline-flex; align-items: center;
  padding: 3px 12px; border-radius: 999px;
  background: linear-gradient(135deg, hsl(var(--primary)), hsl(280 70% 58%));
  color: hsl(var(--primary-foreground));
  font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
  box-shadow: 0 2px 12px hsl(var(--primary) / 0.35);
}
.ch-pos { font-size: 12px; color: hsl(var(--muted-foreground)); }
.chapter h1 {
  font-size: 27px; line-height: 1.4; margin: 0 0 22px; letter-spacing: 0.2px;
  padding-bottom: 16px; border-bottom: 1px solid hsl(var(--foreground) / 0.08);
}
.chapter h2 {
  font-size: 20.5px; margin: 38px 0 12px;
  display: flex; align-items: center; gap: 10px; line-height: 1.45;
}
.chapter h2::before {
  content: ""; flex: none; width: 4px; height: 20px; border-radius: 2px;
  background: linear-gradient(180deg, hsl(var(--primary)), hsl(var(--primary) / 0.35));
}
.chapter h3 { font-size: 16.5px; margin: 24px 0 8px; }
.chapter p { font-size: 14.5px; line-height: 1.9; margin: 10px 0; color: hsl(var(--foreground) / 0.9); }
.chapter ul, .chapter ol { padding-left: 1.5em; margin: 10px 0; }
.chapter li { font-size: 14.5px; line-height: 1.9; margin: 4px 0; color: hsl(var(--foreground) / 0.9); }
.chapter li::marker { color: hsl(var(--primary) / 0.85); }
.chapter a {
  color: hsl(var(--primary)); text-decoration: underline;
  text-decoration-color: hsl(var(--primary) / 0.35); text-underline-offset: 3px;
  transition: text-decoration-color 0.15s;
}
.chapter a:hover { text-decoration-color: hsl(var(--primary)); }
.chapter strong { color: hsl(var(--foreground)); font-weight: 650; }
.chapter img { max-width: 100%; }
.chapter hr { border: 0; border-top: 1px solid hsl(var(--foreground) / 0.08); margin: 30px 0; }

.chapter code {
  font-family: 'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace;
  font-size: 0.87em;
  background: hsl(var(--foreground) / 0.07);
  border: 1px solid hsl(var(--foreground) / 0.06);
  border-radius: 6px; padding: 1.5px 6px;
  color: hsl(var(--accent-foreground));
  overflow-wrap: anywhere;
}
.codeblock pre code,
.chapter pre code {
  background: none; border: 0; padding: 0; border-radius: 0;
  color: hsl(240 10% 88%); font-size: 12.8px; overflow-wrap: normal;
}

.codeblock {
  margin: 16px 0; border-radius: 12px; overflow: hidden;
  border: 1px solid hsl(240 10% 16%);
  background: hsl(240 18% 6%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
.code-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 10px 6px 14px;
  background: hsl(240 12% 9%);
  border-bottom: 1px solid hsl(240 10% 14%);
}
.code-lang { font-size: 11px; letter-spacing: 0.8px; text-transform: uppercase; color: hsl(240 8% 52%); font-weight: 600; }
.copy-btn {
  font: inherit; font-size: 11.5px; cursor: pointer;
  color: hsl(240 8% 62%); background: hsl(240 10% 14%);
  border: 1px solid hsl(240 10% 19%); border-radius: 6px; padding: 2.5px 10px;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.copy-btn:hover { color: hsl(0 0% 92%); background: hsl(240 10% 19%); }
.copy-btn.copied { color: hsl(152 60% 62%); border-color: hsl(152 45% 30%); background: hsl(152 40% 11%); }
.codeblock pre { margin: 0; padding: 14px 18px; overflow-x: auto; }
.codeblock pre code { font-family: 'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace; line-height: 1.75; display: block; }
.tok-c { color: hsl(240 6% 46%); font-style: italic; }
.tok-s { color: hsl(152 55% 62%); }
.tok-k { color: hsl(258 90% 77%); }
.tok-n { color: hsl(35 85% 66%); }
.tok-t { color: hsl(190 75% 64%); }
.tok-a { color: hsl(45 80% 70%); }

.table-wrap { overflow-x: auto; margin: 14px 0; border: 1px solid hsl(var(--foreground) / 0.08); border-radius: 12px; }
.chapter table { width: 100%; border-collapse: collapse; font-size: 13.5px; margin: 0; }
.chapter th {
  text-align: left; font-weight: 600; color: hsl(var(--muted-foreground));
  background: hsl(var(--foreground) / 0.04);
  padding: 9px 14px; border-bottom: 1px solid hsl(var(--foreground) / 0.08);
}
.chapter td { padding: 9px 14px; border-bottom: 1px solid hsl(var(--foreground) / 0.06); vertical-align: top; }
.chapter tr:last-child td { border-bottom: none; }

.chapter blockquote {
  margin: 14px 0; padding: 8px 18px;
  border-left: 3px solid hsl(var(--primary) / 0.7);
  background: hsl(var(--primary) / 0.07);
  border-radius: 4px 12px 12px 4px;
}
.chapter blockquote p { margin: 6px 0; color: hsl(var(--foreground) / 0.88); }

.chapter li:has(input[type="checkbox"]) { list-style: none; margin-left: -1.3em; }
.chapter input[type="checkbox"] { accent-color: hsl(var(--primary)); margin-right: 7px; }

.ch-nav {
  display: flex; gap: 14px;
  margin-top: 44px; padding-top: 22px;
  border-top: 1px solid hsl(var(--foreground) / 0.08);
}
.ch-nav a, .ch-nav-spacer { flex: 1; min-width: 0; }
.ch-nav a {
  text-decoration: none;
  border: 1px solid hsl(var(--foreground) / 0.09);
  border-radius: 12px; padding: 11px 16px;
  background: hsl(var(--foreground) / 0.03);
  transition: background 0.15s, border-color 0.15s;
}
.ch-nav a:hover { background: hsl(var(--foreground) / 0.06); border-color: hsl(var(--primary) / 0.4); }
.ch-nav a.next { text-align: right; }
.ch-nav-label { display: block; font-size: 11.5px; color: hsl(var(--muted-foreground)); margin-bottom: 3px; }
.ch-nav-title {
  display: block; font-size: 13.5px; font-weight: 600;
  color: hsl(var(--foreground) / 0.92);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.site-foot { text-align: center; font-size: 12px; color: hsl(var(--muted-foreground)); padding: 10px 0 20px; }

@media (max-width: 1080px) {
  .layout { display: block; }
  .sidebar { position: relative; width: auto; height: auto; border-right: 0; border-bottom: 1px solid hsl(var(--foreground) / 0.08); }
  .side-nav { flex-direction: row; flex-wrap: wrap; }
  .main { padding: 26px 18px 52px; }
  .chapter { padding: 26px 20px; }
  .ch-nav { flex-direction: column; }
  .ch-nav a.next { text-align: left; }
}
`

const PAGE_JS = `
(function () {
  var bar = document.getElementById('progress')
  function onScroll() {
    var h = document.documentElement
    var max = h.scrollHeight - h.clientHeight
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%'
  }
  document.addEventListener('scroll', onScroll, { passive: true })

  // 单章翻页路由:location.hash 决定当前显示的章节
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'))
  var sections = Array.prototype.slice.call(document.querySelectorAll('.chapter'))
  var byId = {}
  sections.forEach(function (s) { byId[s.id] = s })

  function currentId() {
    var h = location.hash.replace(/^#/, '')
    return byId[h] ? h : sections[0].id
  }

  function show() {
    var id = currentId()
    sections.forEach(function (s) { s.style.display = s.id === id ? '' : 'none' })
    links.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-target') === id)
    })
    var title = byId[id] ? byId[id].getAttribute('data-title') : ''
    document.title = title ? title + ' · Web 开发教程' : 'Web 开发教程 · NTE 模组管理器'
    window.scrollTo({ top: 0, behavior: 'instant' })
    onScroll()
  }

  window.addEventListener('hashchange', show)

  // 点击指向当前章节的链接(hash 不变化,不触发 hashchange)时回到顶部
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null
    if (!a) return
    var id = a.getAttribute('href').slice(1)
    if (byId[id] && id === currentId()) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })

  // 键盘 ← / → 翻章
  document.addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return
    var tag = ((ev.target && ev.target.tagName) || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
    var cur = currentId()
    var idx = -1
    for (var k = 0; k < sections.length; k++) {
      if (sections[k].id === cur) { idx = k; break }
    }
    var n = ev.key === 'ArrowRight' ? idx + 1 : idx - 1
    if (n < 0 || n >= sections.length) return
    if (('#' + sections[n].id) === location.hash) return
    location.hash = sections[n].id
  })

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    var ok = false
    try { ok = document.execCommand('copy') } catch (e) {}
    document.body.removeChild(ta)
    done(ok)
  }
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('.copy-btn') : null
    if (!btn) return
    var block = btn.closest('.codeblock')
    var pre = block ? block.querySelector('pre') : null
    if (!pre) return
    var text = pre.innerText
    var done = function (ok) {
      btn.textContent = ok ? '已复制' : '复制失败'
      btn.classList.toggle('copied', ok)
      setTimeout(function () {
        btn.textContent = '复制'
        btn.classList.remove('copied')
      }, 1600)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true) }, function () { fallbackCopy(text, done) })
    } else {
      fallbackCopy(text, done)
    }
  })

  show()
})()
`

const LOGO_SVG =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>'

// ---------------------------------------------------------------- 组装输出

// 标题取自 marked 的 HTML 输出,本身已是转义安全的 HTML,直接拼接即可(勿再 escHtml 二次转义)
const navItems = chapters
  .map(
    (ch) =>
      '<a class="nav-link" data-target="' + ch.id + '" href="#' + ch.id + '">' +
      '<span class="num">' + escHtml(ch.label) + '</span>' +
      '<span class="nav-text">' + ch.title + '</span></a>'
  )
  .join('\n')

const sections = chapters
  .map((ch, i) => {
    const prev = chapters[i - 1]
    const next = chapters[i + 1]
    // 单章翻页模式:眉标胶囊承载"第 N 章",h1 去掉重复的章节编号
    if (ch.label !== '序') {
      ch.html = ch.html.replace(/(<h1[^>]*>)第\s*\d+\s*章\s*·\s*/, '$1')
    }
    const chipText = ch.label === '序' ? '序' : '第 ' + ch.label + ' 章'
    let sec =
      '<section class="chapter" id="' + ch.id + '" data-title="' + ch.title + '">\n' +
      '<div class="ch-eyebrow"><span class="ch-chip">' + escHtml(chipText) + '</span>' +
      '<span class="ch-pos">' + (i + 1) + ' / ' + chapters.length + '</span></div>\n' +
      ch.html + '\n<div class="ch-nav">'
    const chapTag = (c) => (c.label === '序' ? '' : '第 ' + c.label + ' 章 · ')
    sec += prev
      ? '<a href="#' + prev.id + '"><span class="ch-nav-label">← 上一章</span><span class="ch-nav-title">' + chapTag(prev) + prev.title + '</span></a>'
      : '<div class="ch-nav-spacer"></div>'
    sec += next
      ? '<a class="next" href="#' + next.id + '"><span class="ch-nav-label">下一章 →</span><span class="ch-nav-title">' + chapTag(next) + next.title + '</span></a>'
      : '<div class="ch-nav-spacer"></div>'
    sec += '</div>\n</section>'
    return sec
  })
  .join('\n')

const html =
  '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8" />\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
  '<title>Web 开发教程 · NTE 模组管理器</title>\n' +
  '<style>' + PAGE_CSS + '</style>\n</head>\n<body>\n' +
  '<div id="progress"></div>\n' +
  '<div class="bg-blob blob-a"></div><div class="bg-blob blob-b"></div>\n' +
  '<div class="layout">\n' +
  '<aside class="sidebar">\n' +
  '<div class="side-head"><div class="side-logo">' + LOGO_SVG + '</div>' +
  '<div><div class="side-title">Web 开发零基础教程</div><div class="side-sub">以 NTE 模组管理器为实物教材</div></div></div>\n' +
  '<nav class="side-nav">' + navItems + '</nav>\n' +
  '<div class="side-foot">由 scripts/build-tutorial.mjs 生成 · ' + new Date().toISOString().slice(0, 10) + '</div>\n' +
  '</aside>\n' +
  '<main class="main">' + sections +
  '<footer class="site-foot">NTE 模组管理器 · Web 开发教程 · 源文件位于 docs/web-tutorial/</footer>' +
  '</main>\n</div>\n' +
  '<script>' + PAGE_JS + '</script>\n</body>\n</html>\n'

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, html, 'utf8')

console.log(
  '[docs:tutorial] 已生成 ' +
    outFile.replace(repoRoot + '/', '') +
    '(' + chapters.length + ' 章,' + (html.length / 1024).toFixed(0) + ' KB)'
)
