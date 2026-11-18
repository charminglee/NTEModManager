import { memo } from 'react'
import {
  Download,
  ListChecks,
  Package,
  PackageOpen,
  RefreshCcw,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

interface BatchActionBarProps {
  /** 当前选中的模组数量 */
  count: number
  /** 当前视图内全部卡片都已选中时显示「全不选」 */
  allSelected: boolean
  /** 选中项中存在未安装的模组(否则「安装」无意义,禁用) */
  canInstall: boolean
  /** 选中项中存在已安装的模组(否则「卸载」「重新安装」无意义,禁用) */
  canUninstall: boolean
  busy: boolean
  onSelectAll: () => void
  onClear: () => void
  onInstall: () => void
  onUninstall: () => void
  onReinstall: () => void
  onRepackage: () => void
  onMarkInvalid: () => void
  onUnmarkInvalid: () => void
  onDelete: () => void
}

/** 多选后的浮动批量操作栏:底部居中悬浮,仅在有选中项时挂载(从窗口底边直线滑出) */
function BatchActionBar({
  count,
  allSelected,
  canInstall,
  canUninstall,
  busy,
  onSelectAll,
  onClear,
  onInstall,
  onUninstall,
  onReinstall,
  onRepackage,
  onMarkInvalid,
  onUnmarkInvalid,
  onDelete
}: BatchActionBarProps) {
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
      <div className="batch-bar-enter">
        <div className="pointer-events-auto batch-surface shadow-card">
          <span className="select-none whitespace-nowrap px-2 text-xs font-semibold text-foreground/90">
            已选 {count} 个
          </span>
          <div className="h-5 w-px bg-foreground/10" />

          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={allSelected ? onClear : onSelectAll}
          >
            {allSelected ? <X /> : <ListChecks />}
            {allSelected ? '全不选' : '全选'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={busy || !canInstall}
            onClick={onInstall}
          >
            <Download />
            安装
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={busy || !canUninstall}
            onClick={onUninstall}
          >
            <PackageOpen />
            卸载
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={busy || !canUninstall}
            onClick={onReinstall}
          >
            <RefreshCcw />
            重新安装
          </Button>

          <Button variant="outline" size="sm" disabled={busy} onClick={onRepackage}>
            <Package />
            重新打包
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                <TriangleAlert />
                标记失效
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onMarkInvalid}>标记为失效</DropdownMenuItem>
              <DropdownMenuItem onSelect={onUnmarkInvalid}>取消失效标记</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
            <Trash2 />
            删除
          </Button>
        </div>
      </div>
    </div>
  )
}

export default memo(BatchActionBar)
