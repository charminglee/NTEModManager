import { memo, useState } from 'react'
import {
  Blocks,
  FileText,
  Layers,
  PackageOpen,
  Play,
  Settings
} from 'lucide-react'
import { ALL_CATEGORY, OTHER_CATEGORY } from '@shared/types'
import { cn } from '@/lib/utils'
import { LiquidGlass } from '@/components/liquid-glass'
import { GlassButtonOverlay, GLASS_BUTTON_CONTENT_CLASS } from '@/components/ui/button'

export interface SidebarProps {
  /** 侧边栏展示顺序:全部在最上,普通分类按用户排序,其他固定在底部 */
  displayCategories: string[]
  counts: Map<string, number>
  currentCategory: string
  categoryImages: Map<string, string | null>
  appIcon: string | null
  busy: boolean
  view: 'mods' | 'logs'
  onSelectCategory: (category: string) => void
  onReorderCategories: (orderedNormalCategories: string[]) => void
  onLaunchGame: () => void
  onOpenLogs: () => void
  onOpenSettings: () => void
  /** F11 隐藏 UI 时为 true:面板自身淡出(不能用祖先 opacity,会破坏玻璃的 backdrop 采样) */
  uiHidden?: boolean
}

/** memo:日志推送等无关状态变化时不重渲染整棵分类树 */
function Sidebar({
  displayCategories,
  counts,
  currentCategory,
  categoryImages,
  appIcon,
  busy,
  view,
  uiHidden,
  onSelectCategory,
  onReorderCategories,
  onLaunchGame,
  onOpenLogs,
  onOpenSettings
}: SidebarProps) {
  const [draggingName, setDraggingName] = useState<string | null>(null)
  const [dropTargetName, setDropTargetName] = useState<string | null>(null)

  const isNormalCategory = (category: string) => category !== ALL_CATEGORY && category !== OTHER_CATEGORY

  const handleDrop = (targetName: string) => {
    if (!draggingName || draggingName === targetName) {
      setDraggingName(null)
      setDropTargetName(null)
      return
    }
    const normalCategories = displayCategories.filter(isNormalCategory)
    const fromIndex = normalCategories.indexOf(draggingName)
    const toIndex = normalCategories.indexOf(targetName)
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingName(null)
      setDropTargetName(null)
      return
    }
    normalCategories.splice(toIndex, 0, ...normalCategories.splice(fromIndex, 1))
    onReorderCategories(normalCategories)
    setDraggingName(null)
    setDropTargetName(null)
  }

  return (
    <LiquidGlass
      component="aside"
      area="sidebar"
      className={cn(
        'ui-fade z-10 ml-3 my-3 w-[290px] shrink-0 select-none rounded-2xl',
        uiHidden && 'ui-fade-hidden'
      )}
      contentClassName="flex h-full min-h-0 flex-col"
      depth={1}
      blur={2.5}
      dispersion={1}
    >
      {/* 品牌区 */}
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        {appIcon ? (
          <img
            src={appIcon}
            alt="NTE 模组管理器"
            draggable={false}
            className="h-10 w-10 shrink-0 rounded-xl object-contain ring-1 ring-foreground/15"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 to-fuchsia-600 shadow-glow">
            <Blocks className="h-5 w-5 text-white" />
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold tracking-wide text-foreground">
            NTE 模组管理器
          </div>
          <div className="truncate text-[11px] text-muted-foreground">Neverness to Everness</div>
        </div>
      </div>

      {/* 分类导航 */}
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          模组分类
        </div>
        {displayCategories.map((category) => {
          const isSpecial = !isNormalCategory(category)
          const active = view === 'mods' && currentCategory === category
          const image = categoryImages.get(category)
          const dropping = dropTargetName === category && draggingName !== category

          return (
            <button
              key={category}
              type="button"
              disabled={busy}
              draggable={isSpecial ? false : !busy}
              onDragStart={() => setDraggingName(category)}
              onDragOver={(event) => {
                if (draggingName && isNormalCategory(category)) {
                  event.preventDefault()
                  setDropTargetName(category)
                }
              }}
              onDragLeave={() => setDropTargetName((prev) => (prev === category ? null : prev))}
              onDrop={(event) => {
                event.preventDefault()
                handleDrop(category)
              }}
              onDragEnd={() => {
                setDraggingName(null)
                setDropTargetName(null)
              }}
              onClick={() => onSelectCategory(category)}
              className={cn(
                'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all duration-150',
                active
                  ? 'bg-primary/15 font-semibold text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
                  : 'text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground',
                dropping && 'before:absolute before:inset-x-2 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-primary'
              )}
            >
              {/* 选中框的液态玻璃:仅激活项挂覆盖层,参数与玻璃按钮一致(area=buttons)。
                  内容层必须包 GLASS_BUTTON_CONTENT_CLASS(内容带 relative 提到玻璃上方,
                  否则会被覆盖层盖住变糊);拖拽淡出放内容层——根元素 opacity<1 会截断
                  玻璃的 backdrop 采样 */}
              {active && <GlassButtonOverlay />}
              <span
                className={cn(
                  GLASS_BUTTON_CONTENT_CLASS,
                  'w-full gap-2.5 text-left',
                  draggingName === category && 'opacity-40'
                )}
              >
                {isSpecial ? (
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      active
                        ? 'bg-primary/25 text-primary'
                        : 'bg-foreground/[0.06] text-muted-foreground group-hover:text-foreground'
                    )}
                  >
                    {category === ALL_CATEGORY ? (
                      <Layers className="h-3.5 w-3.5" />
                    ) : (
                      <PackageOpen className="h-3.5 w-3.5" />
                    )}
                  </span>
                ) : image ? (
                  <img
                    src={image}
                    alt=""
                    draggable={false}
                    className="h-6 w-6 shrink-0 rounded-md object-cover ring-1 ring-foreground/15"
                  />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] text-xs font-bold text-foreground/70">
                    {category.slice(0, 1)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{category}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                    active ? 'bg-primary/20 text-primary' : 'bg-foreground/[0.06] text-muted-foreground'
                  )}
                >
                  {counts.get(category) ?? 0}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      {/* 底部操作区 */}
      <div className="space-y-2 border-t border-foreground/[0.08] p-3">
        {/* filter(brightness) 会成为 backdrop root,悬停时打碎玻璃层的背景采样,悬停反馈改用色标过渡 */}
        <button
          type="button"
          disabled={busy}
          onClick={onLaunchGame}
          className="group relative flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-linear-to-r from-violet-600/80 to-fuchsia-600/80 text-sm font-semibold text-white shadow-glow transition-all duration-150 hover:from-violet-500/85 hover:to-fuchsia-500/85 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-100"
        >
          <GlassButtonOverlay />
          <span className={GLASS_BUTTON_CONTENT_CLASS}>
            <Play className="h-4 w-4 fill-current" />
            启动游戏
          </span>
        </button>
        <div className="grid grid-cols-2 gap-2">
          <SideActionButton icon={<FileText className="h-4 w-4" />} label="日志" active={view === 'logs'} disabled={busy} onClick={onOpenLogs} />
          <SideActionButton icon={<Settings className="h-4 w-4" />} label="设置" disabled={busy} onClick={onOpenSettings} />
        </div>
      </div>
    </LiquidGlass>
  )
}

function SideActionButton({
  icon,
  label,
  onClick,
  active,
  disabled
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group relative flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-100',
        active
          ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]'
          : 'bg-foreground/[0.05] text-foreground/75 hover:bg-foreground/[0.08] hover:text-foreground'
      )}
    >
      <GlassButtonOverlay />
      <span className={GLASS_BUTTON_CONTENT_CLASS}>
        {icon}
        {label}
      </span>
    </button>
  )
}

export default memo(Sidebar)
