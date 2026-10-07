import {
  ALL_CATEGORY,
  OTHER_CATEGORY,
  SortOrder,
  type ModInfo
} from './types'

export function normalizeCategories(categories: string[]): string[] {
  const normalized: string[] = []
  for (const category of categories) {
    const name = category.trim()
    if (!name || name === ALL_CATEGORY || name === OTHER_CATEGORY) {
      continue
    }
    if (!normalized.includes(name)) {
      normalized.push(name)
    }
  }
  return normalized
}

export function orderedCategories(categories: string[], requestedOrder: string[]): string[] {
  const ordered: string[] = []
  for (const category of requestedOrder) {
    if (categories.includes(category) && !ordered.includes(category)) {
      ordered.push(category)
    }
  }
  for (const category of categories) {
    if (!ordered.includes(category)) {
      ordered.push(category)
    }
  }
  return ordered
}

function parseModName(
  mod: ModInfo,
  categories: string[]
): { category: string; secondary: string } | null {
  const nameParts = mod.name.split('-')
  if (nameParts.length !== 2 && nameParts.length !== 3) {
    return null
  }
  for (const part of nameParts) {
    if (part.trim().length === 0) {
      return null
    }
  }
  const parsedCategory = nameParts[0].trim()
  if (!categories.includes(parsedCategory)) {
    return null
  }
  return { category: parsedCategory, secondary: nameParts[1].trim() }
}

export function categoryForMod(mod: ModInfo, categories: string[]): string {
  return parseModName(mod, categories)?.category ?? OTHER_CATEGORY
}

export function secondaryNameForMod(mod: ModInfo, categories: string[]): string {
  return parseModName(mod, categories)?.secondary ?? ''
}

export function countByCategory(mods: ModInfo[], categories: string[]): Map<string, number> {
  const counts = new Map<string, number>([[ALL_CATEGORY, mods.length]])
  for (const mod of mods) {
    const category = categoryForMod(mod, categories)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return counts
}

function localeCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN', { numeric: true })
}

export function filterAndSort(
  mods: ModInfo[],
  category: string,
  categories: string[],
  sortOrder: SortOrder
): ModInfo[] {
  let list = mods
  if (category !== ALL_CATEGORY) {
    list = list.filter((mod) => categoryForMod(mod, categories) === category)
  }
  const copy = [...list]
  switch (sortOrder) {
    case SortOrder.NameAscending:
      copy.sort((a, b) => localeCompare(a.name, b.name))
      break
    case SortOrder.NameDescending:
      copy.sort((a, b) => localeCompare(b.name, a.name))
      break
    case SortOrder.ImportedNewestFirst:
      copy.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
      break
    case SortOrder.ImportedOldestFirst:
      copy.sort((a, b) => a.importedAt.localeCompare(b.importedAt))
      break
    case SortOrder.SizeLargestFirst:
      copy.sort((a, b) => b.sizeBytes - a.sizeBytes)
      break
    case SortOrder.SizeSmallestFirst:
      copy.sort((a, b) => a.sizeBytes - b.sizeBytes)
      break
    case SortOrder.InstalledFirst:
    default:
      break
  }
  return copy
}

/** 默认、名称升序、名称降序三种排序下按二级名称分组展示 */
export function groupBySecondaryName(
  mods: ModInfo[],
  categories: string[]
): { secondary: string; mods: ModInfo[] }[] {
  const groups: { secondary: string; mods: ModInfo[] }[] = []
  const bySecondary = new Map<string, ModInfo[]>()
  for (const mod of mods) {
    const secondary = secondaryNameForMod(mod, categories) || OTHER_CATEGORY
    let bucket = bySecondary.get(secondary)
    if (!bucket) {
      bucket = []
      bySecondary.set(secondary, bucket)
      groups.push({ secondary, mods: bucket })
    }
    bucket.push(mod)
  }
  return groups
}
