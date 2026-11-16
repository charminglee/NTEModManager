import type { ModFileEntry, SubModInfo } from './types'

function containsPackage(entry: ModFileEntry): boolean {
  return entry.directory
    ? entry.children.some(containsPackage)
    : /\.(pak|ucas|utoc)$/i.test(entry.name)
}

/** 更深层目录整体归属第一层子模组，不生成递归开关。 */
export function bundleChildren(files: ModFileEntry[], disabled: string[] = []): SubModInfo[] {
  const children = files.filter((entry) => entry.directory && containsPackage(entry))
  if (children.length < 2) return []
  return children.map((entry) => ({
    name: entry.name,
    sizeBytes: entry.sizeBytes,
    enabled: !disabled.includes(entry.name)
  }))
}
