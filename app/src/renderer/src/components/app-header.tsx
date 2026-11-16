import { FileText, LoaderCircle, Package, Play, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import cityline from '@/assets/cityline.svg'
export type AppView = 'mods' | 'logs' | 'settings'
interface Props {
  view: AppView
  busy: boolean
  activity: string
  hasGamePath: boolean
  onNavigate: (view: AppView) => void
  onLaunch: () => void
}
export default function AppHeader({
  view,
  busy,
  activity,
  hasGamePath,
  onNavigate,
  onLaunch
}: Props) {
  return (
    <header className="app-header">
      <div className="brand-strip">
        <span className="brand-wordmark">NTEMM</span>
        <span className="brand-slash" />
        <span>异环模组管理器</span>
        <span className="barcode" aria-hidden />
      </div>
      <div className="global-toolbar">
        <img className="header-city" src={cityline} alt="" />
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
        <button
          type="button"
          className="launch-button"
          disabled={busy || !hasGamePath}
          onClick={onLaunch}
        >
          <Play size={17} />
          启动游戏<span aria-hidden>↗</span>
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
