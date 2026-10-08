import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describeError, logger } from './logger'

/**
 * 所有运行时数据的统一根目录 ~/.ntemm:配置(NteModManager.ini)、日志(logs/)、
 * 缓存(cache/)与 Electron userData(electron/)。主程序与背景图服务共享。
 */
export const NTEMM_HOME_DIR = join(homedir(), '.ntemm')

/** ini 配置文件(主程序与背景服务共用;NTEMM_CONFIG/--config= 仍可显式覆盖) */
export const ntemmConfigFile = (): string => join(NTEMM_HOME_DIR, 'NteModManager.ini')

/** 日志目录;主程序与背景服务各写一个文件,避免双进程同文件交错 */
export const ntemmLogsDir = (): string => join(NTEMM_HOME_DIR, 'logs')

/** 磁盘缓存根目录(Python 模型缓存、Ultralytics/Torch 的隐式缓存) */
export const ntemmCacheDir = (): string => join(NTEMM_HOME_DIR, 'cache')
/** Electron userData 根目录;主程序与背景服务必须各占一个子目录(单例锁按 userData 区分) */
export const ntemmElectronDir = (): string => join(NTEMM_HOME_DIR, 'electron')

/**
 * 预创建 Python 缓存目录。Ultralytics 对不存在的 YOLO_CONFIG_DIR 会误判「不可写」,
 * 把设置回落到当前工作目录(散落在 exe/仓库旁),所以要先建好再拉起子进程;
 * 最终目录是 cache/ultralytics/Ultralytics(它会自行追加一层子目录)。
 */
export function ensurePythonCacheDirs(): void {
  try {
    mkdirSync(join(ntemmCacheDir(), 'ultralytics', 'Ultralytics'), { recursive: true })
    mkdirSync(join(ntemmCacheDir(), 'torch'), { recursive: true })
  } catch (error) {
    // 建不出来时让 ultralytics/torch 走各自的回退逻辑
    logger.warning(`Python 缓存目录创建失败（子进程可能把缓存散落到工作目录）：${describeError(error)}`)
  }
}

/** userData 里可再生或无需搬迁的内容,迁移旧 userData 时跳过 */
const NON_ESSENTIAL_USER_DATA_ENTRIES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'logs',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'lockfile'
])

/**
 * 把旧 userData(默认 %APPDATA%/<app.name>)的内容迁入 ~/.ntemm/electron 下的新目录:
 * 窗口状态、Local Storage 等保留,缓存类目录跳过。仅在目标不存在(首次启动)时执行一次。
 * 迁移失败不阻断启动,大不了丢弃旧状态从头来。
 */
export function migrateLegacyUserData(target: string, legacy: string): string {
  if (existsSync(target)) {
    logger.debug(`userData 目录已存在，跳过旧数据迁移：${target}`)
    return target
  }
  if (!existsSync(legacy)) {
    logger.debug(`旧 userData 目录不存在，无需迁移：${legacy}`)
    return target
  }
  try {
    logger.info(`开始迁移旧 userData：${legacy} → ${target}`)
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(legacy)) {
      if (NON_ESSENTIAL_USER_DATA_ENTRIES.has(entry)) {
        continue
      }
      cpSync(join(legacy, entry), join(target, entry), { recursive: true })
    }
    logger.info('旧 userData 迁移完成')
  } catch (error) {
    logger.warning(`旧 userData 迁移失败，放弃旧状态继续启动：${describeError(error)}`)
    return target
  }
  return target
}

/** 迁移来源的 userData(Electron 缺省行为:%APPDATA%/<app.name>) */
export const legacyUserDataDir = (): string => join(app.getPath('appData'), app.name)
