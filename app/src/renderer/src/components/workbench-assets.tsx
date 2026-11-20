import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FileOutput, Filter, FolderOpen, LoaderCircle, PackageOpen, Search } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from './ui/select'
import WorkbenchSelect from './workbench-select'
import WorkbenchAssetTree from './workbench-asset-tree'
import WorkbenchAssetPreview from './workbench-asset-preview'
import type { AssetEntry, AssetMode, AssetState } from '@shared/workbench-assets'

const modes: Record<AssetMode, string> = {
  all: '全部资源', new: '新增资源', modified: '已修改资源', unpatched: '排除已被覆盖的资源'
}

export default function WorkbenchAssets({ active, toolbarTarget }: { active: boolean; toolbarTarget: HTMLElement | null }) {
  const [state, setState] = useState<AssetState>({ count: 0, archives: [], snapshots: [] })
  const [search, setSearch] = useState('')
  const [archive, setArchive] = useState('')
  const [onlyHtContent, setOnlyHtContent] = useState(true)
  const [mode, setMode] = useState<AssetMode>('all')
  const [snapshot, setSnapshot] = useState('')
  const [loaded, setLoaded] = useState<{ mode: AssetMode; snapshot: string; revision: number }>({
    mode: 'all', snapshot: '', revision: 0
  })
  const [selection, setSelection] = useState<AssetEntry>()
  const [busy, setBusy] = useState<'index' | 'snapshot'>()
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()
  const comparing = mode === 'new' || mode === 'modified'
  const showExport = !!selection
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
    }).catch(error => { if (current) setMessage({ text: String(error), error: true }) })
    return () => { current = false }
  }, [active])

  async function run(operation: NonNullable<typeof busy>, work: () => Promise<void>) {
    setBusy(operation)
    setMessage(undefined)
    try {
      await work()
    } catch (error) {
      setMessage({ text: String(error), error: true })
    } finally {
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
      <div className="workbench-assets-search-group flex min-w-0 items-center gap-2">
        <label className="library-search workbench-assets-search">
          <Search size={17} aria-hidden="true" />
          <Input type="search" placeholder="搜索资源" aria-label="搜索资源" value={search}
            onChange={event => {
              setSearch(event.target.value)
              setSelection(undefined)
            }} />
        </label>
        <Select value={archive} disabled={!!busy || !state.archives.length} onValueChange={nextArchive => {
          if (!state.count) return loadResources(loaded.mode, loaded.snapshot, nextArchive)
          setArchive(nextArchive)
          setSelection(undefined)
        }}>
          <SelectTrigger aria-label="选择包体" title={archiveLabel}>
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
                  aria-label="加载模式" title={`加载模式：${modes[mode]}`}>
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={mode} onValueChange={value => setMode(value as AssetMode)}>
                  {Object.entries(modes).map(([value, label]) =>
                    <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" disabled={!!busy}
                aria-label="过滤文件" title="过滤文件">
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
        <div className="header-action-reveal" data-visible={showExport || undefined}>
          <div className="header-action-reveal-content" {...(!showExport ? { inert: '' } : {})}>
            <Button variant="secondary" size="icon" disabled={!!busy || !state.count}
              aria-label="导出索引快照" title="导出索引快照"
              onClick={() => run('snapshot', async () => {
                const value = await window.api.workbenchAssetSnapshot()
                setState(value)
                setSnapshot(value.snapshots[0])
                setMessage({ text: '已导出索引快照，可在对比加载时选择。' })
              })}><FileOutput aria-hidden="true" /></Button>
          </div>
        </div>
      </div>
    </fieldset>,
    toolbarTarget
  )

  return <>
    {toolbar}
    <fieldset disabled={!!busy} className="workbench-assets">
      {(busy === 'snapshot' || message) && <p role={message?.error ? 'alert' : 'status'}
        className={`break-all text-sm ${message?.error ? 'text-destructive' : 'text-muted-foreground'}`}>
        {busy === 'snapshot' ? '正在导出索引快照……' : message?.text}
      </p>}
      <div className="workbench-assets-browser">
        <section className="workbench-assets-tree workbench-panel" aria-label="文件">
          <div className="group/file-tree relative min-h-0 flex-1">
            <div className="absolute inset-0 overflow-auto aria-busy:invisible" aria-busy={busy === 'index'}>
              {state.count ? <WorkbenchAssetTree key={JSON.stringify([loaded.revision, search, archive, onlyHtContent])}
                query={query} selected={selection} onSelect={setSelection} />
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
            {selection ? <WorkbenchAssetPreview key={JSON.stringify([selection.path, selection.archive])} entry={selection} />
              : <div className="workbench-assets-empty">
                <PackageOpen size={24} aria-hidden="true" />
                <p>选择文件以查看预览。</p>
              </div>}
          </div>
        </section>
      </div>
    </fieldset>
  </>
}
