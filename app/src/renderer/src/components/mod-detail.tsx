import { useRef, useState, type KeyboardEvent } from 'react'
import { FolderOpen, Package, PackageOpen, Pencil, RefreshCw, X } from 'lucide-react'
import type { ModInfo } from '@shared/types'
import type { ModCardActions } from './mod-card'
import { ModStatus } from './mod-card'
import { Button } from './ui/button'
import FileTree from './file-tree'
import ModActions from './mod-actions'
import ModBundlePanel from './mod-bundle-panel'
import { formatFileSize, formatImportedAt } from '@/lib/format'
interface Props {
  mod: ModInfo
  category: string
  busy: boolean
  actions: ModCardActions
  onClose: () => void
}
export default function ModDetail({
  mod,
  category,
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
        <div className="detail-name-title">
          <h2>{mod.name}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="detail-rename-button"
            disabled={busy}
            aria-label={`重命名模组：${mod.name}`}
            title="重命名模组"
            onClick={() => actions.onRename(mod)}
          >
            <Pencil aria-hidden="true" />
          </Button>
        </div>
        <ModStatus mod={mod} />
        <Button variant="ghost" size="icon" aria-label="关闭模组详情" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="detail-scroll">
        <ModBundlePanel
          mod={mod}
          busy={busy}
          onToggle={actions.onToggleSubMod}
          onRename={actions.onRenameSubMod}
        />
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
          </dl>
        )}
        <div className="detail-actions">
          <Button variant="outline" disabled={busy} onClick={() => actions.onRepackage(mod)}>
            <Package />
            重新打包
          </Button>
          <Button
            variant="outline"
            disabled={busy || !mod.installed}
            onClick={() => actions.onReinstall(mod)}
          >
            <RefreshCw />
            重新安装
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => actions.onOpenSource(mod)}>
            <FolderOpen />
            打开源目录
          </Button>
          <Button
            variant="outline"
            disabled={busy || !mod.installed}
            onClick={() => actions.onOpenInstall(mod)}
          >
            <FolderOpen />
            打开安装目录
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
          {mod.installed ? '卸载' : '安装'}
        </Button>
      </div>
    </aside>
  )
}
