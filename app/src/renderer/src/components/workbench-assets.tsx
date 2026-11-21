import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Filter, FolderOpen, LoaderCircle, PackageOpen } from 'lucide-react'
import { toast } from './toast-card'
import { Button } from './ui/button'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuItem, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger
} from './ui/dropdown-menu'
import { SearchBox } from './ui/search-box'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from './ui/select'
import WorkbenchSelect from './workbench-select'
import WorkbenchAssetTree from './workbench-asset-tree'
import WorkbenchAssetPreview from './workbench-asset-preview'
import type { AssetEntry, AssetMode, AssetPreviewMode, AssetState } from '@shared/workbench-assets'

const modes: Record<AssetMode, string> = {
  all: '全部资源', new: '新增资源', modified: '已修改资源', unpatched: '排除已被覆盖的资源'
}

export default function WorkbenchAssets({ active, toolbarTarget, onExportingChange }: {
  active: boolean
  toolbarTarget: HTMLElement | null
  onExportingChange: (exporting: boolean) => void
}) {
  const [state, setState] = useState<AssetState>({ count: 0, archives: [], snapshots: [] })
  const [search, setSearch] = useState('')
  const [archive, setArchive] = useState('')
  const [onlyHtContent, setOnlyHtContent] = useState(true)
  const [mode, setMode] = useState<AssetMode>('all')
  const [snapshot, setSnapshot] = useState('')
  const [loaded, setLoaded] = useState<{ mode: AssetMode; snapshot: string; revision: number }>({
    mode: 'all', snapshot: '', revision: 0
  })
  const [selection, setSelection] = useState<{ entry: AssetEntry; mode: AssetPreviewMode }>()
  const [busy, setBusy] = useState<'index' | 'snapshot' | 'export'>()
  const comparing = mode === 'new' || mode === 'modified'
  const archiveLabel = archive ? archive.split('/').pop() : state.count ? '全部包体' : '选择包体'
  const archiveGroups = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const path of state.archives) {
      const directory = path.slice(0, path.lastIndexOf('/'))
      const entries = groups.get(directory)
      if (entries) entries.push(path)
      else groups.set(directory, [path])
    }
    return [...groups]
  }, [state.archives])
  const query = useMemo(() => ({
    mode: loaded.mode, snapshot: loaded.snapshot, search, archives: archive ? [archive] : [], onlyHtContent
  }), [loaded, search, archive, onlyHtContent])

  useEffect(() => {
    if (!active) return
    let current = true
    window.api.workbenchAssetState().then(value => {
      if (!current) return
      setState(value)
      setArchive(previous => value.archives.includes(previous) ? previous : '')
      setSnapshot(previous => value.snapshots.includes(previous) ? previous : '')
      if (!value.count) setSelection(undefined)
    }).catch(error => {
      if (current) toast.error('读取资源状态失败', { description: error instanceof Error ? error.message : String(error) })
    })
    return () => { current = false }
  }, [active])

  async function run(operation: NonNullable<typeof busy>, work: () => Promise<void>) {
    setBusy(operation)
    if (operation === 'export') onExportingChange(true)
    try {
      await work()
    } catch (error) {
      const title = operation === 'index' ? '加载资源失败' : operation === 'snapshot' ? '导出索引快照失败' : '导出资源失败'
      toast.error(title, { description: error instanceof Error ? error.message : String(error) })
    } finally {
      if (operation === 'export') onExportingChange(false)
      setBusy(undefined)
    }
  }

  function loadResources(nextMode: AssetMode, nextSnapshot: string, nextArchive = '') {
    return run('index', async () => {
      const value = await window.api.workbenchAssetIndex()
      setState(value)
      setArchive(value.archives.includes(nextArchive) ? nextArchive : '')
      setSelection(undefined)
      setLoaded(previous => ({ mode: nextMode, snapshot: nextSnapshot, revision: previous.revision + 1 }))
    })
  }

  const toolbar = active && toolbarTarget && createPortal(
    <fieldset disabled={!!busy} className="workbench-assets-toolbar" aria-label="原生资源操作">
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <SearchBox layout="toolbar" type="search" placeholder="搜索资源" value={search}
          onValueChange={value => {
            setSearch(value)
            setSelection(undefined)
          }} />
        <Select value={archive} disabled={!!busy || !state.archives.length} onValueChange={nextArchive => {
          if (!state.count) return loadResources(loaded.mode, loaded.snapshot, nextArchive)
          setArchive(nextArchive)
          setSelection(undefined)
        }}>
          <SelectTrigger aria-label="选择包体">
            <SelectValue placeholder={archiveLabel} />
          </SelectTrigger>
          <SelectContent>
            {archiveGroups.map(([directory, paths], index) => <Fragment key={directory}>
              {index > 0 && <SelectSeparator />}
              <SelectGroup aria-label={directory}>
                {paths.map(path => <SelectItem key={path} value={path}>{path.split('/').pop()}</SelectItem>)}
              </SelectGroup>
            </Fragment>)}
          </SelectContent>
        </Select>
      </div>
      <div className="workbench-assets-actions flex min-w-0 max-w-full flex-wrap items-center justify-end gap-y-2">
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <div className="inline-flex shrink-0" role="group" aria-label="加载资源">
            <Button variant="secondary" className="rounded-r-none border-r-0" disabled={comparing && !snapshot}
              onClick={() => loadResources(mode, comparing ? snapshot : '')}>加载</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-l-none" disabled={!!busy}
                  aria-label="加载模式">
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={mode} onValueChange={value => setMode(value as AssetMode)}>
                  {Object.entries(modes).map(([value, label]) =>
                    <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!state.count} onSelect={() => run('snapshot', async () => {
                  const value = await window.api.workbenchAssetSnapshot()
                  setState(value)
                  setSnapshot(value.snapshots[0])
                  toast.success('已导出索引快照，可在对比加载时选择')
                })}>导出索引快照</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" disabled={!!busy}
                aria-label="过滤文件">
                <Filter aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem checked={onlyHtContent} onCheckedChange={checked => {
                setOnlyHtContent(checked)
                setSelection(undefined)
              }}>只看 HT/Content</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {comparing && <WorkbenchSelect label="对比快照" className="ms-2 w-auto max-w-56" disabled={!!busy}
          value={snapshot || 'none'}
          options={[
            ['none', '选择对比快照'],
            ...state.snapshots.map(file => [file, file.replace(/\.snapshot\.json$/, '')] as const)
          ]}
          onValueChange={value => setSnapshot(value === 'none' ? '' : value)} />}
      </div>
    </fieldset>,
    toolbarTarget
  )

  return <>
    {toolbar}
    <fieldset disabled={!!busy} aria-busy={!!busy} className="workbench-assets">
      <div className="workbench-assets-browser">
        <section className="workbench-assets-tree workbench-panel" aria-label="文件">
          <div className="group/file-tree relative min-h-0 flex-1">
            <div className="workbench-assets-tree-scroll absolute inset-0 overflow-auto aria-busy:invisible" aria-busy={busy === 'index'}>
              {state.count ? <WorkbenchAssetTree key={JSON.stringify([loaded.revision, search, archive, onlyHtContent])}
                query={query} onPreview={(entry, mode) => setSelection({ entry, mode })}
                onExport={request => run('export', async () => {
                  const result = await window.api.workbenchAssetExport(request)
                  const title = `已导出 ${result.exported} 项`
                  if (!result.failures.length) {
                    toast.success(title, { description: result.directory })
                  } else {
                    const failure = `首项失败：${result.failures[0]}`
                    if (result.exported) {
                      toast.warning(`${title}，失败 ${result.failures.length} 项`, { description: `${result.directory}\n${failure}` })
                    } else {
                      toast.error(`导出失败，共 ${result.failures.length} 项`, { description: failure })
                    }
                  }
                })} />
                : <div className="workbench-assets-empty">
                  <FolderOpen size={24} aria-hidden="true" />
                  <p>{loaded.revision ? '没有可浏览的资源。' : '选择包体，或点击「加载」读取游戏资源。'}</p>
                </div>}
            </div>
            <div role="status" className="pointer-events-none absolute inset-0 hidden place-items-center text-muted-foreground group-has-aria-busy/file-tree:grid">
              <LoaderCircle size={28} className="motion-safe:animate-spin" aria-hidden="true" />
              <span className="sr-only">正在加载文件树……</span>
            </div>
          </div>
        </section>
        <section className="workbench-assets-preview workbench-panel" aria-label="资源预览">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selection ? <WorkbenchAssetPreview key={JSON.stringify([selection.entry.path, selection.entry.archive, selection.mode])}
              entry={selection.entry} mode={selection.mode} />
              : <div className="workbench-assets-empty">
                <PackageOpen size={24} aria-hidden="true" />
                <p>单击文件以查看预览。</p>
              </div>}
          </div>
        </section>
      </div>
    </fieldset>
  </>
}
