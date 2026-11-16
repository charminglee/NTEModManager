import { Layers, Package } from 'lucide-react'
import type { ModInfo } from '@shared/types'
import { formatFileSize } from '@/lib/format'
import Switch from './ui/switch'
import type { ModCardActions } from './mod-card'

export default function ModBundlePanel({ mod, busy, onToggle }: {
  mod: ModInfo
  busy: boolean
  onToggle: ModCardActions['onToggleSubMod']
}) {
  const children = mod.subMods ?? []
  if (!children.length) return null
  const selected = children.filter((child) => child.enabled).length
  return (
    <section className="bundle-panel" aria-label="子模组管理">
      <div className="bundle-heading">
        <h4><Layers />整合包</h4>
        <span aria-live="polite">已选择 {selected}／{children.length}</span>
      </div>
      <p>{mod.installed ? '切换立即生效。整包卸载后保留选择。' : '选择要启用的子模组，安装整包后生效。'}</p>
      <ul>
        {children.map((child) => (
          <li key={child.name}>
            <Package aria-hidden="true" />
            <div className="bundle-child-copy">
              <strong>{child.name}</strong>
              <small>{formatFileSize(child.sizeBytes)} · {child.enabled ? mod.installed ? '已启用' : '待启用' : '已停用'}</small>
            </div>
            <Switch checked={child.enabled} disabled={busy} aria-label={`启用子模组：${child.name}`}
              onCheckedChange={(enabled) => onToggle(mod, child.name, enabled)} />
          </li>
        ))}
      </ul>
      <p className="bundle-footnote">仅管理第一层子模组。更深目录随所属子模组启停，根目录资源随整包启停。</p>
    </section>
  )
}
