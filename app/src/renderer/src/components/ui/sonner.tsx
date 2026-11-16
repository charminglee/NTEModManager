import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

/** 通知定位与生命周期容器，通知卡片由应用绘制。 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="bottom-right"
      duration={3000}
      /* 底部弹出框与内容边距对齐:下边缘距窗口 12px(与面板 mb-3 一致),右边缘 16px(与 mx-4 一致) */
      offset={{ bottom: 12, right: 16 }}
      {...props}
    />
  )
}

export { Toaster }
