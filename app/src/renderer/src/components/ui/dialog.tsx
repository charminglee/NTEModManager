import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface AppDialogAction {
  label: React.ReactNode
  onSelect?: () => void
  destructive?: boolean
  disabled?: boolean
}

export interface AppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind?: 'dialog' | 'alert'
  title: React.ReactNode
  eyebrow?: React.ReactNode
  description?: React.ReactNode
  headerAction?: React.ReactNode
  children?: React.ReactNode
  panelClassName?: string
  headerClassName?: string
  bodyClassName?: string
  footerClassName?: string
  footerStart?: React.ReactNode
  footer?: React.ReactNode
  cancelAction?: AppDialogAction
  confirmAction?: AppDialogAction
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
}

export function AppDialog({
  open,
  onOpenChange,
  kind = 'dialog',
  title,
  eyebrow,
  description,
  headerAction,
  children,
  panelClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
  footerStart,
  footer,
  cancelAction,
  confirmAction,
  onKeyDown
}: AppDialogProps) {
  const isAlert = kind === 'alert'
  const Root = DialogPrimitive.Root
  const Portal = DialogPrimitive.Portal
  const Overlay = DialogPrimitive.Overlay
  const Content = DialogPrimitive.Content
  const Title = DialogPrimitive.Title
  const Description = DialogPrimitive.Description
  const hasFooter =
    footer !== undefined ||
    footerStart !== undefined ||
    cancelAction !== undefined ||
    confirmAction !== undefined

  return (
    <Root open={open} onOpenChange={onOpenChange}>
      <Portal>
        <Overlay className="dialog-overlay fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <div className="dialog-stage pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Content
            className={cn(
              'dialog-panel relative pointer-events-auto w-full max-w-md data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
              panelClassName
            )}
            role={isAlert ? 'alertdialog' : 'dialog'}
            onPointerDownOutside={(event) => {
              if (event.target instanceof Element && event.target.closest('.window-controls')) {
                event.preventDefault()
              }
            }}
            onKeyDown={onKeyDown}
          >
            <div className={cn('dialog-header', headerClassName)}>
              {eyebrow}
              <div className="dialog-heading-row">
                <Title className="dialog-title">{title}</Title>
                {headerAction}
              </div>
            </div>
            <div className={cn('dialog-body', bodyClassName)}>
              {description !== undefined && (
                <Description className="dialog-description">{description}</Description>
              )}
              {children}
            </div>
            {hasFooter && (
              <div className={cn('dialog-footer', footerClassName)}>
                {footer ?? (
                  <>
                    {footerStart}
                    {cancelAction && (
                      <Button
                        variant="secondary"
                        disabled={cancelAction.disabled}
                        onClick={() => {
                          cancelAction.onSelect?.()
                          onOpenChange(false)
                        }}
                      >
                        {cancelAction.label}
                      </Button>
                    )}
                    {confirmAction && (
                      <Button
                        variant={confirmAction.destructive ? 'destructive' : 'default'}
                        disabled={confirmAction.disabled}
                        onClick={confirmAction.onSelect}
                      >
                        {confirmAction.label}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </Content>
        </div>
      </Portal>
    </Root>
  )
}
