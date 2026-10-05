import { memo } from 'react'
import { LiquidGlass } from '@/components/liquid-glass'
import FpsCounter from '@/components/fps-counter'
import { cn } from '@/lib/utils'

interface StatusBarProps {
  totalMods: number
  installedMods: number
  /** 是否在状态栏内显示 FPS 计数(设置「高级」里的性能诊断开关) */
  fpsVisible?: boolean
  /** F11 隐藏 UI 时为 true:面板自身淡出(不能用祖先 opacity,会破坏玻璃的 backdrop 采样) */
  uiHidden?: boolean
}

/** memo:日志推送等无关状态变化时不重渲染(含 FPS 计数与 vaso 实例) */
function StatusBar({ totalMods, installedMods, fpsVisible, uiHidden }: StatusBarProps) {
  return (
    <LiquidGlass
      component="footer"
      area="statusBar"
      className={cn(
        'liquid ui-fade mx-4 mb-3 shrink-0 rounded-xl',
        uiHidden && 'ui-fade-hidden'
      )}
      contentClassName="flex h-10 select-none items-center gap-3 px-4 text-xs text-muted-foreground"
      depth={1}
      blur={2}
    >
      {fpsVisible && <FpsCounter />}
      <span className="ml-auto shrink-0 tabular-nums">
        {totalMods} 个模组 · {installedMods} 个已安装
      </span>
    </LiquidGlass>
  )
}

export default memo(StatusBar)
