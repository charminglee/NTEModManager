import { useEffect, useState } from 'react'
import { File, FolderOpen, Package, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkbenchProject, WorkbenchProjectsApi, ProjectCommand } from '@shared/workbench-projects'

export default function WorkbenchProjects() {
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
    <fieldset disabled={!!busy} aria-label="模组项目" className="grid min-w-0 gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-lg font-semibold">模组项目</h3>
        <Button size="sm" variant="secondary" onClick={() => select('open')}><FolderOpen />打开项目</Button>
        <Button size="sm" onClick={() => select('create')}>新建项目</Button>
      </div>
      {!project && !busy && <p className="text-muted-foreground">新建或打开模组目录，关联虚幻工程后即可选择资源、烘焙并打包。</p>}
      {project && <>
        <div className="grid gap-3 rounded-lg border bg-card/60 p-4">
          {([
            ['项目目录', project.directory, '打开目录', () => folder('project')],
            ['UE 5.6', project.engine, '选择引擎', () => select('engine')],
            ['虚幻工程', project.uproject, '绑定工程', () => select('uproject')]
          ] as const).map(([label, value, button, action]) => <div key={label} className="flex items-center gap-3">
            <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{label}</p>
              <p className="break-all">{value || '尚未绑定'}</p></div>
            <Button size="sm" variant="secondary" onClick={action}>{button}</Button>
          </div>)}
        </div>
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2"><h4 className="mr-auto font-semibold">打包清单（{project.assets.length}）</h4>
            <Button size="sm" variant="secondary" disabled={!project.uproject} onClick={() => select('add')}>添加工程资源</Button>
          </div>
          <p className="text-xs text-muted-foreground">从工程 Content 中选择本次模组需要的全部资源。新增依赖也需加入清单。</p>
          {project.assets.map(asset => <div key={asset} className="flex items-center gap-2 border-b py-1">
            <Package className="size-4 shrink-0" /><span className="flex-1 break-all">{asset}</span>
            <Button size="icon" variant="ghost" aria-label={`从清单移除 ${asset}`} onClick={() => void run('正在更新清单……', async () => {
              setProject(await api.removeWorkbenchAsset(asset))
            })}><X /></Button>
          </div>)}
        </section>
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2"><h4 className="mr-auto font-semibold">项目素材（{project.files.length}）</h4>
            <Button size="sm" variant="ghost" onClick={() => void run('正在读取素材……', async () => {
              setProject(await api.currentWorkbenchProject())
            })}>刷新</Button>
            <Button size="sm" variant="ghost" onClick={() => folder('files')}>打开素材目录</Button>
            <Button size="sm" variant="secondary" onClick={() => select('import')}>导入文件</Button>
          </div>
          {project.files.map(file => <div key={file} className="flex items-center gap-2 border-b py-1">
            <File className="size-4 shrink-0" /><span className="flex-1 break-all">{file}</span>
            <Button size="icon" variant="ghost" aria-label={`将 ${file} 移至回收站`} title="移至回收站" onClick={() => void run('正在移至回收站……', async () => {
              setProject(await api.trashWorkbenchFile(file))
            })}><Trash2 /></Button>
          </div>)}
        </section>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!project.engine || !project.uproject || !project.assets.length} onClick={() => void run('正在烘焙并校验容器，进度见运行日志……', async () => {
            setOutput('')
            setOutput(await api.buildWorkbenchProject())
          })}><Package />烘焙并打包</Button>
          <Button variant="secondary" onClick={() => folder('builds')}>产物目录</Button>
        </div>
      </>}
      {busy && <p role="status" className="text-muted-foreground">{busy}</p>}
      {output && <p role="status" className="break-all">构建产物：{output}</p>}
      {error && <p role="alert" className="whitespace-pre-wrap break-all text-destructive">{error}</p>}
    </fieldset>
  )
}
