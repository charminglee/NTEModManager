import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'

export interface CardMenuPosition {
  x: number
  y: number
  keyboardTrigger?: HTMLElement
}

export function useCardContextMenu(enabled: boolean) {
  const [position, setPosition] = useState<CardMenuPosition | null>(null)
  if (!enabled && position) setPosition(null)

  return {
    position,
    close: () => setPosition(null),
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault()
      if (enabled) setPosition({ x: event.clientX, y: event.clientY })
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      const opensMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
      if (!enabled || !opensMenu || !(event.target instanceof HTMLElement)) return

      event.preventDefault()
      event.stopPropagation()
      const { left, bottom } = event.target.getBoundingClientRect()
      setPosition({ x: left, y: bottom, keyboardTrigger: event.target })
    }
  }
}

export function CardContextMenu({ label, position, onClose, children }: {
  label: string
  position: CardMenuPosition
  onClose: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: position.x, top: position.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label={label}
        aria-labelledby={undefined}
        align="start"
        sideOffset={0}
        collisionPadding={8}
        className="w-52 [&>.solid-popover]:max-h-[var(--radix-dropdown-menu-content-available-height)] [&>.solid-popover]:overflow-y-auto"
        onContextMenu={(event) => event.preventDefault()}
        onEscapeKeyDown={() => position.keyboardTrigger?.focus()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') event.stopPropagation()
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
