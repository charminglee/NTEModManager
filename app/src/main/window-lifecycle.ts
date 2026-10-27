import type { BrowserWindow } from 'electron'
import { backgroundCarousel } from './background-carousel'
import { describeError, logger } from './logger'

/** 冻结整个页面，保留界面状态，同时停止 React、定时器和动画回调。 */
export function registerWindowLifecycle(window: BrowserWindow): void {
  let commands: Promise<void> = Promise.resolve()
  let ownsDebugger = false

  const syncRenderer = (): void => {
    commands = commands.then(async () => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return
      const suspended = window.isMinimized()
      const client = window.webContents.debugger
      try {
        if (!client.isAttached()) {
          client.attach('1.3')
          ownsDebugger = true
        }
        await client.sendCommand('Page.setWebLifecycleState', {
          state: suspended ? 'frozen' : 'active'
        })
        if (!suspended && ownsDebugger) {
          client.detach()
          ownsDebugger = false
        }
        logger.info(suspended ? '窗口已最小化，页面渲染已冻结' : '窗口已恢复，页面渲染已重启')
      } catch (error) {
        logger.error(`更新页面渲染状态失败：${describeError(error)}`)
      }
    })
  }

  window.on('minimize', () => {
    backgroundCarousel.pause()
    syncRenderer()
  })
  window.on('restore', () => {
    syncRenderer()
    void backgroundCarousel.resume()
  })
  window.webContents.on('did-finish-load', () => {
    if (window.isMinimized()) syncRenderer()
  })
}
