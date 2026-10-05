import type { Api } from '../../../preload/index'
import {
  ALL_CATEGORY,
  LIQUID_GLASS_DEFAULTS,
  OTHER_CATEGORY,
  SortOrder,
  type AppConfigData,
  type BackgroundRect,
  type BackgroundState,
  type LogEntry,
  type ModFileEntry,
  type ModInfo
} from '@shared/types'

/**
 * 浏览器测试模式(npm run dev):渲染层不经 Electron 直接跑在浏览器里,
 * window.api 缺失时注入此 mock。数据为内存样例;文件系统/对话框/启动游戏等
 * 原生能力一律拒绝或返回取消。背景图复用调试图集(与 Electron dev 的
 * test_images=1 行为一致),分类缩略图用仓库 img/bg 下的 256×256 图。
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
  '早雾'
]

/** 调试图集(测量过像素尺寸);web.vite.config.ts 的 serveTestImages 插件经 /test-images/ 伺服 */
const BACKGROUND_IMAGES: { url: string; width: number; height: number }[] = [
  { url: '/test-images/HSWdzR2aQAAvBs6.jpg', width: 2048, height: 1536 },
  { url: '/test-images/photo_5183804761118018770_y.jpg', width: 1106, height: 1280 },
  { url: '/test-images/photo_4934122395052739790_y.jpg', width: 713, height: 1267 }
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
  sizeBytes: 0,
  directory: true,
  children
})

const mods: ModInfo[] = [
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
    files: [directory('textures', [file('dress_a.dds', 16_777_216), file('dress_b.dds', 12_582_912)]), file('meta.json', 512)],
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
    files: [directory('mesh', [file('kimono.mesh', 4_194_304)]), directory('textures', [file('kimono.dds', 41_943_040)])],
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
    files: [directory('wings', [file('wing_l.mesh', 2_097_152), file('wing_r.mesh', 2_097_152), file('feathers.dds', 33_554_432)])],
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

function cloneMods(): ModInfo[] {
  return mods.map((mod) => ({ ...mod }))
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
  configPath: 'C:\\Users\\mock\\AppData\\Roaming\\NteModManager\\NteModManager.ini',
  gameDirectory: 'D:/Games/NTE',
  modsDirectory: 'D:/Games/NTE/mods',
  backupsDirectory: 'D:/Games/NTE/mods.bak',
  backgroundImagesDirectory: 'D:/pictures/wallpapers',
  gameLauncher: 'D:/Games/NTE/NTE.exe',
  packagerDirectory: 'D:/Games/NTE/packager',
  autoUseLastPackagingPath: true,
  exclusiveInstallExemptGroups: [],
  categories: [...CATEGORIES],
  categoryOrder: [],
  sortOrder: SortOrder.InstalledFirst,
  windowSize: null,
  windowPosition: null,
  windowMaximized: false,
  testImagesEnabled: true,
  fpsCounterEnabled: false,
  liquidGlass: { ...LIQUID_GLASS_DEFAULTS }
}

const bootstrapLogs: LogEntry[] = [
  { level: 'info', message: '浏览器测试模式:window.api 为内存 mock,文件相关操作不可用', timestamp: new Date().toISOString() }
]

// ============ 背景轮播 mock ============
let backgroundIndex = 0
let backgroundGeneration = 0
let backgroundListener: ((state: BackgroundState) => void) | null = null

function makeBackgroundState(): BackgroundState {
  const image = BACKGROUND_IMAGES[backgroundIndex % BACKGROUND_IMAGES.length]
  return {
    generation: backgroundGeneration,
    path: `D:/pictures/test/${image.url.split('/').pop()}`,
    url: image.url,
    imageWidth: image.width,
    imageHeight: image.height,
    crop: coverCrop(image.width, image.height)
  }
}

// ============ mock api ============
const api: Api = {
  async bootstrap() {
    return {
      config: { ...config, liquidGlass: { ...config.liquidGlass } },
      mods: cloneMods(),
      logs: bootstrapLogs,
      initialization: { success: true, message: '' },
      autoOpenSettings: false
    }
  },

  async scanMods() {
    return cloneMods()
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
    return findMod(name) ? unavailable('添加压缩包') : { success: false, message: `未找到模组 ${name}` }
  },

  async replaceModArchive(name) {
    return findMod(name) ? unavailable('替换压缩包') : { success: false, message: `未找到模组 ${name}` }
  },

  async installAll(category) {
    const targets = mods.filter(
      (mod) => category === ALL_CATEGORY || (category === OTHER_CATEGORY ? categoryOfMod(mod) === OTHER_CATEGORY : categoryOfMod(mod) === category)
    )
    for (const mod of targets) mod.installed = true
    return { result: { success: true, message: `已安装 ${targets.length} 个模组(mock)` } }
  },

  async uninstallAll(category) {
    const targets = mods.filter(
      (mod) => category === ALL_CATEGORY || (category === OTHER_CATEGORY ? categoryOfMod(mod) === OTHER_CATEGORY : categoryOfMod(mod) === category)
    )
    for (const mod of targets) mod.installed = false
    return { result: { success: true, message: `已卸载 ${targets.length} 个模组(mock)` } }
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
    return { ...config, liquidGlass: { ...config.liquidGlass } }
  },

  async updateConfig(patch) {
    const { liquidGlass, ...rest } = patch
    Object.assign(config, rest)
    if (liquidGlass) {
      config.liquidGlass = { ...config.liquidGlass, ...liquidGlass }
    }
    return { ...config, liquidGlass: { ...config.liquidGlass } }
  },

  async openConfigFile() {
    return unavailable('打开配置文件')
  },

  async setSortOrder(sortOrder) {
    config.sortOrder = sortOrder
    return { success: true, message: '' }
  },

  async setCategoryOrder(order) {
    config.categoryOrder = [...order]
    return { success: true, message: '' }
  },

  async pickArchive() {
    return null
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
    return makeBackgroundState().path
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
  }
}

export function installBrowserApiMock(): void {
  window.api = api
  console.info('[NTEMM] 浏览器测试模式:window.api 已注入 mock(数据为内存样例)')
}
