import { Import, Package } from 'lucide-react'
import { Button } from './ui/button'
import './header-mod-actions.css'

export function HeaderModActions({
  view,
  busy,
  onImport,
  onPackageMod
}: {
  view: 'mods' | 'workbench'
  busy: boolean
  onImport: () => void
  onPackageMod: () => void
}) {
  return (
    <div className="header-mod-actions">
      {view === 'mods' ? (
        <Button onClick={onImport} disabled={busy}>
          <Import />
          导入
        </Button>
      ) : (
        <Button variant="outline" onClick={onPackageMod} disabled={busy}>
          <Package />
          打包
        </Button>
      )}
      <span className="header-action-divider" aria-hidden="true" />
    </div>
  )
}
