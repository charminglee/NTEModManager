import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, RefreshCw, Search } from 'lucide-react'
import type { LogEntry } from '@shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
const labels: Record<LogEntry['level'], string> = {
  debug: '调试',
  info: '信息',
  warning: '警告',
  error: '错误'
}
function LogView() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('all')
  const [follow, setFollow] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  const filtered = useMemo(
    () =>
      logs
        .filter(
          (entry) =>
            (level === 'all' || entry.level === level) &&
            entry.message.toLowerCase().includes(query.toLowerCase())
        )
        .slice(-500),
    [logs, query, level]
  )
  useEffect(() => {
    let live = true
    const pending: LogEntry[] = []
    let loaded = false
    const unsubscribe = window.api.onLogEntry((entry) => {
      if (!loaded) pending.push(entry)
      else setLogs((previous) => [...previous.slice(-3999), entry])
    })
    void window.api.getLogEntries().then((entries) => {
      if (!live) return
      loaded = true
      const keys = new Set(
        entries.map((entry) => `${entry.timestamp}\0${entry.level}\0${entry.message}`)
      )
      setLogs(
        [
          ...entries,
          ...pending.filter(
            (entry) => !keys.has(`${entry.timestamp}\0${entry.level}\0${entry.message}`)
          )
        ].slice(-4000)
      )
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (follow && container.current) container.current.scrollTop = container.current.scrollHeight
  }, [filtered, follow])
  return (
    <section className="logs-workspace">
      <div className="workspace-page-heading">
        <h1>运行日志</h1>
        <p>查看导入、安装与打包结果。</p>
      </div>
      <div className="logs-toolbar">
        <label className="library-search">
          <Search size={17} />
          <Input
            aria-label="查找日志"
            placeholder="查找日志"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select aria-label="日志级别" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">全部级别</option>
          {Object.entries(labels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <label className="follow-toggle">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          跟随滚动
        </label>
        <Button
          variant="outline"
          size="icon"
          aria-label="刷新日志"
          onClick={() => void window.api.getLogEntries().then(setLogs)}
        >
          <RefreshCw />
        </Button>
      </div>
      <div
        className="logs-table ink-panel"
        ref={container}
        onScroll={() => {
          const el = container.current
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 24) setFollow(false)
        }}
      >
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>级别</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, index) => (
              <tr key={index}>
                <td>{entry.timestamp}</td>
                <td className={`log-level-${entry.level}`}>{labels[entry.level]}</td>
                <td>{entry.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="log-empty">{query || level !== 'all' ? '没有匹配的日志' : '暂无日志'}</p>
        )}
      </div>
      {!follow && (
        <Button
          className="jump-to-log"
          variant="outline"
          onClick={() => {
            setFollow(true)
            if (container.current) container.current.scrollTop = container.current.scrollHeight
          }}
        >
          <ArrowDown />
          查看最新日志
        </Button>
      )}
    </section>
  )
}
export default memo(LogView)
