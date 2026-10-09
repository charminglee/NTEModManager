import { dialog, ipcMain, shell, webContents } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as repository from './repository'
import { changeInstallationForAll, installModExclusively, runBatchModAction } from './operations'
import { getAppConfig, getLastCategory, setCategoryOrder, setLastCategory, setSortOrder, updateAppConfig } from './config'
import { runPackager } from './packager'
import { encodeMediaPath } from './background'
import { backgroundCarousel } from './background-carousel'
import { describeError, logger } from './logger'
import type { AppConfigPatch, BatchModAction, ImportResult, ModInfo, OperationResult, SortOrder } from '../shared/types'

type ProgressReporter = (message: string) => void

let mainWindowProvider: () => Electron.BrowserWindow | null = () => null

export function setMainWindowProvider(provider: () => Electron.BrowserWindow | null): void {
  mainWindowProvider = provider
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

  const packResult = await runPackager({
    batchPath: join(config.packagerDirectory, '傻瓜打包器.bat'),
    packageDirectory: config.packagerDirectory,
    sourceDirectory
  })
  if (!packResult.success) {
    return packResult
  }

  report(`正在替换 ${mod.name} 的源文件...`)
  const replaced = await repository.replacePackagedMod(mod, config.packagerDirectory)
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
      const config = getAppConfig()
      return runPackager({
        batchPath: join(config.packagerDirectory, '傻瓜打包器.bat'),
        packageDirectory: config.packagerDirectory,
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
      const config = getAppConfig()
      return repository.importPackagedMod(modName, config.packagerDirectory)
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
  ipcMain.handle('config:open', async () => {
    const path = getAppConfig().configPath
    const error = await shell.openPath(path)
    if (error) {
      logger.warning(`无法使用系统默认方式打开配置文件：${path}`)
      return failure('无法打开配置文件')
    }
    logger.info(`已使用系统默认方式打开配置文件：${path}`)
    return { success: true, message: '已打开配置文件' }
  })
  ipcMain.handle('config:update', (_event, patch: AppConfigPatch) => {
    updateAppConfig(patch)
    logger.info(
      `配置已更新：${Object.keys(patch)
        .filter((key) => patch[key as keyof AppConfigPatch] !== undefined)
        .join(',')}`
    )
    const next = getAppConfig()
    // 背景来源相关配置变化:刷新轮播图库,无需重启应用
    if (patch.backgroundImagesDirectory !== undefined || patch.testImagesEnabled !== undefined) {
      backgroundCarousel.reloadImages()
    }
    return next
  })
  ipcMain.handle('config:setSortOrder', (_event, sortOrder: SortOrder) => {
    setSortOrder(sortOrder)
    logger.debug(`排序方式已保存：${sortOrder}`)
    return { success: true, message: '' }
  })
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
      child.unref()
    } catch {
      logger.error(`无法启动游戏启动器：${launcherPath}`)
      return failure('无法启动游戏启动器。')
    }
    logger.info(`已启动游戏启动器：${launcherPath}`)
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
