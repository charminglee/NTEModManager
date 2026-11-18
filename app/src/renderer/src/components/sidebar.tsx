import type { ReactNode } from 'react'

interface SidebarItem<Id extends string> {
  id: Id
  label: string
  icon: ReactNode
  count?: number
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
  const renderItem = ({ id, icon, label, count }: SidebarItem<Id>) => (
    <button
      key={id}
      type="button"
      className="sidebar-row"
      aria-current={activeId === id ? 'page' : undefined}
      onClick={() => onSelect(id)}
    >
      <span className="sidebar-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sidebar-label">{label}</span>
      {count !== undefined && <span className="sidebar-count">{count}</span>}
    </button>
  )

  return (
    <nav className="app-sidebar ink-panel" aria-label={label}>
      <div className="sidebar-scroll">
        {items.map(renderItem)}
        {items.length === 0 && emptyMessage && <p className="px-3 py-5 text-sm">{emptyMessage}</p>}
      </div>
      {footerItems && footerItems.length > 0 && (
        <div className="sidebar-footer">{footerItems.map(renderItem)}</div>
      )}
    </nav>
  )
}
