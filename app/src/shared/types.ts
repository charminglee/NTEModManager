export const ALL_CATEGORY = '全部'
export const OTHER_CATEGORY = '其他'
export const MANIFEST_FILE_NAME = '.nte-mod-manager.json'

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
}

export interface ModFileEntry {
  name: string
  sizeBytes: number
  directory: boolean
  children: ModFileEntry[]
}

export interface ModInfo {
  name: string
  sourcePath: string
  sizeBytes: number
  files: ModFileEntry[]
  /** ISO 8601(本地时间) */
  importedAt: string
  installed: boolean
  invalid: boolean
}

export interface OperationResult {
  success: boolean
  message: string
  cancelled?: boolean
}

export interface ImportResult {
  archive: string
  result: OperationResult
  /** 导入成功后的模组名称(用于导入后重命名提示) */
  importedName?: string
}

/** 液态玻璃可单独开关的界面区域 */
export type LiquidGlassArea = 'sidebar' | 'modCards' | 'toolbar' | 'logPanel' | 'buttons' | 'inputs'

/** 液态玻璃效果配置:总开关(液态玻璃/毛玻璃)+ 效果强度 + 区域开关 */
export interface LiquidGlassConfig {
  /** 总开关:true=液态玻璃(Vaso 实时渲染),false=毛玻璃(高透 backdrop 模糊回退) */
  enabled: boolean
  /** 折射强度 0-100(%):乘算各面板自身的折射深度,0 为关闭 */
  refraction: number
  /** 边缘色散强度 0-100(%):仅侧边栏接入(渲染开销成倍增加,不铺开到批量小玻璃),0 为关闭 */
  dispersion: number
  /** 背景模糊强度 0-100(%):乘算各面板自身的模糊半径,0 为关闭 */
  blur: number
  /** 边缘高光强度 0-100(%):乘算边缘镜面反光,0 为关闭 */
  specular: number
  /** 侧边栏 */
  sidebar: boolean
  /** 模组卡片 */
  modCards: boolean
  /** 顶部工具栏 */
  toolbar: boolean
  /** 日志面板 */
  logPanel: boolean
  /** 玻璃样式的按钮(工具栏、浏览等) */
  buttons: boolean
  /** 文本输入框(搜索、路径、重命名等) */
  inputs: boolean
}

export const LIQUID_GLASS_DEFAULTS: LiquidGlassConfig = {
  enabled: true,
  refraction: 100,
  dispersion: 100,
  blur: 100,
  specular: 100,
  sidebar: true,
  modCards: true,
  toolbar: true,
  logPanel: true,
  buttons: true,
  inputs: true
}

export const LIQUID_GLASS_KEYS = Object.keys(LIQUID_GLASS_DEFAULTS) as (keyof LiquidGlassConfig)[]

/** 全局圆角(px):所有 UI 控件(含液态/毛玻璃面板)统一套用的 border-radius */
export const UI_CORNER_RADIUS_DEFAULT = 16
export const UI_CORNER_RADIUS_MIN = 0
export const UI_CORNER_RADIUS_MAX = 32

export interface AppConfigData {
  configPath: string
  /** 游戏安装目录;由模组目录/启动器路径反推得到 */
  gameDirectory: string
  /** 模组安装目录;随游戏安装目录自动生成 */
  modsDirectory: string
  backupsDirectory: string
  backgroundImagesDirectory: string
  /** 游戏启动器路径;随游戏安装目录自动生成 */
  gameLauncher: string
  packagerDirectory: string
  autoUseLastPackagingPath: boolean
  exclusiveInstallExemptGroups: string[]
  categories: string[]
  categoryOrder: string[]
  sortOrder: SortOrder
  /** 启动时恢复上次打开的分类;上次分类单独记录在 [Preferences] last_category */
  restoreLastCategory: boolean
  testImagesEnabled: boolean
  /** 显示 FPS 计数器(性能诊断);NTEMM_FPS=1 环境变量可强制开启 */
  fpsCounterEnabled: boolean
  /** 全局圆角(px):写入 :root 的 --radius,所有控件的圆角刻度由它单点派生 */
  uiCornerRadius: number
  liquidGlass: LiquidGlassConfig
}

/** 设置界面可修改的配置子集;未指定的字段保持不变。 */
export interface AppConfigPatch {
  /** 游戏安装目录;写入时同步生成模组目录与启动器路径 */
  gameDirectory?: string
  modsDirectory?: string
  backupsDirectory?: string
  backgroundImagesDirectory?: string
  gameLauncher?: string
  packagerDirectory?: string
  autoUseLastPackagingPath?: boolean
  exclusiveInstallExemptGroups?: string[]
  restoreLastCategory?: boolean
  testImagesEnabled?: boolean
  fpsCounterEnabled?: boolean
  uiCornerRadius?: number
  liquidGlass?: Partial<LiquidGlassConfig>
}

/** 持久化到 INI 的 Preferences/mod_list_sort_order 取值 */
export enum SortOrder {
  InstalledFirst = 0,
  NameAscending = 1,
  NameDescending = 2,
  ImportedNewestFirst = 3,
  ImportedOldestFirst = 4,
  SizeLargestFirst = 5,
  SizeSmallestFirst = 6
}

export const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: SortOrder.InstalledFirst, label: '默认' },
  { value: SortOrder.NameAscending, label: '名称：A 到 Z' },
  { value: SortOrder.NameDescending, label: '名称：Z 到 A' },
  { value: SortOrder.ImportedNewestFirst, label: '导入时间：最新优先' },
  { value: SortOrder.ImportedOldestFirst, label: '导入时间：最早优先' },
  { value: SortOrder.SizeLargestFirst, label: '文件大小：从大到小' },
  { value: SortOrder.SizeSmallestFirst, label: '文件大小：从小到大' }
]

export interface BackgroundRect {
  x: number
  y: number
  width: number
  height: number
}

/** 主进程背景轮播推送给渲染进程的一帧状态;同代更新(裁剪/线框变化)不换代。 */
export interface BackgroundState {
  generation: number
  /** 当前背景图源文件路径 */
  path: string
  /** 全图的 media:// 地址 */
  url: string
  imageWidth: number
  imageHeight: number
  /** 源图上的裁剪矩形(与视口同比例),渲染端按此几何铺满视口 */
  crop: BackgroundRect
  /** AI 调试线框 PNG(全图尺寸);仅调试模式开启时携带 */
  debugOverlay?: Uint8Array<ArrayBuffer>
  debugOverlayStatus?: string
}
