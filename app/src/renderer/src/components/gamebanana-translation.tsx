import { useMemo, useState } from 'react'
import { Globe, LoaderCircle } from 'lucide-react'
import { Button } from './ui/button'
import GameBananaHtml from './gamebanana-html'

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

export default function GameBananaTranslation({ html, title }: { html: string; title: string }) {
  const text = useMemo(() => extractText(html), [html])
  const [translation, setTranslation] = useState('')
  const [showTranslation, setShowTranslation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggleTranslation = async () => {
    if (translation) {
      setShowTranslation(!showTranslation)
      return
    }
    setLoading(true)
    setError('')
    try {
      setTranslation(await window.api.translateYoudaoText(text))
      setShowTranslation(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="gamebanana-translatable">
      {text && <div className="gamebanana-translation-toolbar">
        <Button variant="ghost" size="sm" onClick={() => void toggleTranslation()} disabled={loading} aria-expanded={showTranslation}>
          {loading ? <LoaderCircle className="animate-spin" /> : <Globe />}
          {loading ? '正在翻译' : showTranslation ? '收起译文' : translation ? '显示译文' : '翻译'}
        </Button>
        {error && <span className="gamebanana-translation-error" role="alert">{error}</span>}
      </div>}
      <GameBananaHtml html={html} title={title} />
      {showTranslation && <div className="gamebanana-translation-result" aria-live="polite">
        <div>有道翻译 · 简体中文</div>
        <p>{translation}</p>
      </div>}
    </div>
  )
}
