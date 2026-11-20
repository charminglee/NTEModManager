import { Import, Package } from 'lucide-react'
import type { AppView } from './app-header'
import { Button } from './ui/button'
import './header-mod-actions.css'

export function HeaderModActions({
  view,
  busy,
  onImport,
  onPackageMod
}: {
  view: AppView
  busy: boolean
  onImport: () => void
  onPackageMod: () => void
}) {
  const visible = view === 'mods'
  return (
    <div className="header-mod-actions header-action-reveal" data-visible={visible || undefined}>
      <div className="header-mod-actions-content header-action-reveal-content" {...(!visible ? { inert: '' } : {})}>
        <Button onClick={onImport} disabled={busy}>
          <Import />
          导入
        </Button>
        <Button variant="secondary" onClick={onPackageMod} disabled={busy}>
          <Package />
          打包
        </Button>
        <span className="header-action-divider" aria-hidden="true" />
      </div>
    </div>
  )
}
