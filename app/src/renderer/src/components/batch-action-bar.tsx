import { memo } from 'react'
import { Download, ListChecks, Package, PackageOpen, RefreshCcw, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LiquidGlass } from '@/components/liquid-glass'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface BatchActionBarProps {
  /** 当前选中的模组数量 */
  count: number
  /** 当前视图内全部卡片都已选中时隐藏「全选」 */
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
  onDelete: () => void
  /** F11 隐藏 UI 时为 true:面板自身淡出(不能用祖先 opacity,会破坏玻璃的 backdrop 采样) */
  uiHidden?: boolean
}

/** 多选后的浮动批量操作栏:底部居中悬浮,仅在有选中项时挂载(从窗口底边直线滑出) */
function BatchActionBar({
  count,
  allSelected,
  canInstall,
  canUninstall,
  busy,
  uiHidden,
  onSelectAll,
  onClear,
  onInstall,
  onUninstall,
  onReinstall,
  onRepackage,
  onDelete
}: BatchActionBarProps) {
  return (
    // 外层只负责定位居中:相对模组列表区(main 加 relative)而非整个窗口;
    // -translate-x-1/2 是独立 translate 属性,不能与动画的 transform 叠加,
    // 否则滑出轨迹是斜线。内层只做入场动画(纯垂直位移),也不落 opacity:
    // 祖先 opacity<1 会截断玻璃的 backdrop 采样
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
      <div className="batch-bar-enter">
        <LiquidGlass
          area="toolbar"
          className={cn(
            'ui-fade pointer-events-auto rounded-2xl shadow-card',
            uiHidden && 'ui-fade-hidden'
          )}
          contentClassName="flex items-center gap-1.5 px-2.5 py-2"
          depth={1}
          blur={2}
        >
        <span className="select-none whitespace-nowrap px-2 text-xs font-semibold text-foreground/90">
          已选 {count} 个
        </span>
        <div className="h-5 w-px bg-foreground/10" />

        {!allSelected && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="glass" size="sm" disabled={busy} onClick={onSelectAll}>
                <ListChecks />
                全选
              </Button>
            </TooltipTrigger>
            <TooltipContent>选中当前列表中的全部模组(Ctrl+A)</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" size="sm" disabled={busy || !canInstall} onClick={onInstall}>
              <Download />
              安装
            </Button>
          </TooltipTrigger>
          <TooltipContent>安装选中项中未安装的模组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" size="sm" disabled={busy || !canUninstall} onClick={onUninstall}>
              <PackageOpen />
              卸载
            </Button>
          </TooltipTrigger>
          <TooltipContent>卸载选中项中已安装的模组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" size="sm" disabled={busy || !canUninstall} onClick={onReinstall}>
              <RefreshCcw />
              重新安装
            </Button>
          </TooltipTrigger>
          <TooltipContent>卸载并重装选中项中已安装的模组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" size="sm" disabled={busy} onClick={onRepackage}>
              <Package />
              重新打包
            </Button>
          </TooltipTrigger>
          <TooltipContent>逐个重新打包选中的模组(未记录源文件夹时会弹窗选择)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
              <Trash2 />
              删除
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除选中的模组(不可撤销)</TooltipContent>
        </Tooltip>

        <div className="h-5 w-px bg-foreground/10" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="glass"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={busy}
              onClick={onClear}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>清除选择(Esc)</TooltipContent>
        </Tooltip>
        </LiquidGlass>
      </div>
    </div>
  )
}

export default memo(BatchActionBar)
