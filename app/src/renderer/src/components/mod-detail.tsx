import { FolderInput, FolderOpen, Package, PackageOpen, Pencil, RefreshCw } from 'lucide-react'
import type { ModFileEntry, ModInfo } from '@shared/types'
import type { ModCardActions } from './mod-card'
import { ModStatus } from './mod-card'
import { Button } from './ui/button'
import { AppDrawer } from './ui/drawer'
import FileTree from './file-tree'
import ModActions from './mod-actions'
import ModBundlePanel from './mod-bundle-panel'
import { formatFileSize, formatImportedAt } from '@/lib/format'
interface Props {
  open: boolean
  mod: ModInfo
  category: string
  busy: boolean
  actions: ModCardActions
  onClose: () => void
}
export default function ModDetail({
  open,
  mod,
  category,
  busy,
  actions,
  onClose
}: Props) {
  let fileCount = 0
  const entries: ModFileEntry[] = [...mod.files]
  while (entries.length > 0) {
    const entry = entries.pop()!
    if (entry.directory) entries.push(...entry.children)
    else fileCount += 1
  }

  return (
    <AppDrawer
      open={open}
      title={mod.name}
      onClose={onClose}
      onEscapeKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) event.preventDefault()
      }}
      titleAction={
        <Button
          variant="ghost"
          size="icon"
          className="detail-rename-button"
          disabled={busy}
          aria-label={`重命名模组：${mod.name}`}
          onClick={() => actions.onRename(mod)}
        >
          <Pencil aria-hidden="true" />
        </Button>
      }
      headerEnd={<ModStatus mod={mod} />}
      footer={
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
          <Button variant="outline" disabled={busy} onClick={() => actions.onAddArchive(mod)}>
            <FolderInput />
            添加
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
      }
    >
      <ModBundlePanel
        mod={mod}
        busy={busy}
        onToggle={actions.onToggleSubMod}
        onRename={actions.onRenameSubMod}
      />
      <section>
        <h3 className="section-heading">文件</h3>
        <div className="detail-file-panel">
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
      </section>
      <section className="detail-info">
        <h3 className="section-heading">信息</h3>
        <dl className="detail-metadata">
          <dt>文件大小</dt>
          <dd>{formatFileSize(mod.sizeBytes)}</dd>
          <dt>文件数量</dt>
          <dd>{fileCount} 个</dd>
          <dt>导入时间</dt>
          <dd>{formatImportedAt(mod.importedAt)}</dd>
          <dt>角色分类</dt>
          <dd>{category}</dd>
          <dt>源目录</dt>
          <dd className="select-text break-all">{mod.sourcePath}</dd>
        </dl>
      </section>
    </AppDrawer>
  )
}
