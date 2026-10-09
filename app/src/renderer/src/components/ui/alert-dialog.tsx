import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '@/lib/utils'
import { LiquidGlass } from '@/components/liquid-glass'
import { buttonVariants, GlassButtonOverlay, GLASS_BUTTON_CONTENT_CLASS } from '@/components/ui/button'

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(
  ({ className, ...props }, ref) => (
    <AlertDialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      {...props}
      ref={ref}
    />
  )
)
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    {/*
      Content 本身作为全屏 flex 容器做布局居中(而非 transform),避免 Windows
      缩放下文字渲染在非整数像素上发虚;Portal 的 Presence 跟踪的直接子元素就是
      Content,关闭动画的播放与检测依赖这一点,不能再往里包一层容器。
    */}
    <AlertDialogPrimitive.Content
      ref={ref}
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out"
      {...props}
    >
      {/* 液态玻璃面板,关闭效果时回退对话框同款毛玻璃;overlay-panel 是稳定钩子类
          (与 dialog.tsx 同名)。网格布局与内边距放在 relative 内容层;
          ui-fade-popover 让面板随开合淡入淡出且不打断 backdrop 采样 */}
      <LiquidGlass
        area="overlays"
        className={cn(
          'overlay-panel ui-fade-popover pointer-events-auto w-full max-w-lg rounded-xl shadow-card',
          className
        )}
        fallbackClassName="glass-dialog frosted"
        contentClassName="grid gap-4 p-6"
        depth={1}
        blur={4}
      >
        {children}
      </LiquidGlass>
    </AlertDialogPrimitive.Content>
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-2 text-left', className)} {...props} />
)
AlertDialogHeader.displayName = 'AlertDialogHeader'

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-row justify-end gap-2', className)} {...props} />
)
AlertDialogFooter.displayName = 'AlertDialogFooter'

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold', className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('whitespace-pre-wrap text-sm text-muted-foreground', className)}
    {...props}
  />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & {
    variant?: 'default' | 'destructive'
  }
>(({ className, variant = 'default', children, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(
      buttonVariants({ variant: variant === 'destructive' ? 'destructive' : 'default' }),
      'group relative disabled:opacity-100',
      className
    )}
    {...props}
  >
    <GlassButtonOverlay />
    <span className={GLASS_BUTTON_CONTENT_CLASS}>{children}</span>
  </AlertDialogPrimitive.Action>
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, children, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: 'outline' }), 'group relative disabled:opacity-100', className)}
    {...props}
  >
    <GlassButtonOverlay />
    <span className={GLASS_BUTTON_CONTENT_CLASS}>{children}</span>
  </AlertDialogPrimitive.Cancel>
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel
}
