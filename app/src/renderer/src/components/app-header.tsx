import { Fragment } from 'react'
import { FileText, LoaderCircle, Package, Play, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HeaderModActions } from './header-mod-actions'
import gamebananaIcon from '@/assets/gamebanana.png'
import ayakamodsIcon from '@/assets/ayakamods.png'

function GameBananaLogo({ size = 19 }: { size?: number }) {
  return (
    <img
      className="gamebanana-nav-icon"
      src={gamebananaIcon}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  )
}
function AyakaModsLogo({ size = 19 }: { size?: number }) {
  return (
    <img
      className="ayakamods-icon"
      src={ayakamodsIcon}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  )
}
export type AppView = 'mods' | 'gamebanana' | 'ayakamods' | 'logs' | 'settings'
interface Props {
  view: AppView
  busy: boolean
  activity: string
  hasGamePath: boolean
  isFullScreen: boolean
  onNavigate: (view: AppView) => void
  onLaunch: () => void
  onImport: () => void
  onPackageMod: () => void
}
export default function AppHeader({
  view,
  busy,
  activity,
  hasGamePath,
  isFullScreen,
  onNavigate,
  onLaunch,
  onImport,
  onPackageMod
}: Props) {
  return (
    <header className="app-header">
      {!isFullScreen && (
        <div className="brand-strip">
          <span className="brand-wordmark">NTEMM</span>
          <span className="brand-slash" />
          <span>异环模组管理器</span>
          <span className="barcode" aria-hidden />
        </div>
      )}
      <div className="global-toolbar">
        <nav aria-label="主导航">
          {(
            [
              { id: 'mods', label: '模组库', Icon: Package },
              { id: 'gamebanana', label: 'GameBanana', Icon: GameBananaLogo },
              { id: 'ayakamods', label: 'AyakaMods', Icon: AyakaModsLogo },
              { id: 'logs', label: '运行日志', Icon: FileText },
              { id: 'settings', label: '设置', Icon: Settings }
            ] as const
          ).map(({ id, label, Icon }) => (
            <Fragment key={id}>
              {(id === 'gamebanana' || id === 'logs') && (
                <span className="header-action-divider" aria-hidden="true" />
              )}
              <button
                type="button"
                className={cn('global-nav-item', view === id && 'is-active')}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon size={19} />
                {label}
              </button>
            </Fragment>
          ))}
        </nav>
        <HeaderModActions busy={busy} onImport={onImport} onPackageMod={onPackageMod} />
        <button
          type="button"
          className="launch-button"
          disabled={busy || !hasGamePath}
          onClick={onLaunch}
        >
          <svg
            className="launch-city"
            viewBox="0 0 1440 100"
            preserveAspectRatio="xMinYMax meet"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <g id="launch-cityscape">
                <g fill="currentColor">
                  <path d="M0 95h720v5H0zM6 78h24v17H6zM36 64h23v31H36zM64 82h18v13H64zM88 46h27v49H88zM95 28h13v20H95zM99 12h5v20h-5zM123 73h24v22h-24zM154 57h24v38h-24zM161 39h10v19h-10zM183 80h16v15h-16zM206 28h8v67h-8zM203 44h14v4h-14zM207 14h6v18h-6zM209 2h2v14h-2zM227 62h29v33h-29zM264 74h18v21h-18z" />
                  <path d="M288 75h70v4h-70zM300 35h4v60h-4zM340 35h4v60h-4z" />
                  <path d="M365 81h25v14h-25zM397 60h22v35h-22zM403 46h10v14h-10zM427 72h18v23h-18zM453 35h30v60h-30zM459 26h18v9h-18zM467 12h3v14h-3zM491 77h23v18h-23zM522 55h26v40h-26zM529 43h12v12h-12zM556 69h20v26h-20zM584 47h29v48h-29zM590 37h17v10h-17zM620 78h20v17h-20zM650 57h24v38h-24zM657 41h10v16h-10zM683 73h25v22h-25z" />
                </g>
                <path
                  d="M288 75Q296 66 302 37Q322 83 342 37Q348 66 358 75M294 65v10M310 52v23M318 59v16M326 59v16M334 52v23M352 67v8"
                  stroke="currentColor"
                  strokeWidth={2}
                />
              </g>
            </defs>
            <g>
              <use href="#launch-cityscape" />
              <use href="#launch-cityscape" x="720" />
            </g>
          </svg>
          <Play className="launch-icon" size={17} />
          <span className="launch-text">启动游戏</span>
        </button>
      </div>
      {busy && (
        <div className="operation-progress" role="status">
          <LoaderCircle className="animate-spin" size={15} />
          <span>{activity || '操作进行中，请稍候…'}</span>
        </div>
      )}
    </header>
  )
}
