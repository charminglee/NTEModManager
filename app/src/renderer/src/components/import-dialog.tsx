import { LoaderCircle, Package } from 'lucide-react'
import { AppDialog } from '@/components/ui/dialog'

interface Props {
  archives: string[] | null
  activity: string
  onHide: () => void
}
export default function ImportDialog({ archives, activity, onHide }: Props) {
  return (
    <AppDialog
      open={archives !== null}
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
      title="导入模组"
      description={activity || '正在处理压缩包，请稍候…'}
      panelClassName="max-w-xl"
      confirmAction={{ label: '隐藏', onSelect: onHide }}
    >
      <div className="import-result-list">
        {archives?.map((path) => (
          <div key={path} className="import-result-row">
            <Package size={24} />
            <div>
              <strong>{path.split(/[\\/]/).pop()}</strong>
              <p>
                <LoaderCircle size={14} className="animate-spin" />
                正在处理
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="import-progress-track" aria-label="正在导入">
        <span />
      </div>
    </AppDialog>
  )
}
