import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { getYouTubeWatchUrl, parseYouTubeEmbedUrl } from '@shared/youtube'
import { toast } from './toast-card'

const FRAME_DOCUMENT = `<!doctype html>
  <html lang="zh-CN"><head><meta charset="utf-8">
  <base href="https://gamebanana.com/">
  <style>
    * { scrollbar-width: none; }
    ::-webkit-scrollbar { display: none; width: 0; height: 0; }
    :root { color-scheme: dark; font: 14px/1.8 'Segoe UI', 'Microsoft YaHei UI', sans-serif; color: #eee5d8; }
    html, body { margin: 0; padding: 0; background: transparent; overflow-wrap: anywhere; }
    body { display: flow-root; }
    body > :first-child { margin-top: 0; } body > :last-child { margin-bottom: 0; }
    a { color: #f2b6a1; text-decoration: underline; text-underline-offset: 3px; }
    img, video { max-width: 100%; height: auto; }
    .ntemm-youtube, .ntemm-youtube-player { display: block; }
    .ntemm-youtube-player { max-width: 100%; min-height: 200px; height: auto; aspect-ratio: 16 / 9; border: 0; background: #1d1c1a; }
    table { border-collapse: collapse; max-width: 100%; } th, td { border: 1px solid #696358; padding: 8px 12px; }
    pre { overflow-x: auto; padding: 12px; background: #ffffff0a; } code { font-family: Consolas, monospace; }
    blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #c27b64; color: #c9c0b3; }
    ul, ol { padding-left: 24px; } h1, h2, h3, h4 { line-height: 1.4; } hr { border: 0; border-top: 1px solid #625c52; }
    .spoiler { background: #555; } .spoiler:hover { background: transparent; }
    [data-ntemm-update-change] + [data-ntemm-update-change] { margin-top: 12px; }
    .ntemm-update-change-heading { color: #dcb893; font-size: 11px; }
  </style></head><body></body></html>`

function replaceEmbeddedFrames(content: DocumentFragment): void {
  const document = content.ownerDocument
  content.querySelectorAll('iframe').forEach((original) => {
    const url = parseYouTubeEmbedUrl(original.getAttribute('src') ?? '')
    if (!url) {
      original.remove()
      return
    }

    const player = document.createElement('iframe')
    player.className = 'ntemm-youtube-player'
    player.src = url.href
    player.title = original.getAttribute('title')?.trim() || 'YouTube 视频'
    const width = original.getAttribute('width') ?? ''
    player.width = /^[1-9]\d{0,3}$/.test(width) ? width : '560'
    player.loading = 'lazy'
    player.referrerPolicy = 'strict-origin-when-cross-origin'
    player.allow = 'encrypted-media; picture-in-picture'
    player.allowFullscreen = true

    const link = document.createElement('a')
    link.href = getYouTubeWatchUrl(url).href
    link.textContent = '在 YouTube 上观看'

    const container = document.createElement('span')
    container.className = 'ntemm-youtube'
    container.append(player, link)
    original.replaceWith(container)
  })
}

export default function GameBananaHtml({ html, title, updateCategories }: { html: string; title: string; updateCategories?: string[] }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameDocument, setFrameDocument] = useState<Document | null>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !frameDocument) return
    const document = frameDocument
    const content = DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      ADD_TAGS: ['iframe'],
      FORBID_TAGS: ['base', 'embed', 'form', 'link', 'meta', 'object', 'script', 'style', 'template'],
      FORBID_ATTR: ['ping', 'srcdoc']
    })
    replaceEmbeddedFrames(content)
    if (updateCategories?.length) {
      content.querySelectorAll<HTMLElement>('[data-ntemm-update-change]').forEach((block) => {
        const category = updateCategories[Number(block.dataset.ntemmUpdateChange)]
        if (!category) return
        const heading = document.createElement('div')
        heading.className = 'ntemm-update-change-heading'
        heading.translate = false
        heading.textContent = category
        block.prepend(heading)
      })
    }
    document.body.replaceChildren(content)

    const resize = () => { frame.style.height = `${Math.ceil(document.body.getBoundingClientRect().height) + 2}px` }
    const observer = new ResizeObserver(resize)
    observer.observe(document.body)
    const openLink = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a[href]')
      const href = link?.getAttribute('href')
      if (href == null) return
      event.preventDefault()
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1))
        document.getElementById(id)?.scrollIntoView()
      } else {
        const url = URL.parse(href, document.baseURI)
        if (!url) return
        void window.api.openExternal(url.href).then((result) => {
          if (!result.success) toast.error('打开链接失败', { description: result.message })
        }).catch((error) => toast.error('打开链接失败', { description: String(error) }))
      }
    }
    document.addEventListener('click', openLink)
    resize()
    return () => {
      observer.disconnect()
      document.removeEventListener('click', openLink)
    }
  }, [frameDocument, html, updateCategories])

  return <iframe
    ref={frameRef}
    className="gamebanana-html"
    title={title}
    sandbox="allow-same-origin allow-scripts"
    allow="encrypted-media; picture-in-picture"
    allowFullScreen
    srcDoc={FRAME_DOCUMENT}
    onLoad={() => setFrameDocument(frameRef.current?.contentDocument ?? null)}
  />
}
