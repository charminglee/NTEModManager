import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseIni, serializeIni, splitList, unquote } from './ini'
import type { AppConfigData, AppConfigPatch, LiquidGlassConfig } from '../shared/types'
import { LIQUID_GLASS_DEFAULTS, SortOrder } from '../shared/types'

const CONFIG_FILE_NAME = 'NteModManager.ini'

/** 游戏安装目录下的固定相对路径:模组安装目录与启动器 */
const DEFAULT_GAME_DIRECTORY = 'E:/Neverness To Everness'
const GAME_MODS_SUBPATH = 'Client/WindowsNoEditor/HT/Content/Paks/~mods'
const GAME_LAUNCHER_FILENAME = 'NTELauncher.exe'

export const DEFAULT_MOD_CATEGORIES = [
  '黑羽',
  '灵可',
  '残虹',
  '安魂曲',
  '薄荷',
  '达芙蒂尔',
  '法帝娅',
  '九原',
  '娜娜莉',
  '主角',
  '小吱',
  '浔',
  '伊洛伊',
  '早雾',
  '真红',
  '哈尼娅',
  '哈索尔',
  '海月'
]

export const DEFAULT_CATEGORY_ORDER = [
  '黑羽',
  '灵可',
  '残虹',
  '伊洛伊',
  '真红',
  '安魂曲',
  '娜娜莉',
  '小吱',
  '薄荷',
  '九原',
  '达芙蒂尔',
  '浔',
  '主角',
  '哈尼娅',
  '法帝娅',
  '哈索尔',
  '早雾',
  '海月'
]

let cachedConfigPath: string | null = null

/** LiquidGlassConfig 字段与 [LiquidGlass] 配置节键名的对应关系 */
const LIQUID_GLASS_INI_KEYS: Record<keyof LiquidGlassConfig, string> = {
  enabled: 'enabled',
  refraction: 'refraction',
  dispersion: 'dispersion',
  blur: 'blur',
  specular: 'specular',
  sidebar: 'sidebar',
  modCards: 'mod_cards',
  toolbar: 'toolbar',
  statusBar: 'status_bar',
  logPanel: 'log_panel'
}

/**
 * 配置文件与可执行文件放在同一目录(与原 Qt 版一致);开发模式下放在 app 目录,
 * 避免写进 node_modules/electron/dist。
 */
export function configFilePath(): string {
  if (cachedConfigPath) {
    return cachedConfigPath
  }
  // NTEMM_CONFIG 显式指定 ini 位置(bg-server 的 --config= 参数会写入该环境变量),
  // 供服务与主程序 exe 不同目录部署时指回主程序的配置
  const override = process.env.NTEMM_CONFIG?.trim()
  if (override) {
    cachedConfigPath = override.replace(/\\/g, '/')
    return cachedConfigPath
  }
  const baseDir = app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()
  cachedConfigPath = join(baseDir, CONFIG_FILE_NAME)
  return cachedConfigPath
}

function readIni(): ReturnType<typeof parseIni> {
  const filePath = configFilePath()
  if (!existsSync(filePath)) {
    createDefaultConfig(filePath)
  }
  try {
    return parseIni(readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeSection(section: string, entries: Record<string, string>): void {
  const ini = readIni()
  ini[section] = entries
  writeFileSync(configFilePath(), serializeIni(ini), 'utf-8')
}

function getPath(key: string, fallback: string, allowEmpty = false): string {
  const ini = readIni()
  const raw = (ini.Paths?.[key] ?? '').trim()
  if (!raw && !allowEmpty) {
    return fallback
  }
  return raw.replace(/\\/g, '/')
}

function getBool(section: string, key: string, fallback: boolean): boolean {
  const raw = readIni()[section]?.[key]?.trim()
  if (raw === undefined || raw === '') {
    return fallback
  }
  return raw === '1' || raw.toLowerCase() === 'true'
}

function getInt(section: string, key: string, fallback: number): number {
  const parsed = Number.parseInt(readIni()[section]?.[key] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getList(section: string, key: string, fallback: string[]): string[] {
  const raw = readIni()[section]?.[key]
  if (raw === undefined) {
    return fallback
  }
  return splitList(unquote(raw))
}

function createDefaultConfig(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const ini = parseIni('')
  ini.Paths = {
    mods_directory: `${DEFAULT_GAME_DIRECTORY}/${GAME_MODS_SUBPATH}`,
    backups_directory: 'E:/NteMod/Backups',
    background_images_directory: 'D:/pictures/真人',
    game_launcher: `${DEFAULT_GAME_DIRECTORY}/${GAME_LAUNCHER_FILENAME}`,
    packager_directory: 'E:/Projects/ModManager/傻瓜打包器'
  }
  ini.Categories = {
    names: DEFAULT_MOD_CATEGORIES.join(',')
  }
  ini.Preferences = {
    mod_list_sort_order: String(SortOrder.NameAscending),
    mod_category_order: DEFAULT_CATEGORY_ORDER.join(','),
    auto_use_last_packaging_path: '1',
    exclusive_install_exempt_groups: 'UI'
  }
  ini.Debug = {
    test_images: '0',
    fps_counter: '0'
  }
  const liquidGlassEntries: Record<string, string> = {}
  for (const [key, iniKey] of Object.entries(LIQUID_GLASS_INI_KEYS)) {
    const value = LIQUID_GLASS_DEFAULTS[key as keyof LiquidGlassConfig]
    liquidGlassEntries[iniKey] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
  }
  ini.LiquidGlass = liquidGlassEntries
  writeFileSync(filePath, serializeIni(ini), 'utf-8')
}

/**
 * 从已有路径反推游戏安装目录:优先剥离模组目录的固定后缀,
 * 否则剥离启动器文件名,最后退回启动器所在目录(兼容非常规配置)。
 */
function deriveGameDirectory(modsDirectory: string, gameLauncher: string): string {
  const mods = modsDirectory.replace(/\\/g, '/')
  const modsSuffix = `/${GAME_MODS_SUBPATH}`.toLowerCase()
  if (mods.toLowerCase().endsWith(modsSuffix)) {
    return mods.slice(0, mods.length - modsSuffix.length)
  }
  const launcher = gameLauncher.replace(/\\/g, '/')
  const launcherSuffix = `/${GAME_LAUNCHER_FILENAME}`.toLowerCase()
  if (launcher.toLowerCase().endsWith(launcherSuffix)) {
    return launcher.slice(0, launcher.length - launcherSuffix.length)
  }
  const lastSlash = launcher.lastIndexOf('/')
  return lastSlash > 0 ? launcher.slice(0, lastSlash) : ''
}

export function getAppConfig(): AppConfigData {
  const ini = readIni()
  const modsDirectory = getPath('mods_directory', `${DEFAULT_GAME_DIRECTORY}/${GAME_MODS_SUBPATH}`)
  const gameLauncher = getPath('game_launcher', `${DEFAULT_GAME_DIRECTORY}/${GAME_LAUNCHER_FILENAME}`)

  return {
    configPath: configFilePath(),
    gameDirectory: deriveGameDirectory(modsDirectory, gameLauncher),
    modsDirectory,
    backupsDirectory: getPath('backups_directory', 'E:/NteMod/Backups'),
    backgroundImagesDirectory: getPath('background_images_directory', 'D:/pictures/真人', true),
    gameLauncher,
    packagerDirectory: getPath('packager_directory', 'E:/Projects/ModManager/傻瓜打包器'),
    autoUseLastPackagingPath: getBool('Preferences', 'auto_use_last_packaging_path', true),
    exclusiveInstallExemptGroups: getList('Preferences', 'exclusive_install_exempt_groups', ['UI']),
    categories: getList('Categories', 'names', DEFAULT_MOD_CATEGORIES),
    categoryOrder: getList('Preferences', 'mod_category_order', DEFAULT_CATEGORY_ORDER),
    sortOrder: clampSortOrder(getInt('Preferences', 'mod_list_sort_order', SortOrder.NameAscending)),
    testImagesEnabled: getBool('Debug', 'test_images', false),
    // 冒烟测量工具可用 NTEMM_FPS=1 强制开启,不受配置开关影响
    fpsCounterEnabled:
      getBool('Debug', 'fps_counter', false) || process.env.NTEMM_FPS === '1',
    liquidGlass: getLiquidGlassConfig(ini)
  }
}

/** 解析 [LiquidGlass] 配置节;键缺失时逐项回退到默认值。
 *  效果强度项兼容旧版布尔编码:'1'/'true' 视为 100,'0'/'false' 视为 0。 */
function getLiquidGlassConfig(ini: ReturnType<typeof parseIni>): LiquidGlassConfig {
  const section = ini.LiquidGlass
  const result = { ...LIQUID_GLASS_DEFAULTS }
  if (!section) {
    return result
  }
  for (const [key, iniKey] of Object.entries(LIQUID_GLASS_INI_KEYS)) {
    const configKey = key as keyof LiquidGlassConfig
    const raw = section[iniKey]?.trim().toLowerCase()
    if (raw === undefined || raw === '') {
      continue
    }
    if (typeof LIQUID_GLASS_DEFAULTS[configKey] === 'boolean') {
      ;(result[configKey] as boolean) = raw === '1' || raw === 'true'
      continue
    }
    if (raw === '1' || raw === 'true') {
      // 旧版布尔开关的视觉等效值:色散在旧版从未实际渲染(无组件接入,开关是死的),
      // 必须迁移为 0,否则旧配置会继承到全局 100% 色散,把帧率打穿
      ;(result[configKey] as number) = configKey === 'dispersion' ? 0 : 100
    } else if (raw === '0' || raw === 'false') {
      ;(result[configKey] as number) = 0
    } else {
      const parsed = Number.parseFloat(raw)
      ;(result[configKey] as number) = Number.isFinite(parsed)
        ? Math.min(100, Math.max(0, parsed))
        : LIQUID_GLASS_DEFAULTS[configKey]
    }
  }
  return result
}

function clampSortOrder(value: number): SortOrder {
  if (value < SortOrder.InstalledFirst || value > SortOrder.SizeSmallestFirst) {
    return SortOrder.NameAscending
  }
  return value as SortOrder
}

export function setSortOrder(sortOrder: SortOrder): void {
  writeSection('Preferences', {
    ...readIni().Preferences,
    mod_list_sort_order: String(sortOrder)
  })
}

export function setCategoryOrder(categoryOrder: string[]): void {
  writeSection('Preferences', {
    ...readIni().Preferences,
    mod_category_order: categoryOrder.join(',')
  })
}

// ============ 视觉识别(Python 桥)路径 ============
// 对应原 Qt 版 AppConfig 的 pythonExecutable/visualRegionScript/orientationModel/pythonModelCache:
// 打包后固定在 resources/python 下;开发模式自动探测仓库内环境,均可用 Paths/* 键覆盖。

function repoRoot(): string {
  return join(app.getAppPath(), '..')
}

function overriddenPath(key: string): string {
  return getPath(key, '', true)
}

export function pythonExecutable(): string {
  const override = overriddenPath('python_executable')
  if (override) {
    return override
  }
  if (!app.isPackaged) {
    const venvPython = join(repoRoot(), '.venv/Scripts/python.exe')
    if (existsSync(venvPython)) {
      return venvPython
    }
    return join(repoRoot(), 'python/python.exe')
  }
  return join(process.resourcesPath, 'python/python.exe')
}

export function visualRegionScript(): string {
  const override = overriddenPath('visual_region_script')
  if (override) {
    return override
  }
  if (!app.isPackaged) {
    const devScript = join(repoRoot(), 'src/python/visual_region_detector.py')
    if (existsSync(devScript)) {
      return devScript
    }
  }
  return join(process.resourcesPath, 'python/visual_region_detector.py')
}

export function orientationModel(): string {
  const override = overriddenPath('orientation_model')
  if (override) {
    return override
  }
  if (!app.isPackaged) {
    const trainedModel = join(
      repoRoot(),
      'training/orientation/checkpoints/weighted_unfrozen/best.pt'
    )
    if (existsSync(trainedModel)) {
      return trainedModel
    }
    return join(repoRoot(), 'python/orientation-model/best.pt')
  }
  return join(process.resourcesPath, 'python/orientation-model/best.pt')
}

/** 姿态模型(yolo26x-pose.pt)所在目录;Python 端 resolve_model_path 会在该目录下解析模型文件名 */
export function pythonModelCache(): string {
  const override = overriddenPath('python_model_cache')
  if (override) {
    return override
  }
  if (!app.isPackaged && existsSync(join(repoRoot(), 'yolo26x-pose.pt'))) {
    return repoRoot()
  }
  return join(process.resourcesPath, 'python/model-cache')
}

const PATH_PATCH_KEYS: Partial<Record<keyof AppConfigPatch, string>> = {
  modsDirectory: 'mods_directory',
  backupsDirectory: 'backups_directory',
  backgroundImagesDirectory: 'background_images_directory',
  gameLauncher: 'game_launcher',
  packagerDirectory: 'packager_directory'
}

/** 设置界面保存:将补丁写入配置文件,未指定的字段保持原值。 */
export function updateAppConfig(patch: AppConfigPatch): void {
  const ini = readIni()

  const pathEntries: Record<string, string> = {}
  if (typeof patch.gameDirectory === 'string') {
    const gameDir = patch.gameDirectory.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    if (gameDir) {
      pathEntries.mods_directory = `${gameDir}/${GAME_MODS_SUBPATH}`
      pathEntries.game_launcher = `${gameDir}/${GAME_LAUNCHER_FILENAME}`
    }
  }
  for (const [key, iniKey] of Object.entries(PATH_PATCH_KEYS)) {
    const raw = patch[key as keyof AppConfigPatch]
    if (typeof raw === 'string') {
      pathEntries[iniKey as string] = raw.trim().replace(/\\/g, '/')
    }
  }
  if (Object.keys(pathEntries).length > 0) {
    ini.Paths = { ...ini.Paths, ...pathEntries }
  }

  const preferenceEntries: Record<string, string> = {}
  if (patch.autoUseLastPackagingPath !== undefined) {
    preferenceEntries.auto_use_last_packaging_path = patch.autoUseLastPackagingPath ? '1' : '0'
  }
  if (patch.exclusiveInstallExemptGroups !== undefined) {
    preferenceEntries.exclusive_install_exempt_groups =
      patch.exclusiveInstallExemptGroups.map((group) => group.trim()).filter(Boolean).join(',')
  }
  if (Object.keys(preferenceEntries).length > 0) {
    ini.Preferences = { ...ini.Preferences, ...preferenceEntries }
  }

  if (patch.testImagesEnabled !== undefined) {
    ini.Debug = { ...ini.Debug, test_images: patch.testImagesEnabled ? '1' : '0' }
  }

  if (patch.fpsCounterEnabled !== undefined) {
    ini.Debug = { ...ini.Debug, fps_counter: patch.fpsCounterEnabled ? '1' : '0' }
  }

  if (patch.liquidGlass) {
    const entries: Record<string, string> = { ...ini.LiquidGlass }
    for (const [key, value] of Object.entries(patch.liquidGlass)) {
      const iniKey = LIQUID_GLASS_INI_KEYS[key as keyof LiquidGlassConfig]
      if (!iniKey) {
        continue
      }
      entries[iniKey] =
        typeof value === 'boolean'
          ? value
            ? '1'
            : '0'
          : String(Math.min(100, Math.max(0, Math.round(value))))
    }
    ini.LiquidGlass = entries
  }

  writeFileSync(configFilePath(), serializeIni(ini), 'utf-8')
}
