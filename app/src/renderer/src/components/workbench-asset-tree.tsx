import { useEffect, useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { Button } from './ui/button'
import type { AssetDirectory, AssetEntry, AssetQuery } from '@shared/workbench-assets'

type TreeQuery = Omit<AssetQuery, 'directory'>
type BranchProps = {
  query: TreeQuery
  directory?: string
  selected?: AssetEntry
  onSelect: (entry: AssetEntry) => void
}

const rowClass = 'h-7 w-full justify-start gap-1.5 border-0 px-2 text-left text-xs font-normal focus-visible:outline-offset-[-2px]'

function AssetFolder({ path, expand, ...props }: BranchProps & { path: string; expand: boolean }) {
  const [open, setOpen] = useState(expand)
  const name = path.slice(path.lastIndexOf('/') + 1)

  return <li>
    <Button type="button" variant="ghost" className={rowClass} title={path} aria-expanded={open}
      onClick={() => setOpen(value => !value)}>
      <ChevronRight aria-hidden="true" className={open ? 'rotate-90' : undefined} />
      {open ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
      <span className="truncate">{name}</span>
    </Button>
    {open && <WorkbenchAssetTree {...props} directory={path} />}
  </li>
}

export default function WorkbenchAssetTree({ query, directory = '', selected, onSelect }: BranchProps) {
  const [result, setResult] = useState<AssetDirectory>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const expandHtContent = query.onlyHtContent && (!directory || directory.toLowerCase() === 'ht')
  const expandSearchResult = !!query.search.trim() && result?.folders.length === 1 && !result.rows.length
  const expandFolders = expandHtContent || expandSearchResult

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      window.api.workbenchAssetQuery({ ...query, directory }).then(value => {
        if (active) setResult(value)
      }).catch(reason => {
        if (active) setError(String(reason))
      }).finally(() => {
        if (active) setLoading(false)
      })
    }, !directory && query.search ? 120 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query, directory])

  return <div aria-busy={directory ? undefined : loading}>
    {result && result.count > 0 && <ul className={directory ? 'ml-3 border-l border-border pl-1' : 'p-1'}>
      {result.folders.map(path => <AssetFolder key={JSON.stringify([path, expandFolders])} path={path} expand={expandFolders}
        query={query} selected={selected} onSelect={onSelect} />)}
      {result.rows.map(row => {
        const name = row.path.slice(row.path.lastIndexOf('/') + 1)
        return <li key={JSON.stringify([row.path, row.archive])}>
          <Button type="button" variant="ghost" title={`${row.path}\n${row.archive}`}
            aria-pressed={row.path === selected?.path && row.archive === selected.archive}
            className={`${rowClass} pl-7 aria-pressed:bg-accent aria-pressed:text-accent-foreground`}
            onClick={() => onSelect(row)}>
            <File aria-hidden="true" />
            <span className="truncate">{name}</span>
          </Button>
        </li>
      })}
    </ul>}
    {result?.count === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">没有匹配的资源。</p>}
    {error && <p role="alert" className="break-all px-3 py-2 text-xs text-destructive">{error}</p>}
  </div>
}
