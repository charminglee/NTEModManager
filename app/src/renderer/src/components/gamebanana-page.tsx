import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, LoaderCircle, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import type {
  AppConfigData,
  GameBananaDownloadTask,
  GameBananaFile,
  GameBananaMod
} from '@shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import PromptDialog from './prompt-dialog'
import GameBananaCard from './gamebanana-card'
import GameBananaDownloadDrawer from './gamebanana-download-drawer'
import GameBananaDetail from './gamebanana-detail'
import { toast } from './toast-card'

interface Props {
  active: boolean
  visible: boolean
  config: AppConfigData
  onConfigChange: (config: AppConfigData) => void
  onModsChanged: () => void
}

interface DownloadTarget {
  mod: GameBananaMod
  file: GameBananaFile
}

export default function GameBananaPage({ active, visible, config, onConfigChange, onModsChanged }: Props) {
  const [mods, setMods] = useState<GameBananaMod[]>([])
  const [selected, setSelected] = useState<GameBananaMod | null>(null)
  const lastSelectedRef = useRef<GameBananaMod | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tasks, setTasks] = useState<GameBananaDownloadTask[]>([])
  const [downloadMarks, setDownloadMarks] = useState<Record<string, string>>({})
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null)
  const [now, setNow] = useState(Date.now)
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
      setSelected((current) => (current && next.some((mod) => mod.id === current.id) ? current : null))
      nextPageRef.current = 2
      setHasMore(next.length > 0)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  const loadNextPage = async () => {
    if (!active || loading || loadingMoreRef.current || !hasMore) return
    const page = nextPageRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError('')
    try {
      const next = await window.api.listGameBananaMods(page)
      const existingIds = new Set(mods.map((mod) => mod.id))
      const newMods = next.filter((mod) => !existingIds.has(mod.id))
      setMods((current) => [...current, ...newMods])
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
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!active || loading || loadingMore || !hasMore) return
    const grid = modGridRef.current
    if (grid && grid.scrollHeight <= grid.clientHeight + 80) {
      void loadNextPage()
    }
  }, [active, hasMore, loading, loadingMore, mods.length])

  useEffect(() => {
    let active = true
    let downloadMarksChanged = false
    const unsubscribeMarks = window.api.onGameBananaDownloadMarksChanged((marks) => {
      downloadMarksChanged = true
      setDownloadMarks(marks)
    })
    void window.api.getGameBananaDownloadMarks().then((marks) => {
      if (active && !downloadMarksChanged) setDownloadMarks(marks)
    }).catch((loadError) => {
      if (active && !downloadMarksChanged) toast.error('读取下载标记失败', { description: String(loadError) })
    })
    void window.api.getGameBananaTasks().then((initial) => {
      if (active) setTasks(initial)
    })
    const unsubscribe = window.api.onGameBananaDownloadTask((task) => {
      if (task.source !== 'gamebanana') return
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
      unsubscribeMarks()
      unsubscribe()
    }
  }, [onModsChanged])

  const filteredMods = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return keyword.length === 0 ? mods : mods.filter((mod) => `${mod.name} ${mod.authors}`.toLowerCase().includes(keyword))
  }, [mods, search])

  const activeTaskCount = tasks.filter((task) => !['completed', 'failed'].includes(task.status)).length

  const openDetail = (mod: GameBananaMod) => {
    lastSelectedRef.current = mod
    setSelected(mod)
  }

  const openDownload = (mod: GameBananaMod, file: GameBananaFile) => {
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
            <p>浏览 Neverness To Everness 社区模组。</p>
          </div>
          <div className="gamebanana-heading-actions">
            <div className="library-search gamebanana-search">
              <Search size={17} />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模组或作者" />
            </div>
            <Button variant="secondary" onClick={() => void loadFirstPage()} disabled={loading || loadingMore} size="icon">
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </header>

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
                <GameBananaCard
                  key={mod.id}
                  mod={mod}
                  selected={selected?.id === mod.id}
                  active={active && visible}
                  now={now}
                  onOpen={openDetail}
                  onDownload={openDownload}
                />
              ))}
              <div className="gamebanana-load-more" role="status" aria-live="polite">
                {loadMoreError ? (
                  <>
                    <span className="gamebanana-error">加载更多模组失败：{loadMoreError}</span>
                    <Button size="sm" variant="secondary" onClick={() => void loadNextPage()}>重试</Button>
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
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            <Download />下载列表{activeTaskCount > 0 ? `  ·  ${activeTaskCount}` : ''}
          </Button>
        </div>
      </div>

      {lastSelectedRef.current && (
        <GameBananaDetail
          key={lastSelectedRef.current.id}
          initial={lastSelectedRef.current}
          lastDownloadedFileId={downloadMarks[lastSelectedRef.current.id]}
          open={active && selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
          onDownload={openDownload}
        />
      )}
      <GameBananaDownloadDrawer open={active && visible && drawerOpen} tasks={tasks} onClose={() => setDrawerOpen(false)} />
      <PromptDialog
        open={active && downloadTarget !== null}
        title="下载 GameBanana 模组"
        description={downloadTarget ? `即将下载 ${downloadTarget.file.name} ，请输入保存到模组库的名称：` : undefined}
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
