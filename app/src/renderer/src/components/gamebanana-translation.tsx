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
  const [sourceLanguage, setSourceLanguage] = useState<GameBananaTranslationLanguage>('en')
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

  const buttonLabel = loading ? '正在翻译' : isTranslated ? '显示原文' : translatedHtml ? '显示译文' : `翻译${sourceLanguage === 'en' ? '英语' : '俄语'}原文`
  const button = hasText ? (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild disabled={loading}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`gamebanana-translation-button${isTranslated ? ' is-translated' : ''}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.ctrlKey) return
            event.preventDefault()
            event.currentTarget.focus()
          }}
          onKeyDownCapture={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (translatedHtml) setShowTranslation(!showTranslation)
            else void translate(sourceLanguage)
          }}
          aria-label={buttonLabel}
          aria-pressed={isTranslated}
          aria-keyshortcuts="ArrowDown"
        >
          {loading ? <LoaderCircle className="animate-spin" /> : <Globe />}
          <span
            className="gamebanana-translation-arrow"
            aria-hidden="true"
            title="选择原文语言"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setMenuOpen((open) => !open)
            }}
          ><ChevronDown /></span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[70]" aria-label="原文语言">
        <DropdownMenuRadioGroup value={sourceLanguage}>
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
