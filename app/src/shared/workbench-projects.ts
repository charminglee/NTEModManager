export interface WorkbenchProject {
  directory: string
  engine: string
  uproject: string
  assets: string[]
  files: string[]
}

export type ProjectCommand = 'create' | 'open' | 'engine' | 'uproject' | 'add' | 'import'

export interface WorkbenchProjectsApi {
  currentWorkbenchProject(): Promise<WorkbenchProject | null>
  selectWorkbenchProject(command: ProjectCommand): Promise<WorkbenchProject | null>
  removeWorkbenchAsset(asset: string): Promise<WorkbenchProject>
  trashWorkbenchFile(file: string): Promise<WorkbenchProject>
  showWorkbenchFolder(target: 'project' | 'content' | 'builds' | 'files'): Promise<void>
  buildWorkbenchProject(): Promise<string>
}
