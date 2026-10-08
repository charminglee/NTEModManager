import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getAppConfig } from './config'
import { logger } from './logger'

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase()
}

function isSupportedImage(name: string): boolean {
  return ['jpg', 'jpeg', 'png'].includes(extensionOf(name))
}

/** 调试图集目录(test_images=1 时的背景图来源;浏览器 dev 模式的 serveTestImages 同源) */
export const TEST_IMAGES_ROOT = 'F:/pictures/test'

/** 数值命名的子目录中的图片。 */
export function collectBackgroundImages(): string[] {
  const config = getAppConfig()

  const fromBackgroundDirectory = (): string[] => {
    const root = config.backgroundImagesDirectory
    if (!root) {
      return []
    }
    const images: string[] = []
    let subdirectories: string[]
    try {
      subdirectories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map((entry) => entry.name)
    } catch {
      logger.warning(`无法读取背景图目录：${root}`)
      return []
    }
    for (const directory of subdirectories) {
      try {
        for (const name of readdirSync(join(root, directory))) {
          if (isSupportedImage(name)) {
            images.push(join(root, directory, name))
          }
        }
      } catch {
        // 单个子目录不可读不拖垮整个图库
      }
    }
    return images
  }

  if (config.testImagesEnabled) {
    const testRoot = TEST_IMAGES_ROOT
    let images: string[] = []
    try {
      images = readdirSync(testRoot)
        .filter((name) => isSupportedImage(name))
        .map((name) => join(testRoot, name))
    } catch {
      images = []
    }
    if (images.length > 0) {
      return images
    }
    // 调试图集目录不可用(盘未挂载/已改名)时回退正常图库:空白背景比「调试模式
    // 名义开启却什么都不显示」更接近预期,且 dev 命令会强制开启本开关,不能让
    // 图集缺失把背景整个拖没
    logger.warning(
      `测试图片模式已开启，但 ${testRoot} 没有可用的 jpg/png 图片；回退到 background_images_directory`
    )
  }

  const images = fromBackgroundDirectory()
  if (images.length === 0) {
    logger.warning(
      `背景图目录中没有可用的图片：${config.backgroundImagesDirectory}（需要数值命名的子目录，内含 jpg/jpeg/png 文件）`
    )
  }
  return images
}

/** media://local/ 的路径段编码(逐段 encodeURIComponent) */
export function encodeMediaPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function decodeMediaPath(url: string): string | null {
  // media://local/E%3A/foo/bar.png
  const prefix = 'media://local/'
  if (!url.startsWith(prefix)) {
    return null
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(url.slice(prefix.length))
  } catch {
    return null
  }
  return decoded
}
