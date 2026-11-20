import { memo } from 'react'
import { Check, Circle, Layers, Package, TriangleAlert } from 'lucide-react'
import type { ModInfo } from '@shared/types'
import { formatFileSize, formatImportedAt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { useCardContextMenu } from './card-context-menu'
import { ModCardMenu } from './mod-actions'

export interface ModCardActions {
  onToggleInstall: (mod: ModInfo) => void
  onToggleSubMod: (mod: ModInfo, childName: string, enabled: boolean) => void
  onRenameSubMod: (mod: ModInfo, childName: string) => void
  onReinstall: (mod: ModInfo) => void
  onRename: (mod: ModInfo) => void
  onRepackage: (mod: ModInfo) => void
  onAddArchive: (mod: ModInfo) => void
  onReplaceArchive: (mod: ModInfo) => void
  onExportArchive: (mod: ModInfo) => void
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
  selectionMode: boolean
  selected: boolean
  active: boolean
  displayName: string
  onActivate: (name: string) => void
}
function ModCard({
  mod,
  actions,
  disabled,
  selectionMode,
  selected,
  active,
  displayName,
  onActivate
}: Props) {
  const menu = useCardContextMenu(!disabled)

  return (
    <>
      <article
        data-mod-name={mod.name}
        className={cn('mod-row', active && 'is-active', selected && 'is-selected')}
        onContextMenu={menu.onContextMenu}
        onKeyDown={menu.onKeyDown}
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
          aria-pressed={selectionMode ? selected : active}
          aria-keyshortcuts="Shift+F10"
          onClick={(event) => {
            if (selectionMode || event.ctrlKey || event.metaKey) {
              if (!disabled) actions.onToggleSelect(mod, { shiftKey: event.shiftKey })
            } else {
              onActivate(mod.name)
            }
          }}
        >
          <span className="mod-package-icon">
            {mod.subMods?.length ? <Layers /> : <Package />}
          </span>
          <span className="mod-row-copy">
            <strong>{displayName}</strong>
            <small>
              {!!mod.subMods?.length && <span className="bundle-badge">整合包  ·  {mod.subMods.length} 个子模组</span>}
              {formatFileSize(mod.sizeBytes)}  ·  {formatImportedAt(mod.importedAt)}
            </small>
          </span>
        </button>
        <ModStatus mod={mod} />
        <Button
          variant={mod.installed || mod.invalid ? 'secondary' : 'default'}
          size="sm"
          className="mod-install-button"
          disabled={disabled}
          onClick={() => actions.onToggleInstall(mod)}
        >
          {mod.installed ? '卸载' : mod.invalid ? '仍要安装' : '安装'}
        </Button>
      </article>
      {menu.position && (
        <ModCardMenu
          mod={mod}
          actions={actions}
          position={menu.position}
          selected={selected}
          onActivate={onActivate}
          onClose={menu.close}
        />
      )}
    </>
  )
}
export default memo(ModCard)
