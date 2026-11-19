import { app } from 'electron'
import { join } from 'node:path'

export function workbenchToolsDirectory(): string {
  return app.isPackaged ? join(process.resourcesPath, 'libs') : join(app.getAppPath(), '..', 'libs')
}
