import { app } from 'electron'
import { join } from 'node:path'

export function bundledToolsDirectory(): string {
  return app.isPackaged ? join(process.resourcesPath, 'libs') : join(app.getAppPath(), '..', 'libs')
}
