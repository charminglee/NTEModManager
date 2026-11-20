import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import './collapsible.css'

interface AppCollapsibleProps {
  title: string
  badges?: ReactNode
  meta?: ReactNode
  action?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export function AppCollapsible({ title, badges, meta, action, defaultOpen, children }: AppCollapsibleProps) {
  return (
    <details className="app-collapsible" open={defaultOpen}>
      <summary>
        <span className="app-collapsible-heading">
          <ChevronRight className="app-collapsible-chevron" aria-hidden="true" />
          <span className="app-collapsible-label">
            <strong>{title}</strong>
            {badges}
          </span>
        </span>
        {(meta || action) && <span className="app-collapsible-end">
          {meta && <span className="app-collapsible-meta">{meta}</span>}
          {action}
        </span>}
      </summary>
      <div className="app-collapsible-body">{children}</div>
    </details>
  )
}
