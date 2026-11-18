import { useMemo, useState, type ReactNode } from 'react'
import { Globe, LoaderCircle } from 'lucide-react'
import { createTranslationSource } from '@/lib/gamebanana-html-translation'
import { Button } from './ui/button'
import GameBananaHtml from './gamebanana-html'

interface TranslationParts {
  button: ReactNode
  content: ReactNode
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
      const result = await window.api.translateGameBanana(source.paragraphs)
      if (!result.some(Boolean)) throw new Error('有道翻译未返回可对应原文的译文。')
      const applied = source.applyTranslation(result)
      setTranslation({ source: html, html: applied.html, incompleteSegments: applied.incompleteSegments })
      setShowTranslation(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = loading ? '正在翻译' : isTranslated ? '显示原文' : translatedHtml ? '显示译文' : '翻译'
  const button = source.paragraphs.length > 0 ? (
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
