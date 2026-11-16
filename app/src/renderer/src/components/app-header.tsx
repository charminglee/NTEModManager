import { FileText, LoaderCircle, Package, Play, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HeaderModActions } from './header-mod-actions'
export type AppView = 'mods' | 'logs' | 'settings'
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
              { id: 'logs', label: '运行日志', Icon: FileText },
              { id: 'settings', label: '设置', Icon: Settings }
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              className={cn('global-nav-item', view === id && 'is-active')}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={19} />
              {label}
            </button>
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
            viewBox="0 0 360 100"
            preserveAspectRatio="xMidYMax meet"
            fill="none"
            aria-hidden="true"
          >
            <g fill="currentColor">
              <path d="M0 95h360v5H0zM6 78h24v17H6zM36 64h23v31H36zM64 82h18v13H64zM88 46h27v49H88zM95 28h13v20H95zM99 12h5v20h-5zM123 73h24v22h-24zM154 57h24v38h-24zM161 39h10v19h-10zM183 80h16v15h-16zM206 28h8v67h-8zM203 44h14v4h-14zM207 14h6v18h-6zM209 2h2v14h-2zM227 62h29v33h-29zM264 74h18v21h-18zM299 41h5v54h-5zM344 14h5v81h-5z" />
              <path d="m290 40 59-26v5l-59 26zm0 35 59-39v5l-59 39z" />
            </g>
            <path
              d="m291 44 53 42m-39-46 39 34m-25-41 25 24M2 96h356"
              stroke="currentColor"
              strokeWidth={2}
            />
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
