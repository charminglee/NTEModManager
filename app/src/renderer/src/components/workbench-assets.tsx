import { createElement, useEffect, useState } from 'react'
import { Button } from './ui/button'
import { assetPageSize, type AssetEntry, type AssetFormat, type AssetMode, type AssetQuery, type AssetState } from '@shared/workbench-assets'

const modes: Record<AssetMode, string> = {
  all: '全部资源', multiple: '选择容器', new: '新增资源', modified: '已修改资源', unpatched: '排除已被覆盖的资源'
}
const formats: Record<AssetFormat, string> = { json: 'JSON 属性', texture: 'PNG 贴图', model: 'GLB 模型', raw: '容器原始文件' }
const initialQuery: AssetQuery = { mode: 'all', archives: [], snapshot: '', search: '', page: 0 }
const field = 'h-9 rounded-md border bg-background px-2 text-sm'

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

  return <section className="mx-auto grid w-full max-w-6xl gap-4 p-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">原生资源</h2>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!state.count || !!busy} onClick={() => run('正在保存快照……', async () => {
          const s = await window.api.workbenchAssetSnapshot()
          setState(s)
          update({ snapshot: s.snapshots[0] })
          setMessage('已保存当前索引快照。')
        })}>保存快照</Button>
        <Button size="sm" disabled={!!busy} onClick={() => run('正在扫描游戏容器……', async () => {
          setState(await window.api.workbenchAssetIndex())
          update({})
        })}>{state.count ? '重建索引' : '建立索引'}</Button>
      </div>
    </header>
    <fieldset disabled={!!busy} className="grid min-w-0 gap-3">
      <div className="flex flex-wrap gap-2">
        <select className={field} aria-label="加载模式" value={query.mode} onChange={e => update({ mode: e.target.value as AssetMode })}>
          {Object.entries(modes).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>
        <input type="search" className={field + ' min-w-40 flex-1'} placeholder="搜索资源路径" aria-label="搜索资源路径"
          value={query.search} onChange={e => update({ search: e.target.value })} />
      </div>
      {query.mode === 'multiple' && <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs">
        {state.archives.map(archive => <label key={archive} className="flex items-center gap-1"><input type="checkbox"
          checked={query.archives.includes(archive)} onChange={e => update({ archives: e.target.checked
            ? [...query.archives, archive] : query.archives.filter(a => a !== archive) })} />{archive}</label>)}
      </div>}
      {comparing && <select aria-label="对比快照" className={field} value={query.snapshot} onChange={e => update({ snapshot: e.target.value })}>
        <option value="">选择对比快照</option>
        {state.snapshots.map(s => <option key={s} value={s}>{s.replace('.snapshot.json', '')}</option>)}
      </select>}
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <section className="min-w-0 rounded-lg border bg-card">
          <header className="border-b px-3 py-2 text-sm font-semibold">资源列表 · {result.count.toLocaleString()}</header>
          <div className="max-h-[48vh] min-h-28 overflow-auto">
            {result.rows.map(row => <button key={row.archive + '/' + row.path} type="button"
              aria-pressed={entry?.path === row.path && entry.archive === row.archive}
              className="block w-full border-b px-3 py-2 text-left hover:bg-secondary aria-pressed:bg-accent"
              onClick={() => {
                setEntry(row)
                setPreview(undefined)
                setMessage('')
                const name = row.path.split('/').pop() ?? ''
                setFormat(/^T_/i.test(name) ? 'texture' : /^(SK|SM)_/i.test(name) ? 'model'
                  : /\.(?:uasset|umap|json)$/i.test(name) ? 'json' : 'raw')
              }}>
              <span className="block break-all text-sm">{row.path}</span>
              <small className="text-muted-foreground">{row.archive} · {row.size.toLocaleString()} B</small>
            </button>)}
            {!result.count && <p className="p-4 text-sm text-muted-foreground">{!state.count ? '建立索引后可浏览已配置游戏目录中的资源。'
              : comparing && !query.snapshot ? '选择旧快照以比较当前资源。' : '没有匹配的资源。'}</p>}
          </div>
          {result.count > assetPageSize && <footer className="flex items-center justify-between p-2 text-sm">
            <Button size="sm" variant="ghost" disabled={!query.page} onClick={() => update({ page: query.page - 1 })}>上一页</Button>
            {query.page + 1} ／ {Math.ceil(result.count / assetPageSize)}
            <Button size="sm" variant="ghost" disabled={(query.page + 1) * assetPageSize >= result.count}
              onClick={() => update({ page: query.page + 1 })}>下一页</Button>
          </footer>}
        </section>
        <section className="min-w-0 rounded-lg border bg-card p-3">
          <h3 className="break-all text-sm font-semibold">{entry?.path.split('/').pop() ?? '资源预览'}</h3>
          {entry ? <div className="mt-3 flex flex-wrap gap-2">
            <select aria-label="资源格式" className={field} value={format} onChange={e => {
              setFormat(e.target.value as AssetFormat); setPreview(undefined); setMessage('')
            }}>{Object.entries(formats).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>
            <Button variant="secondary" disabled={format === 'raw'} onClick={() => run('正在读取资源……', show)}>预览</Button>
            <Button variant="outline" onClick={() => run('正在导出资源……', async () => {
              setMessage('导出目录：' + await window.api.workbenchAssetExport(entry, format))
            })}>导出</Button>
          </div> : <p className="mt-2 text-sm text-muted-foreground">选择资源以查看内容或导出文件。</p>}
          {preview?.format === 'json' && <pre className="mt-3 max-h-[48vh] overflow-auto text-xs">{preview.value}</pre>}
          {preview?.format === 'texture' && <img className="mx-auto mt-3 max-h-96 max-w-full object-contain" src={preview.value} alt={preview.name} />}
          {preview?.format === 'model' && createElement('model-viewer', { src: preview.value, alt: preview.name, 'camera-controls': true,
            onError: () => setMessage('模型渲染失败。'), style: { width: '100%', height: '340px' } })}
        </section>
      </div>
    </fieldset>
    <p role="status" className="break-all text-sm">{busy || message}</p>
  </section>
}
