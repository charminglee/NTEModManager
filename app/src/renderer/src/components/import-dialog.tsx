import { Check, LoaderCircle, Package, TriangleAlert } from 'lucide-react'
import type { ImportResult } from '@shared/types'
import { AppDialog } from '@/components/ui/dialog'
import { Button } from './ui/button'

export interface ImportSession {
  archives: string[]
  results: ImportResult[]
}
interface Props {
  session: ImportSession | null
  busy: boolean
  activity: string
  onClose: () => void
  onRetry: (path: string) => void
}
export default function ImportDialog({ session, busy, activity, onClose, onRetry }: Props) {
  const successes = session?.results.filter((item) => item.result.success).length ?? 0
  const failures = session?.results.filter((item) => !item.result.success).length ?? 0
  return (
    <AppDialog
      open={session !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
      title="导入模组"
      description={
        busy
          ? activity || '正在处理压缩包，请稍候…'
          : `已完成：成功 ${successes} 个，失败 ${failures} 个。`
      }
      panelClassName="max-w-xl"
      confirmAction={{
        label: '继续',
        disabled: busy,
        onSelect: onClose
      }}
    >
      <div className="import-result-list">
        {session?.archives.map((path) => {
          const item = session.results.find((result) => result.archive === path)
          return (
            <div key={path} className="import-result-row">
              <Package size={24} />
              <div>
                <strong title={path}>{path.split(/[\\/]/).pop()}</strong>
                {item ? (
                  <p className={item.result.success ? 'is-installed' : 'is-invalid'}>
                    {item.result.success ? <Check size={14} /> : <TriangleAlert size={14} />}
                    {item.result.success ? '已完成' : item.result.message || '导入失败'}
                  </p>
                ) : (
                  <p>
                    <LoaderCircle size={14} className="animate-spin" />
                    正在处理
                  </p>
                )}
              </div>
              {item && !item.result.success && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => onRetry(path)}>
                  重试
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {busy && (
        <div className="import-progress-track" aria-label="正在导入">
          <span />
        </div>
      )}
    </AppDialog>
  )
}