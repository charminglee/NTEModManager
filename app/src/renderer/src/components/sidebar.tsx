import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  onLaunchGame: () => void
  onOpenLogs: () => void
  onOpenSettings: () => void
  /** F11 隐藏 UI 时为 true:面板自身淡出(不能用祖先 opacity,会破坏玻璃的 backdrop 采样) */
  uiHidden?: boolean
}

/**
 * memo:日志推送等无关状态变化时不重渲染整棵分类树。
 *
 * 分类选中框是 nav 里单一悬浮指示条(手机导航栏式):按下时放大并可自由拖动——
 * 拖动中 1:1 跟随指针(不吸附行),松开才吸附到最近分类并提交选择。
 * 注意:这里占用「按住 + 移动」手势,分类的拖拽排序因此暂时关闭(App 侧
 * categoryOrder 数据模型与 setCategoryOrder API 原样保留)。
 */
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
  onLaunchGame,
  onOpenLogs,
  onOpenSettings
}: SidebarProps) {
  // 滑动选中框:静止时位置 = 目标按钮的 offsetTop(相对 nav 内容),分类增删后重量
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null)
  // 首次定位完成后才开过渡,避免挂载时指示条从导航顶部滑入
  const [indicatorReady, setIndicatorReady] = useState(false)
  // 自由拖动:y = 指示条顶部(nav 内容坐标)。moved 只区分「跟随中」与「按下滑向
  // 所按行的预览」——预览走基础过渡动画,跟随中 translate 零过渡;松手无论是否
  // 拖动过都提交最近分类(原地点击 = 最近行即所按行,click 再幂等提交一次)。
  // StrictMode 的 setState updater 会双调用,提交选择等副作用一律走 dragRef
  // 镜像,不放进 updater
  const [drag, setDrag] = useState<{ y: number; moved: boolean } | null>(null)
  const dragRef = useRef<{
    grabOffset: number
    y: number
    pressClientY: number
    startY: number
    moved: boolean
  } | null>(null)
  // 松手时选中框还在途中:settling 期间保持放大(与玻璃点亮)滑到位,
  // translate 的 transitionend(或兜底计时器)到达后才缩回默认尺寸
  const [settling, setSettling] = useState(false)
  const settleTimer = useRef<number | null>(null)

  // 指示条位置 = 当前分类按钮的几何;布局一旦变化(窗口缩放、字体加载、分类增删)
  // 必须重测,否则指示条停在旧位置与按钮错开——这是拖动/显示「错位」的一大来源
  const measureIndicator = () => {
    if (view !== 'mods') return
    const button = buttonRefs.current.get(currentCategory)
    if (!button) return
    setIndicator({ top: button.offsetTop, height: button.offsetHeight })
    if (!indicatorReady) {
      requestAnimationFrame(() => setIndicatorReady(true))
    }
  }

  useLayoutEffect(() => {
    measureIndicator()
    // 依赖含 indicatorReady:首次测量后挂 data-ready(开过渡)再测一次,抵消
    // StrictMode 双调用等造成的测量时机差异
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCategory, view, displayCategories, indicatorReady])

  useEffect(() => {
    // 窗口尺寸与字体晚载都会改变分类行的布局,而按钮 offsetTop 不会自行通知
    const remeasure = () => measureIndicator()
    window.addEventListener('resize', remeasure)
    document.fonts?.ready.then(remeasure)
    return () => {
      window.removeEventListener('resize', remeasure)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCategory, view, displayCategories, indicatorReady])

  // 指针坐标 → nav 内容坐标(指示条随内容滚动,translateY 必须用内容坐标)
  const contentY = (clientY: number) => {
    const nav = navRef.current
    return nav ? clientY - nav.getBoundingClientRect().top + nav.scrollTop : 0
  }

  // settling 完成:已滑到吸附行,缩回默认尺寸、熄灭玻璃点亮
  const finishSettle = () => {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current)
      settleTimer.current = null
    }
    setDrag(null)
    setSettling(false)
  }

  useEffect(() => {
    if (drag === null) return
    const move = (event: PointerEvent) => {
      const prev = dragRef.current
      const nav = navRef.current
      if (!prev || !nav) return
      const entries = [...buttonRefs.current.values()]
      if (entries.length === 0) return
      const rowHeight = entries[0].offsetHeight
      const min = entries[0].offsetTop
      const last = entries[entries.length - 1]
      if (!prev.moved) {
        // 按下后还没真正移动:只更新锚点基准(指针位置),不动 y——
        // 让「滑向所按行」的预览动画继续走,2px 内的抖动不算拖动
        if (Math.abs(event.clientY - prev.pressClientY) <= 2) return
        // 进入拖动:按滑向预览的实时动画位置重新锚定抓取点,无缝转 1:1 跟随
        let anchor = prev.y
        if (indicatorRef.current) {
          const cs = getComputedStyle(indicatorRef.current)
          if (cs.translate !== 'none') anchor = parseFloat(cs.translate.split(' ')[1])
        }
        const y = Math.min(last.offsetTop + last.offsetHeight - rowHeight, Math.max(min, anchor))
        dragRef.current = { grabOffset: contentY(event.clientY) - anchor, y, moved: true, pressClientY: prev.pressClientY }
        setDrag({ y, moved: true })
        return
      }
      const y = Math.min(
        last.offsetTop + last.offsetHeight - rowHeight,
        Math.max(min, contentY(event.clientY) - prev.grabOffset)
      )
      dragRef.current = { ...prev, y }
      setDrag({ y, moved: true })
    }
    const release = () => {
      const prev = dragRef.current
      dragRef.current = null
      if (!prev) return
      // 松手一律吸附最近分类并提交。原地点击时最近行就是所按行,随后 click 的
      // 提交与之幂等;不能在这里跳过提交——按下后选中框已滑向所按行,若不提交,
      // drag 清空会先把它退回旧分类再等 click 滑回来,出现来回滑的动画
      const entries = [...buttonRefs.current.entries()].map(([name, el]) => ({
        name,
        top: el.offsetTop,
        height: el.offsetHeight
      }))
      if (entries.length === 0) return
      const center = prev.y + entries[0].height / 2
      let nearest = entries[0]
      let nearestDist = Infinity
      for (const entry of entries) {
        const dist = Math.abs(entry.top + entry.height / 2 - center)
        if (dist < nearestDist) {
          nearestDist = dist
          nearest = entry
        }
      }
      // 直接把指示条放到吸附行:松手瞬间过渡类恢复,从自由位置平滑吸附过去;
      // 若吸附行就是当前分类,测量 effect 不会重跑,必须在这里显式归位
      onSelectCategory(nearest.name)
      setIndicator({ top: nearest.top, height: nearest.height })
      // 途中松手:保持放大滑到位,translate 的 transitionend(或兜底计时器)
      // 到达后再缩回;已到位(无 translate 动画在跑)则立即缩回
      const moving = indicatorRef.current
        ?.getAnimations()
        .some((a) => (a as CSSTransition).transitionProperty === 'translate')
      if (moving) {
        setDrag({ y: nearest.top, moved: false })
        setSettling(true)
        if (settleTimer.current !== null) clearTimeout(settleTimer.current)
        settleTimer.current = window.setTimeout(finishSettle, 450)
      } else {
        setDrag(null)
        setSettling(false)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
    }
  }, [drag !== null, onSelectCategory])

  // settling 期间监听 translate 到位:滑到吸附行后再缩回默认尺寸
  // (transitionend 万一丢失时由 release 里的兜底计时器接管)
  useEffect(() => {
    if (!settling) return
    const el = indicatorRef.current
    if (!el) return
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === 'translate') finishSettle()
    }
    el.addEventListener('transitionend', onEnd)
    return () => el.removeEventListener('transitionend', onEnd)
  }, [settling])

  const isNormalCategory = (category: string) => category !== ALL_CATEGORY && category !== OTHER_CATEGORY

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
      <nav ref={navRef} className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          模组分类
        </div>
        {/* 滑动选中框:translate(滑动/吸附)与 scale(按压放大)用独立属性,
            过渡在 index.css 按 data-dragging 分别调——按下未拖动时选中框带放大
            动画滑向所按行,真正拖动后 translate 零过渡 1:1 跟随指针。opacity 过渡
            不能落在它自身或祖先上(opacity<1 会截断玻璃的 backdrop 采样),
            显隐用 visibility 瞬切 */}
        <div
          ref={indicatorRef}
          aria-hidden
          data-ready={indicatorReady || undefined}
          data-pressed={drag !== null || undefined}
          data-dragging={(drag?.moved && !settling) || undefined}
          className="sidebar-active-indicator pointer-events-none absolute left-3 right-3 top-0 rounded-lg bg-primary/15 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]"
          style={{
            height: indicator?.height ?? 0,
            translate: `0 ${drag ? drag.y : indicator?.top ?? 0}px`,
            scale: drag !== null ? '1.07' : '1',
            visibility: (view === 'mods' || drag !== null) && indicator ? 'visible' : 'hidden'
          }}
        >
          <GlassButtonOverlay />
        </div>
        {displayCategories.map((category) => {
          const isSpecial = !isNormalCategory(category)
          const active = view === 'mods' && currentCategory === category
          const image = categoryImages.get(category)

          return (
            <button
              key={category}
              ref={(el) => {
                if (el) buttonRefs.current.set(category, el)
                else buttonRefs.current.delete(category)
              }}
              type="button"
              disabled={busy}
              onPointerDown={(event) => {
                // 新按压取消尚未完成的 settling(上一次滑行由新目标接管),
                // 按下即滑向所按分类(带放大动画):起点 = 所按行顶部。
                // 日志视图等指示条无位置时同样从所按行起;抓取点相对该行顶计算,
                // 一旦真正开始移动,按指示条实时动画位置重新锚定,无缝转 1:1 跟随
                if (settleTimer.current !== null) {
                  clearTimeout(settleTimer.current)
                  settleTimer.current = null
                }
                setSettling(false)
                const startY = buttonRefs.current.get(category)?.offsetTop ?? 0
                dragRef.current = {
                  grabOffset: contentY(event.clientY) - startY,
                  y: startY,
                  pressClientY: event.clientY,
                  moved: false
                }
                setDrag({ y: startY, moved: false })
              }}
              onClick={() => onSelectCategory(category)}
              className={cn(
                'group relative mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150',
                active
                  ? 'font-semibold text-foreground'
                  : 'text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground'
              )}
            >
              {/* 选中框已上移为 nav 里的滑动指示条(玻璃覆盖层跟指示条走),按钮只剩文字强调;
                  内容层仍包 GLASS_BUTTON_CONTENT_CLASS——禁用淡出落内容层,
                  根元素 opacity<1 会截断玻璃的 backdrop 采样 */}
              <span className={cn(GLASS_BUTTON_CONTENT_CLASS, 'w-full gap-2.5 text-left')}>
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
          : 'glass-btn-root text-foreground/75'
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
