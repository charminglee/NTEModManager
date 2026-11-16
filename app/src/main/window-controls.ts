import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { OperationResult, WindowAction, WindowState } from '../shared/types'
import { describeError, logger } from './logger'

/** 窗口控制只接受主窗口顶层页面的请求，关闭窗口时撤销注册。 */
export function registerWindowControls(window: BrowserWindow): void {
  const checkSender = (event: IpcMainInvokeEvent): void => {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('窗口控制请求来源无效')
    }
  }
  const state = (): WindowState => ({
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen()
  })
  const publishState = (): void => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('window:state-changed', state())
    }
  }
  ipcMain.handle('window:state', (event): WindowState => {
    checkSender(event)
    return state()
  })
  ipcMain.handle('window:control', (event, action: WindowAction): OperationResult => {
    try {
      checkSender(event)
      switch (action) {
        case 'minimize':
          window.minimize()
          break
        case 'toggle-maximize':
          if (window.isFullScreen()) window.setFullScreen(false)
          else if (window.isMaximized()) window.unmaximize()
          else window.maximize()
          break
        case 'close':
          // 先应答，再走正常关闭流程，保留已有窗口状态保存与退出处理。
          setImmediate(() => {
            if (!window.isDestroyed()) window.close()
          })
          break
        default:
          throw new Error('不支持的窗口操作')
      }
      return { success: true, message: '' }
    } catch (error) {
      logger.error(`窗口操作失败：${describeError(error)}`)
      return { success: false, message: describeError(error) }
    }
  })
  window.on('maximize', publishState)
  window.on('unmaximize', publishState)
  window.on('enter-full-screen', publishState)
  window.on('leave-full-screen', publishState)
  window.webContents.on('did-finish-load', publishState)
  window.once('closed', () => {
    ipcMain.removeHandler('window:state')
    ipcMain.removeHandler('window:control')
  })
}
