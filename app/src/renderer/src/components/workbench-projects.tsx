import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { File, FolderOpen, Package, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkbenchProject, WorkbenchProjectsApi, ProjectCommand } from '@shared/workbench-projects'

export default function WorkbenchProjects({ active, toolbarTarget }: { active: boolean; toolbarTarget: HTMLElement | null }) {
  const api = window.api as typeof window.api & WorkbenchProjectsApi
  const [project, setProject] = useState<WorkbenchProject | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [output, setOutput] = useState('')
  useEffect(() => {
    let mounted = true
    setBusy('正在读取项目……')
    api.currentWorkbenchProject().then(value => { if (mounted) setProject(value) })
      .catch(reason => { if (mounted) setError(String(reason)) })
      .finally(() => { if (mounted) setBusy('') })
    return () => { mounted = false }
  }, [api])

  async function run(label: string, operation: () => Promise<void>) {
    setBusy(label)
    setError('')
    try {
      await operation()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  function select(command: ProjectCommand) {
    void run('正在处理项目……', async () => {
      const next = await api.selectWorkbenchProject(command)
      setProject(next)
      setOutput('')
    })
  }

  function folder(target: Parameters<WorkbenchProjectsApi['showWorkbenchFolder']>[0]) {
    void run('正在打开目录……', () => api.showWorkbenchFolder(target))
  }

  return (
    <fieldset disabled={!!busy} aria-label="模组项目" className="grid min-w-0 gap-4 text-sm">
      {active && toolbarTarget && createPortal(
        <fieldset disabled={!!busy} className="flex min-w-0 flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => select('open')}><FolderOpen />打开项目</Button>
          <Button onClick={() => select('create')}>新建项目</Button>
        </fieldset>,
        toolbarTarget
      )}
      {busy && <p role="status" className="workbench-panel px-4 py-3 text-muted-foreground">{busy}</p>}
      {error && <p role="alert" className="workbench-panel whitespace-pre-wrap break-all px-4 py-3 text-destructive">{error}</p>}
      {!project && !busy && (
        <div className="library-empty workbench-panel">
          <FolderOpen size={32} aria-hidden="true" />
          <h2>尚未打开模组项目</h2>
          <p>新建或打开模组目录，关联虚幻工程后即可选择资源、烘焙并打包。</p>
        </div>
      )}
      {project && <>
        <section className="workbench-panel">
          <header className="workbench-panel-heading"><h2>工程设置</h2></header>
          <dl className="divide-y">
            {([
              ['项目目录', project.directory, '打开目录', () => folder('project')],
              ['UE 5.6', project.engine, '选择引擎', () => select('engine')],
              ['虚幻工程', project.uproject, '绑定工程', () => select('uproject')]
            ] as const).map(([label, value, button, action]) => (
              <div key={label} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <dt className="font-semibold">{label}</dt>
                  <dd className="mt-1 break-all text-xs text-muted-foreground select-text">{value || '尚未绑定'}</dd>
                </div>
                <Button size="sm" variant="secondary" onClick={action}>{button}</Button>
              </div>
            ))}
          </dl>
        </section>
        <div className="workbench-split">
          <section className="workbench-panel">
            <header className="workbench-panel-heading">
              <h2>打包清单（{project.assets.length}）</h2>
              <Button size="sm" variant="secondary" disabled={!project.uproject} onClick={() => select('add')}>添加工程资源</Button>
            </header>
            <p className="px-4 py-3 text-xs text-muted-foreground">从工程 Content 中选择需要打包的资源及其新增依赖。</p>
            {project.assets.length > 0 && <ul className="divide-y border-t px-4">
              {project.assets.map(asset => <li key={asset} className="flex items-center gap-2 py-1">
                <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-all">{asset}</span>
                <Button size="icon" variant="ghost" aria-label={`从清单移除 ${asset}`} onClick={() => void run('正在更新清单……', async () => {
                  setProject(await api.removeWorkbenchAsset(asset))
                })}><X /></Button>
              </li>)}
            </ul>}
          </section>
          <section className="workbench-panel">
            <header className="workbench-panel-heading">
              <h2>项目素材（{project.files.length}）</h2>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => void run('正在读取素材……', async () => {
                  setProject(await api.currentWorkbenchProject())
                })}>刷新</Button>
                <Button size="sm" variant="ghost" onClick={() => folder('files')}>打开素材目录</Button>
                <Button size="sm" variant="secondary" onClick={() => select('import')}>导入文件</Button>
              </div>
            </header>
            {project.files.length ? <ul className="divide-y px-4">
              {project.files.map(file => <li key={file} className="flex items-center gap-2 py-1">
                <File className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-all">{file}</span>
                <Button size="icon" variant="ghost" aria-label={`将 ${file} 移至回收站`} title="移至回收站" onClick={() => void run('正在移至回收站……', async () => {
                  setProject(await api.trashWorkbenchFile(file))
                })}><Trash2 /></Button>
              </li>)}
            </ul> : <p className="px-4 py-3 text-sm text-muted-foreground">暂无素材</p>}
          </section>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => folder('builds')}>产物目录</Button>
          <Button disabled={!project.engine || !project.uproject || !project.assets.length} onClick={() => void run('正在烘焙并校验容器，进度见运行日志……', async () => {
            setOutput('')
            setOutput(await api.buildWorkbenchProject())
          })}><Package />烘焙并打包</Button>
        </div>
        {output && <p role="status" className="workbench-panel break-all px-4 py-3 select-text">构建产物：{output}</p>}
      </>}
    </fieldset>
  )
}
