import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ntemmConfigFile } from './ntemm-paths'
import { parseIni, serializeIni, splitList, unquote } from './ini'
import type { AppConfigData, AppConfigPatch, LiquidGlassConfig } from '../shared/types'
import {
  LIQUID_GLASS_DEFAULTS,
  SortOrder,
  UI_CORNER_RADIUS_DEFAULT,
  UI_CORNER_RADIUS_MAX,
  UI_CORNER_RADIUS_MIN
} from '../shared/types'

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
  logPanel: 'log_panel',
  buttons: 'buttons',
  inputs: 'inputs'
}

/**
 * 配置统一保存到 ~/.ntemm/NteModManager.ini(主程序与背景服务共享);
 * 可执行文件同目录(开发模式为 app 目录)的已有 ini 首次读取时自动迁移过来。
 */
export function configFilePath(): string {
  if (cachedConfigPath) {
    return cachedConfigPath
  }
  // NTEMM_CONFIG 显式指定 ini 位置(python/visual_region_detector.py --http 的
  // --config 参数解析同一变量),供外部服务与主程序不同目录部署时指回主程序的配置
  const override = process.env.NTEMM_CONFIG?.trim()
  if (override) {
    cachedConfigPath = override.replace(/\\/g, '/')
    return cachedConfigPath
  }
  const filePath = ntemmConfigFile()
  // 旧位置(exe/app 目录)的 ini 仍存在而新位置还没有时,搬一次家;失败则退回旧位置
  const legacyPath = join(
    app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath(),
    CONFIG_FILE_NAME
  )
  if (!existsSync(filePath) && existsSync(legacyPath)) {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      copyFileSync(legacyPath, filePath)
    } catch {
      cachedConfigPath = legacyPath.replace(/\\/g, '/')
      return cachedConfigPath
    }
  }
  cachedConfigPath = filePath
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
    exclusive_install_exempt_groups: 'UI',
    ui_corner_radius: String(UI_CORNER_RADIUS_DEFAULT),
    restore_last_category: '0'
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
    restoreLastCategory: getBool('Preferences', 'restore_last_category', false),
    testImagesEnabled: getBool('Debug', 'test_images', false),
    // 冒烟测量工具可用 NTEMM_FPS=1 强制开启,不受配置开关影响
    fpsCounterEnabled:
      getBool('Debug', 'fps_counter', false) || process.env.NTEMM_FPS === '1',
    uiCornerRadius: clampUiCornerRadius(
      getInt('Preferences', 'ui_corner_radius', UI_CORNER_RADIUS_DEFAULT)
    ),
    liquidGlass: getLiquidGlassConfig(ini)
  }
}

/** 解析 [LiquidGlass] 配置节;键缺失时逐项回退到默认值。
 *  效果强度项兼容布尔写法:'1'/'true' 视为 100,'0'/'false' 视为 0。 */
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
      // 布尔开关的视觉等效值:强度按 100% 迁移(色散现仅作用于侧边栏/工具栏,可安全开启)
      ;(result[configKey] as number) = 100
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

function clampUiCornerRadius(value: number): number {
  if (!Number.isFinite(value)) {
    return UI_CORNER_RADIUS_DEFAULT
  }
  return Math.min(UI_CORNER_RADIUS_MAX, Math.max(UI_CORNER_RADIUS_MIN, Math.round(value)))
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

/** 上次打开的分类([Preferences] last_category);空串 = 无记录 */
export function getLastCategory(): string {
  return unquote(readIni().Preferences?.last_category ?? '').trim()
}

export function setLastCategory(category: string): void {
  writeSection('Preferences', {
    ...readIni().Preferences,
    last_category: category
  })
}

// ============ 视觉识别(Python 桥)路径 ============
// Python 资源(解释器、识别脚本、模型)不打包进应用,运行时解析「python 资源目录」:
// 优先用程序所在目录旁的 python/,找不到则从 exe 目录向上逐级找含识别脚本的 python/
// (开发模式 = 仓库根的 python/)。找不到时仍返回缺省拼装路径,让 spawn/existsSync
// 失败并走 fallback 视觉检测。均可用 Paths/* 键覆盖(设置界面已移除,ini 是手动兜底)。

const PYTHON_SCRIPT_NAME = 'visual_region_detector.py'

function overriddenPath(key: string): string {
  return getPath(key, '', true)
}

let cachedAssetsDir: string | null | undefined

function pythonAssetsDir(): string {
  if (cachedAssetsDir === undefined) {
    cachedAssetsDir = null
    let dir = dirname(app.getPath('exe'))
    for (let depth = 0; depth < 10; depth += 1) {
      const candidate = join(dir, 'python')
      if (existsSync(join(candidate, PYTHON_SCRIPT_NAME))) {
        cachedAssetsDir = candidate
        break
      }
      const parent = dirname(dir)
      if (parent === dir) {
        break
      }
      dir = parent
    }
  }
  // 找不到时返回 exe 旁的约定位置,错误信息里能看到试过的路径
  return cachedAssetsDir ?? join(dirname(app.getPath('exe')), 'python')
}

export function pythonExecutable(): string {
  const override = overriddenPath('python_executable')
  if (override) {
    return override
  }
  const assetsDir = pythonAssetsDir()
  const venvPython = join(assetsDir, '.venv/Scripts/python.exe')
  return existsSync(venvPython) ? venvPython : join(assetsDir, 'python.exe')
}

export function visualRegionScript(): string {
  const override = overriddenPath('visual_region_script')
  if (override) {
    return override
  }
  return join(pythonAssetsDir(), PYTHON_SCRIPT_NAME)
}

export function orientationModel(): string {
  const override = overriddenPath('orientation_model')
  if (override) {
    return override
  }
  return join(pythonAssetsDir(), 'orientation-model/best.pt')
}

/** 姿态模型(yolo26x-pose.pt)所在目录;Python 端 resolve_model_path 会在该目录下解析模型文件名 */
export function pythonModelCache(): string {
  const override = overriddenPath('python_model_cache')
  if (override) {
    return override
  }
  return join(pythonAssetsDir(), 'model-cache')
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
  if (patch.uiCornerRadius !== undefined) {
    preferenceEntries.ui_corner_radius = String(clampUiCornerRadius(patch.uiCornerRadius))
  }
  if (patch.restoreLastCategory !== undefined) {
    preferenceEntries.restore_last_category = patch.restoreLastCategory ? '1' : '0'
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
