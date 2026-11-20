import { useEffect, useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { Button } from './ui/button'
import type { AssetDirectory, AssetEntry, AssetQuery } from '@shared/workbench-assets'

type TreeQuery = Omit<AssetQuery, 'directory' | 'page'>
type BranchProps = {
  query: TreeQuery
  directory?: string
  selected?: AssetEntry
  onSelect: (entry: AssetEntry) => void
  onOpen: (entry: AssetEntry) => void
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

export default function WorkbenchAssetTree({ query, directory = '', selected, onSelect, onOpen }: BranchProps) {
  const [result, setResult] = useState<AssetDirectory>()
  const [request, setRequest] = useState({ page: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nextPage, setNextPage] = useState(0)

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      window.api.workbenchAssetQuery({ ...query, directory, page: request.page }).then(value => {
        if (!active) return
        setResult(previous => request.page && previous ? {
          ...value, folders: [...previous.folders, ...value.folders], rows: [...previous.rows, ...value.rows]
        } : value)
        setNextPage(request.page + 1)
      }).catch(reason => {
        if (active) setError(String(reason))
      }).finally(() => {
        if (active) setLoading(false)
      })
    }, !directory && query.search ? 120 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query, directory, request])

  return <>
    {!directory && result && <p className="px-3 py-1 text-xs text-muted-foreground">{result.count.toLocaleString()} 项资源</p>}
    {result && result.count > 0 && <ul className={directory ? 'ml-3 border-l border-border pl-1' : 'p-1'}>
      {result.folders.map(path => <AssetFolder key={path} path={path}
        expand={!!query.search.trim() && !result.more && result.folders.length === 1 && !result.rows.length}
        query={query} selected={selected} onSelect={onSelect} onOpen={onOpen} />)}
      {result.rows.map(row => {
        const name = row.path.slice(row.path.lastIndexOf('/') + 1)
        return <li key={JSON.stringify([row.path, row.archive])}>
          <Button type="button" variant="ghost" title={`${row.path}\n${row.archive}`}
            aria-pressed={row.path === selected?.path && row.archive === selected.archive}
            className={`${rowClass} pl-7 aria-pressed:bg-accent aria-pressed:text-accent-foreground`}
            onClick={event => event.detail === 0 ? onOpen(row) : onSelect(row)}
            onDoubleClick={() => onOpen(row)}>
            <File aria-hidden="true" />
            <span className="truncate">{name}</span>
            <span className="ml-auto max-w-[35%] truncate text-muted-foreground">{row.archive.split('/').pop()}</span>
          </Button>
        </li>
      })}
    </ul>}
    {result?.count === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">没有匹配的资源。</p>}
    {error && <p role="alert" className="break-all px-3 py-2 text-xs text-destructive">{error}</p>}
    {loading && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">正在读取目录……</p>}
    {!loading && result?.more && <Button type="button" variant="ghost" size="sm" className="ml-2"
      onClick={() => {
        setError('')
        setLoading(true)
        setRequest({ page: nextPage })
      }}>显示更多</Button>}
  </>
}
