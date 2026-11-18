import { Check, Download, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { GameBananaDownloadTask } from '@shared/types'
import { formatFileSize } from '@/lib/format'
import { AppDrawer } from './ui/drawer'

interface Props {
  open: boolean
  tasks: GameBananaDownloadTask[]
  onClose: () => void
}

function statusText(task: GameBananaDownloadTask): string {
  if (task.status === 'queued') return '等待下载'
  if (task.status === 'downloading') return '正在下载'
  if (task.status === 'extracting') return '正在解压'
  if (task.status === 'installing') return '正在安装'
  if (task.status === 'completed') return '已完成'
  return '下载失败'
}

function progress(task: GameBananaDownloadTask): number {
  if (task.status === 'completed') return 100
  if (!task.totalBytes) return 0
  return Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
}

export default function GameBananaDownloadDrawer({ open, tasks, onClose }: Props) {
  return (
    <AppDrawer open={open} title="下载列表" onClose={onClose}>
      {tasks.length === 0 ? (
        <div className="gamebanana-download-empty">
          <Download size={32} />
          <strong>还没有下载任务</strong>
          <span>从模组详情页开始下载。</span>
        </div>
      ) : (
        tasks.map((task) => (
          <article className="gamebanana-download-item" key={task.id}>
            <div className="gamebanana-download-item-heading">
              <div className="gamebanana-download-item-icon">
                {task.status === 'completed' ? <Check /> : task.status === 'failed' ? <TriangleAlert /> : <LoaderCircle className="animate-spin" />}
              </div>
              <div className="gamebanana-download-item-copy">
                <strong title={task.customName}>{task.customName}</strong>
                <span>{task.fileName}</span>
              </div>
              <small>{statusText(task)}</small>
            </div>
            <div className="gamebanana-progress-track" aria-label={`${progress(task)}%`}>
              <span style={{ width: `${progress(task)}%` }} />
            </div>
            <div className="gamebanana-download-item-meta">
              <span>{task.message}</span>
              {task.totalBytes ? (
                <span>{formatFileSize(task.downloadedBytes)}／{formatFileSize(task.totalBytes)}</span>
              ) : null}
            </div>
          </article>
        ))
      )}
    </AppDrawer>
  )
}
