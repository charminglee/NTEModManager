import { useEffect, useMemo, useRef } from 'react'
import { toast } from './toast-card'

export default function GameBananaHtml({ html, title }: { html: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const cleanupRef = useRef<() => void>(() => {})
  const documentHtml = useMemo(() => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    document.querySelectorAll('script, base, meta, object, embed').forEach((element) => element.remove())
    document.querySelectorAll('*').forEach((element) => {
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') element.removeAttribute(attribute.name)
      }
    })
    document.head.insertAdjacentHTML('afterbegin', `<meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; media-src 'self' https:; style-src 'unsafe-inline'; frame-src 'none'; form-action 'none'; base-uri https://gamebanana.com;">
      <base href="https://gamebanana.com/">
      <style>
        * { scrollbar-width: none; }
        ::-webkit-scrollbar { display: none; width: 0; height: 0; }
        :root { color-scheme: dark; font: 14px/1.8 'Segoe UI', 'Microsoft YaHei UI', sans-serif; color: #eee5d8; }
        html, body { margin: 0; padding: 0; background: transparent; overflow-wrap: anywhere; }
        body { display: flow-root; }
        body > :first-child { margin-top: 0; } body > :last-child { margin-bottom: 0; }
        a { color: #f2b6a1; text-decoration: underline; text-underline-offset: 3px; }
        img, video { max-width: 100%; height: auto; } iframe { max-width: 100%; }
        table { border-collapse: collapse; max-width: 100%; } th, td { border: 1px solid #696358; padding: 8px 12px; }
        pre { overflow-x: auto; padding: 12px; background: #ffffff0a; } code { font-family: Consolas, monospace; }
        blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #c27b64; color: #c9c0b3; }
        ul, ol { padding-left: 24px; } h1, h2, h3, h4 { line-height: 1.4; } hr { border: 0; border-top: 1px solid #625c52; }
        .spoiler { background: #555; } .spoiler:hover { background: transparent; }
      </style>`)
    return `<!doctype html>${document.documentElement.outerHTML}`
  }, [html])

  useEffect(() => () => cleanupRef.current(), [])

  return <iframe
    ref={frameRef}
    className="gamebanana-html"
    title={title}
    sandbox="allow-same-origin"
    srcDoc={documentHtml}
    onLoad={() => {
      cleanupRef.current()
      const frame = frameRef.current!
      const document = frame.contentDocument!
      const resize = () => { frame.style.height = `${Math.ceil(document.body.getBoundingClientRect().height) + 2}px` }
      const observer = new ResizeObserver(resize)
      observer.observe(document.body)
      const openLink = (event: MouseEvent) => {
        const link = (event.target as Element).closest('a')
        if (!link) return
        event.preventDefault()
        if (link.getAttribute('href')?.startsWith('#')) {
          document.getElementById(decodeURIComponent(link.hash.slice(1)))?.scrollIntoView()
        } else {
          void window.api.openExternal(link.href).then((result) => {
            if (!result.success) toast.error('打开链接失败', { description: result.message })
          }).catch((error) => toast.error('打开链接失败', { description: String(error) }))
        }
      }
      document.addEventListener('click', openLink)
      cleanupRef.current = () => {
        observer.disconnect()
        document.removeEventListener('click', openLink)
      }
      resize()
    }}
  />
}
