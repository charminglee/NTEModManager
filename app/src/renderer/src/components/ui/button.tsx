import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { LiquidGlass } from '@/components/liquid-glass'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]',
  {
    variants: {
      variant: {
        // 各实心变体一律用半透明底色:液态玻璃覆盖层垫在底色之下,不透明底会把玻璃完全盖死
        default:
          'bg-primary/80 text-primary-foreground shadow-[0_4px_20px_-6px_hsl(var(--primary)/0.55)] hover:bg-primary/90',
        destructive: 'bg-destructive/80 text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-border bg-transparent hover:bg-secondary/70 hover:text-secondary-foreground',
        secondary: 'bg-secondary/70 text-secondary-foreground hover:bg-secondary/50',
        ghost: 'hover:bg-secondary/60 hover:text-secondary-foreground',
        // 无底色:默认与悬浮都不画任何自有矩形(悬浮反馈见 index.css 的 glass-btn-overlay
        // 规则——液态玻璃悬停=覆盖层高光增强,玻璃关闭=轻底色由 CSS 按覆盖层状态切换)
        glass: 'text-foreground',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-lg px-6',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/**
 * 液态玻璃覆盖层:所有按钮(全部变体)共用。玻璃垫在按钮底色之上(pointer-events:none),
 * inset 必须为 0 与底色完全重合——外扩会让玻璃的内沿高光环浮在底色边界外侧,
 * 看起来像玻璃叠在另一层色块上。悬浮反馈见 index.css 的 glass-btn-overlay 规则;
 * 玻璃关闭时回退为空层,按钮退回各自变体的普通外观。
 */
export function GlassButtonOverlay() {
  return (
    <LiquidGlass
      area="buttons"
      aria-hidden
      crisp={false}
      className="glass-btn-overlay pointer-events-none rounded-[inherit]"
      fallbackClassName=""
      style={{ position: 'absolute', inset: '0', clipPath: 'inset(0)' }}
      depth={0}
      blur={2}
    />
  )
}

/** 玻璃按钮的内容层:禁用淡出必须落在内容上——根元素 opacity<1 会截断玻璃的 backdrop 采样 */
export const GLASS_BUTTON_CONTENT_CLASS =
  'relative inline-flex items-center justify-center gap-2 transition-opacity group-disabled:opacity-50'

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    // 玻璃不能让 vaso 直接渲染按钮根:vaso 的玻璃层与根元素用同一标签渲染,
    // component="button" 会产生 button 嵌套 button 的非法结构,因此按钮保持唯一的
    // <button> 根,玻璃作为 pointer-events:none 的覆盖层盖在内容之下,
    // 并以 style 内联定位覆盖 vaso 根元素自带的 position:relative。
    if (!asChild) {
      return (
        <button
          ref={ref}
          className={cn(
            buttonVariants({ variant, size, className }),
            'group relative disabled:opacity-100',
            // glass 变体无自有底色,悬停反馈由 index.css 按覆盖层状态切换(需此标记类定位)
            variant === 'glass' && 'glass-btn-root'
          )}
          {...props}
        >
          <GlassButtonOverlay />
          <span className={GLASS_BUTTON_CONTENT_CLASS}>{children}</span>
        </button>
      )
    }
    // asChild(Slot)无法注入覆盖层子元素,退回无玻璃的普通渲染
    const Comp = Slot
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), 'disabled:opacity-50')}
        ref={ref}
        {...props}
      >
        {children}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
