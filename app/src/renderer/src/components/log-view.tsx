import { memo, useEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LiquidGlass } from '@/components/liquid-glass'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@shared/types'

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
  debug: 'text-muted-foreground/70',
  info: 'text-foreground/85',
  warning: 'text-amber-600 dark:text-amber-300/90',
  error: 'text-[hsl(0,72%,44%)] dark:text-[hsl(0,85%,72%)]'
}

const LEVEL_LABELS: Record<LogEntry['level'], string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR'
}

interface LogViewProps {
  logs: LogEntry[]
  /** F11 隐藏 UI 时为 true:面板自身淡出(不能用祖先 opacity,会破坏玻璃的 backdrop 采样) */
  uiHidden?: boolean
}

/** 界面最多渲染的日志条数;完整日志在 INI 同目录的日志文件里 */
const MAX_VISIBLE_LOGS = 500

/** memo:日志推送频繁,未打开日志页时不重渲染 */
function LogView({ logs, uiHidden }: LogViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [followTail, setFollowTail] = useState(true)
  const [showJumpButton, setShowJumpButton] = useState(false)
  const visibleLogs = logs.length > MAX_VISIBLE_LOGS ? logs.slice(-MAX_VISIBLE_LOGS) : logs

  useEffect(() => {
    const container = containerRef.current
    if (container && followTail) {
      container.scrollTop = container.scrollHeight
    }
  }, [logs, followTail])

  const handleScroll = () => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const atBottom = container.scrollTop >= container.scrollHeight - container.clientHeight - 4
    setFollowTail(atBottom)
    setShowJumpButton(!atBottom)
  }

  const jumpToBottom = () => {
    const container = containerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
      setFollowTail(true)
      setShowJumpButton(false)
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      {/* 关闭液态玻璃时回退为对话框同款毛玻璃,保证日志仍浮在背景图上可读 */}
      <LiquidGlass
        area="logPanel"
        className={cn('ui-fade h-full rounded-xl', uiHidden && 'ui-fade-hidden')}
        fallbackClassName="glass-dialog frosted"
        contentClassName="h-full"
        depth={1}
        blur={2}
      >
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto p-4"
        >
          {logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无日志
            </div>
          ) : (
            <div className="select-text space-y-0.5 font-mono text-xs leading-relaxed">
              {visibleLogs.map((entry, index) => (
                <div key={index} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground/60">{entry.timestamp}</span>
                  <span className={`shrink-0 font-semibold ${LEVEL_COLORS[entry.level]}`}>
                    {LEVEL_LABELS[entry.level]}
                  </span>
                  <span className={`${LEVEL_COLORS[entry.level]} break-all`}>{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </LiquidGlass>
      <div
        className={cn(
          'pointer-events-none absolute bottom-4 right-8 transition-opacity duration-300',
          uiHidden && 'opacity-0'
        )}
      >
        {showJumpButton && (
          <Button
            variant="glass"
            size="icon"
            className="pointer-events-auto h-8 w-8 rounded-full"
            onClick={jumpToBottom}
            title="滚动到底部"
          >
            <ArrowDown />
          </Button>
        )}
      </div>
    </div>
  )
}

export default memo(LogView)
