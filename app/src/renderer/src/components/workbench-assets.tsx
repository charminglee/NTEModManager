import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileOutput, Filter, FolderOpen, LoaderCircle, PackageOpen, Search } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import WorkbenchSelect from './workbench-select'
import WorkbenchAssetTree from './workbench-asset-tree'
import WorkbenchAssetPreview from './workbench-asset-preview'
import type { AssetEntry, AssetMode, AssetState } from '@shared/workbench-assets'

const modes: Record<AssetMode, string> = {
  all: '全部资源', new: '新增资源', modified: '已修改资源', unpatched: '排除已被覆盖的资源'
}

export default function WorkbenchAssets({ active }: { active: boolean }) {
  const [state, setState] = useState<AssetState>({ count: 0, archives: [], snapshots: [] })
  const [search, setSearch] = useState('')
  const [archive, setArchive] = useState('')
  const [onlyHtContent, setOnlyHtContent] = useState(true)
  const [mode, setMode] = useState<AssetMode>('all')
  const [snapshot, setSnapshot] = useState('')
  const [loaded, setLoaded] = useState<{ mode: AssetMode; snapshot: string; revision: number }>({
    mode: 'all', snapshot: '', revision: 0
  })
  const [selection, setSelection] = useState<{ entry: AssetEntry; open: number }>()
  const [busy, setBusy] = useState<'index' | 'snapshot'>()
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()
  const comparing = mode === 'new' || mode === 'modified'
  const archiveLabel = archive ? archive.split('/').pop() : '选择包体'
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

  function loadResources(nextMode: AssetMode, nextSnapshot: string, nextArchive = archive) {
    return run('index', async () => {
      const value = await window.api.workbenchAssetIndex()
      setState(value)
      setArchive(value.archives.includes(nextArchive) ? nextArchive : '')
      setSelection(undefined)
      setLoaded(previous => ({ mode: nextMode, snapshot: nextSnapshot, revision: previous.revision + 1 }))
    })
  }

  function select(entry: AssetEntry, open = false) {
    setSelection(previous => {
      if (open) return { entry, open: (previous?.open ?? 0) + 1 }
      if (previous?.entry.path === entry.path && previous.entry.archive === entry.archive) return previous
      return { entry, open: 0 }
    })
  }

  return <fieldset disabled={!!busy} className="workbench-assets">
    <div className="workbench-assets-toolbar">
      <div className="flex min-w-0 items-center gap-2">
        <label className="library-search workbench-assets-search">
          <Search size={17} aria-hidden="true" />
          <Input type="search" placeholder="搜索资源" aria-label="搜索资源" value={search}
            onChange={event => {
              setSearch(event.target.value)
              setSelection(undefined)
            }} />
        </label>
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
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {comparing && <WorkbenchSelect label="对比快照" className="w-auto max-w-56" disabled={!!busy}
          value={snapshot || 'none'}
          options={[
            ['none', '选择对比快照'],
            ...state.snapshots.map(file => [file, file.replace(/\.snapshot\.json$/, '')] as const)
          ]}
          onValueChange={value => setSnapshot(value === 'none' ? '' : value)} />}
        <Button variant="secondary" disabled={!state.count} title="导出索引快照" onClick={() => run('snapshot', async () => {
          const value = await window.api.workbenchAssetSnapshot()
          setState(value)
          setSnapshot(value.snapshots[0])
          setMessage({ text: '已导出索引快照，可在对比加载时选择。' })
        })}><FileOutput aria-hidden="true" />导出</Button>
      </div>
    </div>
    {(busy === 'snapshot' || message) && <p role={message?.error ? 'alert' : 'status'}
      className={`break-all text-sm ${message?.error ? 'text-destructive' : 'text-muted-foreground'}`}>
      {busy === 'snapshot' ? '正在导出索引快照……' : message?.text}
    </p>}
    <div className="workbench-assets-browser">
      <section className="workbench-assets-tree workbench-panel" aria-label="文件">
        <header className="workbench-panel-heading">
          <h2 className="mr-auto">文件</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="workbench-assets-archive" disabled={!!busy || !state.archives.length}
                aria-label="选择包体" title={archiveLabel}>
                <span className="truncate">{archiveLabel}</span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="workbench-assets-archive-menu">
              <DropdownMenuRadioGroup value={archive} onValueChange={value => {
                const nextArchive = archive === value ? '' : value
                if (nextArchive && !state.count) return loadResources(loaded.mode, loaded.snapshot, nextArchive)
                setArchive(nextArchive)
                setSelection(undefined)
              }}>
                {archiveGroups.map(([directory, paths], index) => <Fragment key={directory}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuGroup aria-label={directory}>
                    {paths.map(path => <DropdownMenuRadioItem key={path} value={path}>
                      <span className="break-all">{path.split('/').pop()}</span>
                    </DropdownMenuRadioItem>)}
                  </DropdownMenuGroup>
                </Fragment>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="size-8" disabled={!!busy}
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
        </header>
        <div className="group/file-tree relative min-h-0 flex-1">
          <div className="absolute inset-0 overflow-auto aria-busy:invisible" aria-busy={busy === 'index'}>
            {state.count ? <WorkbenchAssetTree key={JSON.stringify([loaded.revision, search, archive, onlyHtContent])}
              query={query} selected={selection?.entry} onSelect={select} onOpen={entry => select(entry, true)} />
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
        <header className="workbench-panel-heading"><h2>资源预览</h2></header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selection ? <WorkbenchAssetPreview key={JSON.stringify([selection.entry.path, selection.entry.archive, selection.open])}
            entry={selection.entry} autoOpen={selection.open > 0} disabled={!!busy} />
            : <div className="workbench-assets-empty">
              <PackageOpen size={24} aria-hidden="true" />
              <p>双击文件树中的文件加载预览。</p>
            </div>}
        </div>
      </section>
    </div>
  </fieldset>
}
