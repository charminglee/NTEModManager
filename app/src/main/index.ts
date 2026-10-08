import { BrowserWindow, Menu, app, nativeTheme, protocol } from 'electron'
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

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { secure: true, supportFetchAPI: true, stream: true }
  }
])

// 液态玻璃的 backdrop-filter/SVG 滤镜逐帧开销大,软件渲染下帧率会崩到个位数:
// 显式开启 GPU 光栅化并忽略驱动黑名单,避免掉进 SwiftShader。GPU 状态会记录在启动日志。
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
// Skia Graphite:GPU 优先的新渲染后端。默认后端里 backdrop-filter 的 url(#svg) 位移滤镜
// 走 CPU 光栅(GPU 占用率低、CPU 高);Graphite 把图像滤镜搬到 GPU 执行。
app.commandLine.appendSwitch('enable-features', 'SkiaGraphite')
// 仅 dev:开放 CDP 调试端口(自动化验证走 127.0.0.1:9222),打包版不开放
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// 加固:拦截 window.open 与页面发起的导航(渲染层只应加载本地 dev server / 打包文件),
// 防止未来引入的远程内容或被污染的数据把窗口导向任意 URL
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
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
  })
  // 渲染层的报错(JS 异常、未处理的 Promise 拒绝、资源加载失败)统一落进运行日志,
  // 否则渲染层出问题只在 devtools 里可见,日志文件里毫无痕迹
  contents.on('console-message', (details) => {
    if (details.level === 'error') {
      const source = details.sourceId ? `（${details.sourceId}:${details.lineNumber}）` : ''
      logger.error(`[渲染层] ${details.message.slice(0, 500)}${source}`)
    }
  })
})


let mainWindow: BrowserWindow | null = null

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
    autoHideMenuBar: true,
    backgroundColor,
    title: 'NTE 模组管理器',
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  setMainWindowProvider(() => mainWindow)

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
        headers: { 'content-type': contentType }
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

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
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
    logger.info(`配置：game_launcher=${config.gameLauncher},packager_directory=${config.packagerDirectory}`)
    createWindow()
    backgroundCarousel.start(() => mainWindow)

    app.on('will-quit', () => {
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
