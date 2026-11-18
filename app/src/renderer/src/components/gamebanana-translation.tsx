import { useMemo, useState, type ReactNode } from 'react'
import { Globe, LoaderCircle } from 'lucide-react'
import type { GameBananaTranslationSection } from '@shared/types'
import { createTranslationSource } from '@/lib/gamebanana-html-translation'
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
  title,
  children
}: {
  modId: number
  section: GameBananaTranslationSection
  updatedAt: number
  html: string
  title: string
  children: (parts: TranslationParts) => ReactNode
}) {
  const source = useMemo(() => {
    const { paragraphs, applyTranslation } = createTranslationSource(html)
    return { request: { modId, section, updatedAt, html, paragraphs }, applyTranslation }
  }, [modId, section, updatedAt, html])
  const [translation, setTranslation] = useState<{ source: typeof source; html: string; incompleteSegments: number } | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const currentTranslation = translation?.source === source ? translation : null
  const translatedHtml = currentTranslation?.html ?? ''
  const isTranslated = Boolean(translatedHtml && showTranslation)

  const toggleTranslation = async () => {
    if (translatedHtml) {
      setShowTranslation(!showTranslation)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await window.api.translateGameBanana(source.request)
      if (!result.some(Boolean)) throw new Error('有道翻译未返回可对应原文的译文。')
      const applied = source.applyTranslation(result)
      setTranslation({ source, ...applied })
      setShowTranslation(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = loading ? '正在翻译' : isTranslated ? '显示原文' : translatedHtml ? '显示译文' : '翻译'
  const button = source.request.paragraphs.length > 0 ? (
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
      {isTranslated && currentTranslation && currentTranslation.incompleteSegments > 0 && (
        <div className="gamebanana-translation-error" role="status">
          部分文本未能翻译，已保留原文（{currentTranslation.incompleteSegments} 处）。
        </div>
      )}
      <GameBananaHtml html={isTranslated ? translatedHtml : html} title={title} />
    </div>
  )

  return <>{children({ button, content })}</>
}
