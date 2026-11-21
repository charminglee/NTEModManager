import type { AssetDirectory, AssetEntry, AssetQuery } from './workbench-assets'

export function effectiveAssets(rows: AssetEntry[]) {
  const effective = new Map<string, AssetEntry>()
  for (const row of rows) {
    const key = row.path.toLowerCase()
    const previous = effective.get(key)
    if (!previous || previous.order <= row.order) effective.set(key, row)
  }
  return effective
}

export function* matchingAssets(rows: AssetEntry[], query: AssetQuery, baseline?: Map<string, AssetEntry>) {
  const archives = new Set(query.archives)
  const term = query.search.trim().toLowerCase()
  const prefix = query.directory ? query.directory + '/' : ''
  for (const row of rows) {
    const treePath = row.path.replace(/^\/+/, '')
    if (!treePath.startsWith(prefix) || archives.size && !archives.has(row.archive)) continue
    const path = treePath.toLowerCase()
    if ((query.onlyHtContent && !path.startsWith('ht/content/')) || !path.includes(term)) continue
    if (query.mode === 'modified' || query.mode === 'new') {
      const old = baseline?.get(row.path.toLowerCase())
      if (query.mode === 'modified' ? !old || old.size === row.size && old.encrypted === row.encrypted : old) continue
    }
    yield row
  }
}

export function assetResults(rows: AssetEntry[], query: AssetQuery, baseline?: Map<string, AssetEntry>): AssetDirectory {
  const prefix = query.directory ? query.directory + '/' : ''
  const folders = new Set<string>()
  const files: AssetEntry[] = []
  let count = 0
  for (const row of matchingAssets(rows, query, baseline)) {
    const treePath = row.path.replace(/^\/+/, '')
    const separator = treePath.indexOf('/', prefix.length)
    if (separator === -1) files.push(row)
    else folders.add(treePath.slice(0, separator))
    count++
  }
  return {
    count,
    folders: [...folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    rows: files
  }
}
