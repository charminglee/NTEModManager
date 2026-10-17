import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface PromptDialogProps {
  open: boolean
  title: string
  description?: string
  label: string
  initialValue?: string
  confirmText?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** 通用文本输入对话框(重命名、导入命名等)。 */
export default function PromptDialog({
  open,
  title,
  description,
  label,
  initialValue = '',
  confirmText = '确定',
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
  const lastTextRef = useRef({ title, description, label, confirmText })
  useEffect(() => {
    if (open) {
      lastTextRef.current = { title, description, label, confirmText }
    }
  }, [open, title, description, label, confirmText])
  const shown = open ? { title, description, label, confirmText } : lastTextRef.current

  useEffect(() => {
    if (open) {
      setValue(initialValue)
      window.setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 30)
    }
  }, [open, initialValue])

  const submit = () => {
    onConfirm(value.trim())
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{shown.title}</DialogTitle>
          {shown.description && <DialogDescription>{shown.description}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="prompt-input">{shown.label}</Label>
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
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={submit}>{shown.confirmText}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
