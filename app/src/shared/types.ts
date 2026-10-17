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

/** 模组列表批量操作类型(mods:batch) */
export type BatchModAction =
  | 'install'
  | 'uninstall'
  | 'remove'
  | 'markInvalid'
  | 'unmarkInvalid'
  | 'reinstall'
  | 'repackage'

/** 液态玻璃可单独开关的界面区域 */
export type LiquidGlassArea =
  | 'sidebar'
  | 'modCards'
  | 'toolbar'
  | 'logPanel'
  | 'buttons'
  | 'inputs'
  | 'overlays'

/**
 * 液态玻璃效果配置。
 *
 * 设置界面暴露的分组:
 *   1. 强度(百分比,乘算各面板的基准值):折射 / 背景模糊 / 边缘高光 / 边缘色散;
 *   2. 材质与光学(绝对值,直接覆盖基准值):亮度 / 玻璃不透明度 / 倒角厚度 /
 *      镜面反光 / 菲涅耳反射 / 微失真;
 *   3. 玻璃样式与区域开关。
 * 其余键(饱和度、冷色着色、棱面模式、投影、按压反馈)不再出现在设置界面,
 * 按各自的默认值生效,仍可通过 INI 手动调整。
 *
 * 每一项都对应 @ybouane/liquidglass 的 per-element 配置键,写进 [LiquidGlass] 配置节。
 */
export interface LiquidGlassConfig {
  /** 总开关:true=液态玻璃(WebGL 实时折射),false=毛玻璃(高透 backdrop 模糊回退) */
  enabled: boolean
  /** 折射强度 0-100(%):乘算基准折射(面板 1.2 / 控件 0.69),0 为关闭 */
  refraction: number
  /** 边缘色散 0-100(%):乘算基准色散(面板 0.2 / 控件 0.05),0 为关闭 */
  dispersion: number
  /** 背景模糊 0-100(%):乘算基准模糊(0.3),0 为关闭 */
  blur: number
  /** 边缘高光 0-100(%):乘算内沿高光(面板 0.05 / 指示条 0.2),0 为关闭 */
  edgeHighlight: number
  /** 亮度 -50~50(%):正数提亮、负数压暗玻璃里的画面(0 = 与背景等亮) */
  brightness: number
  /** 饱和度 -100~100(%):-100 灰度、0 原样、100 更艳 */
  saturation: number
  /** 冷色着色 0-100(%):玻璃整体偏冷蓝的着色强度 */
  tint: number
  /** 玻璃不透明度 0-100(%):乘算各面板基准(面板 1、有色按钮 0.6),越低越透 */
  opacity: number
  /** 倒角厚度 0-200(%):乘算「圆角 = 厚度」基准,越大棱面越厚(仍按元素最短边收口) */
  bevel: number
  /** 棱面模式:0=双凸(两面折射)、1=穹顶(平面底 + 单面折射,近放大镜) */
  bevelMode: number
  /** 镜面反光 0-100(%):Blinn-Phong 高光强度(默认 0,不开启) */
  gloss: number
  /** 菲涅耳反射 0-200(%):掠射角反射强度(基准 100% = 库默认 1.0) */
  fresnel: number
  /** 微失真 0-100(%):玻璃表面的细微噪点扰动 */
  distortion: number
  /** 额外投影 0-100(%):在各面板基准投影之上叠加的投影不透明度 */
  shadow: number
  /** 投影扩散(px):基准 10 */
  shadowSpread: number
  /** 投影垂直偏移(px):基准 1 */
  shadowOffsetY: number
  /** 按钮悬浮提亮 / 按下压平棱面(按钮与输入框档位启用) */
  buttonFeedback: boolean
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
  /** 浮层(对话框、下拉菜单、选择器、toast 通知) */
  overlays: boolean
}

export const LIQUID_GLASS_DEFAULTS: LiquidGlassConfig = {
  enabled: true,
  refraction: 100,
  dispersion: 100,
  blur: 100,
  edgeHighlight: 100,
  brightness: 0,
  saturation: 0,
  tint: 0,
  opacity: 100,
  bevel: 100,
  bevelMode: 0,
  gloss: 0,
  fresnel: 100,
  distortion: 0,
  shadow: 0,
  shadowSpread: 10,
  shadowOffsetY: 1,
  buttonFeedback: true,
  sidebar: true,
  modCards: true,
  toolbar: true,
  logPanel: true,
  buttons: true,
  inputs: true,
  overlays: true
}

export const LIQUID_GLASS_KEYS = Object.keys(LIQUID_GLASS_DEFAULTS) as (keyof LiquidGlassConfig)[]

/** 全局圆角(px):所有 UI 控件(含液态/毛玻璃面板)统一套用的 border-radius */
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
  backgroundMaskOpacity?: number
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
