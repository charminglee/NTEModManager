import {
  CircleArrowUp,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  Package,
  Pencil,
  RefreshCcw,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { ModInfo } from '@shared/types'
import type { ModCardActions } from './mod-card'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
export default function ModActions({
  mod,
  actions,
  disabled,
  label
}: {
  mod: ModInfo
  actions: ModCardActions
  disabled: boolean
  label?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={label ? 'outline' : 'ghost'}
          size={label ? 'default' : 'icon'}
          disabled={disabled}
          aria-label={label ?? `更多操作：${mod.name}`}
        >
          <MoreHorizontal />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
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
          添加压缩包
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onReplaceArchive(mod)}>
          <CircleArrowUp />
          更新／替换压缩包
        </DropdownMenuItem>
        {mod.installed && (
          <DropdownMenuItem onSelect={() => actions.onReinstall(mod)}>
            <RefreshCcw />
            重新安装
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.onToggleInvalid(mod)}>
          <TriangleAlert />
          {mod.invalid ? '取消失效标记' : '标记为失效'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onOpenSource(mod)}>
          <FolderOpen />
          打开源文件位置
        </DropdownMenuItem>
        {mod.installed && (
          <DropdownMenuItem onSelect={() => actions.onOpenInstall(mod)}>
            <FolderOpen />
            打开安装位置
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => actions.onDelete(mod)}>
          <Trash2 />
          删除模组
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
