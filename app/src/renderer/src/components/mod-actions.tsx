import {
  CircleArrowUp,
  Download,
  MoreHorizontal,
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
          className={label ? undefined : 'size-8'}
          disabled={disabled}
          aria-label={label ?? `更多操作：${mod.name}`}
        >
          <MoreHorizontal />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => actions.onReplaceArchive(mod)}>
          <CircleArrowUp />
          更新／替换
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.onExportArchive(mod)}>
          <Download />
          导出
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.onToggleInvalid(mod)}>
          <TriangleAlert />
          {mod.invalid ? '取消失效标记' : '标记为失效'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => actions.onDelete(mod)}>
          <Trash2 />
          删除模组
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
