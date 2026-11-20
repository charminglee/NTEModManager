import { lazy, Suspense, useState } from 'react'
import { FolderOpen, Layers, PackageOpen } from 'lucide-react'
import Sidebar from './sidebar'

const sections = [
  { id: 'assets', label: '原生资源', icon: <PackageOpen size={20} />, Panel: lazy(() => import('./workbench-assets')) },
  { id: 'spine', label: 'Spine 编辑器', icon: <Layers size={20} />, Panel: lazy(() => import('./workbench-spine')) },
  { id: 'projects', label: '模组项目', icon: <FolderOpen size={20} />, Panel: lazy(() => import('./workbench-projects')) }
] as const

type Section = (typeof sections)[number]['id']

export default function Workbench({ visible }: { visible: boolean }) {
  const [section, setSection] = useState<Section>('assets')
  const [opened, setOpened] = useState<Section[]>(['assets'])
  const activeSection = sections.find(({ id }) => id === section)!

  return (
    <section className="workbench settings-workspace" style={visible ? undefined : { display: 'none' }}>
      <Sidebar label="工作台工具" items={sections} activeId={section} onSelect={id => {
        setSection(id)
        setOpened(current => current.includes(id) ? current : [...current, id])
      }} />
      <main aria-label={activeSection.label} className="settings-page">
        <header className="workspace-page-heading"><h1>{activeSection.label}</h1></header>
        {sections.map(({ id, label, Panel }) => opened.includes(id) && (
          <div key={id} className="workbench-content" style={id === section ? undefined : { display: 'none' }}>
            <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">正在加载{label}……</p>}>
              <Panel active={visible && id === section} />
            </Suspense>
          </div>
        ))}
      </main>
    </section>
  )
}
