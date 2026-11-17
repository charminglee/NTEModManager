import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, LoaderCircle, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import type {
  AppConfigData,
  GameBananaDownloadTask,
  GameBananaFile,
  GameBananaMod
} from '@shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import PromptDialog from './prompt-dialog'
import GameBananaDownloadDrawer from './gamebanana-download-drawer'
import { formatFileSize } from '@/lib/format'
import { toast } from './toast-card'

interface Props {
  config: AppConfigData
  onConfigChange: (config: AppConfigData) => void
  onModsChanged: () => void
}

interface DownloadTarget {
  mod: GameBananaMod
  file: GameBananaFile
}

function formatUpdatedAt(timestamp: number): string {
  if (!timestamp) return '更新时间未知'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(timestamp * 1000)
  )
}

function shortNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export default function GameBananaPage({ config, onConfigChange, onModsChanged }: Props) {
  const [mods, setMods] = useState<GameBananaMod[]>([])
  const [selected, setSelected] = useState<GameBananaMod | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tasks, setTasks] = useState<GameBananaDownloadTask[]>([])
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null)

  const loadMods = async (nextPage = page) => {
    setLoading(true)
    setError('')
    try {
      const next = await window.api.listGameBananaMods(nextPage)
      setMods(next)
      setSelected((current) => (current && next.some((mod) => mod.id === current.id) ? current : next[0] ?? null))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMods(1)
  }, [])

  useEffect(() => {
    let active = true
    void window.api.getGameBananaTasks().then((initial) => {
      if (active) setTasks(initial)
    })
    const unsubscribe = window.api.onGameBananaDownloadTask((task) => {
      setTasks((current) => {
        const index = current.findIndex((item) => item.id === task.id)
        if (index < 0) return [...current, task]
        const next = [...current]
        next[index] = task
        return next
      })
      if (task.status === 'completed') {
        onModsChanged()
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [onModsChanged])

  const filteredMods = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return keyword.length === 0 ? mods : mods.filter((mod) => `${mod.name} ${mod.authors}`.toLowerCase().includes(keyword))
  }, [mods, search])

  const activeTaskCount = tasks.filter((task) => !['completed', 'failed'].includes(task.status)).length

  const openDownload = (mod: GameBananaMod, file = mod.files[0]) => {
    if (!file) {
      toast.warning('这个模组没有可下载文件')
      return
    }
    setDownloadTarget({ mod, file })
  }

  const updateInstallPreference = (checked: boolean) => {
    const next = { ...config, gameBananaInstallAfterDownload: checked }
    onConfigChange(next)
    void window.api.updateConfig({ gameBananaInstallAfterDownload: checked }).catch((saveError) => {
      toast.error('保存下载偏好失败', { description: String(saveError) })
    })
  }

  const startDownload = async (name: string) => {
    const target = downloadTarget
    setDownloadTarget(null)
    if (!target) return
    try {
      await window.api.startGameBananaDownload(
        target.mod.id,
        target.file.id,
        name,
        config.gameBananaInstallAfterDownload
      )
      setDrawerOpen(true)
    } catch (downloadError) {
      toast.error('下载任务创建失败', { description: downloadError instanceof Error ? downloadError.message : String(downloadError) })
    }
  }

  return (
    <main className="gamebanana-page">
      <div className="gamebanana-main-column">
        <header className="workspace-page-heading gamebanana-heading">
          <div>
            <span className="eyebrow">COMMUNITY MODS / NTE</span>
            <h1>GameBanana</h1>
            <p>浏览 Neverness To Everness 社区模组，下载后自动进入 NTEMM 模组库。</p>
          </div>
          <div className="gamebanana-heading-actions">
            <Button variant="outline" onClick={() => void loadMods(page)} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              刷新
            </Button>
          </div>
        </header>

        <div className="gamebanana-toolbar">
          <div className="library-search gamebanana-search">
            <Search size={17} />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索当前页模组或作者" />
          </div>
          <span className="gamebanana-page-label">第 {page} 页 · {mods.length} 个模组</span>
        </div>

        {error ? (
          <div className="gamebanana-state gamebanana-error">
            <TriangleAlert size={36} />
            <strong>GameBanana 加载失败</strong>
            <span>{error}</span>
            <Button onClick={() => void loadMods(page)}>重试</Button>
          </div>
        ) : loading ? (
          <div className="gamebanana-state"><LoaderCircle className="animate-spin" size={38} /><span>正在读取 GameBanana 模组……</span></div>
        ) : filteredMods.length === 0 ? (
          <div className="gamebanana-state"><Search size={36} /><strong>没有匹配的模组</strong><span>换一个关键词试试。</span></div>
        ) : (
          <div className="gamebanana-layout">
            <section className="gamebanana-mod-grid" aria-label="GameBanana 模组列表">
              {filteredMods.map((mod) => (
                <button
                  type="button"
                  className={`gamebanana-mod-card ${selected?.id === mod.id ? 'is-selected' : ''}`}
                  key={mod.id}
                  onClick={() => setSelected(mod)}
                >
                  {mod.previewUrl ? <img src={mod.previewUrl} alt="" /> : <div className="gamebanana-card-placeholder"><Download /></div>}
                  <div className="gamebanana-card-copy">
                    <strong>{mod.name}</strong>
                    <span>{mod.authors} · {formatUpdatedAt(mod.updatedAt)}</span>
                    <small>{shortNumber(mod.downloads)} 下载 · {shortNumber(mod.likes)} 喜欢</small>
                  </div>
                </button>
              ))}
            </section>

            {selected && (
              <aside className="gamebanana-detail" aria-label="GameBanana 模组详情">
                {selected.previewUrl ? <img className="gamebanana-detail-image" src={selected.previewUrl} alt="" /> : null}
                <div className="gamebanana-detail-body">
                  <span className="eyebrow">MOD #{selected.id}</span>
                  <h2>{selected.name}</h2>
                  <p className="gamebanana-detail-byline">{selected.authors} · 更新于 {formatUpdatedAt(selected.updatedAt)}</p>
                  <p className="gamebanana-description">{selected.description || '作者没有提供描述。'}</p>
                  <div className="gamebanana-stats">
                    <span><strong>{shortNumber(selected.downloads)}</strong>下载</span>
                    <span><strong>{shortNumber(selected.likes)}</strong>喜欢</span>
                    <span><strong>{shortNumber(selected.views)}</strong>浏览</span>
                  </div>
                  <div className="gamebanana-file-list">
                    <h3>可下载文件</h3>
                    {selected.files.length === 0 ? <p>暂无可下载文件。</p> : selected.files.map((file) => (
                      <div className="gamebanana-file-row" key={file.id}>
                        <div><strong>{file.name}</strong><span>{formatFileSize(file.sizeBytes)} · {shortNumber(file.downloadCount)} 次下载</span></div>
                        <Button size="sm" onClick={() => openDownload(selected, file)}><Download />下载</Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" className="gamebanana-open-button" onClick={() => void window.api.openExternal(selected.profileUrl)}>
                    <ExternalLink />打开 GameBanana 页面
                  </Button>
                </div>
              </aside>
            )}
          </div>
        )}

        <div className="gamebanana-page-footer">
          <Button variant="outline" onClick={() => { setPage((value) => Math.max(1, value - 1)); void loadMods(Math.max(1, page - 1)) }} disabled={page <= 1 || loading}>上一页</Button>
          <Button variant="outline" onClick={() => { setPage((value) => value + 1); void loadMods(page + 1) }} disabled={loading}>下一页</Button>
          <Button className="gamebanana-queue-button" onClick={() => setDrawerOpen(true)}>
            <Download />下载列表{activeTaskCount > 0 ? ` · ${activeTaskCount}` : ''}
          </Button>
        </div>
      </div>

      <GameBananaDownloadDrawer open={drawerOpen} tasks={tasks} onClose={() => setDrawerOpen(false)} />
      <PromptDialog
        open={downloadTarget !== null}
        title="下载 GameBanana 模组"
        description={downloadTarget ? `文件：${downloadTarget.file.name}。请输入保存到模组库的名称。` : undefined}
        label="模组名称："
        initialValue={downloadTarget?.mod.name ?? ''}
        confirmText="开始下载"
        installAfterDownload={config.gameBananaInstallAfterDownload}
        onInstallAfterDownloadChange={updateInstallPreference}
        onCancel={() => setDownloadTarget(null)}
        onConfirm={(name) => void startDownload(name)}
      />
    </main>
  )
}
