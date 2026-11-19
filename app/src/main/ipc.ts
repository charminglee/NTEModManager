import { app, dialog, ipcMain, shell, webContents } from 'electron'
import { registerWorkbenchAssets } from './workbench-assets'
import { registerWorkbenchProjects } from './workbench-projects'
import { registerWorkbenchSpine } from './workbench-spine'
import { loadGameSpine } from './workbench-game-spine'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as repository from './repository'
import { changeInstallationForAll, installModExclusively, runBatchModAction } from './operations'
import {
  getAppConfig, getLastCategory, readConfigFile, saveConfigFile, setCategoryOrder, setLastCategory, updateAppConfig
} from './config'
import { builtInPackagerDirectory, runPackager } from './packager'
import { encodeMediaPath } from './background'
import { backgroundCarousel } from './background-carousel'
import { describeError, logger } from './logger'
import { gameBananaImageSession } from './gamebanana-image-cache'
import {
  createDownloadTask,
  executeDownloadTask,
  getMod as getGameBananaMod,
  getModComments as getGameBananaModComments,
  getModSummary as getGameBananaModSummary,
  getModUpdates as getGameBananaModUpdates,
  getTasks as getGameBananaTasks,
  listMods as listGameBananaMods,
  setTaskBroadcaster
} from './gamebanana'
import {
  clearGameBananaDownloadCache,
  getGameBananaDownloadCacheSize,
  getGameBananaDownloadMarks,
  recordGameBananaDownload
} from './gamebanana-download-cache'
import {
  clearGameBananaTranslationCache,
  getGameBananaTranslationCacheSize,
  translateGameBanana
} from './gamebanana-translation'
import {
  clearYoudaoCredentials,
  getYoudaoCredentialsStatus,
  saveYoudaoCredentials
} from './youdao-translation'
import type { AppConfigPatch, BatchModAction, GameBananaTranslationRequest, ImportResult, ModInfo, OperationResult, YoudaoCredentialsInput } from '../shared/types'
import { cancelDownload, getPendingDownloads, prepareDownload } from './ayakamods'

type ProgressReporter = (message: string) => void

let mainWindowProvider: () => Electron.BrowserWindow | null = () => null

export function setMainWindowProvider(provider: () => Electron.BrowserWindow | null): void {
  mainWindowProvider = provider
}

function sendGameBananaDownloadMarks(marks: Record<string, string>): void {
  const window = mainWindowProvider()
  if (window && !window.isDestroyed()) window.webContents.send('gamebanana:download-marks-changed', marks)
}

function sendProgress(message: string): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) {
      contents.send('op:progress', message)
    }
  }
}

/** 开发模式下可执行文件位于 node_modules/electron/dist,改用项目根目录查找 7z。 */
function appDir(): string {
  return process.defaultApp ? process.cwd() : dirname(process.execPath)
}

let operationChain: Promise<unknown> = Promise.resolve()

/** 串行执行所有变更类操作,避免并发写文件系统。 */
function runExclusive<T>(activity: string, operation: (report: ProgressReporter) => Promise<T>): Promise<T> {
  const run = operationChain.then(async () => {
    logger.info(`开始异步操作：${activity}`)
    const startedAt = Date.now()
    try {
      const result = await operation(sendProgress)
      logger.info(`异步操作完成：${activity}（耗时 ${Date.now() - startedAt}ms）`)
      return result
    } catch (error) {
      // 抛异常的操作对渲染层只是一次 invoke 拒绝,不落日志就彻底无迹可寻
      logger.error(`异步操作异常：${activity}：${describeError(error)}`)
      throw error
    }
  })
  operationChain = run.catch(() => undefined)
  return run
}

function failure(message: string): OperationResult {
  return { success: false, message }
}

async function findMod(name: string): Promise<ModInfo | null> {
  const mods = await repository.scan()
  const mod = mods.find((item) => item.name === name) ?? null
  if (!mod) {
    // 所有针对模组的操作都先经过这里;找不到时操作方只返回一句提示,得在这里留痕
    logger.error(`操作找不到模组：${name}（可能已被删除或重命名）`)
  }
  return mod
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * 重新打包单个模组的完整流程:确定源文件夹(自动复用上次路径,否则弹窗选择)→
 * 运行打包器 → 替换模组源文件 → 已安装则重装。单模组与批量重新打包共用;
 * 用户取消源文件夹选择时返回 cancelled 结果。
 */
async function repackageModWithSource(
  mod: ModInfo,
  report: ProgressReporter
): Promise<OperationResult> {
  const config = getAppConfig()

  // 开启自动复用时直接使用该模组上次选择的源文件夹。
  let sourceDirectory: string | null = null
  const lastPath = repository.lastPackagingPath(mod.name)
  if (config.autoUseLastPackagingPath && isDirectory(lastPath)) {
    sourceDirectory = lastPath
  } else {
    const window = mainWindowProvider()
    if (!window) {
      return failure('无法打开文件夹选择窗口')
    }
    const picked = await dialog.showOpenDialog(window, {
      title: `重新打包「${mod.name}」：选择源文件夹`,
      defaultPath: isDirectory(lastPath) ? lastPath : undefined,
      properties: ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      logger.debug('重新打包已取消：用户未选择源文件夹')
      return { success: false, message: '', cancelled: true }
    }
    sourceDirectory = picked.filePaths[0]
    logger.info(`重新打包 ${mod.name}：源文件夹：${sourceDirectory}`)
    const pathSaved = repository.setLastPackagingPath(mod.name, sourceDirectory)
    if (!pathSaved.success) {
      return pathSaved
    }
  }

  const packageDirectory = builtInPackagerDirectory()
  const packResult = await runPackager({
    batchPath: join(packageDirectory, '傻瓜打包器.bat'),
    packageDirectory,
    sourceDirectory
  })
  if (!packResult.success) {
    return packResult
  }

  report(`正在替换 ${mod.name} 的源文件...`)
  const replaced = await repository.replacePackagedMod(mod, packageDirectory)
  if (!replaced.success) {
    return replaced
  }
  if (mod.installed) {
    report(`正在重装 ${mod.name}...`)
    const uninstalled = await repository.uninstall(mod)
    if (!uninstalled.success) {
      return uninstalled
    }
    const installed = await repository.install(mod)
    if (!installed.success) {
      return installed
    }
  }
  return replaced
}

/** 批量重新打包:逐个复用与单模组相同的流程;用户在弹窗取消时中止整批。 */
async function runBatchRepackage(
  names: string[],
  report: ProgressReporter
): Promise<{ result: OperationResult }> {
  const byName = new Map((await repository.scan()).map((mod) => [mod.name, mod]))

  const failures: string[] = []
  let changedCount = 0
  for (const [index, name] of names.entries()) {
    const mod = byName.get(name)
    if (!mod) {
      logger.error(`批量重新打包找不到模组：${name}（可能已被删除或重命名）`)
      failures.push(`${name}:找不到模组`)
      continue
    }
    report(`正在重新打包 ${name}(${index + 1}/${names.length})...`)
    const result = await repackageModWithSource(mod, report)
    if (result.cancelled) {
      logger.info(`批量重新打包中止：已打包 ${changedCount} 个，用户取消了源文件夹选择`)
      return { result: { success: false, message: '', cancelled: true } }
    }
    if (result.success) {
      changedCount += 1
    } else {
      logger.error(`批量重新打包失败：${name}：${result.message}`)
      failures.push(`${name}:${result.message}`)
    }
  }

  const summary = `已重新打包 ${changedCount} 个模组`
  logger.info(`批量重新打包完成：成功 ${changedCount} 个，失败 ${failures.length} 个`)
  return {
    result: failures.length === 0
      ? { success: true, message: summary }
      : { success: false, message: `${summary}\n${failures.join('\n')}` }
  }
}

/** 打开系统选择对话框的公共入口;窗口不可用或用户取消返回 null,取消会留 debug 日志 */
async function pickFileWithDialog(options: Electron.OpenDialogOptions): Promise<string | null> {
  const window = mainWindowProvider()
  if (!window) {
    logger.warning('无法打开文件选择窗口：主窗口不存在')
    return null
  }
  const result = await dialog.showOpenDialog(window, options)
  if (result.canceled || result.filePaths.length === 0) {
    logger.debug('用户取消了文件选择')
    return null
  }
  return result.filePaths[0]
}

export function registerIpcHandlers(categoryImageBase: string, appIconPath: string | null): void {
  registerWorkbenchAssets()
  registerWorkbenchProjects()
  registerWorkbenchSpine()
  ipcMain.handle('workbench-spine:load-game', (_event, name: string) => loadGameSpine(name))
  setTaskBroadcaster((task) => {
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed()) {
        contents.send('gamebanana:download-task', task)
      }
    }
  })

  ipcMain.handle('app:icon', () => {
    if (!appIconPath || !existsSync(appIconPath)) {
      return null
    }
    return `media://local/${encodeMediaPath(appIconPath)}`
  })

  ipcMain.handle('app:bootstrap', async () => {
    const config = getAppConfig()
    const mods = await repository.scan()
    const initialization = await repository.initialize()
    if (!initialization.success) {
      logger.error(`模组仓库初始化失败：${initialization.message}`)
    } else {
      logger.info(`模组仓库初始化完成，共 ${mods.length} 个模组`)
    }
    return {
      config,
      mods,
      logs: logger.getEntries(),
      initialization,
      autoOpenSettings: process.env.NTEMM_AUTO_OPEN_SETTINGS === '1',
      // 上次分类仅在设置开启时下发;无记录或设置关闭一律 null(渲染端回落到「全部」)
      lastCategory: config.restoreLastCategory ? getLastCategory() || null : null
    }
  })

  ipcMain.handle('mods:scan', () => repository.scan())

  ipcMain.handle('gamebanana:list', (_event, page: number) => listGameBananaMods(page))
  ipcMain.handle('gamebanana:detail', (_event, modId: number) => getGameBananaMod(modId))
  ipcMain.handle('gamebanana:updates', (_event, modId: number) => getGameBananaModUpdates(modId))
  ipcMain.handle('gamebanana:comments', (_event, modId: number, page: number) => getGameBananaModComments(modId, page))
  ipcMain.handle('youdao:credentialsStatus', () => getYoudaoCredentialsStatus())
  ipcMain.handle('youdao:saveCredentials', (_event, input: YoudaoCredentialsInput) => {
    if (!input || typeof input.appId !== 'string' || typeof input.appSecret !== 'string') {
      throw new Error('有道翻译凭据格式无效。')
    }
    return saveYoudaoCredentials(input)
  })
  ipcMain.handle('youdao:clearCredentials', () => clearYoudaoCredentials())
  ipcMain.handle('gamebanana:translate', (_event, request: GameBananaTranslationRequest) => translateGameBanana(request))
  ipcMain.handle('app:cacheSize', async () => {
    const imageCacheSize = await gameBananaImageSession().getCacheSize()
    return imageCacheSize + getGameBananaTranslationCacheSize() + getGameBananaDownloadCacheSize()
  })
  ipcMain.handle('app:clearCache', async () => {
    await gameBananaImageSession().clearCache()
    clearGameBananaTranslationCache()
    clearGameBananaDownloadCache()
    sendGameBananaDownloadMarks({})
  })
  ipcMain.handle('gamebanana:downloadMarks', () => getGameBananaDownloadMarks())
  ipcMain.handle('gamebanana:tasks', () => getGameBananaTasks().filter((task) => task.source === 'gamebanana'))
  ipcMain.handle('ayakamods:pendingDownloads', () => getPendingDownloads())
  ipcMain.handle('ayakamods:tasks', () => getGameBananaTasks().filter((task) => task.source === 'ayakamods'))
  ipcMain.handle('ayakamods:cancelDownload', (_event, id: string) => cancelDownload(id))
  ipcMain.handle('ayakamods:startDownload', (_event, id: string, customName: string, installAfterDownload: boolean) => {
    const download = prepareDownload(id, customName, installAfterDownload, appDir())
    void runExclusive(`下载 AyakaMods 模组 ${customName}`, async (report) => {
      report(`正在下载 ${customName}……`)
      return download.execute()
    })
    return download.taskId
  })
  ipcMain.handle(
    'gamebanana:startDownload',
    async (_event, modId: number, fileId: string, customName: string, installAfterDownload: boolean) => {
      const mod = await getGameBananaModSummary(modId)
      const file = [...mod.files, ...mod.archivedFiles].find((item) => item.id === fileId)
      if (!file) {
        throw new Error(`找不到 GameBanana 文件：${fileId}`)
      }
      const taskId = createDownloadTask(mod, file, customName)
      void runExclusive(`下载 GameBanana 模组 ${mod.name}`, async (report) => {
        report(`正在下载 ${mod.name}……`)
        const result = await executeDownloadTask(taskId, mod, file, installAfterDownload, appDir())
        if (result.success) {
          const marks = recordGameBananaDownload(mod.id, file.id)
          if (marks) sendGameBananaDownloadMarks(marks)
        }
        return result
      })
      return taskId
    }
  )
  ipcMain.handle('gamebanana:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      return failure('只允许打开 HTTPS 网页地址。')
    }
    await shell.openExternal(url)
    return { success: true, message: '已打开网页' }
  })

  ipcMain.handle('mods:import', (_event, archivePaths: string[]) =>
    runExclusive(`导入 ${archivePaths.length} 个压缩包`, async (report): Promise<ImportResult[]> => {
      const results: ImportResult[] = []
      for (const archivePath of archivePaths) {
        report(`正在导入 ${basenameOf(archivePath)}...`)
        const result = await repository.importArchive(archivePath, appDir())
        results.push({
          archive: archivePath,
          result,
          importedName: result.success ? parseImportedName(result.message) : undefined
        })
      }
      return results
    })
  )

  ipcMain.handle('mods:install', (_event, name: string) =>
    runExclusive(`安装 ${name}`, async (report) => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      const config = getAppConfig()
      return installModExclusively(mod, config.categories, config.exclusiveInstallExemptGroups, report)
    })
  )

  ipcMain.handle('mods:setSubModEnabled', (_event, name: string, childName: string, enabled: boolean) =>
    runExclusive(`切换子模组 ${name}／${childName}`, async (report) => {
      const mod = await findMod(name)
      if (!mod) return failure(`找不到模组：${name}`)
      report(`正在${enabled ? '启用' : '停用'}子模组：${childName}…`)
      return repository.setSubModEnabled(mod, childName, enabled)
    })
  )

  ipcMain.handle('mods:renameSubMod', (_event, name: string, childName: string, newName: string) =>
    runExclusive(`重命名子模组 ${name}／${childName}`, async (report) => {
      const mod = await findMod(name)
      if (!mod) return failure(`找不到模组：${name}`)
      report(`正在重命名子模组：${childName}…`)
      return repository.renameSubMod(mod, childName, newName)
    })
  )

  ipcMain.handle('mods:uninstall', (_event, name: string) =>
    runExclusive(`卸载 ${name}`, async () => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      return repository.uninstall(mod)
    })
  )

  ipcMain.handle('mods:remove', (_event, name: string) =>
    runExclusive(`删除 ${name}`, async () => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      return repository.remove(mod)
    })
  )

  ipcMain.handle('mods:rename', (_event, oldName: string, newName: string) =>
    runExclusive(`重命名 ${oldName}`, async () => {
      const mod = await findMod(oldName)
      if (!mod) {
        return failure(`找不到模组：${oldName}`)
      }
      return repository.rename(mod, newName)
    })
  )

  ipcMain.handle('mods:setInvalid', (_event, name: string, invalid: boolean) =>
    runExclusive(invalid ? `标记 ${name} 为失效` : `取消 ${name} 的失效标记`, async (report) => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      if (invalid && mod.installed) {
        report(`正在卸载失效模组 ${name}...`)
        const uninstalled = await repository.uninstall(mod)
        if (!uninstalled.success) {
          return uninstalled
        }
      }
      return repository.setInvalid(mod, invalid)
    })
  )

  ipcMain.handle('mods:renameFile', (_event, name: string, relativePath: string, newFileName: string) =>
    runExclusive(`重命名文件 ${relativePath}`, async () => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      return repository.renameFile(mod, relativePath, newFileName)
    })
  )

  ipcMain.handle('mods:addArchive', (_event, name: string, archivePath: string) =>
    runExclusive(`向 ${name} 添加文件`, async () => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      return repository.addFromArchive(mod, archivePath, appDir())
    })
  )

  ipcMain.handle('mods:replaceArchive', (_event, name: string, archivePath: string) =>
    runExclusive(`更新 ${name}`, async () => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      return repository.replaceFromArchive(mod, archivePath, appDir())
    })
  )

  ipcMain.handle('mods:exportArchive', (_event, name: string) =>
    runExclusive(`导出 ${name}`, async (report) => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      const window = mainWindowProvider()
      if (!window) {
        return failure('无法打开文件保存窗口')
      }
      const picked = await dialog.showSaveDialog(window, {
        title: `导出「${mod.name}」`,
        defaultPath: join(app.getPath('downloads'), `${mod.name}.zip`),
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
      })
      if (picked.canceled || !picked.filePath) {
        return { success: false, message: '', cancelled: true }
      }
      if (!picked.filePath.toLowerCase().endsWith('.zip')) {
        return failure('导出文件名必须以 .zip 结尾。')
      }

      report(`正在将 ${mod.name} 压缩为 ZIP……`)
      return repository.exportArchive(mod, picked.filePath, appDir())
    })
  )

  ipcMain.handle('mods:installAll', (_event, category: string) =>
    runExclusive('批量安装模组', async (report) => {
      const config = getAppConfig()
      return changeInstallationForAll(true, category, config.categories, report)
    })
  )

  ipcMain.handle('mods:uninstallAll', (_event, category: string) =>
    runExclusive('批量卸载模组', async (report) => {
      const config = getAppConfig()
      return changeInstallationForAll(false, category, config.categories, report)
    })
  )

  ipcMain.handle('mods:batch', (_event, action: BatchModAction, names: string[]) => {
    // 重新打包可能逐个弹出源文件夹选择框,与纯仓库操作不同批次处理
    if (action === 'repackage') {
      return runExclusive('批量重新打包', async (report) => runBatchRepackage(names, report))
    }
    return runExclusive(`批量${action}`, async (report) => runBatchModAction(action, names, report))
  })

  ipcMain.handle('package:run', (_event, sourceDirectory?: string) =>
    runExclusive('打包模组', async () => {
      const packageDirectory = builtInPackagerDirectory()
      return runPackager({
        batchPath: join(packageDirectory, '傻瓜打包器.bat'),
        packageDirectory,
        sourceDirectory
      })
    })
  )

  ipcMain.handle('package:lastPath', (_event, name: string) => repository.lastPackagingPath(name))

  ipcMain.handle('package:setLastPath', (_event, name: string, path: string) =>
    repository.setLastPackagingPath(name, path)
  )

  ipcMain.handle('package:import', (_event, modName: string) =>
    runExclusive(`导入打包模组 ${modName}`, async () => {
      return repository.importPackagedMod(modName, builtInPackagerDirectory())
    })
  )

  ipcMain.handle('package:repackage', (_event, name: string) =>
    runExclusive(`重新打包 ${name}`, async (report) => {
      const mod = await findMod(name)
      if (!mod) {
        return failure(`找不到模组：${name}`)
      }
      return repackageModWithSource(mod, report)
    })
  )

  ipcMain.handle('config:get', () => getAppConfig())
  ipcMain.handle('config:readFile', () => readConfigFile())
  ipcMain.handle('config:saveFile', (_event, original: string, content: string) =>
    runExclusive('保存配置文件', async () => {
      const before = getAppConfig()
      if (!(await saveConfigFile(original, content))) return null
      const next = getAppConfig()
      if (before.testImagesEnabled !== next.testImagesEnabled ||
          before.backgroundImagesDirectory !== next.backgroundImagesDirectory) {
        backgroundCarousel.reloadImages(true)
      }
      return next
    })
  )
  const updateConfig = async (patch: AppConfigPatch) => {
    const before = getAppConfig()
    await updateAppConfig(patch)
    logger.info(
      `配置已更新：${Object.keys(patch)
        .filter((key) => patch[key as keyof AppConfigPatch] !== undefined)
        .join(',')}`
    )
    const next = getAppConfig()
    // 背景来源相关配置变化:刷新轮播图库,无需重启应用。
    // 来源确实变更(测试图开关翻转/背景目录改动)时强制换一张,
    // 即使旧图恰好仍在新图库中也立即体现切换结果;普通保存保持「无缝保留」。
    if (patch.backgroundImagesDirectory !== undefined || patch.testImagesEnabled !== undefined) {
      const sourceChanged =
        before.testImagesEnabled !== next.testImagesEnabled ||
        before.backgroundImagesDirectory !== next.backgroundImagesDirectory
      backgroundCarousel.reloadImages(sourceChanged)
    }
    return next
  }
  ipcMain.handle('config:update', (_event, patch: AppConfigPatch) =>
    patch.backupsDirectory === undefined
      ? updateConfig(patch)
      : runExclusive('保存模组备份目录', () => updateConfig(patch))
  )
  ipcMain.handle('config:setCategoryOrder', (_event, order: string[]) => {
    setCategoryOrder(order)
    logger.debug(`分类顺序已保存：${order.join('、')}`)
    return { success: true, message: '' }
  })
  ipcMain.handle('config:setLastCategory', (_event, category: string) => {
    setLastCategory(category)
    logger.debug(`当前分类已记忆：${category || '（空）'}`)
    return { success: true, message: '' }
  })

  ipcMain.handle('dialog:pickArchive', async () => {
    const picked = await pickFileWithDialog({
      title: '选择要导入的压缩包',
      filters: [{ name: '压缩包', extensions: ['zip', 'rar', '7z'] }],
      properties: ['openFile']
    })
    if (typeof picked !== 'string') {
      return null
    }
    logger.debug(`已选择要导入的压缩包：${picked}`)
    return picked
  })

  ipcMain.handle('dialog:pickDirectory', async (_event, defaultPath?: string) => {
    const picked = await pickFileWithDialog({
      title: '选择文件夹',
      defaultPath: defaultPath && existsSync(defaultPath) ? defaultPath : undefined,
      properties: ['openDirectory']
    })
    if (typeof picked !== 'string') {
      return null
    }
    logger.debug(`已选择文件夹：${picked}`)
    return picked
  })

  ipcMain.handle(
    'dialog:pickFile',
    async (_event, options?: { title?: string; extensions?: string[]; defaultPath?: string }) => {
      const picked = await pickFileWithDialog({
        title: options?.title ?? '选择文件',
        defaultPath:
          options?.defaultPath && existsSync(options.defaultPath) ? options.defaultPath : undefined,
        filters:
          options?.extensions && options.extensions.length > 0
            ? [{ name: '文件', extensions: options.extensions }]
            : undefined,
        properties: ['openFile']
      })
      if (typeof picked !== 'string') {
        return null
      }
      logger.debug(`已选择文件：${picked}`)
      return picked
    }
  )

  ipcMain.handle('path:open', async (_event, path: string) => {
    const error = await shell.openPath(path)
    if (error) {
      logger.warning(`无法打开路径：${path}：${error}`)
      return failure(error)
    }
    logger.debug(`已打开路径：${path}`)
    return { success: true, message: '' }
  })
  ipcMain.handle('path:showInFolder', (_event, path: string) => {
    shell.showItemInFolder(path)
    logger.debug(`已在文件夹中定位：${path}`)
    return { success: true, message: '' }
  })

  ipcMain.handle('launcher:run', async () => {
    const launcherPath = getAppConfig().gameLauncher
    if (!existsSync(launcherPath)) {
      logger.warning(`找不到游戏启动器：${launcherPath}`)
      return failure(`找不到游戏启动器：${launcherPath}`)
    }
    const { spawn } = await import('node:child_process')
    try {
      const child = spawn(launcherPath, [], { detached: true, stdio: 'ignore' })
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      child.unref()
    } catch (error) {
      logger.error(`无法启动游戏启动器：${launcherPath}，${describeError(error)}`)
      return failure('无法启动游戏启动器。')
    }
    logger.info(`已启动游戏启动器：${launcherPath}`)
    const window = mainWindowProvider()
    if (window && !window.isDestroyed()) {
      window.minimize()
    }
    return { success: true, message: '已启动游戏启动器' }
  })

  ipcMain.handle('log:entries', () => logger.getEntries())

  ipcMain.handle('background:next', () => {
    logger.info('手动切换背景')
    backgroundCarousel.switchBackground()
    return { success: true, message: '' }
  })
  ipcMain.handle('background:toggleDebugMode', () => {
    logger.info('已切换背景调试模式')
    backgroundCarousel.toggleDebugMode()
    return { success: true, message: '' }
  })
  ipcMain.handle('background:currentPath', () => backgroundCarousel.currentPath())
  ipcMain.handle('background:currentState', () => backgroundCarousel.lastPushedState())

  ipcMain.handle('category:image', (_event, category: string) => {
    // category 拼进路径前先拒绝分隔符:防止构造出目录树之外的文件路径
    if (
      typeof category !== 'string' ||
      category.length === 0 ||
      category.includes('/') ||
      category.includes('\\')
    ) {
      return null
    }
    const imagePath = join(categoryImageBase, `${category}.png`)
    if (!existsSync(imagePath)) {
      return null
    }
    return `media://local/${encodeMediaPath(imagePath)}`
  })
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function parseImportedName(message: string): string | undefined {
  const prefix = '已导入 '
  if (message.startsWith(prefix)) {
    return message.slice(prefix.length)
  }
  return undefined
}
