import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ayakamodsIcon from '@/assets/ayakamods.png'
import { Button } from './ui/button'
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
  visible: boolean
}

export default function AyakaModsPage({ visible }: Props) {
  const webviewRef = useRef<WebviewElement>(null)
  const [loading, setLoading] = useState(RUNS_IN_ELECTRON)
  const [error, setError] = useState('')

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
            浏览 Neverness To Everness 社区模组。
          </p>
        </div>
        {RUNS_IN_ELECTRON && (
          <div className="gamebanana-heading-actions">
            <Button variant="outline" size="icon" onClick={reload} aria-label="刷新" title="刷新">
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        )}
      </header>
      <div className="ayakamods-browser">
        <div className="ayakamods-browser-frame">
          {RUNS_IN_ELECTRON ? (
            <webview
              ref={webviewRef}
              title="AyakaMods 模组社区"
              className={`ayakamods-webview ${visible ? '' : 'is-hidden'}`}
              src={COMMUNITY_URL}
              partition="persist:ayakamods"
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
    </main>
  )
}
