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
  const showImport = view === 'mods'
  const showPackage = view === 'workbench'
  return (
    <div className="header-mod-actions" data-visible={showImport || showPackage || undefined}>
      <div className="header-mod-actions-content">
        <div className="header-mod-action-stack">
          <div className="header-mod-action" {...(!showImport ? { inert: '' } : {})}>
            <Button onClick={onImport} disabled={busy}>
              <Import />
              导入
            </Button>
          </div>
          <div className="header-mod-action" {...(!showPackage ? { inert: '' } : {})}>
            <Button variant="outline" onClick={onPackageMod} disabled={busy}>
              <Package />
              打包
            </Button>
          </div>
        </div>
        <span className="header-action-divider" aria-hidden="true" />
      </div>
    </div>
  )
}
