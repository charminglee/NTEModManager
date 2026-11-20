import {
  CircleArrowUp,
  Download,
  FolderInput,
  FolderOpen,
  Info,
  ListChecks,
  MoreHorizontal,
  Package,
  PackageOpen,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { ModInfo } from '@shared/types'
import type { ModCardActions } from './mod-card'
import { CardContextMenu, type CardMenuPosition } from './card-context-menu'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

interface ModActionProps {
  mod: ModInfo
  actions: ModCardActions
}

function ModArchiveActionItems({ mod, actions }: ModActionProps) {
  return (
    <>
      <DropdownMenuItem onSelect={() => actions.onReplaceArchive(mod)}>
        <CircleArrowUp />
        更新／替换
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.onExportArchive(mod)}>
        <Download />
        导出
      </DropdownMenuItem>
    </>
  )
}

function ModFlagAndDeleteItems({ mod, actions }: ModActionProps) {
  return (
    <>
      <DropdownMenuItem onSelect={() => actions.onToggleInvalid(mod)}>
        <TriangleAlert />
        {mod.invalid ? '取消失效标记' : '标记为失效'}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem destructive onSelect={() => actions.onDelete(mod)}>
        <Trash2 />
        删除模组
      </DropdownMenuItem>
    </>
  )
}

export default function ModActions({
  mod,
  actions,
  disabled,
  label
}: ModActionProps & {
  disabled: boolean
  label?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={label ? 'outline' : 'ghost'}
          size={label ? 'default' : 'icon'}
          className={label ? undefined : 'size-8'}
          disabled={disabled}
          aria-label={label ?? `更多操作：${mod.name}`}
        >
          <MoreHorizontal />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <ModArchiveActionItems mod={mod} actions={actions} />
        <DropdownMenuSeparator />
        <ModFlagAndDeleteItems mod={mod} actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ModCardMenu({
  mod,
  actions,
  position,
  selected,
  onActivate,
  onClose
}: ModActionProps & {
  position: CardMenuPosition
  selected: boolean
  onActivate: (name: string) => void
  onClose: () => void
}) {
  return (
    <CardContextMenu label={`模组操作：${mod.name}`} position={position} onClose={onClose}>
      <DropdownMenuItem onSelect={() => onActivate(mod.name)}>
        <Info />
        查看详情
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.onToggleSelect(mod, { shiftKey: false })}>
        <ListChecks />
        {selected ? '取消选中模组' : '选中模组'}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => actions.onToggleInstall(mod)}>
        <PackageOpen />
        {mod.installed ? '卸载' : mod.invalid ? '仍要安装' : '安装'}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!mod.installed} onSelect={() => actions.onReinstall(mod)}>
        <RefreshCw />
        重新安装
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => actions.onRename(mod)}>
        <Pencil />
        重命名模组
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.onRepackage(mod)}>
        <Package />
        重新打包
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.onAddArchive(mod)}>
        <FolderInput />
        添加
      </DropdownMenuItem>
      <ModArchiveActionItems mod={mod} actions={actions} />
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => actions.onOpenSource(mod)}>
        <FolderOpen />
        打开源目录
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!mod.installed} onSelect={() => actions.onOpenInstall(mod)}>
        <FolderOpen />
        打开安装目录
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <ModFlagAndDeleteItems mod={mod} actions={actions} />
    </CardContextMenu>
  )
}
