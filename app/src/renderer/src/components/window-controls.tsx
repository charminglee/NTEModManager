import { useEffect, useState } from 'react'
import type { WindowAction, WindowState } from '@shared/types'
import { toast } from './toast-card'

interface Props {
  onFullScreenChange: (isFullScreen: boolean) => void
}

export default function WindowControls({ onFullScreenChange }: Props) {
  const [state, setState] = useState<WindowState>({ isMaximized: false, isFullScreen: false })
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let active = true
    let receivedUpdate = false
    const applyState = (next: WindowState) => {
      setState(next)
      onFullScreenChange(next.isFullScreen)
    }
    const unsubscribe = window.api.onWindowStateChanged((next) => {
      receivedUpdate = true
      if (active) applyState(next)
    })
    void window.api
      .getWindowState()
      .then((next) => {
        if (active && !receivedUpdate) applyState(next)
      })
      .catch((error) => {
        if (active) toast.error('无法读取窗口状态', { description: String(error) })
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [onFullScreenChange])
  const control = async (action: WindowAction) => {
    if (pending) return
    setPending(true)
    try {
      const result = await window.api.controlWindow(action)
      if (!result.success) toast.error('窗口操作未完成', { description: result.message })
    } catch (error) {
      toast.error('窗口操作未完成', { description: String(error) })
    } finally {
      setPending(false)
    }
  }
  const expanded = state.isMaximized || state.isFullScreen
  if (state.isFullScreen) return null
  return (
    <div className="window-controls" role="group" aria-label="窗口控制">
      <button
        type="button"
        disabled={pending}
        aria-label="最小化窗口"
        title="最小化"
        onClick={() => void control('minimize')}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5h10" />
        </svg>
      </button>
      <button
        type="button"
        disabled={pending}
        aria-label={expanded ? '还原窗口' : '最大化窗口'}
        title={expanded ? '还原' : '最大化'}
        onClick={() => void control('toggle-maximize')}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {expanded ? (
            <>
              <path d="M5.5 5.5v-3h8v8h-3" />
              <path d="M2.5 5.5h8v8h-8z" />
            </>
          ) : (
            <path d="M3 3h10v10H3z" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="window-close"
        disabled={pending}
        aria-label="关闭窗口"
        title="关闭"
        onClick={() => void control('close')}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m3.5 3.5 9 9m0-9-9 9" />
        </svg>
      </button>
    </div>
  )
}
