import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { AppConfigData, AyakaModsDownloadRequest, GameBananaDownloadTask } from '@shared/types'
import ayakamodsIcon from '@/assets/ayakamods.png'
import { Button } from './ui/button'
import PromptDialog from './prompt-dialog'
import GameBananaDownloadDrawer from './gamebanana-download-drawer'
import { toast } from './toast-card'
import './ayakamods-page.css'

const COMMUNITY_URL = 'https://ayakamods.com/games/neverness-to-everness.417/'
const RUNS_IN_ELECTRON = navigator.userAgent.includes('Electron')

interface WebviewElement extends HTMLElement {
  reload: () => void
}

interface WebviewLoadFailure extends Event {
  errorCode: number
  errorDescription: string
  isMainFrame: boolean
}

interface Props {
  active: boolean
  visible: boolean
  config: AppConfigData
  onConfigChange: (config: AppConfigData) => void
  onModsChanged: () => void
}

export default function AyakaModsPage({ active, visible, config, onConfigChange, onModsChanged }: Props) {
  const webviewRef = useRef<WebviewElement>(null)
  const [loading, setLoading] = useState(RUNS_IN_ELECTRON)
  const [error, setError] = useState('')
  const [requests, setRequests] = useState<AyakaModsDownloadRequest[]>([])
  const [tasks, setTasks] = useState<GameBananaDownloadTask[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const startingRef = useRef(false)
  const target = requests[0]

  useEffect(() => {
    let mounted = true
    const unsubscribeRequest = window.api.onAyakaModsDownloadRequest((request) => {
      setRequests((current) => current.some((item) => item.id === request.id) ? current : [...current, request])
    })
    const unsubscribeTask = window.api.onGameBananaDownloadTask((task) => {
      if (task.source !== 'ayakamods') return
      setTasks((current) => [...current.filter((item) => item.id !== task.id), task])
      if (task.status === 'completed') onModsChanged()
    })
    void Promise.all([window.api.getAyakaModsPendingDownloads(), window.api.getAyakaModsTasks()]).then(([initialRequests, initialTasks]) => {
      if (!mounted) return
      setRequests((current) => [...initialRequests.filter((item) => !current.some((request) => request.id === item.id)), ...current])
      setTasks((current) => [...initialTasks.filter((item) => !current.some((task) => task.id === item.id)), ...current])
    }).catch((loadError) => toast.error('读取 AyakaMods 下载任务失败', { description: String(loadError) }))
    return () => {
      mounted = false
      unsubscribeRequest()
      unsubscribeTask()
    }
  }, [onModsChanged])

  const updateInstallPreference = (checked: boolean) => {
    onConfigChange({ ...config, gameBananaInstallAfterDownload: checked })
    void window.api.updateConfig({ gameBananaInstallAfterDownload: checked }).catch((saveError) => {
      toast.error('保存下载偏好失败', { description: String(saveError) })
    })
  }

  const startDownload = async (name: string) => {
    if (!target || startingRef.current) return
    startingRef.current = true
    try {
      await window.api.startAyakaModsDownload(target.id, name, config.gameBananaInstallAfterDownload)
      setRequests((current) => current.filter((item) => item.id !== target.id))
      setDrawerOpen(true)
    } catch (downloadError) {
      toast.error('下载任务创建失败', { description: String(downloadError) })
    } finally {
      startingRef.current = false
    }
  }

  const cancelDownload = async () => {
    if (!target || startingRef.current) return
    try {
      await window.api.cancelAyakaModsDownload(target.id)
      setRequests((current) => current.filter((item) => item.id !== target.id))
    } catch (cancelError) {
      toast.error('取消下载失败', { description: String(cancelError) })
    }
  }

  useEffect(() => {
    if (!RUNS_IN_ELECTRON) return
    const webview = webviewRef.current
    if (!webview) return

    const handleStart = () => {
      setLoading(true)
      setError('')
    }
    const handleStop = () => setLoading(false)
    const handleFailure = (event: Event) => {
      const failure = event as WebviewLoadFailure
      if (!failure.isMainFrame || failure.errorCode === -3) return
      setLoading(false)
      setError(failure.errorDescription || 'AyakaMods 页面加载失败。')
    }

    webview.addEventListener('did-start-loading', handleStart)
    webview.addEventListener('did-stop-loading', handleStop)
    webview.addEventListener('did-fail-load', handleFailure)
    return () => {
      webview.removeEventListener('did-start-loading', handleStart)
      webview.removeEventListener('did-stop-loading', handleStop)
      webview.removeEventListener('did-fail-load', handleFailure)
    }
  }, [])

  const reload = () => {
    webviewRef.current?.reload()
  }

  return (
    <main className="ayakamods-page gamebanana-main-column">
      <header className="workspace-page-heading gamebanana-heading">
        <div>
          <h1>AyakaMods</h1>
          <p
            className={error ? 'ayakamods-heading-error' : undefined}
            role={error ? 'alert' : 'status'}
            aria-live="polite"
            title={error || undefined}
          >
            浏览社区模组，点击站内下载即可导入模组库。
          </p>
        </div>
        {RUNS_IN_ELECTRON && (
          <div className="gamebanana-heading-actions">
            <Button variant="outline" size="icon" onClick={reload} aria-label="刷新">
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        )}
      </header>
      <div className="ayakamods-browser" {...(target || drawerOpen ? { inert: '' } : {})}>
        <div className="ayakamods-browser-frame">
          {RUNS_IN_ELECTRON ? (
            <webview
              ref={webviewRef}
              title="AyakaMods 模组社区"
              className={`ayakamods-webview ${visible ? '' : 'is-hidden'}`}
              src={COMMUNITY_URL}
              partition="persist:ayakamods"
              allowpopups=""
            />
          ) : (
            <div className="ayakamods-preview">
              <div className="ayakamods-preview-content">
                <span className="ayakamods-preview-icon">
                  <img className="ayakamods-icon" src={ayakamodsIcon} width={32} height={32} alt="" aria-hidden="true" />
                </span>
                <h2>AyakaMods 社区浏览</h2>
                <p>AyakaMods 禁止其他站点通过普通网页框架嵌入。桌面版会在此区域内嵌浏览，浏览器开发模式仅展示入口。</p>
                <span className="ayakamods-preview-url">{COMMUNITY_URL}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="gamebanana-page-footer">
        <Button onClick={() => setDrawerOpen(true)}>
          <Download />下载列表{tasks.some((task) => !['completed', 'failed'].includes(task.status))
            ? `  ·  ${tasks.filter((task) => !['completed', 'failed'].includes(task.status)).length}` : ''}
        </Button>
      </div>
      <GameBananaDownloadDrawer open={visible && drawerOpen && !target} tasks={tasks} onClose={() => setDrawerOpen(false)} />
      <PromptDialog
        open={active && target !== undefined}
        title="下载 AyakaMods 模组"
        description={target ? `即将下载 ${target.fileName}，请输入保存到模组库的名称：` : undefined}
        initialValue={target?.fileName.replace(/\.(zip|rar|7z)$/i, '') ?? ''}
        confirmText="开始下载"
        installAfterDownload={config.gameBananaInstallAfterDownload}
        onInstallAfterDownloadChange={updateInstallPreference}
        onCancel={() => void cancelDownload()}
        onConfirm={(name) => void startDownload(name)}
      />
    </main>
  )
}
