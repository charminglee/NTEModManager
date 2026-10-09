import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * toast 的定位/生命周期容器。视觉全部由 toast.custom 渲染的液态玻璃卡片承担
 * (components/toast-card.tsx + index.css 的 data-styled='false' 覆盖),
 * 内置 toast 样式已不再使用,这里不再配置 classNames。
 */
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
