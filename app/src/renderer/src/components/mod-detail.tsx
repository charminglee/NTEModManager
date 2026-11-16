import { useRef, useState, type KeyboardEvent } from 'react'
import { FolderOpen, Package, PackageOpen, RefreshCw, X } from 'lucide-react'
import type { ModInfo } from '@shared/types'
import type { ModCardActions } from './mod-card'
import { ModStatus } from './mod-card'
import { Button } from './ui/button'
import FileTree from './file-tree'
import ModActions from './mod-actions'
import cityline from '@/assets/cityline.svg'
import { formatFileSize, formatImportedAt } from '@/lib/format'
interface Props {
  mod: ModInfo
  category: string
  group: string
  exempt: boolean
  image: string | null
  busy: boolean
  actions: ModCardActions
  onClose: () => void
}
export default function ModDetail({
  mod,
  category,
  group,
  exempt,
  image,
  busy,
  actions,
  onClose
}: Props) {
  const [tab, setTab] = useState<'files' | 'info'>('files')
  const tabsRef = useRef<HTMLDivElement>(null)
  const handleTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 'files'
        : event.key === 'End'
          ? 'info'
          : tab === 'files'
            ? 'info'
            : 'files'
    setTab(next)
    tabsRef.current?.querySelector<HTMLButtonElement>('#detail-' + next + '-tab')?.focus()
  }
  return (
    <aside className="mod-detail ink-panel" aria-label="模组详情">
      <div className="detail-heading">
        <h2>模组详情</h2>
        <span className="hazard-mark" aria-hidden />
        <Button variant="ghost" size="icon" aria-label="关闭模组详情" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="detail-scroll">
        <div className="detail-preview">
          <img className="detail-preview-city" src={cityline} alt="" />
          {image ? (
            <img className="detail-portrait" src={image} alt={category} />
          ) : (
            <Package className="detail-preview-package" />
          )}
          <span className="detail-preview-label">
            {category}
            <small>MOD ARCHIVE／01</small>
          </span>
        </div>
        <div className="detail-name">
          <h3>{mod.name}</h3>
          <ModStatus mod={mod} />
        </div>
        <div
          className="detail-tabs"
          ref={tabsRef}
          onKeyDown={handleTabKey}
          role="tablist"
          aria-label="模组详情内容"
        >
          <button
            role="tab"
            id="detail-files-tab"
            tabIndex={tab === 'files' ? 0 : -1}
            aria-selected={tab === 'files'}
            aria-controls="detail-files-panel"
            onClick={() => setTab('files')}
          >
            文件
          </button>
          <button
            role="tab"
            id="detail-info-tab"
            tabIndex={tab === 'info' ? 0 : -1}
            aria-selected={tab === 'info'}
            aria-controls="detail-info-panel"
            onClick={() => setTab('info')}
          >
            信息
          </button>
        </div>
        {tab === 'files' ? (
          <div
            id="detail-files-panel"
            role="tabpanel"
            aria-labelledby="detail-files-tab"
            className="detail-file-panel"
            key={mod.name}
          >
            {mod.files.length ? (
              <FileTree
                entries={mod.files}
                depth={0}
                relativeBase=""
                onRenameFile={(path, name) => actions.onRenameFile(mod, path, name)}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">此模组暂无文件</p>
            )}
          </div>
        ) : (
          <dl
            id="detail-info-panel"
            role="tabpanel"
            aria-labelledby="detail-info-tab"
            className="detail-metadata"
          >
            <dt>文件大小</dt>
            <dd>{formatFileSize(mod.sizeBytes)}</dd>
            <dt>导入时间</dt>
            <dd>{formatImportedAt(mod.importedAt)}</dd>
            <dt>角色分类</dt>
            <dd>{category}</dd>
            <dt>源目录</dt>
            <dd className="select-text break-all">{mod.sourcePath}</dd>
            <dt>安装规则</dt>
            <dd>{exempt ? '允许同组共存' : group ? '同分组互斥安装' : '未归类'}</dd>
          </dl>
        )}
        <div className="detail-actions">
          <Button variant="outline" disabled={busy} onClick={() => actions.onRepackage(mod)}>
            <Package />
            重新打包
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => actions.onReplaceArchive(mod)}>
            <RefreshCw />
            更新／替换
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => actions.onOpenSource(mod)}>
            <FolderOpen />
            打开源目录
          </Button>
          <ModActions mod={mod} actions={actions} disabled={busy} label="更多操作" />
        </div>
        <Button
          className="detail-primary-action"
          variant={mod.installed ? 'outline' : 'default'}
          disabled={busy}
          onClick={() => actions.onToggleInstall(mod)}
        >
          <PackageOpen />
          {mod.installed ? '卸载此模组' : mod.invalid ? '确认后安装此模组' : '安装此模组'}
        </Button>
      </div>
    </aside>
  )
}
