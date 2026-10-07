import { memo } from 'react'
import { ArrowUpDown, Download, Package, PackageOpen, RefreshCw, Search, Upload } from 'lucide-react'
import { SORT_OPTIONS, type SortOrder } from '@shared/types'
import { cn } from '@/lib/utils'
import { LiquidGlass } from '@/components/liquid-glass'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ModListHeaderProps {
  category: string
  count: number
  /** 已安装的模组数量,显示在总数右侧 */
  installedCount: number
  search: string
  sortOrder: SortOrder
  busy: boolean
  onSearchChange: (value: string) => void
  onSortOrderChange: (order: SortOrder) => void
  onInstallAll: () => void
  onUninstallAll: () => void
  onRefresh: () => void
  onImport: () => void
  onPackageMod: () => void
  /** F11 隐藏 UI 时为 true:玻璃面板自身淡出(不能用祖先 opacity,会破坏 backdrop 采样) */
  uiHidden?: boolean
}

/** memo:日志推送等无关状态变化时不重渲染工具栏(含 vaso 实例);搜索输入仍正常更新 */
function ModListHeader({
  category,
  count,
  installedCount,
  search,
  sortOrder,
  busy,
  uiHidden,
  onSearchChange,
  onSortOrderChange,
  onInstallAll,
  onUninstallAll,
  onRefresh,
  onImport,
  onPackageMod
}: ModListHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pb-4 pt-6">
      <div
        className={cn(
          'min-w-0 transition-opacity duration-300',
          uiHidden && 'opacity-0'
        )}
      >
        <h1 className="truncate text-2xl font-bold tracking-wide text-foreground text-shadow-soft">
          {category}
        </h1>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {count} 个模组 · {installedCount} 个已安装
        </div>
      </div>

      <LiquidGlass
        area="toolbar"
        className={cn('ui-fade ml-auto rounded-2xl', uiHidden && 'ui-fade-hidden')}
        contentClassName="flex flex-wrap items-center gap-2 px-2.5 py-2"
        depth={1}
        blur={2}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索模组..."
            className="h-9 w-44 border-transparent pl-8 hover:bg-foreground/[0.06]"
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" size="icon" disabled={busy} onClick={onRefresh}>
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>重新扫描模组目录</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="glass" size="icon" disabled={busy}>
                  <ArrowUpDown />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>更改排序方式</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>排序方式</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SORT_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={option.value === sortOrder}
                onCheckedChange={() => onSortOrderChange(option.value)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" disabled={busy} onClick={onInstallAll}>
              <Download />
              全部安装
            </Button>
          </TooltipTrigger>
          <TooltipContent>安装当前分类中的所有未安装模组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" disabled={busy} onClick={onUninstallAll}>
              <PackageOpen />
              全部卸载
            </Button>
          </TooltipTrigger>
          <TooltipContent>卸载当前分类中的所有已安装模组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="glass" disabled={busy} onClick={onPackageMod}>
              <Package />
              打包
            </Button>
          </TooltipTrigger>
          <TooltipContent>打包模组</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button disabled={busy} onClick={onImport}>
              <Upload />
              导入
            </Button>
          </TooltipTrigger>
          <TooltipContent>从压缩包导入模组</TooltipContent>
        </Tooltip>
      </LiquidGlass>
    </header>
  )
}

export default memo(ModListHeader)
