import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Globe, RefreshCw } from 'lucide-react'
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

  const openExternal = () => {
    void window.api.openExternal(COMMUNITY_URL).then((result) => {
      if (!result.success) setError(result.message)
    })
  }

  const reload = () => {
    webviewRef.current?.reload()
  }

  return (
    <main className="ayakamods-page">
      <header className="workspace-page-heading ayakamods-heading">
        <div className="ayakamods-heading-copy">
          <span className="eyebrow">AYAKAMODS COMMUNITY</span>
          <h1>AyakaMods</h1>
          <p
            className={`ayakamods-heading-status ${error ? 'is-error' : ''}`}
            role={error ? 'alert' : 'status'}
            aria-live="polite"
            title={error || undefined}
          >
            {error || (loading ? '正在载入 Neverness To Everness 模组社区……' : '浏览 Neverness To Everness 社区模组，页面内容由 AyakaMods 提供。')}
          </p>
        </div>
        <div className="ayakamods-heading-actions">
          {RUNS_IN_ELECTRON && (
            <Button variant="outline" onClick={reload}>
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              刷新
            </Button>
          )}
          <Button variant="outline" onClick={openExternal}>
            <ExternalLink />
            在浏览器打开
          </Button>
        </div>
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
                <span className="ayakamods-preview-icon"><Globe size={32} /></span>
                <h2>AyakaMods 社区浏览</h2>
                <p>AyakaMods 禁止其他站点通过普通网页框架嵌入。桌面版会在此区域内嵌浏览，浏览器开发模式仅展示入口。</p>
                <span className="ayakamods-preview-url">{COMMUNITY_URL}</span>
                <Button onClick={openExternal}>
                  <ExternalLink />
                  在浏览器打开
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
