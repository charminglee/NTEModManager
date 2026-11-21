import { useEffect, useRef, useState } from 'react'
import { AppDialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import Switch from './ui/switch'

interface PromptDialogProps {
  open: boolean
  title: string
  description?: string
  initialValue?: string
  resetKey?: string
  confirmText?: string
  confirmDisabled?: boolean
  switchOptions?: {
    label: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
  }[]
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** 通用文本输入对话框(重命名、导入命名等)。 */
export default function PromptDialog({
  open,
  title,
  description,
  initialValue = '',
  resetKey,
  confirmText = '确定',
  confirmDisabled,
  switchOptions,
  onConfirm,
  onCancel
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * 关闭动画(弹层 150ms 渐隐)期间,调用方通常已把内容置空(如 prompt 状态置
   * null 后 title/label 传空串),而 Radix 退出动画让面板 DOM 多存活一瞬——
   * 文字会先于面板消失(关闭瞬间标题闪没)。打开期间把文本快照进 ref,关闭
   * 期间沿用最后一次的值,让文字与面板一起渐隐。
   */
  const lastTextRef = useRef({ title, description, confirmText })
  useEffect(() => {
    if (open) {
      lastTextRef.current = { title, description, confirmText }
    }
  }, [open, title, description, confirmText])
  const shown = open ? { title, description, confirmText } : lastTextRef.current

  useEffect(() => {
    if (open) {
      setValue(initialValue)
      window.setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 30)
    }
  }, [open, initialValue, resetKey])

  const submit = () => {
    if (!confirmDisabled) onConfirm(value.trim())
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => (!next ? onCancel() : undefined)}
      title={shown.title}
      description={shown.description}
      cancelAction={{ label: '取消' }}
      confirmAction={{ label: shown.confirmText, disabled: confirmDisabled, onSelect: submit }}
    >
      <div className="grid gap-2">
        <Input
          id="prompt-input"
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </div>
      {switchOptions?.map(({ label, checked, onCheckedChange, disabled }) => (
        <div className="prompt-switch-row" key={label}>
          <strong>{label}</strong>
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            aria-label={label}
          />
        </div>
      ))}
    </AppDialog>
  )
}
