# NTE 模组管理器 (React 重构版)

原 Qt 6 Widgets 桌面模组管理器的重构版本:**Electron + React 18 + TypeScript + Tailwind CSS + shadcn/ui**,采用流行的左侧边栏布局与深色高级感主题(紫罗兰点缀,实底面板)。业务逻辑完整移植自 `../src` 下的 C++ 实现,并复用原有数据(模组备份目录、`.nte-mod-manager.json` 状态清单、`NteModManager.ini` 配置键)。

## 功能

- **导入**:将 `.zip` / `.rar` / `.7z` 压缩包拖放到窗口任意位置,或点击「导入」按钮;解压到备份目录,导入后可逐个重命名(支持 `角色名-二级名称[-三级名称]` 自动归类)。
- **分类侧边栏**:`全部` 固定顶部、`其他` 固定底部,普通分类可拖拽排序(持久化到 INI);每个分类显示角色头像(`../img/bg/<分类>.png`)与模组计数。
- **安装 / 卸载**:安装 = 将模组文件夹复制到游戏 `~mods` 目录;同一角色同一二级名称分组互斥(自动卸载同组模组,`exclusive_install_exempt_groups` 名单豁免)。
- **批量操作**:当前分类「全部安装 / 全部卸载」,含失效模组确认。
- **模组卡片**:展开查看文件树(文件夹折叠、双击文件名内联重命名,`pak/ucas/utoc` 三件套按 `_P` 规则组重命名);更多菜单:重命名、重新打包、添加压缩包、更新/替换压缩包、标记失效、打开源/安装位置、删除。
- **打包模组 / 重新打包**:运行 `傻瓜打包器.bat`(退出码 2 视为取消);重新打包自动复用该模组上次选择的源文件夹(`auto_use_last_packaging_path`)。
- **失效标记**:标记时自动卸载,安装失效模组前要求确认。
- **排序**:默认(已安装优先)/ 名称 A-Z / Z-A / 导入时间 / 文件大小;默认与名称排序按二级名称分组显示。
- **日志页**:运行日志实时推送、跟随滚动、按级别着色;日志文件在 `%APPDATA%/nte-mod-manager/logs/NteModManager.log`。
- **背景图轮播 + AI 识别**:完整移植原 Qt 版 `BackgroundWidget` + `VisualRegionDetector`——主进程随机选图后调用内嵌 Python 视觉识别(`visual_region_detector.py`,YOLO 姿态 + 方向分类)计算人物焦点区域,按窗口视口裁剪铺满显示;每 10 秒轮换并以 900ms 交叉淡化过渡,窗口 resize 后自动重新识别。方向模型缺失或 Python 不可用时自动回退为显著性焦点检测。`↓` 切换背景,`F10` 打开当前背景源文件,`F12` 开关 AI 调试线框(状态栏显示识别状态),`F11` 隐藏/显示界面(双击背景恢复)。

## 开发

```powershell
cd app
npm install
npm run dev        # 开发模式(热更新)
npm run build      # 生产构建到 out/
npm run typecheck  # 主进程 + 渲染进程类型检查
npm run dist       # electron-builder 打包(dist/ 目录,绿色版)
```

环境变量 `NTEMM_AUTO_SCREENSHOT=<png 路径>` 可在启动 8 秒后自动截图并退出(冒烟测试用);`NTEMM_SMOKE_KEYS=<png 前缀>` 自动发送 F12/↓ 并分阶段截图(验证背景调试线框/切换/轮播);`NTEMM_USER_DATA=<目录>` 隔离 userData(单例锁与日志),可与正在运行的实例并存调试。

> 网络受限时安装 Electron 二进制:设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后运行 `node scripts/install-electron.cjs`(npm 拦截 postinstall 时也可用它补装)。
>
> `npm run dist` 若报 `Cannot create symbolic link`(winCodeSign 缓存解压失败):winCodeSign 包内含 macOS 符号链接,Windows 无管理员/开发者模式权限时无法创建。运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\seed-wincodesign.ps1` 预置缓存(排除仅用于 macOS 签名的 darwin 符号链接)后重新打包即可。

## 配置

首次启动在可执行文件同目录(开发模式为 `app/` 目录)生成 `NteModManager.ini`,键与 Qt 版完全一致,修改后需重启:

| 配置键 | 用途 |
| --- | --- |
| `Paths/mods_directory` | 游戏模组安装目录(`~mods`) |
| `Paths/backups_directory` | 模组备份目录(含 `.nte-mod-manager.json` 状态清单) |
| `Paths/background_images_directory` | 背景图片目录(数值命名的子目录),留空禁用 |
| `Paths/game_launcher` | 「启动游戏」按钮启动的启动器 |
| `Paths/packager_directory` | 包含 `傻瓜打包器.bat` 与打包产物的目录 |
| `Categories/names` | 角色分类名(逗号分隔) |
| `Preferences/mod_category_order` | 分类拖拽排序结果 |
| `Preferences/mod_list_sort_order` | 排序方式(0-6) |
| `Preferences/auto_use_last_packaging_path` | 重新打包时自动复用上次的源文件夹 |
| `Preferences/exclusive_install_exempt_groups` | 互斥安装豁免的二级名称分组 |
| `Preferences/window_size` | 窗口尺寸(关闭时自动保存) |
| `Debug/test_images` | 背景图改用 `F:/pictures/test`(调试);`npm run dev` 自动开启,`npm run dist` 自动关闭 |
| `Paths/python_executable` | 视觉识别 Python 解释器;缺省用仓库 `.venv`(开发)或 `resources/python/python.exe`(打包) |
| `Paths/visual_region_script` | `visual_region_detector.py` 路径(保持 Python 实现) |
| `Paths/orientation_model` | 方向分类模型 `best.pt`;文件不存在时使用 fallback 检测 |
| `Paths/python_model_cache` | 姿态模型 `yolo26x-pose.pt` 所在目录 |

仍需系统安装 [7-Zip](https://www.7-zip.org/)(查找顺序:`NTE_7ZIP_PATH` 环境变量 → 应用目录 → PATH → Program Files)。

## 架构

```
src/shared/       主进程与渲染进程共享:类型、分类/排序纯逻辑(对应 ModListLogic)
src/main/         Electron 主进程(原 C++ 业务逻辑的 TS 移植)
  config.ts         NteModManager.ini 读写(对应 AppConfig,含 Python/模型路径)
  repository.ts     模组仓库:扫描/导入/安装/卸载/重命名/删除/清单(对应 ModRepository)
  operations.ts     互斥安装、批量安装/卸载
  archive.ts        7z 查找与解压(GBK 输出解码)
  packager.ts       傻瓜打包器 bat 调用
  background.ts     背景图目录扫描(对应 BackgroundImageCatalog)
  visual-region-detector.ts  视觉识别:Python 桥、fallback 检测、视口裁剪(对应 VisualRegionDetector)
  background-carousel.ts     背景轮播状态机:10s 轮换/检测队列/状态推送(对应 BackgroundWidget)
  ipc.ts            全部 IPC 处理器(操作串行化,进度事件推送)
  logger.ts         内存 + 文件日志,实时推送渲染进程
src/preload/      contextBridge 暴露类型化 window.api(含 webUtils 拖放路径)
src/renderer/     React 界面
  components/       sidebar(分类导航/拖拽排序)、mod-card、file-tree、
                    mod-list-header、status-bar、log-view、background-layer(交叉淡化/调试线框)、prompt-dialog
  components/ui/    shadcn/ui 组件(button/dialog/dropdown-menu/alert-dialog/…)
```

Python 环境(`.venv` 或 `Paths/python_executable`)需安装 `requirements.txt` 依赖(torch/ultralytics/torchvision/Pillow);打包版将脚本与模型放入 `resources/python/`(electron-builder extraResources 已配置),解释器目录需自行放置。

安全:modelContextIsolation 开启、nodeIntegration 关闭;图片通过自定义 `media://` 协议按扩展名白名单提供。
