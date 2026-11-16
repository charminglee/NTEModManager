import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { toast as sonner } from 'sonner'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'info' | 'warning' | 'error'

interface ToastOptions {
  description?: string
}

const VARIANT_ICONS: Record<ToastVariant, LucideIcon> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleX
}

function ToastCard({
  variant,
  title,
  description
}: {
  variant: ToastVariant
  title: string
  description?: string
}) {
  const Icon = VARIANT_ICONS[variant]
  return (
    <div
      className={cn('toast-surface flex gap-3 p-4', description ? 'items-start' : 'items-center')}
      role="status"
    >
      <Icon className={cn('h-5 w-5 shrink-0', description && 'mt-0.5')} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-medium leading-normal">{title}</span>
        {description && (
          <span className="whitespace-pre-wrap text-[13px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </div>
    </div>
  )
}

function show(variant: ToastVariant, title: string, options?: ToastOptions) {
  sonner.custom(() => (
    <ToastCard variant={variant} title={title} description={options?.description} />
  ))
}

export const toast = {
  success: (title: string, options?: ToastOptions) => show('success', title, options),
  info: (title: string, options?: ToastOptions) => show('info', title, options),
  warning: (title: string, options?: ToastOptions) => show('warning', title, options),
  error: (title: string, options?: ToastOptions) => show('error', title, options)
}
