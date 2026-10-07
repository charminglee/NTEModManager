import { memo, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  CircleArrowUp,
  FolderOpen,
  FolderInput,
  MoreHorizontal,
  Package,
  PackageCheck,
  Pencil,
  RefreshCcw,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { ModInfo } from '@shared/types'
import { formatFileSize, formatImportedAt } from '@/lib/format'
import { cn } from '@/lib/utils'
import FileTree from '@/components/file-tree'
import { LiquidGlass } from '@/components/liquid-glass'
import { Badge } from '@/components/ui/badge'
import { Button, GlassButtonOverlay, GLASS_BUTTON_CONTENT_CLASS } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface ModCardActions {
  onToggleInstall: (mod: ModInfo) => void
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
}

interface ModCardProps {
  mod: ModInfo
  actions: ModCardActions
  disabled: boolean
  /** F11 隐藏 UI 时为 true:面板自身淡出(不能用祖先 opacity,会破坏玻璃的 backdrop 采样) */
  uiHidden?: boolean
}

/** 视口首次可见回调的共享 IntersectionObserver:卡片上百张,不能每卡一个 observer 实例 */
let revealObserver: IntersectionObserver | null = null
const revealCallbacks = new WeakMap<Element, (delayMs: number) => void>()

const STAGGER_STEP_MS = 45
/** 批内交错上限:视口特别高、单批卡片很多时,最后一张也不晚于 495ms 起步 */
const MAX_STAGGER_MS = 11 * STAGGER_STEP_MS

function observeFirstViewportEntry(el: Element, onReveal: (delayMs: number) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onReveal(0)
    return () => {}
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        // 同批进入视口的卡片按视口纵坐标排序,批内自上而下依次交错推入。
        // 交错只在批内分配、不跨批累积:若用全局游标排队,快速甩动滚动时
        // 途中掠过视口的卡片会逐张领走槽位,滚到底部后视口内的卡片
        // 反而要等游标追上来才能推入
        const revealed = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        for (const [batchIndex, entry] of revealed.entries()) {
          revealObserver!.unobserve(entry.target)
          const callback = revealCallbacks.get(entry.target)
          revealCallbacks.delete(entry.target)
          callback?.(Math.min(batchIndex * STAGGER_STEP_MS, MAX_STAGGER_MS))
        }
      },
      // 底部外扩一点:卡片刚探入视口就开始推入,而不是完整出现后才动
      { rootMargin: '0px 0px 5% 0px' }
    )
  }
  revealCallbacks.set(el, onReveal)
  revealObserver.observe(el)
  return () => {
    revealObserver?.unobserve(el)
    revealCallbacks.delete(el)
  }
}

/** memo:列表卡片多且各带 vaso 玻璃实例,无关状态(如日志推送)变化时不重渲染 */
function ModCard({ mod, actions, disabled, uiHidden }: ModCardProps) {
  const [expanded, setExpanded] = useState(false)
  // 推入动画在卡片首次进入视口时才播放:挂载即处于右侧等待态(不可见),
  // 观察器触发后整体置换为播放态,避免回调前的「先定格后跳动」闪现
  const [entered, setEntered] = useState(false)
  const revealRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = revealRef.current
    if (!el) return
    return observeFirstViewportEntry(el, (delayMs) => {
      el.style.setProperty('--card-enter-delay', `${delayMs}ms`)
      setEntered(true)
    })
  }, [])

  return (
    <div ref={revealRef} className={cn(entered ? 'card-go' : 'card-wait')}>
        <LiquidGlass
          area="modCards"
          className={cn(
            'ui-fade overflow-hidden rounded-xl',
            uiHidden && 'ui-fade-hidden',
            entered ? 'card-enter' : 'card-children-wait'
          )}
          depth={1.4}
          blur={1.5}
          crisp={false}
        >
        <div className="relative flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            disabled={disabled}
            className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                !expanded && '-rotate-90'
              )}
            />
            {mod.invalid && (
              <TriangleAlert
                className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400"
                aria-label="此模组已标记为失效"
              />
            )}
            <div className="min-w-0">
              <div className="select-text truncate text-[15px] font-semibold text-foreground">
                {mod.name}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {formatFileSize(mod.sizeBytes)} · 导入于 {formatImportedAt(mod.importedAt)}
              </div>
            </div>
          </button>
  
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                onClick={() => actions.onToggleInstall(mod)}
                className={cn(
                  'group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3.5 text-xs font-semibold transition-all duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-100',
                  mod.installed
                    ? 'bg-[hsl(var(--success)/0.2)] text-[hsl(var(--success))] shadow-[inset_0_0_0_1px_hsl(var(--success)/0.4)] hover:bg-[hsl(var(--success)/0.3)]'
                    : 'bg-secondary/70 text-secondary-foreground shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.1)] hover:bg-secondary'
                )}
              >
                <GlassButtonOverlay />
                <span className={GLASS_BUTTON_CONTENT_CLASS}>
                  {mod.installed ? (
                    <>
                      <PackageCheck className="h-3.5 w-3.5" />
                      已安装
                    </>
                  ) : (
                    <>
                      <Package className="h-3.5 w-3.5" />
                      未安装
                    </>
                  )}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{mod.installed ? '点击卸载此模组' : '点击安装此模组'}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-full focus-visible:ring-0 focus-visible:ring-offset-0"
                    disabled={disabled}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>更多操作</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="end"
              className="w-48"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuItem onClick={() => actions.onRename(mod)}>
                <Pencil />
                重命名...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions.onRepackage(mod)}>
                <Package />
                重新打包
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onAddArchive(mod)}>
                <FolderInput />
                添加...
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onReplaceArchive(mod)}>
                <CircleArrowUp />
                更新/替换...
              </DropdownMenuItem>
              {mod.installed && (
                <DropdownMenuItem onClick={() => actions.onReinstall(mod)}>
                  <RefreshCcw />
                  重新安装
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions.onToggleInvalid(mod)}>
                <TriangleAlert />
                {mod.invalid ? '取消失效标记' : '标记为失效'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions.onOpenSource(mod)}>
                <FolderOpen />
                打开源文件位置
              </DropdownMenuItem>
              {mod.installed && (
                <DropdownMenuItem onClick={() => actions.onOpenInstall(mod)}>
                  <FolderOpen />
                  打开安装位置
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onClick={() => actions.onDelete(mod)}>
                <Trash2 />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
  
        <div
          className={cn(
            'relative grid transition-[grid-template-rows] duration-200 ease-out',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="mx-3 mb-3 rounded-lg border border-foreground/[0.08] p-2">
              {mod.files.length > 0 ? (
                <FileTree
                  entries={mod.files}
                  depth={0}
                  relativeBase=""
                  onRenameFile={(relativePath, newName) => actions.onRenameFile(mod, relativePath, newName)}
                />
              ) : (
                <div className="px-3 py-2 text-xs italic text-muted-foreground">文件夹为空</div>
              )}
            </div>
            {mod.invalid && (
              <div className="px-4 pb-3">
                <Badge variant="destructive">已标记为失效</Badge>
              </div>
            )}
          </div>
        </div>
        </LiquidGlass>
    </div>
  )
}

export default memo(ModCard)
