import * as React from 'react'
import { LiquidGlass } from '@/components/liquid-glass'
import { cn } from '@/lib/utils'

/**
 * 输入框液态玻璃覆盖层:与按钮的 GlassButtonOverlay 同一配方(depth=0 无折射贴图,
 * 只做边缘高光与背景模糊,形状完全由 CSS 决定,可与外壳圆角严丝合缝)。
 * <input> 是空元素无法容纳覆盖层子元素,因此输入框由相对定位的外壳 +
 * 玻璃覆盖层 + 裸输入元素三层构成:液态模式下外壳不带底色,玻璃层即表面;
 * 玻璃关闭时覆盖层回退为 bg-secondary/40 底色,即无玻璃时的普通外观。
 * 文字偏移只来自外壳的 padding,输入元素自身 p-0——不可再继承一份造成双倍缩进。
 */
export function GlassInputOverlay() {
  return (
    <LiquidGlass
      area="inputs"
      aria-hidden
      crisp={false}
      className="glass-input-overlay pointer-events-none rounded-[inherit]"
      fallbackClassName="bg-secondary/40"
      style={{ position: 'absolute', inset: '0', clipPath: 'inset(0)' }}
      depth={0}
      blur={2}
    />
  )
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <span
        className={cn(
          'glass-input-root relative flex h-9 w-full rounded-md border border-input px-3 py-1 text-sm text-foreground shadow-xs transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring',
          className
        )}
      >
        <GlassInputOverlay />
        <input
          type={type}
          className="relative w-full min-w-0 bg-transparent p-0 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium"
          ref={ref}
          {...props}
        />
      </span>
    )
  }
)
Input.displayName = 'Input'

export { Input }
