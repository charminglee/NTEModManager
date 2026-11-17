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

export interface SubModInfo {
  name: string
  sizeBytes: number
  enabled: boolean
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
  /** 仅第一层资源文件夹，两个及以上时视为整合包。 */
  subMods?: SubModInfo[]
}

export interface OperationResult {
  success: boolean
  message: string
  cancelled?: boolean
}

export type WindowAction = 'minimize' | 'toggle-maximize' | 'toggle-fullscreen' | 'close'

export interface WindowState {
  isMaximized: boolean
  isFullScreen: boolean
}

export interface ImportResult {
  archive: string
  result: OperationResult
  /** 导入成功后的模组名称(用于导入后重命名提示) */
  importedName?: string
}

/** 模组列表批量操作类型(mods:batch) */
export type BatchModAction =
  | 'install'
  | 'uninstall'
  | 'remove'
  | 'markInvalid'
  | 'unmarkInvalid'
  | 'reinstall'
  | 'repackage'

/** 兼容旧版的圆角配置，当前主题使用固定的小圆角。 */
export const UI_CORNER_RADIUS_DEFAULT = 16
export const UI_CORNER_RADIUS_MIN = 0
export const UI_CORNER_RADIUS_MAX = 32

/** 背景颜色遮罩不透明度(%):0=无遮罩,100=最初的完整强度;默认 50 对应减半后的观感 */
export const BACKGROUND_MASK_OPACITY_DEFAULT = 50
export const BACKGROUND_MASK_OPACITY_MIN = 0
export const BACKGROUND_MASK_OPACITY_MAX = 100

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
  /** 背景颜色遮罩不透明度(%):衬托 UI 的颜色遮罩相对完整强度的比例 */
  backgroundMaskOpacity: number
  /** GameBanana 下载完成后是否自动安装 */
  gameBananaInstallAfterDownload: boolean
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
  backgroundMaskOpacity?: number
  gameBananaInstallAfterDownload?: boolean
}

export interface GameBananaFile {
  id: string
  name: string
  sizeBytes: number
  downloadCount: number
  downloadUrl: string
  md5?: string
}

export interface GameBananaMod {
  id: number
  name: string
  authors: string
  gameName: string
  downloads: number
  likes: number
  views: number
  updatedAt: number
  description: string
  previewUrl: string | null
  profileUrl: string
  downloadUrl: string | null
  installInstructions: string
  files: GameBananaFile[]
}

export type GameBananaDownloadStatus =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'completed'
  | 'failed'

export interface GameBananaDownloadTask {
  id: string
  modId: number
  modName: string
  fileName: string
  customName: string
  status: GameBananaDownloadStatus
  downloadedBytes: number
  totalBytes: number | null
  message: string
  createdAt: string
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
