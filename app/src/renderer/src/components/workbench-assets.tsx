import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileOutput, FolderOpen, PackageOpen, Search } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger
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
  const [mode, setMode] = useState<AssetMode>('all')
  const [snapshot, setSnapshot] = useState('')
  const [loaded, setLoaded] = useState<{ mode: AssetMode; snapshot: string; revision: number }>({
    mode: 'all', snapshot: '', revision: 0
  })
  const [selection, setSelection] = useState<{ entry: AssetEntry; open: number }>()
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()
  const comparing = mode === 'new' || mode === 'modified'
  const archiveLabel = archive ? archive.split('/').pop() : '选择包体'
  const query = useMemo(() => ({ mode: loaded.mode, snapshot: loaded.snapshot, search, archives: archive ? [archive] : [] }),
    [loaded, search, archive])

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

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label)
    setMessage(undefined)
    try {
      await work()
    } catch (error) {
      setMessage({ text: String(error), error: true })
    } finally {
      setBusy('')
    }
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
      <label className="library-search workbench-assets-search">
        <Search size={17} aria-hidden="true" />
        <Input type="search" placeholder="搜索资源路径" aria-label="搜索资源路径" value={search}
          onChange={event => {
            setSearch(event.target.value)
            setSelection(undefined)
          }} />
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {comparing && <WorkbenchSelect label="对比快照" className="w-auto max-w-56" disabled={!!busy}
          value={snapshot || 'none'}
          options={[
            ['none', '选择对比快照'],
            ...state.snapshots.map(file => [file, file.replace(/\.snapshot\.json$/, '')] as const)
          ]}
          onValueChange={value => setSnapshot(value === 'none' ? '' : value)} />}
        <Button variant="outline" disabled={!state.count} title="导出索引快照" onClick={() => run('正在导出索引快照……', async () => {
          const value = await window.api.workbenchAssetSnapshot()
          setState(value)
          setSnapshot(value.snapshots[0])
          setMessage({ text: '已导出索引快照，可在对比加载时选择。' })
        })}><FileOutput aria-hidden="true" />导出</Button>
        <div className="inline-flex shrink-0" role="group" aria-label="加载资源">
          <Button className="rounded-r-none" disabled={comparing && !snapshot}
            onClick={() => run('正在加载游戏资源……', async () => {
              const value = await window.api.workbenchAssetIndex()
              setState(value)
              setArchive(previous => value.archives.includes(previous) ? previous : '')
              setSelection(undefined)
              setLoaded(previous => ({ mode, snapshot: comparing ? snapshot : '', revision: previous.revision + 1 }))
            })}>加载</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="rounded-l-none border-l-primary-foreground/25" disabled={!!busy}
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
    </div>
    {(busy || message) && <p role={message?.error ? 'alert' : 'status'}
      className={`break-all text-sm ${message?.error ? 'text-destructive' : 'text-muted-foreground'}`}>{busy || message?.text}</p>}
    <div className="workbench-assets-browser">
      <section className="workbench-assets-tree workbench-panel" aria-label="文件">
        <header className="workbench-panel-heading">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h2>文件</h2>
            {!!state.count && <span className="text-xs font-normal text-muted-foreground">{modes[loaded.mode]}</span>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="workbench-assets-archive" disabled={!!busy || !state.archives.length}
                aria-label="选择包体" title={archiveLabel}>
                <span className="truncate">{archiveLabel}</span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="workbench-assets-archive-menu">
              <DropdownMenuRadioGroup value={archive} onValueChange={value => {
                setArchive(previous => previous === value ? '' : value)
                setSelection(undefined)
              }}>
                {state.archives.map(path => <DropdownMenuRadioItem key={path} value={path}>
                  <span className="break-all">{path.split('/').pop()}</span>
                </DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {state.count ? <WorkbenchAssetTree key={JSON.stringify([loaded.revision, search, archive])}
            query={query} selected={selection?.entry} onSelect={select} onOpen={entry => select(entry, true)} />
            : <div className="workbench-assets-empty">
              <FolderOpen size={24} aria-hidden="true" />
              <p>{loaded.revision ? '没有可浏览的资源。' : '点击「加载」读取游戏资源。'}</p>
            </div>}
        </div>
      </section>
      <section className="workbench-assets-preview workbench-panel" aria-label="资源预览">
        <header className="workbench-panel-heading"><h2>资源预览</h2></header>
        {selection ? <WorkbenchAssetPreview key={JSON.stringify([selection.entry.path, selection.entry.archive, selection.open])}
          entry={selection.entry} autoOpen={selection.open > 0} disabled={!!busy} />
          : <div className="workbench-assets-empty">
            <PackageOpen size={24} aria-hidden="true" />
            <p>双击文件树中的文件加载预览。</p>
          </div>}
      </section>
    </div>
  </fieldset>
}
