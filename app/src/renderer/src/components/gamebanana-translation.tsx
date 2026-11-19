import { useMemo, useState, type ReactNode } from 'react'
import { Globe, LoaderCircle } from 'lucide-react'
import type { GameBananaTranslationSection } from '@shared/types'
import { getTranslatableText } from '@/lib/gamebanana-html-translation'
import { Button } from './ui/button'
import GameBananaHtml from './gamebanana-html'

interface TranslationParts {
  button: ReactNode
  content: ReactNode
}

export default function GameBananaTranslation({
  modId,
  section,
  updatedAt,
  html,
  updateCategories,
  title,
  children
}: {
  modId: number
  section: GameBananaTranslationSection
  updatedAt: number
  html: string
  updateCategories?: string[]
  title: string
  children: (parts: TranslationParts) => ReactNode
}) {
  const source = useMemo(() => ({ modId, section, updatedAt, html }), [modId, section, updatedAt, html])
  const sourceText = useMemo(() => getTranslatableText(html), [html])
  const [translation, setTranslation] = useState<{ source: typeof source; html: string } | null>(null)
  const [unchangedSource, setUnchangedSource] = useState<typeof source | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const translatedHtml = translation?.source === source ? translation.html : ''
  const isTranslated = Boolean(translatedHtml && showTranslation)

  const translate = async () => {
    setError('')
    setLoading(true)
    try {
      const result = await window.api.translateGameBanana({ ...source, bypassCache: unchangedSource === source })
      const translatedText = getTranslatableText(result)
      if (!translatedText || translatedText === sourceText) {
        setUnchangedSource(source)
        setError('译文没有改变正文，请重试翻译。')
        return
      }
      setTranslation({ source, html: result })
      setShowTranslation(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = loading ? '正在翻译' : isTranslated ? '显示原文' : translatedHtml ? '显示译文' : '翻译'
  const button = sourceText ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`gamebanana-translation-button${isTranslated ? ' is-translated' : ''}`}
      disabled={loading}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (translatedHtml) setShowTranslation(!showTranslation)
        else void translate()
      }}
      aria-label={buttonLabel}
      aria-pressed={isTranslated}
    >
      {loading ? <LoaderCircle className="animate-spin" /> : <Globe />}
    </Button>
  ) : null
  const content = (
    <div className="gamebanana-translation-content">
      {error && <div className="gamebanana-translation-error" role="alert">{error}</div>}
      <GameBananaHtml html={isTranslated ? translatedHtml : html} title={title} updateCategories={updateCategories} />
    </div>
  )

  return <>{children({ button, content })}</>
}
