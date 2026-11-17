import { memo } from 'react'
import { MoreHorizontal, RefreshCw, Search } from 'lucide-react'
import { SORT_OPTIONS, type SortOrder } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import ticket from '@/assets/ticket-stamp.svg'
export type StatusFilter = 'all' | 'installed' | 'uninstalled' | 'invalid'
interface Props {
  category: string
  counts: Record<StatusFilter, number>
  search: string
  sortOrder: SortOrder
  status: StatusFilter
  busy: boolean
  onSearchChange: (value: string) => void
  onSortOrderChange: (order: SortOrder) => void
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
        <img className="ticket-stamp" src={ticket} alt="" />
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
        <select
          aria-label="排序方式"
          value={p.sortOrder}
          onChange={(e) => p.onSortOrderChange(Number(e.target.value) as SortOrder)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button variant="outline" size="icon" onClick={p.onRefresh} disabled={p.busy} title="重新扫描模组目录">
          <RefreshCw />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="当前分类操作" disabled={p.busy}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={p.onInstallAll}>当前分类全部安装</DropdownMenuItem>
            <DropdownMenuItem onSelect={p.onUninstallAll}>当前分类全部卸载</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
