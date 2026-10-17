import * as React from 'react'
import { LiquidGlass } from '@/components/liquid-glass'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      // 玻璃长在外壳 <span> 上:折射层是壳内的注入画布,输入框本身
      // 保持透明背景与自有的文字/光标行为。文字偏移只来自外壳的 padding,
      // 输入元素自身 p-0——不可再继承一份造成双倍缩进
      <LiquidGlass
        overlay
        area="inputs"
        crisp={false}
        button
        fallbackClassName="bg-secondary/40"
        className={cn(
          'relative flex h-9 w-full rounded-md border border-input px-3 py-1 text-sm text-foreground shadow-xs transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring',
          className
        )}
      >
        <input
          type={type}
          className="relative w-full min-w-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium"
          ref={ref}
          {...props}
        />
      </LiquidGlass>
    )
  }
)
Input.displayName = 'Input'

export { Input }
