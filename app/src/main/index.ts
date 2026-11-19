import { BrowserWindow, Menu, app, nativeTheme, protocol, session, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { configFilePath, getAppConfig } from './config'
import { describeError, logger } from './logger'
import {
  NTEMM_HOME_DIR,
  legacyUserDataDir,
  migrateLegacyUserData,
  ntemmElectronDir,
  ntemmLogsDir
} from './ntemm-paths'
import { TEST_IMAGES_ROOT, decodeMediaPath } from './background'
import { backgroundCarousel } from './background-carousel'
import { registerIpcHandlers, setMainWindowProvider } from './ipc'
import { builtInPackagerDirectory } from './packager'
import { registerWindowLifecycle } from './window-lifecycle'
import { registerWindowControls } from './window-controls'
import { cancelPendingDownloads, registerAyakaModsDownloads } from './ayakamods'
import { parseYouTubeEmbedUrl, YOUTUBE_EMBED_SOURCES } from '../shared/youtube'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    // 本地媒体协议使用标准来源与受限文件白名单。
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

// 无论系统语言为何，Electron 与 Chromium 的界面统一使用简体中文。
app.commandLine.appendSwitch('lang', 'zh-CN')

// 仅 dev:开放 CDP 调试端口(自动化验证走 127.0.0.1:9222),打包版不开放。
// 9222 被其他并行实例占用时可用 NTEMM_CDP_PORT 改口,互不干扰。
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.NTEMM_CDP_PORT ?? '9222')
}

const AYAKA_MODS_COMMUNITY_PATH = '/games/neverness-to-everness.417/'
const AYAKA_MODS_HOSTS = new Set(['ayakamods.com', 'www.ayakamods.com'])

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function isAyakaModsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && AYAKA_MODS_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function isAyakaModsCommunityPage(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isAyakaModsUrl(url) && parsed.pathname === AYAKA_MODS_COMMUNITY_PATH
  } catch {
    return false
  }
}

// 加固：主界面只允许本地页面；AyakaMods 内嵌页只允许站点自身导航，外部 HTTPS 链接交给系统浏览器。
app.on('web-contents-created', (_event, contents) => {
  const isAyakaModsWebview = contents.getType() === 'webview'
  contents.setWindowOpenHandler(({ url }) => {
    if (isAyakaModsWebview && isAyakaModsUrl(url)) {
      void contents.loadURL(url).catch((error: Error & { code?: string }) => {
        if (error.code !== 'ERR_ABORTED') logger.warning(`AyakaMods 页面打开失败：${describeError(error)}`)
      })
    } else if (isAyakaModsWebview && isHttpsUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  const guardNavigation = (event: Electron.Event, url: string) => {
    if (isAyakaModsWebview) {
      if (isAyakaModsUrl(url)) return
      event.preventDefault()
      if (isHttpsUrl(url)) {
        void shell.openExternal(url)
      } else {
        logger.warning(`已拦截 AyakaMods 内嵌页导航：${url}`)
      }
      return
    }
    const devUrl = process.env.ELECTRON_RENDERER_URL
    const allowed =
      (devUrl !== undefined && url.startsWith(devUrl)) ||
      url.startsWith('file://') ||
      url.startsWith('media://') ||
      url.startsWith('devtools://')
    if (!allowed) {
      event.preventDefault()
      logger.warning(`已拦截渲染层导航：${url}`)
    }
  }
  contents.on('will-navigate', guardNavigation)
  contents.on('will-redirect', (event) => {
    if (contents === mainWindow?.webContents && !event.isMainFrame && parseYouTubeEmbedUrl(event.url)) return
    guardNavigation(event, event.url)
  })
  if (isAyakaModsWebview) return
  // 渲染层的报错（JS 异常、未处理的 Promise 拒绝、资源加载失败）统一落进运行日志，
  // 否则渲染层出问题只在 devtools 里可见，日志文件里毫无痕迹。
  contents.on('console-message', (details) => {
    if (details.level === 'error') {
      const source = details.sourceId ? `（${details.sourceId}:${details.lineNumber}）` : ''
      logger.error(`[渲染层] ${details.message.slice(0, 500)}${source}`)
    }
  })
})


let mainWindow: BrowserWindow | null = null

function registerYouTubeReferrer(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: YOUTUBE_EMBED_SOURCES.map((source) => `${source}*`)
  }, (details, callback) => {
    const headers = details.requestHeaders
    if (details.resourceType === 'subFrame' && mainWindow && details.webContentsId === mainWindow.webContents.id &&
      parseYouTubeEmbedUrl(details.url) && !Object.keys(headers).some((name) => name.toLowerCase() === 'referer')) {
      // 本地 file:// 页面不会发送 Referer，使用应用标识向 YouTube 标识嵌入来源。
      headers.Referer = 'https://com.nuoyan.nte-mod-manager/'
    }
    callback({ requestHeaders: headers })
  })
}

function categoryImageBase(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'category-bg')
  }
  return join(app.getAppPath(), '..', 'img', 'bg')
}

function windowIcon(): string | null {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, 'nte-mod-manager.ico')
    : join(app.getAppPath(), '..', 'img', 'nte-mod-manager.ico')
  return existsSync(candidate) ? candidate : null
}

function createWindow(): void {
  // 深浅色跟随系统;NTEMM_FORCE_THEME=light|dark 可强制指定(用于冒烟测试)。
  const forcedTheme = process.env.NTEMM_FORCE_THEME
  nativeTheme.themeSource = forcedTheme === 'light' || forcedTheme === 'dark' ? forcedTheme : 'system'
  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#0a0a12' : '#f1f0f7'

  const iconPath = windowIcon()

  mainWindow = new BrowserWindow({
    // 窗口位置/尺寸/最大化的记忆交给 Electron 内置持久化(Electron 44+):
    // name 是状态存取的键,缺省尺寸仅在首次启动(无持久化记录)时生效
    name: 'main',
    windowStatePersistence: true,
    width: 1315,
    height: 1000,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor,
    title: 'NTE 模组管理器',
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // 网页播放器全屏时填满内容区，保持原生窗口的大小与状态。
      disableHtmlFullscreenWindowResize: true,
      spellcheck: false
    }
  })
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAyakaModsCommunityPage(params.src)) {
      event.preventDefault()
      logger.warning(`已拦截未知内嵌页：${params.src}`)
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
  })
  setMainWindowProvider(() => mainWindow)
  registerWindowLifecycle(mainWindow)
  registerWindowControls(mainWindow)

  // F11 原生全屏:应用菜单已置空(Menu.setApplicationMenu(null)),没有默认
  // 加速键,这里在主进程直接接管,与 Chrome 的 F11 行为对齐(窗口真实全屏,
  // 而非隐藏 UI;再按一次 F11 退出全屏)。
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'F11') {
      event.preventDefault()
      const win = mainWindow
      if (win) {
        win.setFullScreen(!win.isFullScreen())
      }
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 冒烟测试:NTEMM_AUTO_SCREENSHOT=<png 路径> 时,启动后自动截图并退出。
    const screenshotPath = process.env.NTEMM_AUTO_SCREENSHOT
    if (screenshotPath) {
      logger.info(`冒烟截图已启用：${screenshotPath}`)
      setTimeout(async () => {
        if (!mainWindow) {
          return
        }
        try {
          const image = await mainWindow.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
          logger.info(`已保存自动截图：${screenshotPath}`)
        } catch (error) {
          logger.error(`自动截图失败：${error instanceof Error ? error.message : String(error)}`)
        }
        mainWindow?.close()
      }, 8000)
    }

    // 冒烟按键测试:NTEMM_SMOKE_KEYS=<png 前缀> 时自动发送 F12/↓,分阶段截图后退出,
    // 用于验证背景调试线框、手动切换与自动轮播的完整渲染链路。
    const smokeKeysPrefix = process.env.NTEMM_SMOKE_KEYS
    if (smokeKeysPrefix) {
      const snap = async (name: string) => {
        if (!mainWindow) {
          return
        }
        try {
          const image = await mainWindow.webContents.capturePage()
          const file = `${smokeKeysPrefix}-${name}.png`
          writeFileSync(file, image.toPNG())
          logger.info(`冒烟按键截图：${file}`)
        } catch (error) {
          logger.error(`冒烟按键截图失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      setTimeout(() => {
        logger.info('冒烟按键测试：发送 F12')
        mainWindow?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F12' })
      }, 6000)
      setTimeout(() => void snap('f12'), 8000)
      setTimeout(() => {
        logger.info('冒烟按键测试：发送 ↓')
        mainWindow?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
      }, 9000)
      setTimeout(() => void snap('down'), 11500)
      setTimeout(() => void snap('rotate'), 22500)
      setTimeout(() => mainWindow?.close(), 24000)
    }
  })

  // 窗口位置/尺寸由 windowStatePersistence 自动持久化,无需在 close 时手动保存
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 窗口尺寸变化后延迟重新做视觉识别
  mainWindow.on('resize', () => {
    backgroundCarousel.handleWindowResized()
  })

  // 系统切换深浅色时同步原生窗口底色,避免窗口边缘出现主题不符的闪烁。
  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0a0a12' : '#f1f0f7')
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon'
}

/** media:// 允许读取的根目录:背景图目录(+测试图目录)、分类图目录、应用图标目录。 */
function allowedMediaRoots(): string[] {
  const roots: string[] = []
  const config = getAppConfig()
  if (config.backgroundImagesDirectory) {
    roots.push(config.backgroundImagesDirectory)
  }
  if (config.testImagesEnabled) {
    roots.push(TEST_IMAGES_ROOT)
  }
  roots.push(categoryImageBase())
  const icon = windowIcon()
  if (icon) {
    roots.push(dirname(icon))
  }
  return roots.map((root) => resolve(root))
}

/** child 是否位于 root 之内(win32 relative 大小写不敏感,与 NTFS 一致)。 */
function isPathInsideRoot(child: string, root: string): boolean {
  const rel = relative(root, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const path = decodeMediaPath(request.url)
    if (!path) {
      return new Response('Bad Request', { status: 400 })
    }
    // URL 由主进程构造,但协议处理必须按最小权限收紧:仅允许应用自己目录树内的图片,
    // 否则 media://local/<编码路径> 可读取磁盘上任意匹配扩展名的文件
    const resolved = resolve(path)
    if (!allowedMediaRoots().some((root) => isPathInsideRoot(resolved, root))) {
      logger.warning(`media:// 拒绝了目录白名单之外的路径：${path}`)
      return new Response('Forbidden', { status: 403 })
    }
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const contentType = IMAGE_CONTENT_TYPES[extension]
    if (!contentType) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!existsSync(path)) {
      return new Response('Not Found', { status: 404 })
    }
    try {
      const data = await readFile(path)
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type': contentType,
          // 本地图片响应允许跨源读取，文件来源仍受白名单约束。
          'access-control-allow-origin': '*'
        }
      })
    } catch (error) {
      logger.warning(`读取图片失败：${path}：${describeError(error)}`)
      return new Response('Internal Server Error', { status: 500 })
    }
  })
}

// 运行数据统一保存到 ~/.ntemm(配置/日志/缓存/Electron userData)。
// userData 迁入 electron/app;旧的 %APPDATA% 目录在首次启动时搬迁(跳过可再生缓存),
// 窗口状态等不丢。NTEMM_USER_DATA 仍可显式隔离(冒烟/多开),且优先于默认位置,
// 此时日志也跟着隔离目录走,避免与真实实例混写同一个日志文件。
const userDataOverride = process.env.NTEMM_USER_DATA
const logDirectory = userDataOverride ? join(userDataOverride, 'logs') : ntemmLogsDir()
// 日志器在模块加载期就初始化:userData 迁移、配置回退等早期逻辑也需要留下日志
logger.initialize(logDirectory, 'NteModManager.log')

// 主进程级的意外错误以前只会打到 stderr(打包后无人可见),现在落进运行日志
process.on('uncaughtException', (error) => {
  logger.error(`主进程未捕获异常：${describeError(error)}`)
})
process.on('unhandledRejection', (reason) => {
  logger.error(`主进程未处理的 Promise 拒绝：${describeError(reason)}`)
})

if (userDataOverride) {
  app.setPath('userData', userDataOverride)
} else {
  app.setPath(
    'userData',
    migrateLegacyUserData(join(ntemmElectronDir(), 'app'), legacyUserDataDir())
  )
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    const ayakaModsSession = session.fromPartition('persist:ayakamods')
    await Promise.all([
      session.defaultSession.setProxy({ mode: 'system' }),
      ayakaModsSession.setProxy({ mode: 'system' })
    ])
    Menu.setApplicationMenu(null)
    registerAyakaModsDownloads(ayakaModsSession, () => mainWindow?.webContents)
    registerYouTubeReferrer()
    registerMediaProtocol()
    logger.addBroadcaster(() => mainWindow)
    registerIpcHandlers(categoryImageBase(), windowIcon())

    logger.info('========== NTE 模组管理器启动 ==========')
    logger.info(`应用版本：${app.getVersion()}，Electron：${process.versions.electron}`)
    logger.info(`数据目录：${NTEMM_HOME_DIR}`)
    // Electron 43+ 主进程快照启动让 whenReady 早于 GPU 进程初始化完成,立即查询
    // getGPUFeatureStatus 会永远读到 disabled_software 的假象,延迟到状态稳定后再记录。
    setTimeout(() => {
      logger.info(`GPU 特性状态：${JSON.stringify(app.getGPUFeatureStatus())}`)
    }, 3000)
    void app
      .getGPUInfo('basic')
      .then((info) => {
        const devices = (info as { gpuDevice?: unknown[] }).gpuDevice ?? []
        logger.info(`GPU 设备：${JSON.stringify(devices)}`)
      })
      .catch(() => logger.debug('GPU 设备信息获取失败'))
    const config = getAppConfig()
    logger.info(`配置文件：${configFilePath()}`)
    logger.info(`配置：mods_directory=${config.modsDirectory}`)
    logger.info(`配置：backups_directory=${config.backupsDirectory}`)
    logger.info(`配置：background_images_directory=${config.backgroundImagesDirectory}`)
    logger.info(`配置：game_launcher=${config.gameLauncher}`)
    logger.info(`内置打包器：${builtInPackagerDirectory()}`)
    createWindow()
    backgroundCarousel.start(() => mainWindow)

    app.on('will-quit', () => {
      cancelPendingDownloads()
      void backgroundCarousel.dispose()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
