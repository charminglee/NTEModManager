import { useState, type CSSProperties, type ReactNode } from 'react'
import { Shader, SolidColor } from 'shaders/react'
import NavSelectionHighlight from './nav-selection-highlight'

interface SidebarItem<Id extends string> {
  id: Id
  label: string
  icon: ReactNode
  count?: number
  palette?: readonly [string, string, string, string]
}

interface SidebarProps<Id extends string> {
  label: string
  items: readonly SidebarItem<Id>[]
  footerItems?: readonly SidebarItem<Id>[]
  emptyMessage?: string
  activeId: Id
  onSelect: (id: Id) => void
}

export default function Sidebar<Id extends string>({
  label,
  items,
  footerItems,
  emptyMessage,
  activeId,
  onSelect
}: SidebarProps<Id>) {
  const [wave, setWave] = useState<{ id: Id; x: number; y: number; sequence: number } | null>(null)
  const renderItem = ({ id, icon, label, count, palette }: SidebarItem<Id>) => (
    <button
      key={id}
      type="button"
      className={palette ? 'sidebar-row character-row' : 'sidebar-row'}
      style={palette && ({ '--accent': palette[0], '--second': palette[1], '--third': palette[2], '--fourth': palette[3] } as CSSProperties)}
      aria-current={activeId === id ? 'page' : undefined}
      onClick={({ currentTarget, detail, clientX, clientY }) => {
        if (palette) {
          const rect = currentTarget.getBoundingClientRect()
          const x = detail ? clientX - rect.left : rect.width / 2
          const y = detail ? clientY - rect.top : rect.height / 2
          setWave(last => ({ id, x, y, sequence: (last?.sequence ?? 0) + 1 }))
        }
        const scroll = currentTarget.closest<HTMLElement>('[data-nav-selection-scroll]')
        if (scroll) {
          const row = currentTarget.getBoundingClientRect()
          const viewport = scroll.getBoundingClientRect()
          if (row.top < viewport.top) {
            scroll.scrollBy({ top: Math.floor(row.top - viewport.top), behavior: 'instant' })
          } else if (row.bottom > viewport.bottom) {
            scroll.scrollBy({ top: Math.ceil(row.bottom - viewport.bottom), behavior: 'instant' })
          }
        }
        onSelect(id)
      }}
    >
      {palette && activeId === id && <>
        <span className="character-edge" aria-hidden="true"><Shader className="character-edge-gpu" disableTelemetry><SolidColor color={palette[0]} /></Shader></span>
        {wave?.id === id && <span key={wave.sequence} className="character-wave" aria-hidden="true" style={{ left: wave.x, top: wave.y }} onAnimationEnd={() => setWave(null)} />}
      </>}
      <span className="nav-item-content">
        <span className="sidebar-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sidebar-label">{label}</span>
        {count !== undefined && <span className="sidebar-count">{count}</span>}
      </span>
    </button>
  )

  return (
    <nav className="app-sidebar ink-panel" aria-label={label}>
      <div className="sidebar-sections">
        {!items.some(item => item.id === activeId && item.palette) && <NavSelectionHighlight />}
        <div className="sidebar-scroll" data-nav-selection-scroll>
          {items.map(renderItem)}
          {items.length === 0 && emptyMessage && <p className="px-3 py-5 text-sm">{emptyMessage}</p>}
        </div>
        {footerItems && footerItems.length > 0 && (
          <div className="sidebar-footer">{footerItems.map(renderItem)}</div>
        )}
      </div>
    </nav>
  )
}
