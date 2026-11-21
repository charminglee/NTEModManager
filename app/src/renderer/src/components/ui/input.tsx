import * as React from 'react'
import { cn } from '@/lib/utils'
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
export { Input }
