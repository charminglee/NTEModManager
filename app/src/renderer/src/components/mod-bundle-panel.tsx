import { Package, Pencil } from 'lucide-react'
import type { ModInfo } from '@shared/types'
import { formatFileSize } from '@/lib/format'
import { Button } from './ui/button'
import Switch from './ui/switch'
import type { ModCardActions } from './mod-card'

export default function ModBundlePanel({ mod, busy, onToggle, onRename }: {
  mod: ModInfo
  busy: boolean
  onToggle: ModCardActions['onToggleSubMod']
  onRename: ModCardActions['onRenameSubMod']
}) {
  const children = mod.subMods ?? []
  if (!children.length) return null
  const selected = children.filter((child) => child.enabled).length
  return (
    <section className="bundle-panel" aria-label="整合包">
      <h3 className="section-heading">
        整合包 <small aria-live="polite">已选择 {selected}／{children.length}</small>
      </h3>
      <ul className="detail-file-panel">
        {children.map((child) => (
          <li key={child.name}>
            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
            <div className="bundle-child-copy">
              <strong>
                {child.name}
                <span className="bundle-rename-anchor">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="bundle-rename-button"
                    disabled={busy}
                    aria-label={`重命名子模组：${child.name}`}
                    title="重命名子模组"
                    onClick={() => onRename(mod, child.name)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </span>
              </strong>
            </div>
            <small className="bundle-child-size">{formatFileSize(child.sizeBytes)}</small>
            <Switch checked={child.enabled} disabled={busy} aria-label={`启用子模组：${child.name}`}
              onCheckedChange={(enabled) => onToggle(mod, child.name, enabled)} />
          </li>
        ))}
      </ul>
    </section>
  )
}
