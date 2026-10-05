import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      duration={3000}
      /* 底部弹出框与状态栏对齐:下边缘 = 状态栏上缘(mb-3 12px + h-10 40px)+ 10px 间隔;
         右边缘与状态栏右缘(mx-4)平齐。状态栏边距调整时需同步这里 */
      offset={{ bottom: 62, right: 16 }}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast glass-dialog border-border text-foreground rounded-xl shadow-card',
          description: 'text-muted-foreground whitespace-pre-wrap',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-secondary text-secondary-foreground'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
