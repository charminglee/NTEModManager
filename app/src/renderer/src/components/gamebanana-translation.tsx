import { useMemo, useState, type ReactNode } from 'react'
import { Globe, LoaderCircle } from 'lucide-react'
import { Button } from './ui/button'
import GameBananaHtml from './gamebanana-html'

interface TranslationParts {
  button: ReactNode
  content: ReactNode
}

function extractText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll('script, style, template, svg, iframe, object, embed').forEach((element) => element.remove())
  document.querySelectorAll('br, hr').forEach((element) => element.replaceWith('\n'))
  document.querySelectorAll('address, article, blockquote, dd, div, dl, figcaption, figure, h1, h2, h3, h4, h5, h6, li, main, p, pre, section, tr').forEach((element) => element.append('\n'))
  return (document.body.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function createTranslationSource(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const prefix = `__NTEMM_${crypto.randomUUID().replaceAll('-', '')}_`
  const segments: Array<{
    node: Text
    original: string
    start: string
    end: string
    translatable: boolean
  }> = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let currentNode: Node | null

  while ((currentNode = walker.nextNode())) {
    const node = currentNode as Text
    const original = node.nodeValue ?? ''
    if (!original.trim()) continue

    const parent = node.parentElement
    if (!parent || parent.closest('script, style, template, svg, iframe, object, embed')) continue

    const index = segments.length
    const translatable = !parent.closest('code, pre, kbd, samp, [translate="no"], [data-translate="no"]')
    const start = translatable ? `${prefix}TEXT_${index}_START__` : `${prefix}KEEP_${index}__`
    const end = translatable ? `${prefix}TEXT_${index}_END__` : ''
    node.nodeValue = translatable ? `${start}${original}${end}` : start
    segments.push({ node, original, start, end, translatable })
  }

  return {
    hasText: segments.some((segment) => segment.translatable),
    text: extractText(document.documentElement.outerHTML),
    prompt: `将文本翻译成简体中文。只翻译 ${prefix}TEXT_<编号>_START__ 与 ${prefix}TEXT_<编号>_END__ 成对标记之间的文字。${prefix}KEEP_<编号>__ 标记代表需原样保留的内容。输出时必须逐字复制原文中的每个实际标记，保持数量和顺序，不得新增、删除或翻译标记，也不要添加说明。`,
    applyTranslation(translation: string) {
      let cursor = 0
      let translatedSegments = 0
      let incompleteSegments = 0
      const translatedValues = segments.map((segment, index) => {
        if (!segment.translatable) {
          const markerIndex = translation.indexOf(segment.start, cursor)
          if (markerIndex >= 0) cursor = markerIndex + segment.start.length
          return segment.original
        }

        const startIndex = translation.indexOf(segment.start, cursor)
        if (startIndex < 0) {
          incompleteSegments += 1
          return segment.original
        }
        const contentStart = startIndex + segment.start.length
        const endIndex = translation.indexOf(segment.end, contentStart)
        let nextMarkerIndex = -1
        for (const nextSegment of segments.slice(index + 1)) {
          const markerIndex = translation.indexOf(nextSegment.start, contentStart)
          if (markerIndex >= 0 && (nextMarkerIndex < 0 || markerIndex < nextMarkerIndex)) {
            nextMarkerIndex = markerIndex
          }
        }
        if (endIndex < 0 || (nextMarkerIndex >= 0 && nextMarkerIndex < endIndex)) {
          incompleteSegments += 1
          cursor = nextMarkerIndex >= 0 ? nextMarkerIndex : contentStart
          return segment.original
        }

        cursor = endIndex + segment.end.length
        const leadingWhitespace = segment.original.match(/^\s+/u)?.[0] ?? ''
        const trailingWhitespace = segment.original.match(/\s+$/u)?.[0] ?? ''
        const translatedText = translation.slice(contentStart, endIndex).trim()
        if (!translatedText) {
          incompleteSegments += 1
          return segment.original
        }
        translatedSegments += 1
        return `${leadingWhitespace}${translatedText}${trailingWhitespace}`
      })

      segments.forEach((segment, index) => { segment.node.nodeValue = translatedValues[index] })
      return {
        html: document.documentElement.outerHTML,
        translatedSegments,
        incompleteSegments
      }
    }
  }
}

export default function GameBananaTranslation({
  html,
  title,
  children
}: {
  html: string
  title: string
  children: (parts: TranslationParts) => ReactNode
}) {
  const source = useMemo(() => createTranslationSource(html), [html])
  const [translation, setTranslation] = useState<{ source: string; html: string; incompleteSegments: number } | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const translatedHtml = translation?.source === html ? translation.html : ''
  const isTranslated = Boolean(translatedHtml && showTranslation)

  const toggleTranslation = async () => {
    if (translatedHtml) {
      setShowTranslation(!showTranslation)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await window.api.translateYoudaoText(source.text, source.prompt)
      const applied = source.applyTranslation(result)
      if (applied.translatedSegments === 0) {
        throw new Error('有道翻译没有保留格式标记，未应用译文。')
      }
      setTranslation({ source: html, html: applied.html, incompleteSegments: applied.incompleteSegments })
      setShowTranslation(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = loading ? '正在翻译' : isTranslated ? '显示原文' : translatedHtml ? '显示译文' : '翻译'
  const button = source.hasText ? (
    <Button
      variant="ghost"
      size="icon"
      className={`gamebanana-translation-button${isTranslated ? ' is-translated' : ''}`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void toggleTranslation()
      }}
      disabled={loading}
      aria-label={buttonLabel}
      aria-pressed={isTranslated}
    >
      {loading ? <LoaderCircle className="animate-spin" /> : <Globe />}
    </Button>
  ) : null
  const content = (
    <div className="gamebanana-translation-content">
      {error && <div className="gamebanana-translation-error" role="alert">{error}</div>}
      {isTranslated && translation?.source === html && translation.incompleteSegments > 0 && (
        <div className="gamebanana-translation-error" role="status">
          部分文本未能翻译，已保留原文（{translation.incompleteSegments} 处）。
        </div>
      )}
      <GameBananaHtml html={isTranslated ? translatedHtml : html} title={title} />
    </div>
  )

  return <>{children({ button, content })}</>
}
