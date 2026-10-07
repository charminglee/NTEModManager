import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      duration={3000}
      /* 底部弹出框与内容边距对齐:下边缘距窗口 12px(与面板 mb-3 一致),右边缘 16px(与 mx-4 一致) */
      offset={{ bottom: 12, right: 16 }}
      className="toaster group"
      toastOptions={{
        classNames: {
          /* 与菜单/对话框同款 glass-dialog frosted 毛玻璃浮层(不带 border-border,glass-dialog 自带边框) */
          toast:
            'group toast glass-dialog frosted text-foreground rounded-xl shadow-card',
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
