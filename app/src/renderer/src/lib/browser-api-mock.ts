import type { Api } from '../../../preload/index'
import { parseIni, splitList, unquote, updateIniText } from '@shared/ini'
import { workbenchAssetsMock } from './workbench-assets-mock'
import { workbenchProjectsMock } from './workbench-projects-mock'
import { workbenchSpineMock } from './workbench-spine-mock'
import { bundleChildren } from '@shared/mod-bundle'
import {
  ALL_CATEGORY,
  BACKGROUND_MASK_OPACITY_DEFAULT,
  OTHER_CATEGORY,
  UI_CORNER_RADIUS_DEFAULT,
  type AppConfigData,
  type BackgroundRect,
  type BackgroundState,
  type GameBananaComment,
  type GameBananaDownloadTask,
  type GameBananaFile,
  type GameBananaMod,
  type GameBananaUpdate,
  type LogEntry,
  type ModFileEntry,
  type ModInfo,
  type YoudaoCredentialsStatus,
  type WindowState
} from '@shared/types'

/**
 * 浏览器测试模式(npm run dev):渲染层不经 Electron 直接跑在浏览器里,
 * window.api 缺失时注入此 mock。数据为内存样例;文件系统/对话框/启动游戏等
 * 原生能力一律拒绝或返回取消。背景图复用调试图集(与 Electron dev 的
 * test_images=1 行为一致),并响应「使用测试背景图」开关(浏览器无真实图库,
 * 关闭后背景清空以体现切换生效);分类缩略图用仓库 img/bg 下的 256×256 图。
 */

const CATEGORIES = [
  '黑羽',
  '灵可',
  '残虹',
  '伊洛伊',
  '真红',
  '安魂曲',
  '小吱',
  '薄荷',
  '九原',
  '法帝娅',
  '哈索尔',
  '浔',
  '主角',
  '哈尼娅',
  '娜娜莉',
  '海月',
  '达芙蒂尔',
  '早雾',
  '明音凛'
]

/** 调试图集(测量过像素尺寸,与 F:/pictures/test 当前内容一致);
 *  web.vite.config.ts 的 serveTestImages 插件经 /test-images/ 伺服 */
const BACKGROUND_IMAGES: { url: string; width: number; height: number }[] = [
  { url: '/test-images/0b75ec85-cad5-4d7e-af49-fc6bc3dac554.jpg', width: 2048, height: 1536 },
  { url: '/test-images/下载 - 2024-02-17T004743.640.jpg', width: 1104, height: 828 },
  { url: '/test-images/photo_6269019679716215625_w.jpg', width: 1886, height: 2048 }
]

/** 模拟主进程的 cover 裁剪:取与视口同比例、居中的最大源图矩形 */
function coverCrop(imageWidth: number, imageHeight: number): BackgroundRect {
  const viewportAspect = window.innerWidth / window.innerHeight
  const imageAspect = imageWidth / imageHeight
  if (imageAspect > viewportAspect) {
    const width = Math.round(imageHeight * viewportAspect)
    return { x: Math.round((imageWidth - width) / 2), y: 0, width, height: imageHeight }
  }
  const height = Math.round(imageWidth / viewportAspect)
  return { x: 0, y: Math.round((imageHeight - height) / 2), width: imageWidth, height }
}

const file = (name: string, sizeBytes: number): ModFileEntry => ({
  name,
  sizeBytes,
  directory: false,
  children: []
})

const directory = (name: string, children: ModFileEntry[]): ModFileEntry => ({
  name,
  sizeBytes: children.reduce((total, child) => total + child.sizeBytes, 0),
  directory: true,
  children
})

const mods: ModInfo[] = [
  {
    name: '娜娜莉-整合包',
    sourcePath: 'D:/Games/NTE/mods.bak/娜娜莉-整合包',
    sizeBytes: 36_700_160,
    files: [
      directory('角色外观', [file('Body_P.pak', 12_582_912)]),
      directory('战斗特效', [directory('特效资源', [file('VFX_P.pak', 16_777_216)])]),
      directory('界面立绘', [file('Portrait_P.pak', 7_340_032)]),
      file('Shared_P.pak', 1024),
      file('说明.txt', 512)
    ],
    importedAt: '2026-11-16T09:00:00',
    installed: true,
    invalid: false
  },
  {
    name: '黑羽-原皮',
    sourcePath: 'D:/Games/NTE/mods/黑羽-原皮',
    sizeBytes: 12_640_256,
    files: [file('body.dds', 8_388_608), file('head.dds', 2_097_152), file('meta.json', 512)],
    importedAt: '2026-06-26T03:20:00',
    installed: true,
    invalid: false
  },
  {
    name: '黑羽-礼服-衬裙',
    sourcePath: 'D:/Games/NTE/mods/黑羽-礼服-衬裙',
    sizeBytes: 45_088_768,
    files: [
      directory('textures', [file('dress_a.dds', 16_777_216), file('dress_b.dds', 12_582_912)]),
      file('meta.json', 512)
    ],
    importedAt: '2026-08-12T22:41:00',
    installed: true,
    invalid: false
  },
  {
    name: '灵可-女仆-蕾丝',
    sourcePath: 'D:/Games/NTE/mods/灵可-女仆-蕾丝',
    sizeBytes: 8_912_896,
    files: [file('maid.dds', 6_291_456)],
    importedAt: '2026-07-02T10:15:00',
    installed: false,
    invalid: false
  },
  {
    name: '残虹-泳装',
    sourcePath: 'D:/Games/NTE/mods/残虹-泳装',
    sizeBytes: 22_020_096,
    files: [file('swimsuit.dds', 20_971_520), file('readme.txt', 128)],
    importedAt: '2026-09-18T14:03:00',
    installed: true,
    invalid: false
  },
  {
    name: '伊洛伊-和服-花魁',
    sourcePath: 'D:/Games/NTE/mods/伊洛伊-和服-花魁',
    sizeBytes: 63_503_232,
    files: [
      directory('mesh', [file('kimono.mesh', 4_194_304)]),
      directory('textures', [file('kimono.dds', 41_943_040)])
    ],
    importedAt: '2026-05-30T09:52:00',
    installed: false,
    invalid: false
  },
  {
    name: '真红-猎龙者-去布料',
    sourcePath: 'D:/Games/NTE/mods/真红-猎龙者-去布料',
    sizeBytes: 171_127_603,
    files: [directory('textures', [file('armor.dds', 104_857_600), file('skin.dds', 41_943_040)])],
    importedAt: '2026-09-27T23:44:00',
    installed: true,
    invalid: false
  },
  {
    name: '真红-校服-半裸',
    sourcePath: 'D:/Games/NTE/mods/真红-校服-半裸',
    sizeBytes: 93_326_336,
    files: [file('uniform.dds', 62_914_560)],
    importedAt: '2026-08-26T00:35:00',
    installed: false,
    invalid: false
  },
  {
    name: '安魂曲-舞台-追光',
    sourcePath: 'D:/Games/NTE/mods/安魂曲-半 transparency 演示',
    sizeBytes: 3_565_158,
    files: [file('stage.dds', 3_145_728)],
    importedAt: '2026-07-21T18:09:00',
    installed: true,
    invalid: true
  },
  {
    name: '小吱-猫耳',
    sourcePath: 'D:/Games/NTE/mods/小吱-猫耳',
    sizeBytes: 1_308_672,
    files: [file('ears.mesh', 262_144), file('ears.dds', 1_048_576)],
    importedAt: '2026-09-01T08:27:00',
    installed: true,
    invalid: false
  },
  {
    name: '薄荷-旗袍',
    sourcePath: 'D:/Games/NTE/mods/薄荷-旗袍',
    sizeBytes: 28_311_552,
    files: [directory('textures', [file('qipao.dds', 25_165_824)])],
    importedAt: '2026-06-11T12:33:00',
    installed: false,
    invalid: false
  },
  {
    name: '九原-机甲-重装',
    sourcePath: 'D:/Games/NTE/mods/九原-机甲-重装',
    sizeBytes: 88_080_384,
    files: [directory('mesh', [file('mecha.mesh', 8_388_608)]), file('mecha.dds', 52_428_800)],
    importedAt: '2026-04-19T20:58:00',
    installed: true,
    invalid: false
  },
  {
    name: '法帝娅-舞蹈-旋转',
    sourcePath: 'D:/Games/NTE/mods/法帝娅-舞蹈--spin',
    sizeBytes: 14_680_064,
    files: [file('dance.anim', 4_194_304), file('dress.dds', 8_388_608)],
    importedAt: '2026-08-30T16:47:00',
    installed: false,
    invalid: false
  },
  {
    name: '哈索尔-天使-羽翼',
    sourcePath: 'D:/Games/NTE/mods/哈索尔-天使-羽翼',
    sizeBytes: 57_146_368,
    files: [
      directory('wings', [
        file('wing_l.mesh', 2_097_152),
        file('wing_r.mesh', 2_097_152),
        file('feathers.dds', 33_554_432)
      ])
    ],
    importedAt: '2026-05-08T11:21:00',
    installed: true,
    invalid: false
  },
  {
    name: '浔-潜水服',
    sourcePath: 'D:/Games/NTE/mods/浔-潜水服',
    sizeBytes: 19_398_656,
    files: [file('wetsuit.dds', 16_777_216)],
    importedAt: '2026-09-05T19:12:00',
    installed: false,
    invalid: false
  },
  {
    name: '主角-猎人皮-比基尼',
    sourcePath: 'D:/Games/NTE/mods/主角-猎人皮-比基尼',
    sizeBytes: 348_127_232,
    files: [directory('textures', [file('bikini.dds', 209_715_200)])],
    importedAt: '2026-08-31T19:10:00',
    installed: false,
    invalid: false
  },
  {
    name: '主角-赛车皮-凸点',
    sourcePath: 'D:/Games/NTE/mods/主角-赛车皮-凸点',
    sizeBytes: 8_178_688,
    files: [file('racing.dds', 6_291_456)],
    importedAt: '2026-06-18T01:37:00',
    installed: false,
    invalid: false
  },
  {
    name: '主角-赛车皮-兔女郎',
    sourcePath: 'D:/Games/NTE/mods/主角-赛车皮-兔女郎',
    sizeBytes: 142_606_336,
    files: [directory('textures', [file('bunny.dds', 104_857_600)])],
    importedAt: '2026-09-27T02:50:00',
    installed: true,
    invalid: false
  },
  {
    name: '哈尼娅-沙漠-旅装',
    sourcePath: 'D:/Games/NTE/mods/哈尼娅-沙漠-旅装',
    sizeBytes: 33_554_432,
    files: [file('desert.dds', 29_360_128)],
    importedAt: '2026-07-08T07:44:00',
    installed: true,
    invalid: false
  },
  {
    name: '娜娜莉-童话皮-半裸',
    sourcePath: 'D:/Games/NTE/mods/娜娜莉-童话皮-半裸',
    sizeBytes: 162_529_280,
    files: [directory('textures', [file('fairytale.dds', 125_829_120)])],
    importedAt: '2026-06-06T05:38:00',
    installed: true,
    invalid: false
  },
  {
    name: '海月-人鱼-鳞片',
    sourcePath: 'D:/Games/NTE/mods/海月-人鱼-鳞片',
    sizeBytes: 74_448_896,
    files: [directory('textures', [file('scales.dds', 62_914_560)]), file('tail.mesh', 4_194_304)],
    importedAt: '2026-10-01T13:05:00',
    installed: false,
    invalid: false
  },
  {
    name: '达芙蒂尔-法师-长袍',
    sourcePath: 'D:/Games/NTE/mods/达芙蒂尔-法师-长袍',
    sizeBytes: 41_943_040,
    files: [file('robe.dds', 33_554_432)],
    importedAt: '2026-05-22T21:29:00',
    installed: true,
    invalid: false
  },
  {
    name: '早雾-病号服',
    sourcePath: 'D:/Games/NTE/mods/早雾-病号服',
    sizeBytes: 6_815_744,
    files: [file('hospital.dds', 5_242_880)],
    importedAt: '2026-09-12T23:58:00',
    installed: false,
    invalid: false
  }
]

const gameBananaFiles: GameBananaFile[] = [
  {
    id: 'mock-file-1',
    name: 'nte_demo_mod.zip',
    sizeBytes: 18_874_368,
    downloadCount: 128,
    uploadedAt: 1794672000,
    version: '1.2',
    description: '完整安装包，包含模型、贴图和安装说明。',
    archived: false,
    downloadUrl: 'https://gamebanana.com/dl/mock-file-1'
  }
]

const gameBananaMods: (GameBananaMod & { updates: GameBananaUpdate[]; commentItems: GameBananaComment[] })[] = [
  {
    id: 727079,
    name: 'Zero Collection Upscale',
    authors: 'yuriko',
    author: { name: 'yuriko333', avatarUrl: '/黑羽.png', profileUrl: 'https://gamebanana.com/members/2297405' },
    modifiedAt: 1794672000,
    version: '1.2',
    archivedFiles: [{ ...gameBananaFiles[0], id: 'mock-archive', name: 'nte_demo_mod_v1.zip', version: '1.0', archived: true, description: '旧版本归档。' }],
    screenshots: [
      { url: '/test-images/0b75ec85-cad5-4d7e-af49-fc6bc3dac554.jpg', thumbnailUrl: '', width: 0, height: 0 },
      { url: '/test-images/photo_6269019679716215625_w.jpg', thumbnailUrl: '', width: 0, height: 0 }
    ],
    updates: [
      { id: 'update-2', name: '画质与模型更新', version: '1.2', uploadedAt: 1794672000, modifiedAt: 1794758400, description: '<p>优化了<strong>模型细节</strong>和贴图质量。</p>', changes: [{ category: 'Improvement', text: '<p>改善膝盖模型，<em>保留原有比例</em>。</p>' }] },
      { id: 'update-1', name: '首次发布', version: '1.0', uploadedAt: 1794412800, modifiedAt: 0, description: '<p>首个公开版本。</p>', changes: [] }
    ],
    commentItems: [
      { id: 'comment-1', author: { name: 'NTE 玩家', avatarUrl: '/娜娜莉.png', profileUrl: 'https://gamebanana.com/members/1' }, uploadedAt: 1794758400, editedAt: 1794844800, content: '<p>感谢作者，<strong>效果很好</strong>！</p><blockquote>支持完整的 HTML 评论排版。</blockquote>', replies: [{ id: 'reply-1', author: { name: 'yuriko333', avatarUrl: '/黑羽.png', profileUrl: 'https://gamebanana.com/members/2297405' }, uploadedAt: 1794844800, editedAt: 0, content: '<p>感谢支持！</p>', replies: [] }] },
      { id: 'comment-2', author: { name: 'Mod 用户', avatarUrl: '', profileUrl: '' }, uploadedAt: 1794844800, editedAt: 0, content: '<p>表格、列表和链接也应正常显示。</p><ul><li>安装成功</li><li>贴图清晰</li></ul>', replies: [] }
    ],
    gameName: 'Neverness To Everness',
    downloads: 1212,
    likes: 53,
    views: 8405,
    comments: 18,
    uploadedAt: Math.floor(Date.now() / 1000) - 86400 * 12,
    updatedAt: Math.floor(Date.now() / 1000),
    description: `<h2>模组介绍</h2><p>浏览器测试模式中的 <strong>GameBanana</strong> 完整模组页面。</p><p style="color: #edc19c">保留内联样式、图片、表格和详细排版。</p><img src="${window.location.origin}/test-images/0b75ec85-cad5-4d7e-af49-fc6bc3dac554.jpg" alt="模组介绍图片" width="360"><table><thead><tr><th>内容</th><th>说明</th></tr></thead><tbody><tr><td>模型</td><td>完整安装包</td></tr></tbody></table><details><summary>安装步骤</summary><ol><li>下载模组</li><li>导入管理器</li></ol></details><p><a href="https://gamebanana.com/mods/727079">原始发布页面</a></p>`,
    previewUrl: '/test-images/0b75ec85-cad5-4d7e-af49-fc6bc3dac554.jpg',
    profileUrl: 'https://gamebanana.com/mods/727079',
    downloadUrl: 'https://gamebanana.com/mods/download/727079',
    installInstructions: '',
    files: gameBananaFiles
  },
  {
    id: 727080,
    name: 'NTE Character Wardrobe',
    authors: 'mock_author',
    author: { name: 'mock_author', avatarUrl: '', profileUrl: '' },
    modifiedAt: 0,
    version: '',
    archivedFiles: [],
    screenshots: [],
    updates: [],
    commentItems: [],
    gameName: 'Neverness To Everness',
    downloads: 684,
    likes: 27,
    views: 4200,
    comments: 9,
    uploadedAt: Math.floor(Date.now() / 1000) - 86400 * 36,
    updatedAt: Math.floor(Date.now() / 1000) - 86400 * 4,
    description: '第二个测试条目，用于检查列表和详情切换。',
    previewUrl: '/test-images/photo_6269019679716215625_w.jpg',
    profileUrl: 'https://gamebanana.com/mods/727080',
    downloadUrl: 'https://gamebanana.com/mods/download/727080',
    installInstructions: '',
    files: gameBananaFiles.map((file) => ({ ...file, id: 'mock-file-2', name: 'wardrobe.7z' }))
  }
]

function findGameBananaMod(modId: number) {
  const mod = gameBananaMods.find((item) => item.id === modId)
  if (!mod) throw new Error(`未找到 GameBanana 模组 ${modId}`)
  return mod
}

function mockGameBananaProfile({ updates, commentItems, ...mod }: (typeof gameBananaMods)[number]): GameBananaMod {
  return { ...mod, files: mod.files.map((file) => ({ ...file })) }
}

function cloneMods(): ModInfo[] {
  return mods.map((mod) => ({ ...mod, subMods: bundleChildren(mod.files,
    mod.subMods?.filter((child) => !child.enabled).map((child) => child.name)) }))
}

function categoryOfMod(mod: ModInfo): string {
  const head = mod.name.split('-')[0]?.trim()
  return head && CATEGORIES.includes(head) ? head : OTHER_CATEGORY
}

function findMod(name: string): ModInfo | undefined {
  return mods.find((mod) => mod.name === name)
}

const unavailable = (what: string) => ({
  success: false,
  message: `浏览器测试模式:不支持${what}`
})

const config: AppConfigData = {
  workbenchAesKey: '',
  workbenchMapping: '',
  workbenchExportDirectory: 'Documents/NTEMM/Exports',
  configPath: 'C:\\Users\\mock\\.ntemm\\NteModManager.ini',
  gameDirectory: 'D:/Games/NTE',
  modsDirectory: 'D:/Games/NTE/mods',
  backupsDirectory: 'D:/Games/NTE/mods.bak',
  backgroundImagesDirectory: 'D:/pictures/wallpapers',
  gameLauncher: 'D:/Games/NTE/NTE.exe',
  autoUseLastPackagingPath: true,
  exclusiveInstallExemptGroups: [],
  categories: [...CATEGORIES],
  categoryOrder: [],
  restoreLastCategory: false,
  testImagesEnabled: true,
  fpsCounterEnabled: false,
  uiCornerRadius: UI_CORNER_RADIUS_DEFAULT,
  backgroundMaskOpacity: BACKGROUND_MASK_OPACITY_DEFAULT,
  gameBananaInstallAfterDownload: false
}

const defaultConfig = { ...config }
const configFileFields = {
  Paths: {
    mods_directory: 'modsDirectory',
    backups_directory: 'backupsDirectory',
    background_images_directory: 'backgroundImagesDirectory',
    game_launcher: 'gameLauncher',
    workbench_mapping: 'workbenchMapping',
    workbench_exports: 'workbenchExportDirectory'
  },
  Workbench: { aes_key: 'workbenchAesKey' },
  Categories: { names: 'categories' },
  Preferences: {
    mod_category_order: 'categoryOrder',
    auto_use_last_packaging_path: 'autoUseLastPackagingPath',
    exclusive_install_exempt_groups: 'exclusiveInstallExemptGroups',
    restore_last_category: 'restoreLastCategory',
    ui_corner_radius: 'uiCornerRadius',
    background_mask_opacity: 'backgroundMaskOpacity',
    gamebanana_install_after_download: 'gameBananaInstallAfterDownload'
  },
  Debug: { test_images: 'testImagesEnabled', fps_counter: 'fpsCounterEnabled' }
} as const satisfies Record<string, Record<string, keyof AppConfigData>>

let mockConfigFile = ''

function updateMockConfigFile(patch: Partial<AppConfigData>): void {
  const ini = parseIni(mockConfigFile)
  for (const [section, fields] of Object.entries(configFileFields)) {
    for (const [key, field] of Object.entries(fields)) {
      const value = patch[field as keyof AppConfigData]
      if (value === undefined) continue
      ini[section] ??= {}
      ini[section][key] = typeof value === 'boolean' ? String(Number(value)) : String(value)
    }
  }
  mockConfigFile = updateIniText(mockConfigFile, ini)
}
updateMockConfigFile(config)
mockConfigFile = `; 浏览器预览配置\n${mockConfigFile}`

function applyMockConfig(patch: Partial<AppConfigData>): void {
  const testImagesBefore = config.testImagesEnabled
  Object.assign(config, patch)
  if (config.testImagesEnabled !== testImagesBefore) {
    backgroundGeneration++
    backgroundIndex++
    backgroundListener?.(makeBackgroundState())
  }
}

let mockYoudaoCredentialStatus: YoudaoCredentialsStatus = { configured: false, appId: '' }

const bootstrapLogs: LogEntry[] = [
  {
    level: 'info',
    message: '浏览器测试模式:window.api 为内存 mock,文件相关操作不可用',
    timestamp: new Date().toISOString()
  }
]

// ============ 背景轮播 mock ============
let backgroundIndex = 0
let backgroundGeneration = 0
let backgroundListener: ((state: BackgroundState | null) => void) | null = null

/** 与 Electron 端一致:关闭「使用测试背景图」后不再提供调试图集。
 *  浏览器模式没有真实图库可切,故返回 null(背景清空),让开关效果可见。 */
function makeBackgroundState(): BackgroundState | null {
  if (!config.testImagesEnabled) {
    return null
  }
  const image = BACKGROUND_IMAGES[backgroundIndex % BACKGROUND_IMAGES.length]
  return {
    generation: backgroundGeneration,
    path: `F:/pictures/test/${image.url.split('/').pop()}`,
    url: image.url,
    imageWidth: image.width,
    imageHeight: image.height,
    crop: coverCrop(image.width, image.height)
  }
}

// ============ mock api ============
/** mock 的「上次打开的分类」:仅内存态,刷新页面即模拟重启 */
let mockLastCategory = ''
let mockGameBananaTasks: GameBananaDownloadTask[] = []
const gameBananaTaskListeners = new Set<(task: GameBananaDownloadTask) => void>()

let previewWindowState: WindowState = { isMaximized: false, isFullScreen: false }
const windowStateListeners = new Set<(state: WindowState) => void>()

const api: Api = {
  ...workbenchAssetsMock,
  ...workbenchProjectsMock,
  ...workbenchSpineMock,
  async loadGameSpine() {
    throw new Error('请在桌面应用中读取游戏容器，或选择本地 Spine 文件。')
  },
  async getWindowState() {
    return { ...previewWindowState }
  },
  async controlWindow(action) {
    if (action === 'toggle-fullscreen') {
      previewWindowState = {
        ...previewWindowState,
        isFullScreen: !previewWindowState.isFullScreen
      }
      for (const listener of windowStateListeners) listener({ ...previewWindowState })
      return { success: true, message: '' }
    }
    if (action !== 'toggle-maximize') {
      return unavailable(action === 'minimize' ? '最小化窗口' : '关闭窗口')
    }
    previewWindowState = { isMaximized: !previewWindowState.isMaximized, isFullScreen: false }
    for (const listener of windowStateListeners) listener({ ...previewWindowState })
    return { success: true, message: '' }
  },
  onWindowStateChanged(callback) {
    windowStateListeners.add(callback)
    return () => {
      windowStateListeners.delete(callback)
    }
  },
  async bootstrap() {
    return {
      config: { ...config },
      mods: cloneMods(),
      logs: bootstrapLogs,
      initialization: { success: true, message: '' },
      autoOpenSettings: false,
      lastCategory: config.restoreLastCategory ? mockLastCategory || null : null
    }
  },

  async scanMods() {
    return cloneMods()
  },

  async listGameBananaMods(page = 1) {
    const mod = gameBananaMods[page - 1]
    return mod ? [mockGameBananaProfile(mod)] : []
  },

  async getGameBananaMod(modId) {
    return mockGameBananaProfile(findGameBananaMod(modId))
  },

  async getGameBananaModUpdates(modId) {
    return findGameBananaMod(modId).updates
  },

  async getGameBananaModComments(modId, page) {
    const items = findGameBananaMod(modId).commentItems
    return {
      comments: items.slice(page - 1, page),
      nextPage: page < items.length ? page + 1 : null
    }
  },

  async getGameBananaTasks() {
    return mockGameBananaTasks.map((task) => ({ ...task }))
  },

  async getAyakaModsTasks() {
    return []
  },
  async getAyakaModsPendingDownloads() {
    return []
  },
  async startAyakaModsDownload() {
    throw new Error('浏览器开发模式不支持拦截站内下载，请使用桌面开发模式。')
  },
  async cancelAyakaModsDownload() {},
  onAyakaModsDownloadRequest() {
    return () => {}
  },

  async startGameBananaDownload(modId, fileId, customName, installAfterDownload) {
    const mod = gameBananaMods.find((item) => item.id === modId)
    const file = mod && [...mod.files, ...mod.archivedFiles].find((item) => item.id === fileId)
    if (!mod || !file) throw new Error('未找到测试下载文件')
    const task: GameBananaDownloadTask = {
      id: `mock-download-${Date.now()}`,
      source: 'gamebanana',
      modId,
      modName: mod.name,
      fileName: file.name,
      customName,
      status: 'queued',
      downloadedBytes: 0,
      totalBytes: file.sizeBytes,
      message: installAfterDownload ? '等待下载，完成后自动安装' : '等待下载',
      createdAt: new Date().toISOString()
    }
    mockGameBananaTasks = [...mockGameBananaTasks, task]
    for (const listener of gameBananaTaskListeners) listener({ ...task })
    window.setTimeout(() => {
      const completed = { ...task, status: 'completed' as const, downloadedBytes: file.sizeBytes, message: '浏览器测试模式：下载完成' }
      mockGameBananaTasks = mockGameBananaTasks.map((item) => item.id === task.id ? completed : item)
      for (const listener of gameBananaTaskListeners) listener({ ...completed })
    }, 900)
    return task.id
  },

  async openExternal() {
    return { success: true, message: '浏览器测试模式：已模拟打开网页' }
  },

  async importArchives(archivePaths) {
    return archivePaths.map((archive) => ({ archive, result: unavailable('导入压缩包') }))
  },

  async installMod(name) {
    const mod = findMod(name)
    if (!mod) return { success: false, message: `未找到模组 ${name}` }
    mod.installed = true
    return { success: true, message: `已安装 ${name}(mock)` }
  },

  async uninstallMod(name) {
    const mod = findMod(name)
    if (!mod) return { success: false, message: `未找到模组 ${name}` }
    mod.installed = false
    return { success: true, message: `已卸载 ${name}(mock)` }
  },

  async setSubModEnabled(name, childName, enabled) {
    const mod = findMod(name)
    if (!mod) return { success: false, message: '找不到模组。' }
    const children = bundleChildren(mod.files,
      mod.subMods?.filter((child) => !child.enabled).map((child) => child.name))
    const child = children.find((item) => item.name === childName)
    if (!child) return { success: false, message: '找不到第一层子模组。' }
    child.enabled = enabled
    mod.subMods = children
    return { success: true, message: `已${enabled ? '选择' : '停用'}子模组：${childName}` }
  },

  async renameSubMod(name, childName, newName) {
    const mod = findMod(name)
    if (!mod) return { success: false, message: '找不到模组。' }
    const child = mod.files.find(
      (entry) => entry.directory && entry.name === childName
    )
    if (!child) return { success: false, message: '找不到第一层子模组。' }
    const trimmedName = newName.trim()
    if (trimmedName.length === 0) {
      return { success: false, message: '子模组名称不能为空。' }
    }
    if (/[<>:"/\\|?*]/.test(trimmedName) || trimmedName === '.' || trimmedName === '..') {
      return { success: false, message: '子模组名称包含无效字符，无法重命名。' }
    }
    if (
      mod.files.some(
        (entry) => entry !== child && entry.name.toLowerCase() === trimmedName.toLowerCase()
      )
    ) {
      return { success: false, message: `模组源文件夹中已存在同名项目：${trimmedName}` }
    }
    if (child.name === trimmedName) {
      return { success: true, message: '子模组名称未变更。' }
    }

    const disabled = (mod.subMods ?? [])
      .filter((item) => !item.enabled)
      .map((item) => (item.name === childName ? trimmedName : item.name))
    child.name = trimmedName
    mod.subMods = bundleChildren(mod.files, disabled)
    return { success: true, message: `已将子模组 ${childName} 重命名为 ${trimmedName}(mock)` }
  },

  async removeMod(name) {
    const index = mods.findIndex((mod) => mod.name === name)
    if (index < 0) return { success: false, message: `未找到模组 ${name}` }
    mods.splice(index, 1)
    return { success: true, message: `已删除 ${name}(mock)` }
  },

  async renameMod(oldName, newName) {
    const mod = findMod(oldName)
    if (!mod) return { success: false, message: `未找到模组 ${oldName}` }
    if (findMod(newName)) return { success: false, message: `已存在同名模组 ${newName}` }
    mod.name = newName
    return { success: true, message: `已重命名为 ${newName}(mock)` }
  },

  async setModInvalid(name, invalid) {
    const mod = findMod(name)
    if (!mod) return { success: false, message: `未找到模组 ${name}` }
    mod.invalid = invalid
    return { success: true, message: '已更新失效标记(mock)' }
  },

  async renameModFile(name, relativePath, newFileName) {
    const mod = findMod(name)
    if (!mod) return { success: false, message: `未找到模组 ${name}` }
    const parts = relativePath.split('/')
    let entries = mod.files
    let entry: ModFileEntry | undefined
    for (let i = 0; i < parts.length; i++) {
      entry = entries.find((item) => item.name === parts[i])
      if (!entry) return { success: false, message: `未找到文件 ${relativePath}` }
      entries = entry.children
    }
    if (entry) entry.name = newFileName
    return { success: true, message: '已重命名文件(mock)' }
  },

  async addModArchive(name) {
    return findMod(name)
      ? unavailable('添加压缩包')
      : { success: false, message: `未找到模组 ${name}` }
  },

  async replaceModArchive(name) {
    return findMod(name)
      ? unavailable('替换压缩包')
      : { success: false, message: `未找到模组 ${name}` }
  },

  async exportModArchive(name) {
    return findMod(name)
      ? unavailable('导出 ZIP')
      : { success: false, message: `未找到模组 ${name}` }
  },

  async installAll(category) {
    const targets = mods.filter(
      (mod) =>
        category === ALL_CATEGORY ||
        (category === OTHER_CATEGORY
          ? categoryOfMod(mod) === OTHER_CATEGORY
          : categoryOfMod(mod) === category)
    )
    for (const mod of targets) mod.installed = true
    return { result: { success: true, message: `已安装 ${targets.length} 个模组(mock)` } }
  },

  async uninstallAll(category) {
    const targets = mods.filter(
      (mod) =>
        category === ALL_CATEGORY ||
        (category === OTHER_CATEGORY
          ? categoryOfMod(mod) === OTHER_CATEGORY
          : categoryOfMod(mod) === category)
    )
    for (const mod of targets) mod.installed = false
    return { result: { success: true, message: `已卸载 ${targets.length} 个模组(mock)` } }
  },

  async batchModAction(action, names) {
    const labels = {
      install: '安装',
      uninstall: '卸载',
      remove: '删除',
      markInvalid: '标记失效',
      unmarkInvalid: '取消失效标记',
      reinstall: '重新安装',
      repackage: '重新打包'
    } as const
    // 重新打包依赖真实的打包器与源文件夹弹窗,浏览器模式一律拒绝
    if (action === 'repackage') {
      return { result: unavailable('批量重新打包') }
    }
    let changed = 0
    const failures: string[] = []
    for (const name of names) {
      const mod = findMod(name)
      if (!mod) continue
      switch (action) {
        case 'install':
          mod.installed = true
          break
        case 'uninstall':
          mod.installed = false
          break
        case 'remove': {
          const index = mods.findIndex((item) => item.name === name)
          if (index >= 0) mods.splice(index, 1)
          break
        }
        case 'markInvalid':
          // 与主进程行为一致:已安装的先卸载再标记
          mod.installed = false
          mod.invalid = true
          break
        case 'unmarkInvalid':
          mod.invalid = false
          break
        case 'reinstall':
          // 与主进程行为一致:仅已安装的可重装(卸载后原样装回)
          if (!mod.installed) {
            failures.push(`${name}:未安装,无法重新安装`)
            continue
          }
          mod.installed = true
          break
      }
      changed += 1
    }
    return {
      result:
        failures.length === 0
          ? { success: true, message: `已${labels[action]} ${changed} 个模组(mock)` }
          : {
              success: false,
              message: `已${labels[action]} ${changed} 个模组(mock)\n${failures.join('\n')}`
            }
    }
  },

  async runPackager() {
    return unavailable('打包模组')
  },

  async getLastPackagingPath() {
    return ''
  },

  async setLastPackagingPath() {
    return unavailable('记录打包路径')
  },

  async importPackagedMod() {
    return unavailable('导入打包模组')
  },

  async repackageMod() {
    return unavailable('重新打包')
  },

  async getConfig() {
    return { ...config }
  },

  async getYoudaoCredentialsStatus() {
    return { ...mockYoudaoCredentialStatus }
  },

  async saveYoudaoCredentials(input) {
    mockYoudaoCredentialStatus = { configured: true, appId: input.appId.trim() }
    return { ...mockYoudaoCredentialStatus }
  },

  async clearYoudaoCredentials() {
    mockYoudaoCredentialStatus = { configured: false, appId: '' }
    return { ...mockYoudaoCredentialStatus }
  },

  async translateGameBanana({ html }) {
    const document = new DOMParser().parseFromString(html, 'text/html')
    document.body.prepend('【模拟译文】')
    return document.documentElement.outerHTML
  },

  getGameBananaTranslationCacheSize: () => Promise.resolve(0),
  clearGameBananaTranslationCache: () => Promise.resolve(),

  async updateConfig(patch) {
    const changes = { ...patch }
    if (changes.gameDirectory) {
      changes.modsDirectory ??= `${changes.gameDirectory}/mods`
      changes.gameLauncher ??= `${changes.gameDirectory}/NTE.exe`
    }
    applyMockConfig(changes)
    updateMockConfigFile(changes)
    return { ...config }
  },

  async readConfigFile() {
    return mockConfigFile
  },

  async saveConfigFile(original, content) {
    if (original !== mockConfigFile) return null
    const ini = parseIni(content, true)
    const next = { ...config }
    for (const [section, fields] of Object.entries(configFileFields)) {
      for (const [key, field] of Object.entries(fields)) {
        const fallback = defaultConfig[field as keyof AppConfigData]
        const text = ini[section]?.[key]
        let value = fallback
        if (text !== undefined) {
          if (Array.isArray(fallback)) value = splitList(unquote(text))
          else if (typeof fallback === 'boolean') value = text === '1' || text.toLowerCase() === 'true'
          else if (typeof fallback === 'number') {
            const number = Number.parseInt(text, 10)
            value = Number.isNaN(number) ? fallback : number
          }
          else value = text.replace(/\\/g, '/')
        }
        Object.assign(next, { [field]: value })
      }
    }
    if (next.modsDirectory !== config.modsDirectory || next.gameLauncher !== config.gameLauncher) {
      next.gameDirectory = next.modsDirectory.endsWith('/mods')
        ? next.modsDirectory.slice(0, -'/mods'.length)
        : next.gameLauncher.slice(0, next.gameLauncher.lastIndexOf('/') + 1).replace(/\/$/, '')
    }
    mockConfigFile = content
    applyMockConfig(next)
    return { ...config }
  },

  async setCategoryOrder(order) {
    config.categoryOrder = [...order]
    updateMockConfigFile({ categoryOrder: config.categoryOrder })
    return { success: true, message: '' }
  },

  async setLastCategory(category) {
    mockLastCategory = category
    return { success: true, message: '' }
  },

  async pickArchive() {
    return new Promise<string | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.zip,.rar,.7z'
      input.onchange = () => resolve(input.files?.[0]?.name ?? null)
      input.oncancel = () => resolve(null)
      input.click()
    })
  },

  async pickDirectory() {
    return null
  },

  async pickFile() {
    return null
  },

  async openPath() {
    return unavailable('打开路径')
  },

  async showInFolder() {
    return unavailable('打开文件位置')
  },

  async launchGame() {
    return unavailable('启动游戏')
  },

  async getLogEntries() {
    return [...bootstrapLogs]
  },

  async nextBackground() {
    backgroundIndex++
    backgroundGeneration++
    backgroundListener?.(makeBackgroundState())
    return { success: true, message: '' }
  },

  async toggleBackgroundDebugMode() {
    return { success: true, message: '浏览器测试模式无调试线框' }
  },

  async getCurrentBackgroundPath() {
    return makeBackgroundState()?.path ?? null
  },

  async getCurrentBackgroundState() {
    return makeBackgroundState()
  },

  onBackgroundState(callback) {
    backgroundListener = callback
    return () => {
      if (backgroundListener === callback) backgroundListener = null
    }
  },

  async getCategoryImage(category) {
    return CATEGORIES.includes(category) ? `/${encodeURIComponent(category)}.png` : null
  },

  async getAppIcon() {
    return null
  },

  getPathForFile(file) {
    return file.name
  },

  onProgress(callback) {
    void callback
    return () => {}
  },

  onLogEntry(callback) {
    void callback
    return () => {}
  },

  onGameBananaDownloadTask(callback) {
    gameBananaTaskListeners.add(callback)
    return () => gameBananaTaskListeners.delete(callback)
  }
}

export function installBrowserApiMock(): void {
  window.api = api
  console.info('[NTEMM] 浏览器测试模式:window.api 已注入 mock(数据为内存样例)')
}
