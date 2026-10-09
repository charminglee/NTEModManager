import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { toast as sonner } from 'sonner'
import { LiquidGlass } from '@/components/liquid-glass'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'info' | 'warning' | 'error'

/** 与 sonner 内置 toast 一致的调用形态:标题 + 可选描述 */
interface ToastOptions {
  description?: string
}

const VARIANT_ICONS: Record<ToastVariant, LucideIcon> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleX
}

/**
 * toast 卡片:液态玻璃面板,关闭效果时回退对话框同款毛玻璃。sonner 的 li 只是定位
 * 外壳(样式重定义见 index.css 的 data-styled='false' 规则),入位/堆叠/滑动关闭/
 * 定时消失仍由 sonner 负责,这里只画视觉;宽度跟 sonner 容器注入的 --width 变量。
 */
function ToastCard({
  variant,
  title,
  description
}: {
  variant: ToastVariant
  title: string
  description?: string
}) {
  const Icon = VARIANT_ICONS[variant]
  return (
    <LiquidGlass
      area="overlays"
      className="ui-fade-popover w-(--width) rounded-xl shadow-card"
      fallbackClassName="glass-dialog frosted"
      contentClassName={cn(
        'flex gap-2.5 p-4 text-foreground',
        description ? 'items-start' : 'items-center'
      )}
      depth={1}
      blur={4}
    >
      <Icon className={cn('h-5 w-5 shrink-0', description && 'mt-0.5')} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-medium leading-normal">{title}</span>
        {description && (
          <span className="whitespace-pre-wrap text-[13px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </div>
    </LiquidGlass>
  )
}

function show(variant: ToastVariant, title: string, options?: ToastOptions) {
  sonner.custom(() => <ToastCard variant={variant} title={title} description={options?.description} />)
}

/** 应用通知入口:与 sonner 的 toast 同形(本应用用到的子集),渲染为液态玻璃卡片 */
export const toast = {
  success: (title: string, options?: ToastOptions) => show('success', title, options),
  info: (title: string, options?: ToastOptions) => show('info', title, options),
  warning: (title: string, options?: ToastOptions) => show('warning', title, options),
  error: (title: string, options?: ToastOptions) => show('error', title, options)
}
