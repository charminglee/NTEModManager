import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LiquidGlass } from '@/components/liquid-glass'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // dialog-overlay 是稳定钩子类:设置滑块拖动隔离(index.css)按它定位遮罩
      'dialog-overlay fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    {/*
      Content 本身作为全屏 flex 容器做布局居中(而非 transform),避免 Windows
      缩放下文字渲染在非整数像素上发虚;Portal 的 Presence 跟踪的直接子元素就是
      Content,关闭动画的播放与检测依赖这一点,不能再往里包一层容器。
    */}
    <DialogPrimitive.Content
      ref={ref}
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out"
      {...props}
    >
      {/* 面板后垫全屏透明关闭层:点击面板外的空白区域即可关闭对话框 */}
      <DialogPrimitive.Close
        tabIndex={-1}
        aria-label="关闭"
        className="pointer-events-auto absolute inset-0 cursor-default rounded-none bg-transparent opacity-0 outline-none"
      />
      {/* 液态玻璃面板,关闭效果时回退对话框同款毛玻璃;overlay-panel 是滑块拖动
          隔离(index.css)按它定位面板的稳定钩子类。ui-fade-popover 让面板随开合
          淡入淡出且不打断 backdrop 采样;网格布局与内边距放在 relative 内容层 */}
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
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 opacity-70 transition-opacity hover:bg-secondary hover:opacity-100 focus:outline-none disabled:pointer-events-none">
              <X className="h-4 w-4" />
              <span className="sr-only">关闭</span>
            </DialogPrimitive.Close>
          </TooltipTrigger>
          <TooltipContent>关闭</TooltipContent>
        </Tooltip>
      </LiquidGlass>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-row justify-end gap-2', className)} {...props} />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
}
