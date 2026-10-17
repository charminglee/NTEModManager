import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { LiquidGlass } from '@/components/liquid-glass'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-95',
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
        // 无底色:默认与悬浮都不画任何自有矩形(悬浮反馈见 index.css 的 glass-btn-root
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
 * 实心变体(有底色)的玻璃不透明度:玻璃压在半透明底色之上,让底色透出来形成
 * 「有色玻璃」,靠 opacity 把产品配色(紫罗兰主色等)保留下来
 */
const TINTED_GLASS_OPACITY = 0.6

export interface GlassButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'ref'> {
  /** 有底色的按钮:让底色透过玻璃(有色玻璃);无底色的玻璃按钮用 false */
  tinted?: boolean
  /** 交互反馈:悬浮提亮、按下压平棱面 */
  button?: boolean
}

/**
 * 自定义外观按钮的玻璃封装:玻璃长在 <button> 本体上(注入 canvas + z-index:-1),
 * 文字/图标照常是活的 DOM。列表卡片、侧边栏底部等自绘按钮统一走这里,
 * 于是「玻璃 + 可控外观」不必再维护覆盖层 + 内容层两层结构。
 */
export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, children, tinted = true, button = true, ...props }, ref) => (
    <LiquidGlass
      component="button"
      ref={ref}
      area="buttons"
      overlay
      crisp={false}
      variant="control"
      button={button}
      opacity={tinted ? TINTED_GLASS_OPACITY : 1}
      // 玻璃关闭时按钮不做毛玻璃回退:它自身的变体样式(实心底色/描边/悬停)就是回退外观
      fallbackClassName=""
      className={className}
      {...props}
    >
      {children}
    </LiquidGlass>
  )
)
GlassButton.displayName = 'GlassButton'

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    // 玻璃直接长在 <button> 上:折射层是按钮内的注入画布(z-index:-1),
    // 文字等内容照常是活的 DOM;按钮因此能拿到悬浮提亮/按下压平反馈
    // (该反馈需要指针事件落在玻璃元素上)
    if (!asChild) {
      return (
        <GlassButton
          ref={ref}
          button={variant !== 'link'}
          tinted={variant !== 'glass'}
          className={cn(
            buttonVariants({ variant, size, className }),
            // glass 变体无自有底色,玻璃关闭时它的悬停反馈由 CSS 按标记类切换
            variant === 'glass' && 'glass-btn-root'
          )}
          {...props}
        >
          {children}
        </GlassButton>
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
