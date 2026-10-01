# 背景图片服务调用示例（React + Electron）

`NteBackgroundImageServer.exe` 是无界面的独立服务版本，采用服务专用的单例互斥体；重复启动的服务进程会退出。该互斥体与 `NteModManager` 不同，因此服务可以与主程序同时运行。它复用模组管理器的 Python 运行环境、AI 背景识别和裁剪逻辑。

## 构建与启动

在仓库根目录单独构建服务目标：

```powershell
cmake --build .\build --config Release --target NteBackgroundImageServer
```

构建产物为 `build\Release\NteBackgroundImageServer.exe`，运行时使用同目录下共用的 `build\Release\python`。在 PowerShell 中启动服务：

```powershell
Start-Process ".\build\Release\NteBackgroundImageServer.exe"
```

服务默认监听 `127.0.0.1:48126`，也可使用 `--port 48127` 指定端口。服务启动并完成模型预热后即可接受请求。

## HTTP 接口

```text
GET http://127.0.0.1:48126/background?width=<窗口宽度>&height=<窗口高度>
```

成功响应为 `image/png`，图片像素尺寸与请求的宽、高一致。每次请求会从配置的 `background_images_directory` 中随机选图，并使用 AI 检测及视口裁剪逻辑。宽、高必须为正数且不超过 `16384`，总像素不能超过 `64 Mi`。请求失败时会返回 HTTP 错误状态和 JSON `error` 字段。

服务没有设置 CORS 响应头，因此不要从 React renderer 直接调用 `fetch`。推荐由 Electron 主进程请求服务，再通过 preload IPC 将图像交给 renderer；无需关闭 Electron 的 `webSecurity`。

## Electron 主进程

在主进程注册 IPC 请求处理器。此示例使用 Node.js 内置 `fetch`，要求 Electron 主进程的 Node.js 版本支持它（Node.js 18 或更高版本）。

```ts
import { ipcMain } from 'electron'

ipcMain.handle('background:get', async (_event, width: number, height: number) => {
  const url = new URL('http://127.0.0.1:48126/background')
  url.searchParams.set('width', String(width))
  url.searchParams.set('height', String(height))

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`背景服务返回 HTTP ${response.status}: ${await response.text()}`)
  }
  return response.arrayBuffer()
})
```

## Preload

确保 `BrowserWindow` 已加载该 preload 且启用了 `contextIsolation`。只向 renderer 暴露所需的调用方法：

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('backgroundService', {
  getImage: (width: number, height: number): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('background:get', width, height),
})
```

为 renderer 添加 TypeScript 类型声明：

```ts
declare global {
  interface Window {
    backgroundService: {
      getImage(width: number, height: number): Promise<ArrayBuffer>
    }
  }
}

export {}
```

## React 组件

组件以窗口当前宽、高请求图片，并在卸载时释放 Blob URL：

```tsx
import { useEffect, useState } from 'react'

export function BackgroundImage() {
  const [imageUrl, setImageUrl] = useState<string>()

  useEffect(() => {
    let disposed = false
    let objectUrl: string | undefined

    void window.backgroundService
      .getImage(window.innerWidth, window.innerHeight)
      .then((png) => {
        const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
        if (disposed) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setImageUrl(url)
      })
      .catch(console.error)

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [])

  return imageUrl ? <img src={imageUrl} alt="" /> : null
}
```

窗口尺寸变化时，重新调用 `getImage` 并传入新的宽、高即可。