import { createElement, useEffect, useState } from 'react'
import { Package, Search } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import WorkbenchSelect from './workbench-select'
import { assetPageSize, type AssetEntry, type AssetFormat, type AssetMode, type AssetQuery, type AssetState } from '@shared/workbench-assets'

const modes: Record<AssetMode, string> = {
  all: '全部资源', multiple: '选择容器', new: '新增资源', modified: '已修改资源', unpatched: '排除已被覆盖的资源'
}
const formats: Record<AssetFormat, string> = { json: 'JSON 属性', texture: 'PNG 贴图', model: 'GLB 模型', raw: '容器原始文件' }
const initialQuery: AssetQuery = { mode: 'all', archives: [], snapshot: '', search: '', page: 0 }

export default function WorkbenchAssets() {
  const [state, setState] = useState<AssetState>({ count: 0, archives: [], snapshots: [] })
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<{ count: number; rows: AssetEntry[] }>({ count: 0, rows: [] })
  const [entry, setEntry] = useState<AssetEntry>()
  const [format, setFormat] = useState<AssetFormat>('json')
  const [preview, setPreview] = useState<{ format: AssetFormat; value: string; name: string }>()
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const comparing = query.mode === 'new' || query.mode === 'modified'

  useEffect(() => {
    let active = true
    window.api.workbenchAssetState().then(s => { if (active) setState(s) })
      .catch(error => { if (active) setMessage(String(error)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    if (comparing && !query.snapshot) {
      setResult({ count: 0, rows: [] })
      return
    }
    const timer = setTimeout(() => {
      window.api.workbenchAssetQuery(query).then(value => { if (active) setResult(value) })
        .catch(error => { if (active) { setMessage(String(error)); setResult({ count: 0, rows: [] }) } })
    }, 100)
    return () => { active = false; clearTimeout(timer) }
  }, [state, query, comparing])

  useEffect(() => () => {
    if (preview && preview.format !== 'json') URL.revokeObjectURL(preview.value)
  }, [preview])

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label)
    setMessage('')
    try { await work() } catch (error) { setMessage(String(error)) } finally { setBusy('') }
  }

  function update(patch: Partial<AssetQuery>) {
    setQuery(q => ({ ...q, page: 0, ...patch }))
    setEntry(undefined)
    setPreview(undefined)
    setMessage('')
  }

  async function show() {
    if (!entry || format === 'raw') return
    setPreview(undefined)
    const { name, bytes } = await window.api.workbenchAssetPreview(entry, format)
    if (format === 'model') await import('@google/model-viewer')
    const value = format === 'json' ? new TextDecoder().decode(bytes)
      : URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: format === 'model' ? 'model/gltf-binary' : 'image/png' }))
    setPreview({ name, format, value })
  }

  return <fieldset disabled={!!busy} className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <label className="library-search basis-48">
        <Search size={17} aria-hidden="true" />
        <Input type="search" placeholder="搜索资源路径" aria-label="搜索资源路径"
          value={query.search} onChange={e => update({ search: e.target.value })} />
      </label>
      <WorkbenchSelect label="加载模式" className="w-auto" disabled={!!busy} options={Object.entries(modes)}
        value={query.mode} onValueChange={mode => update({ mode: mode as AssetMode })} />
      <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="outline" disabled={!state.count} onClick={() => run('正在保存快照……', async () => {
          const s = await window.api.workbenchAssetSnapshot()
          setState(s)
          update({ snapshot: s.snapshots[0] })
          setMessage('已保存当前索引快照。')
        })}>保存快照</Button>
        <Button onClick={() => run('正在扫描游戏容器……', async () => {
          setState(await window.api.workbenchAssetIndex())
          update({})
        })}>{state.count ? '重建索引' : '建立索引'}</Button>
      </div>
    </div>
    {query.mode === 'multiple' && state.archives.length > 0 && (
      <div role="group" aria-label="按容器筛选" className="workbench-panel flex flex-wrap gap-3 p-4 text-sm">
        {state.archives.map(archive => <label key={archive} className="flex min-w-0 items-center gap-2 break-all">
          <input type="checkbox" checked={query.archives.includes(archive)} onChange={e => update({ archives: e.target.checked
            ? [...query.archives, archive] : query.archives.filter(a => a !== archive) })} />{archive}
        </label>)}
      </div>
    )}
    {comparing && <WorkbenchSelect label="对比快照" className="w-fit" disabled={!!busy}
      value={String(state.snapshots.indexOf(query.snapshot))}
      options={[
        ['-1', '选择对比快照'],
        ...state.snapshots.map((snapshot, index) => [String(index), snapshot.replace('.snapshot.json', '')] as const)
      ]}
      onValueChange={index => update({ snapshot: state.snapshots[Number(index)] ?? '' })} />}
    {(busy || message) && <p role="status" className="workbench-panel break-all px-4 py-3 text-sm">{busy || message}</p>}
    <div className="workbench-split">
      <section className="workbench-panel">
        <header className="workbench-panel-heading">
          <h2>资源列表</h2>
          <span className="text-xs font-normal text-muted-foreground">{result.count.toLocaleString()} 项</span>
        </header>
        {result.rows.length ? <ul className="max-h-[52vh] divide-y overflow-auto p-1">
          {result.rows.map(row => <li key={row.archive + '/' + row.path}>
            <Button type="button" variant="ghost"
              aria-pressed={entry?.path === row.path && entry.archive === row.archive}
              className="flex h-auto w-full flex-col items-start gap-1 border-0 px-3 py-2 text-left font-normal whitespace-normal focus-visible:outline-offset-0 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              onClick={() => {
                setEntry(row)
                setPreview(undefined)
                setMessage('')
                const name = row.path.split('/').pop() ?? ''
                setFormat(/^T_/i.test(name) ? 'texture' : /^(SK|SM)_/i.test(name) ? 'model'
                  : /\.(?:uasset|umap|json)$/i.test(name) ? 'json' : 'raw')
              }}>
              <span className="break-all">{row.path}</span>
              <small className="break-all text-xs text-muted-foreground">{row.archive} · {row.size.toLocaleString()} B</small>
            </Button>
          </li>)}
        </ul> : <div className="flex min-h-36 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
          <Package size={24} aria-hidden="true" />
          <p>{!state.count ? '建立索引后即可浏览游戏资源。'
            : comparing && !query.snapshot ? '选择旧快照以比较当前资源。' : '没有匹配的资源。'}</p>
        </div>}
        {result.count > assetPageSize && <footer className="flex flex-wrap items-center justify-between gap-2 border-t p-2 text-xs text-muted-foreground">
          <Button size="sm" variant="ghost" disabled={!query.page} onClick={() => update({ page: query.page - 1 })}>上一页</Button>
          {query.page + 1} ／ {Math.ceil(result.count / assetPageSize)}
          <Button size="sm" variant="ghost" disabled={(query.page + 1) * assetPageSize >= result.count}
            onClick={() => update({ page: query.page + 1 })}>下一页</Button>
        </footer>}
      </section>
      <section className="workbench-panel">
        <header className="workbench-panel-heading"><h2>资源预览</h2></header>
        <div className="grid gap-3 p-4">
          {entry ? <>
            <p className="break-all text-sm font-semibold">{entry.path.split('/').pop()}</p>
            <div className="flex flex-wrap gap-2">
              <WorkbenchSelect label="资源格式" className="w-auto" disabled={!!busy} options={Object.entries(formats)}
                value={format} onValueChange={value => {
                  setFormat(value as AssetFormat)
                  setPreview(undefined)
                  setMessage('')
                }} />
              <Button variant="secondary" disabled={format === 'raw'} onClick={() => run('正在读取资源……', show)}>预览</Button>
              <Button variant="outline" onClick={() => run('正在导出资源……', async () => {
                setMessage('导出目录：' + await window.api.workbenchAssetExport(entry, format))
              })}>导出</Button>
            </div>
          </> : <p className="py-2 text-sm text-muted-foreground">从资源列表选择要预览或导出的文件。</p>}
          {preview?.format === 'json' && <pre className="max-h-[48vh] overflow-auto rounded-md bg-muted/50 p-3 text-xs select-text">{preview.value}</pre>}
          {preview?.format === 'texture' && <img className="mx-auto max-h-96 max-w-full object-contain" src={preview.value} alt={preview.name} />}
          {preview?.format === 'model' && createElement('model-viewer', { src: preview.value, alt: preview.name, 'camera-controls': true,
            onError: () => setMessage('模型渲染失败。'), class: 'block h-80 w-full' })}
        </div>
      </section>
    </div>
  </fieldset>
}
