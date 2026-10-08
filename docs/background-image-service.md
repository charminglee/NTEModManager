# 背景图片服务调用示例(Electron 主进程轮播 + Python 视觉识别)

背景图不再是独立的 HTTP 服务:整个管线由 Electron 主进程的 `backgroundCarousel` 单例(`app/src/main/background-carousel.ts`)驱动——随机选图 → 常驻 Python 视觉识别子进程检测主体区域 → 计算与视口同比例的裁剪矩形 → 通过 IPC 把 `BackgroundState` 推送给渲染端;渲染端 `BackgroundLayer`(`app/src/renderer/src/components/background-layer.tsx`)订阅推送,等图片解码完成后以 900ms 交叉淡化切入。图片文件本身由渲染端通过自定义 `media://` 协议直接加载,不经 fetch、无需 Blob。

## 架构与数据流

```text
背景图目录(数值命名子目录中的 jpg/png)
        │ collectBackgroundImages()  app/src/main/background.ts
        ▼
backgroundCarousel(主进程单例)───────── 10s 轮换 / resize 后 120ms 去抖重检
        │ VisualRegionDetector          app/src/main/visual-region-detector.ts
        ▼
常驻 Python 子进程(python/visual_region_detector.py --server,stdio JSON 行协议)
        │ 识别完成:主体区域 bounds
        ▼
cropForViewport():按视口比例取裁剪矩形(无识别结果时以图心为中心)
        │ win.webContents.send('background:state', BackgroundState)
        ▼
BackgroundLayer(渲染端):等图片解码 → 900ms 交叉淡化 → 按裁剪矩形百分比铺满视口
```

| 环节 | 文件 |
| --- | --- |
| 图库收集 / media 路径编码 | `app/src/main/background.ts` |
| 轮播状态机(选图、换代、推送) | `app/src/main/background-carousel.ts` |
| Python 识别进程桥接 + 视口裁剪 | `app/src/main/visual-region-detector.ts` |
| Python 识别脚本(`--server` 模式) | `python/visual_region_detector.py` |
| IPC 注册 | `app/src/main/ipc.ts` |
| Preload 暴露 | `app/src/preload/index.ts` |
| 渲染端背景层 | `app/src/renderer/src/components/background-layer.tsx` |

## 背景图目录约定

`collectBackgroundImages()` 读取配置的 `background_images_directory`:

- 只识别**数值命名的子目录**(如 `1`、`2`、`42`)中的 `jpg` / `jpeg` / `png` 文件,目录本身不递归。
- 设置中开启「使用测试背景图」(INI `[Debug] test_images`)时,改用代码常量 `TEST_IMAGES_ROOT` 下的**平铺** jpg/png,忽略背景图目录。
- 目录为空或不可读时轮播保持空白;配置变化由设置界面触发 `backgroundCarousel.reloadImages()`,无需重启应用。

## 主进程 API(backgroundCarousel)

主进程内其他模块直接使用导出的单例:

```ts
import { backgroundCarousel } from './background-carousel'

backgroundCarousel.start(getWindow)   // 应用启动时调用;无图则跳过初始化
backgroundCarousel.reloadImages()     // 图库目录/测试图开关变化后刷新
backgroundCarousel.switchBackground() // 手动切换下一张(10s 定时轮换内部共用)
backgroundCarousel.handleWindowResized() // 窗口 resize 后触发去抖重检
backgroundCarousel.setDebugMode(true) // AI 调试线框开关
backgroundCarousel.restartDetection() // Python 环境变化后重建识别进程
backgroundCarousel.currentPath()      // 当前图路径(供分类图等逻辑使用)
backgroundCarousel.lastPushedState()  // 最近一次推送的 BackgroundState
await backgroundCarousel.dispose()    // 退出时停止计时器并结束 Python 进程
```

对外 IPC(注册于 `ipc.ts`,由 preload 暴露给渲染端):

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `background:state` | 主进程 → 渲染端推送 | 携带 `BackgroundState`;目录被改空时推送 `null` 表示清空 |
| `background:currentState` | invoke | 拉取最近一次推送,渲染端挂载晚于轮播启动时补齐第一帧 |
| `background:next` | invoke | 手动切换下一张(切换期间重复调用被忽略) |
| `background:currentPath` | invoke | 当前背景图源文件路径 |
| `background:toggleDebugMode` | invoke | 开关 AI 调试线框 |

推送的 `BackgroundState`(`app/src/shared/types.ts`):

```ts
export interface BackgroundState {
  generation: number          // 换代号;同代更新(识别结果/线框就绪)不换代
  path: string                // 当前背景图源文件路径
  url: string                 // 全图的 media:// 地址
  imageWidth: number
  imageHeight: number
  crop: BackgroundRect        // 源图上的裁剪矩形(与视口同比例)
  debugOverlay?: Uint8Array   // AI 调试线框 PNG(全图尺寸),仅调试模式携带
  debugOverlayStatus?: string
}
```

## media:// 图片协议

推送的 `url` 形如 `media://local/<逐段 encodeURIComponent 的绝对路径>`,由主进程 `protocol.handle('media', ...)`(`app/src/main/index.ts`)服务:

- 仅允许**白名单根目录**(背景图目录、测试图目录、分类图目录、应用图标目录)下的图片文件,其余路径拒绝。
- 渲染端直接把 `url` 赋给 `<img src>`,不需要 fetch、Blob 或关闭 `webSecurity`。
- 路径编码用 `encodeMediaPath()`(反斜杠归一为 `/` 后逐段 `encodeURIComponent`),中文路径可直接使用。

## Preload 暴露(window.api)

`contextIsolation` 开启,经 `contextBridge` 只暴露所需方法(摘自 `app/src/preload/index.ts`):

```ts
nextBackground: (): Promise<OperationResult> => ipcRenderer.invoke('background:next'),
toggleBackgroundDebugMode: (): Promise<OperationResult> => ipcRenderer.invoke('background:toggleDebugMode'),
getCurrentBackgroundPath: (): Promise<string | null> => ipcRenderer.invoke('background:currentPath'),
getCurrentBackgroundState: (): Promise<BackgroundState | null> => ipcRenderer.invoke('background:currentState'),
onBackgroundState: (callback: (state: BackgroundState | null) => void): (() => void) => {
  const listener = (_event: unknown, state: BackgroundState | null) => callback(state)
  ipcRenderer.on('background:state', listener)
  return () => ipcRenderer.removeListener('background:state', listener)
},
```

## React 组件消费示例

渲染端的完整实现在 `background-layer.tsx`;最小用法如下——先订阅再拉取首帧,换代等图片解码后交叉淡化,同代更新即时生效:

```tsx
import { useEffect, useState, type CSSProperties } from 'react'
import type { BackgroundState } from '@shared/types'

export function BackgroundImage() {
  const [state, setState] = useState<BackgroundState | null>(null)

  useEffect(() => {
    // 先订阅再拉取,避免错过挂载前推送的帧
    const unsubscribe = window.api.onBackgroundState(setState)
    void window.api.getCurrentBackgroundState().then((first) => {
      if (first) setState(first)
    })
    return unsubscribe
  }, [])

  if (!state) return null

  // 裁剪矩形与视口同比例,纯百分比定位即可铺满视口,无需监听窗口尺寸
  const { crop } = state
  const geometry: CSSProperties = {
    width: `${(state.imageWidth / crop.width) * 100}%`,
    height: `${(state.imageHeight / crop.height) * 100}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  }
  return (
    <div className="fixed inset-0 overflow-hidden">
      <img src={state.url} alt="" draggable={false} className="absolute max-w-none" style={geometry} />
    </div>
  )
}
```

完整版额外处理:换代时保留旧图层 900ms 交叉淡化、`new Image()` 预解码后再切入、`generation` 回退帧丢弃(乱序保护)、调试线框 PNG 转 Blob URL 并延迟回收、`null` 状态清空回到纯底色。

## 独立 HTTP 背景图服务(--http 模式,供外部程序调用)

主程序内部不走 HTTP:背景管线由 backgroundCarousel 直接驱动 Python 子进程(见上文)。`--http` 模式服务于**外部程序**——不需要任何 Electron 壳,同一个脚本以 HTTP 常驻,消费端直接请求即可拿到按视口比例、以 AI 识别焦点为中心裁剪好的图片字节,可直接用作背景。

启动(解释器与脚本路径规则见下节,建议从仓库根或部署目录运行):

```bash
python/.venv/Scripts/python.exe -X utf8 python/visual_region_detector.py --http \
      --cache-dir python/model-cache --orientation-model python/orientation-model/best.pt
```

| 参数 | 说明 |
| --- | --- |
| `--port <N>` | 监听端口;缺省按 `NTEMM_BG_SERVER_PORT` > ini `[BgServer] port` > 26925 |
| `--images-dir <目录>` | 覆盖背景图库目录(有数值子目录按子目录收集,否则平铺);缺省读 ini |
| `--config <ini>` | 指定配置文件;缺省 `NTEMM_CONFIG` > `~/.ntemm/NteModManager.ini` |
| `--rotation-interval <秒>` | 轮换间隔,默认 10 秒(与主程序一致) |
| 其余 `--device` / `--cache-dir` / `--orientation-model` 等 | 与 stdio 模式共用,控制检测模型 |

接口(仅监听 127.0.0.1,CORS 全开,支持 OPTIONS 预检):

| 接口 | 说明 |
| --- | --- |
| `GET /background?width=<宽>&height=<高>[&format=png][&meta=1]` | 返回裁剪好的图片字节(jpeg 质量 92,`format=png` 可选);`meta=1` 改返回 JSON |
| `GET /health` | 运行状态 JSON:`ok` `port` `images` `current` `generation` `modelReady` `lastViewport` |

行为要点:

- 响应头 `X-Background-Generation` 标换代(随机轮换,缺省 10 秒,与主程序一致);`X-Detection-Pending: 1` 表示检测尚未就绪,本次为图心回退裁剪,后台检测完成后稍后重取即可拿到 AI 结果(单次等待上限 15 秒,检测失败不缓存)。
- `meta=1` 的 JSON 字段:`generation` `path` `imageWidth` `imageHeight` `crop{x,y,width,height}` `width` `height` `format` `detectionPending` `data`(图片字节 Base64)。
- 参数缺省或非法返回 400;图库为空返回 503;模型在后台线程加载,HTTP 立即可用,就绪前所有请求返回图心回退裁剪。
- 单例:端口被占用时新实例报错退出(Windows 上已关闭 SO_REUSEADDR,不会静默双实例)。
- 检测按 (当前图, 视口) 缓存,跨视口不复用——Python 的 `background_crop` 依赖视口比例。

## Python 视觉识别子进程协议

`VisualRegionDetector` 以 `--server` 模式启动常驻子进程,通过 stdin/stdout 的 JSON 行协议通信(检测请求串行化,Python 端逐行处理):

```text
启动:python -X utf8 python/visual_region_detector.py --server --device auto \
      --cache-dir <模型目录> [--orientation-model <方向模型>]
握手:进程就绪后向 stdout 输出一行 {"ready": true},主进程最多等 120 秒
请求:{"image": "正斜杠分隔的图片绝对路径", "viewport_size": [视口宽, 视口高]}
响应:{"detected": true, "background_crop": {"x": .., "y": .., "width": .., "height": ..}}
      或 {"error": "..."};调试模式另含 debug_overlay(Base64 PNG)与
      debug_overlay_size(像素尺寸)
```

注意:

- `-X utf8` 必须保留——Windows 上管道 stdin 默认按 ANSI 代码页解码,中文路径会乱码。
- Python 端逐行处理、不支持并发,主进程用 promise 链串行化检测请求;单次检测超时 120 秒。
- 识别失败/超时不阻塞轮播:主进程回退为以图心为中心的视口比例裁剪。

## Python 环境与模型路径

Python 资源不打包进应用。运行时先看**程序所在目录旁的 `python/`**,找不到再从 exe 目录向上逐级找含 `visual_region_detector.py` 的 `python/`(开发模式即仓库根的 `python/`);目录内的解析如下,均可用 INI `[Paths]` 键覆盖(`python_executable` / `visual_region_script` / `orientation_model` / `python_model_cache`):

| 资源 | 解析结果 |
| --- | --- |
| 解释器 | `<python>/.venv/Scripts/python.exe`(无 venv 时 `<python>/python.exe`) |
| 识别脚本 | `<python>/visual_region_detector.py` |
| 方向模型 | `<python>/orientation-model/best.pt` |
| 姿态模型目录 | `<python>/model-cache` |

部署打包版时把仓库 `python/` 目录整个复制到 exe 旁边即可(`python/.venv` 需用 `python/requirements.txt` 装好依赖:Ultralytics YOLO 姿态模型 + OpenCV);方向模型不存在时自动跳过并使用 fallback 视觉检测。
