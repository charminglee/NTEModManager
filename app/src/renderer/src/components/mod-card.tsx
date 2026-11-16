import { memo } from 'react'
import { Check, Circle, Layers, Package, TriangleAlert } from 'lucide-react'
import type { ModInfo } from '@shared/types'
import { formatFileSize, formatImportedAt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
export interface ModCardActions {
  onToggleInstall: (mod: ModInfo) => void
  onToggleSubMod: (mod: ModInfo, childName: string, enabled: boolean) => void
  onRenameSubMod: (mod: ModInfo, childName: string) => void
  onReinstall: (mod: ModInfo) => void
  onRename: (mod: ModInfo) => void
  onRepackage: (mod: ModInfo) => void
  onAddArchive: (mod: ModInfo) => void
  onReplaceArchive: (mod: ModInfo) => void
  onToggleInvalid: (mod: ModInfo) => void
  onDelete: (mod: ModInfo) => void
  onOpenSource: (mod: ModInfo) => void
  onOpenInstall: (mod: ModInfo) => void
  onRenameFile: (mod: ModInfo, relativePath: string, newFileName: string) => void
  onToggleSelect: (mod: ModInfo, modifiers: { shiftKey: boolean }) => void
}
export function ModStatus({ mod }: { mod: ModInfo }) {
  return (
    <span
      className={cn(
        'mod-status',
        mod.invalid ? 'is-invalid' : mod.installed ? 'is-installed' : 'is-uninstalled'
      )}
    >
      {mod.invalid ? <TriangleAlert /> : mod.installed ? <Check /> : <Circle />}
      {mod.invalid ? '已失效' : mod.installed ? '已安装' : '未安装'}
    </span>
  )
}
interface Props {
  mod: ModInfo
  actions: ModCardActions
  disabled: boolean
  selected: boolean
  active: boolean
  selectionActive: boolean
  displayName: string
  onActivate: (name: string) => void
}
function ModCard({
  mod,
  actions,
  disabled,
  selected,
  active,
  selectionActive,
  displayName,
  onActivate
}: Props) {
  return (
    <article
      data-mod-name={mod.name}
      className={cn(
        'mod-row',
        active && 'is-active',
        selected && 'is-selected',
        selectionActive && 'selection-mode'
      )}
    >
      <label className="mod-checkbox">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          aria-label={`选择模组：${mod.name}`}
          onChange={(event) =>
            actions.onToggleSelect(mod, {
              shiftKey: (event.nativeEvent as MouseEvent).shiftKey ?? false
            })
          }
        />
      </label>
      <button
        type="button"
        className="mod-row-body"
        aria-pressed={active}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey)
            actions.onToggleSelect(mod, { shiftKey: event.shiftKey })
          else onActivate(mod.name)
        }}
        title={mod.name}
      >
        <span className="mod-package-icon">
          {mod.subMods?.length ? <Layers /> : <Package />}
        </span>
        <span className="mod-row-copy">
          <strong>{displayName}</strong>
          <small>
            {!!mod.subMods?.length && <span className="bundle-badge">整合包 · {mod.subMods.length} 个子模组</span>}
            {formatFileSize(mod.sizeBytes)} · {formatImportedAt(mod.importedAt)}
          </small>
        </span>
      </button>
      <ModStatus mod={mod} />
      <Button
        variant={mod.installed || mod.invalid ? 'outline' : 'default'}
        size="sm"
        className="mod-install-button"
        disabled={disabled}
        onClick={() => actions.onToggleInstall(mod)}
      >
        {mod.installed ? '卸载' : mod.invalid ? '仍要安装' : '安装'}
      </Button>
    </article>
  )
}
export default memo(ModCard)
