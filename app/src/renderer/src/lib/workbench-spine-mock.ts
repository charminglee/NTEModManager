import type { workbenchSpineApi } from '../../../preload/workbench-spine'

export const workbenchSpineMock: typeof workbenchSpineApi = {
  async saveSpineFiles(files) {
    for (const file of files) {
      const url = URL.createObjectURL(new Blob([file.bytes]))
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    return '浏览器下载目录'
  }
}
