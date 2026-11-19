import { assetPageSize, type AssetEntry, type AssetQuery } from './workbench-assets'

export function effectiveAssets(rows: AssetEntry[]) {
  const effective = new Map<string, AssetEntry>()
  for (const row of rows) {
    const key = row.path.toLowerCase()
    const previous = effective.get(key)
    if (!previous || previous.order <= row.order) effective.set(key, row)
  }
  return effective
}

export function assetResults(rows: AssetEntry[], query: AssetQuery, baseline?: Map<string, AssetEntry>) {
  const archives = new Set(query.archives)
  const term = query.search.trim().toLowerCase()
  const start = query.page * assetPageSize
  const page: AssetEntry[] = []
  let count = 0
  for (const row of rows) {
    if (query.mode === 'multiple' && archives.size && !archives.has(row.archive)) continue
    const path = row.path.toLowerCase()
    if (!path.includes(term)) continue
    if (query.mode === 'modified' || query.mode === 'new') {
      const old = baseline?.get(path)
      if (query.mode === 'modified' ? !old || old.size === row.size && old.encrypted === row.encrypted : old) continue
    }
    if (count >= start && page.length < assetPageSize) page.push(row)
    count++
  }
  return { count, rows: page }
}
