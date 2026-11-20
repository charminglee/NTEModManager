import { memo } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
export type StatusFilter = 'all' | 'installed' | 'uninstalled' | 'invalid'
interface Props {
  category: string
  counts: Record<StatusFilter, number>
  search: string
  status: StatusFilter
  busy: boolean
  onSearchChange: (value: string) => void
  onStatusChange: (status: StatusFilter) => void
  onRefresh: () => void
  onInstallAll: () => void
  onUninstallAll: () => void
}
function ModListHeader(p: Props) {
  return (
    <div className="mod-library-header">
      <div className="library-title-row">
        <div>
          <div className="library-title">
            <h1>{p.category === '全部' ? '全部模组' : p.category}</h1>
            <span className="title-accent" aria-hidden />
          </div>
          <p>
            {p.counts.all} 个模组  ·  {p.counts.installed} 个已安装
          </p>
        </div>
      </div>
      <div className="library-search-row">
        <label className="library-search">
          <Search size={17} />
          <Input
            value={p.search}
            aria-label="搜索模组"
            placeholder="搜索当前分类的模组"
            onChange={(e) => p.onSearchChange(e.target.value)}
          />
        </label>
        <Button variant="default" onClick={p.onInstallAll} disabled={p.busy}>
          全部安装
        </Button>
        <Button variant="secondary" onClick={p.onUninstallAll} disabled={p.busy}>
          全部卸载
        </Button>
        <Button
          variant="secondary"
          size="icon"
          aria-label="重新扫描模组目录"
          onClick={p.onRefresh}
          disabled={p.busy}
        >
          <RefreshCw />
        </Button>
      </div>
      <div className="library-filter-row">
        <div role="group" aria-label="按安装状态筛选">
          {(
            [
              { id: 'all', label: '全部' },
              { id: 'installed', label: '已安装' },
              { id: 'uninstalled', label: '未安装' },
              { id: 'invalid', label: '失效' }
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={p.status === id}
              onClick={() => p.onStatusChange(id)}
            >
              {label}
              <span>{p.counts[id]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
export default memo(ModListHeader)
