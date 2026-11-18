import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Globe, LoaderCircle } from 'lucide-react'
import type { GameBananaTranslationLanguage, GameBananaTranslationSection } from '@shared/types'
import { hasTranslatableText, restoreTranslationHtml } from '@/lib/gamebanana-html-translation'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/dropdown-menu'
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
  const source = useMemo(() => ({ modId, section, updatedAt, html }), [modId, section, updatedAt, html])
  const hasText = useMemo(() => hasTranslatableText(html), [html])
  const [sourceLanguage, setSourceLanguage] = useState<GameBananaTranslationLanguage | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [translation, setTranslation] = useState<{ source: typeof source; language: GameBananaTranslationLanguage; html: string } | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const translatedHtml = translation?.source === source && translation.language === sourceLanguage ? translation.html : ''
  const isTranslated = Boolean(translatedHtml && showTranslation)

  const translate = async (language: GameBananaTranslationLanguage) => {
    setSourceLanguage(language)
    setError('')
    if (translation?.source === source && translation.language === language) {
      setShowTranslation(true)
      return
    }
    setLoading(true)
    try {
      const result = await window.api.translateGameBanana({ ...source, sourceLanguage: language })
      setTranslation({ source, language, html: restoreTranslationHtml(html, result) })
      setShowTranslation(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = loading ? '正在翻译' : isTranslated ? '显示原文' : translatedHtml ? '显示译文' : '翻译'
  const button = hasText ? (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <span className="gamebanana-translation-actions" role="group" aria-label="翻译操作">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`gamebanana-translation-button${isTranslated ? ' is-translated' : ''}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (translatedHtml) setShowTranslation(!showTranslation)
            else if (sourceLanguage) void translate(sourceLanguage)
            else setMenuOpen(true)
          }}
          disabled={loading}
          aria-label={buttonLabel}
          aria-pressed={isTranslated}
        >
          {loading ? <LoaderCircle className="animate-spin" /> : <Globe />}
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="gamebanana-translation-button gamebanana-translation-arrow"
            onClick={(event) => { event.preventDefault(); event.stopPropagation() }}
            disabled={loading}
            aria-label="选择原文语言"
            title="选择原文语言"
          ><ChevronDown /></Button>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="end" className="z-[70]" aria-label="原文语言">
        <DropdownMenuRadioGroup value={sourceLanguage ?? undefined}>
          <DropdownMenuRadioItem value="en" onSelect={() => void translate('en')}>英语</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="ru" onSelect={() => void translate('ru')}>俄语</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null
  const content = (
    <div className="gamebanana-translation-content">
      {error && <div className="gamebanana-translation-error" role="alert">{error}</div>}
      <GameBananaHtml html={isTranslated ? translatedHtml : html} title={title} />
    </div>
  )

  return <>{children({ button, content })}</>
}
