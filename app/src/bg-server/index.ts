import './argv'
import { app } from 'electron'
import { join } from 'node:path'
import { configFilePath } from '../main/config'
import { logger } from '../main/logger'
import { backgroundService } from './service'

// 与主程序共用 NteModManager.ini,但 userData 必须独立:
// Electron 单例锁存放在 userData 目录,独立之后才能与主程序共存,同时自身保持单例。
const userDataOverride = process.env.NTEMM_USER_DATA
if (userDataOverride) {
  app.setPath('userData', userDataOverride)
} else {
  app.setPath('userData', join(app.getPath('appData'), 'NteModManagerBgServer'))
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  // 重复启动没有窗口可聚焦,视为「立即刷新配置/图库」的信号
  app.on('second-instance', () => {
    backgroundService.reloadNow()
  })

  app.whenReady().then(() => {
    logger.initialize(app.getPath('userData'))
    logger.info('========== NTE 背景图服务启动（无界面） ==========')
    logger.info(`配置文件：${configFilePath()}`)
    backgroundService.start()
  })

  app.on('will-quit', () => {
    void backgroundService.stop()
  })
}
