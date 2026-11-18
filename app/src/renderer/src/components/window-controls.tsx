import { useEffect, useState } from 'react'
import type { WindowAction, WindowState } from '@shared/types'
import { toast } from './toast-card'

interface Props {
  isChromeHidden: boolean
  onFullScreenChange: (isFullScreen: boolean) => void
  onToggleChrome: () => void
  onOpenBackground: () => Promise<void>
  onToggleFullScreen: () => void
}

export default function WindowControls({
  isChromeHidden,
  onFullScreenChange,
  onToggleChrome,
  onOpenBackground,
  onToggleFullScreen
}: Props) {
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
    <div className="window-controls" role="group" aria-label="窗口和快捷键控制">
      <button
        type="button"
        className="window-shortcut"
        aria-label={isChromeHidden ? '显示界面' : '隐藏界面'}
        title={`${isChromeHidden ? '显示界面' : '隐藏界面'}（F9）`}
        onClick={onToggleChrome}
      >
        {isChromeHidden ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4-6.5-4-6.5-4Z" />
            <circle cx="8" cy="8" r="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m2.5 2.5 11 11M6.8 6.8a1.7 1.7 0 0 0 2.4 2.4" />
            <path d="M4.3 4.5A7.7 7.7 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a12 12 0 0 1-2 2.4" />
            <path d="M2 6a12 12 0 0 0-.5 2s2.5 4.5 6.5 4.5c.6 0 1.2-.1 1.8-.3" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-shortcut"
        aria-label="打开当前背景图文件"
        title="打开当前背景图文件（F10）"
        onClick={() => void onOpenBackground()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 2.5h12v11H2z" />
          <circle cx="5.5" cy="6" r="1.2" />
          <path d="m2.5 11 3.2-3 2.1 2 2.3-2.2 3.4 3.2" />
        </svg>
      </button>
      <button
        type="button"
        className="window-shortcut"
        aria-label="切换全屏"
        title="切换全屏（F11）"
        onClick={onToggleFullScreen}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 2H2v4m8-4h4v4m0 4v4h-4m-4 0H2v-4" />
        </svg>
      </button>
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
