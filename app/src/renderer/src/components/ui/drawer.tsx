import { useRef, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

interface AppDrawerProps {
  open: boolean
  onClose: () => void
  title: string
  titleAction?: ReactNode
  headerEnd?: ReactNode
  children: ReactNode
  footer?: ReactNode
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}

export function AppDrawer({
  open,
  onClose,
  title,
  titleAction,
  headerEnd,
  children,
  footer,
  onEscapeKeyDown
}: AppDrawerProps) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Overlay className="app-drawer-overlay" />
      <Dialog.Content
        ref={panelRef}
        className="ink-panel app-drawer"
        {...(!open ? { inert: '' } : {})}
        onOpenAutoFocus={(event) => {
          previousFocus.current = document.activeElement as HTMLElement | null
          event.preventDefault()
          panelRef.current?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          previousFocus.current?.focus({ preventScroll: true })
        }}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        <div className="app-drawer-header">
          <div className="app-drawer-heading">
            <Dialog.Title className="app-drawer-title">{title}</Dialog.Title>
            {titleAction}
          </div>
          {headerEnd}
        </div>
        <div className="app-drawer-body" tabIndex={0}>{children}</div>
        {footer && <div className="app-drawer-footer">{footer}</div>}
      </Dialog.Content>
    </Dialog.Root>
  )
}
