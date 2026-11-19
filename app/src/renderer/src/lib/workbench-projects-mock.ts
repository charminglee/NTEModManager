import type { workbenchProjectsApi } from '../../../preload/workbench-projects'
import type { WorkbenchProject } from '@shared/workbench-projects'

let project: WorkbenchProject | null = null
const projects = new Map<string, WorkbenchProject>()

function active(): WorkbenchProject {
  if (!project) throw new Error('请先打开模组项目。')
  return project
}

export const workbenchProjectsMock: typeof workbenchProjectsApi = {
  async currentWorkbenchProject() { return project && structuredClone(project) },
  async selectWorkbenchProject(command) {
    if (command === 'create' || command === 'open') {
      let directory = project?.directory ?? '示例项目'
      if (command === 'create') directory = '模组项目 ' + (projects.size + 1)
      project = projects.get(directory) ?? {
        directory, engine: 'E:\\NteMod\\UE_5.6', uproject: command === 'open' ? '示例工程/HT.uproject' : '',
        assets: command === 'open' ? ['UI/T_Avatar.uasset'] : [], files: []
      }
      projects.set(directory, project)
    } else {
      const selected = active()
      if (command === 'engine') selected.engine = 'E:\\NteMod\\UE_5.6'
      if (command === 'uproject') selected.uproject = '示例工程/HT.uproject'
      if (command === 'add' && !selected.assets.includes('UI/T_Icon.uasset')) selected.assets.push('UI/T_Icon.uasset')
      if (command === 'import' && !selected.files.includes('立绘.png')) selected.files.push('立绘.png')
    }
    return structuredClone(project)
  },
  async removeWorkbenchAsset(asset) {
    const selected = active()
    selected.assets = selected.assets.filter(value => value !== asset)
    return structuredClone(selected)
  },
  async trashWorkbenchFile(file) {
    const selected = active()
    selected.files = selected.files.filter(value => value !== file)
    return structuredClone(selected)
  },
  async showWorkbenchFolder() {
    throw new Error('请在桌面应用中打开本地目录。')
  },
  async buildWorkbenchProject() {
    const selected = active()
    if (!selected.uproject || !selected.assets.length) throw new Error('请绑定工程并选择资源。')
    return selected.directory + '/Builds/浏览器模拟构建'
  }
}
