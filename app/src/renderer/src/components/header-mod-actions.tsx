import { Import, Package } from 'lucide-react'
import { Button } from './ui/button'
import './header-mod-actions.css'

export function HeaderModActions({
  busy,
  onImport,
  onPackageMod
}: {
  busy: boolean
  onImport: () => void
  onPackageMod: () => void
}) {
  return (
    <div className="header-mod-actions">
      <Button onClick={onImport} disabled={busy}>
        <Import />
        导入
      </Button>
      <Button variant="outline" onClick={onPackageMod} disabled={busy}>
        <Package />
        打包
      </Button>
      <span className="header-action-divider" aria-hidden="true" />
    </div>
  )
}
