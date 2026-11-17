import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, LoaderCircle, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import type {
  AppConfigData,
  GameBananaDownloadTask,
  GameBananaFile,
  GameBananaMod
} from '@shared/types'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
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
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tasks, setTasks] = useState<GameBananaDownloadTask[]>([])
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null)
  const modGridRef = useRef<HTMLElement>(null)
  const nextPageRef = useRef(1)
  const loadingMoreRef = useRef(false)

  const loadFirstPage = async () => {
    if (loadingMoreRef.current) return
    setLoading(true)
    setError('')
    setLoadMoreError('')
    setHasMore(true)
    nextPageRef.current = 1
    if (modGridRef.current) {
      modGridRef.current.scrollTop = 0
    }
    try {
      const next = await window.api.listGameBananaMods(1)
      setMods(next)
      setSelected((current) => (current && next.some((mod) => mod.id === current.id) ? current : next[0] ?? null))
      nextPageRef.current = 2
      setHasMore(next.length > 0)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  const loadNextPage = async () => {
    if (loadingMoreRef.current || !hasMore) return
    const page = nextPageRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const next = await window.api.listGameBananaMods(page)
      const existingIds = new Set(mods.map((mod) => mod.id))
      const newMods = next.filter((mod) => !existingIds.has(mod.id))
      setMods((current) => [...current, ...newMods])
      setSelected((current) => current ?? newMods[0] ?? null)
      nextPageRef.current = page + 1
      setHasMore(next.length > 0 && newMods.length > 0)
    } catch (loadError) {
      setLoadMoreError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadFirstPage()
  }, [])

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return
    const grid = modGridRef.current
    if (grid && grid.scrollHeight <= grid.clientHeight + 80) {
      void loadNextPage()
    }
  }, [hasMore, loading, loadingMore, mods.length])

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
            <h1>GameBanana</h1>
            <p>浏览 Neverness To Everness 社区模组，下载后自动进入 NTEMM 模组库。</p>
          </div>
          <div className="gamebanana-heading-actions">
            <Button variant="outline" onClick={() => void loadFirstPage()} disabled={loading || loadingMore} size="icon">
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </header>

        <div className="gamebanana-toolbar">
          <div className="library-search gamebanana-search">
            <Search size={17} />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索已加载模组或作者" />
          </div>
          <span className="gamebanana-page-label">已加载 {mods.length} 个模组</span>
        </div>

        {error ? (
          <div className="gamebanana-state gamebanana-error">
            <TriangleAlert size={36} />
            <strong>GameBanana 加载失败</strong>
            <span>{error}</span>
            <Button onClick={() => void loadFirstPage()}>重试</Button>
          </div>
        ) : loading ? (
          <div className="gamebanana-state"><LoaderCircle className="animate-spin" size={38} /><span>正在读取 GameBanana 模组……</span></div>
        ) : filteredMods.length === 0 ? (
          <div className="gamebanana-state"><Search size={36} /><strong>没有匹配的模组</strong><span>换一个关键词试试。</span></div>
        ) : (
          <div className="gamebanana-layout">
            <section
              ref={modGridRef}
              className="gamebanana-mod-grid"
              aria-label="GameBanana 模组列表"
              onScroll={(event) => {
                const element = event.currentTarget
                if (element.scrollHeight - element.scrollTop - element.clientHeight < 240) {
                  void loadNextPage()
                }
              }}
            >
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
              <div className="gamebanana-load-more" role="status" aria-live="polite">
                {loadMoreError ? (
                  <>
                    <span className="gamebanana-error">加载更多模组失败：{loadMoreError}</span>
                    <Button size="sm" variant="outline" onClick={() => void loadNextPage()}>重试</Button>
                  </>
                ) : loadingMore ? (
                  <><LoaderCircle className="animate-spin" size={15} />正在加载更多模组……</>
                ) : hasMore ? (
                  '继续下滑加载更多'
                ) : (
                  '已加载全部模组'
                )}
              </div>
            </section>

          </div>
        )}

        <div className="gamebanana-page-footer">
          <Button className="gamebanana-queue-button" onClick={() => setDrawerOpen(true)}>
            <Download />下载列表{activeTaskCount > 0 ? ` · ${activeTaskCount}` : ''}
          </Button>
        </div>
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="gamebanana-detail-dialog">
          {selected && (
            <div className="gamebanana-detail" aria-label="GameBanana 模组详情">
              {selected.previewUrl ? <img className="gamebanana-detail-image" src={selected.previewUrl} alt="" /> : null}
              <div className="gamebanana-detail-body">
                <DialogHeader className="gamebanana-detail-dialog-header">
                  <span className="eyebrow">MOD #{selected.id}</span>
                  <DialogTitle>{selected.name}</DialogTitle>
                  <DialogDescription className="gamebanana-detail-byline">
                    {selected.authors} · 更新于 {formatUpdatedAt(selected.updatedAt)}
                  </DialogDescription>
                </DialogHeader>
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
            </div>
          )}
        </DialogContent>
      </Dialog>
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
