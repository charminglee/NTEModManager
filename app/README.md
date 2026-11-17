# NTE 模组管理器 (NTEMM)

适用于 Neverness To Everness 的 Windows 桌面模组管理器:**Electron + React 18 + TypeScript + Tailwind CSS + shadcn/ui**,采用角色分类、模组列表与详情三栏布局，以及暖白、朱红、墨黑半透明主题。使用模组备份目录、`.nte-mod-manager.json` 状态清单与 `NteModManager.ini` 配置键管理数据。

## 功能

- **AyakaMods 社区**：顶部导航提供异环社区内嵌浏览页，支持站内浏览与刷新。内嵌页仅供浏览；浏览器开发模式展示页面入口与地址预览。

- **整合包**：根目录下至少两个第一层文件夹含有 `.pak`、`.ucas` 或 `.utoc` 资源时，自动识别为整合包。列表显示整合包标识，详情提供子模组独立开关；已安装时切换立即生效，未安装时保存选择。整包卸载、重装及更新后保留同名子模组选择。更深目录整体随所属子模组启停，根目录散放资源随整包启停。

- **导入**:将 `.zip` / `.rar` / `.7z` 压缩包拖放到窗口任意位置,或点击「导入」按钮;解压到备份目录,导入后可逐个重命名(支持 `角色名-二级名称[-三级名称]` 自动归类)。
- **分类侧边栏**:`全部` 固定顶部、`其他` 固定底部,普通分类可拖拽排序(持久化到 INI);每个分类显示角色头像(`../img/bg/<分类>.png`)与模组计数。
- **安装 / 卸载**:安装 = 将模组文件夹复制到游戏 `~mods` 目录;同一角色同一二级名称分组互斥(自动卸载同组模组,`exclusive_install_exempt_groups` 名单豁免)。
- **批量操作**：当前分类提供「全部安装」「全部卸载」按钮，操作前弹出确认对话框；安装失效模组时额外提示风险。
- **模组卡片**:展开查看文件树(文件夹折叠、双击文件名内联重命名,`pak/ucas/utoc` 三件套按 `_P` 规则组重命名);更多菜单:重命名、重新打包、添加压缩包、更新/替换压缩包、标记失效、打开源/安装位置、删除。
- **打包模组 / 重新打包**:运行随应用构建的 `傻瓜打包器.bat`(退出码 2 视为取消);重新打包自动复用该模组上次选择的源文件夹(`auto_use_last_packaging_path`)。
- **失效标记**:标记时自动卸载,安装失效模组前要求确认。
- **分组显示**：模组按二级名称分组，组内保持仓库扫描顺序。
- **日志页**:运行日志实时推送、跟随滚动、按级别着色;日志文件在 `~/.ntemm/logs/NteModManager.log`。
- **背景图轮播 + AI 识别**:主进程随机选图后调用内嵌 Python 视觉识别(`visual_region_detector.py`,YOLO 姿态 + 方向分类)计算人物焦点区域,按窗口视口裁剪铺满显示;每 10 秒轮换并以 900ms 交叉淡化过渡,窗口 resize 后自动重新识别。方向模型缺失或 Python 不可用时自动回退为显著性焦点检测。`↓` 切换背景,`F10` 打开当前背景源文件,`F12` 开关 AI 调试线框(状态栏显示识别状态),`F9` 隐藏/显示界面(双击背景恢复),`F11` 全屏(浏览器模式下为 Chrome 内置全屏,Electron 下为窗口原生全屏)。外部程序可运行 `python/visual_region_detector.py --http` 通过 HTTP 接口获取同样的 AI 裁剪背景图,见 `docs/background-image-service.md`。

点击「启动游戏」后，启动器创建成功时自动最小化管理器；启动失败时保留窗口并提示错误。管理器最小化期间冻结整个界面，暂停背景轮播和检测队列，并关闭 Python 视觉识别进程。恢复窗口后保留原有界面状态，重新启动识别进程和背景轮播。

Python 服务通过 stderr 的 JSON Lines 日志通道传递级别、时间和正文，管理器日志窗口按原级别显示，并为每行自动加上 `[Python] ` 前缀。异常堆栈逐行展示；第三方库直接输出的普通文本作为警告保留。stdout 继续用于识别握手与结果，独立 HTTP 模式保持文本日志。

## 界面动效

界面采用精致克制的动效节奏，统一定义于 `src/renderer/src/motion.css`：控件反馈约 140 毫秒，内容过渡约 240 至 360 毫秒，列表错峰最多延迟 72 毫秒。覆盖主页面、设置分组、分类与筛选、详情面板、文件树、批量操作栏、导入反馈和浮层。筛选仅对可见模组补间位置，业务状态立即更新；持续推送的日志不逐行播放入场。

条件面板使用 `MotionPresence` 保留短暂退场，退场期间禁用交互和键盘访问，快速重新打开会取消卸载。系统开启「减少动态效果」时，关闭位移、回弹和循环播放，保留即时状态反馈。动效不引入额外运行依赖。

## 开发

```powershell
cd app
npm install
npm run dev        # 开发模式(热更新)
npm run build      # 生产构建到 out/
npm run typecheck  # 主进程 + 渲染进程类型检查
npm run dist       # electron-builder 打包(dist/ 目录,绿色版)
```

环境变量 `NTEMM_AUTO_SCREENSHOT=<png 路径>` 可在启动 8 秒后自动截图并退出(冒烟测试用);`NTEMM_SMOKE_KEYS=<png 前缀>` 自动发送 F12/↓ 并分阶段截图(验证背景调试线框/切换/轮播);`NTEMM_USER_DATA=<目录>` 隔离 userData 与日志(单例锁),可与正在运行的实例并存调试。

> 网络受限时安装 Electron 二进制:设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后运行 `node scripts/install-electron.cjs`(npm 拦截 postinstall 时也可用它补装)。
>
> `npm run dist` 若报 `Cannot create symbolic link`(winCodeSign 缓存解压失败):winCodeSign 包内含 macOS 符号链接,Windows 无管理员/开发者模式权限时无法创建。运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\seed-wincodesign.ps1` 预置缓存(排除仅用于 macOS 签名的 darwin 符号链接)后重新打包即可。

## 数据目录

所有运行数据统一保存在 `~/.ntemm/`,互不影响目录外文件:

| 路径 | 内容 |
| --- | --- |
| `~/.ntemm/NteModManager.ini` | 配置文件(见下表;`NTEMM_CONFIG` 可指向别处,Python 背景识别服务的 `--config` 参数解析同一变量) |
| `~/.ntemm/logs/` | 运行日志 |
| `~/.ntemm/cache/` | Python 相关缓存:姿态模型 `python-model/`、Ultralytics 设置 `ultralytics/`、Torch Hub `torch/` |
| `~/.ntemm/electron/app/` | 主程序 Electron userData(窗口状态、Local Storage、GPU/代码缓存) |

用 `NTEMM_USER_DATA` 隔离启动时,userData 与日志改随隔离目录走(日志在 `<隔离目录>/logs/`),不触碰上表。从已有安装升级时自动迁移:exe/app 目录下的旧 ini、`%APPDATA%/nte-mod-manager` 的 userData(跳过可再生缓存)会在首次启动时搬入上述位置,旧文件保留不删。

## 配置

首次启动在 `~/.ntemm/` 下生成 `NteModManager.ini`,修改后需重启:

| 配置键 | 用途 |
| --- | --- |
| `Paths/mods_directory` | 游戏模组安装目录(`~mods`) |
| `Paths/backups_directory` | 模组备份目录(含 `.nte-mod-manager.json` 状态清单) |
| `Paths/background_images_directory` | 背景图片目录(数值命名的子目录),留空禁用 |
| `Paths/game_launcher` | 「启动游戏」按钮启动的启动器 |
| `Categories/names` | 角色分类名(逗号分隔) |
| `Preferences/mod_category_order` | 分类拖拽排序结果 |
| `Preferences/auto_use_last_packaging_path` | 重新打包时自动复用上次的源文件夹 |
| `Preferences/exclusive_install_exempt_groups` | 互斥安装豁免的二级名称分组 |
| `Preferences/window_size` | 窗口尺寸(关闭时自动保存) |
| `Debug/test_images` | 背景图改用 `F:/pictures/test`(调试);`npm run dev` 自动开启,`npm run dist` 自动关闭 |
| `Paths/python_executable` | 视觉识别 Python 解释器;缺省 `python/.venv/Scripts/python.exe`(无 venv 时 `python/python.exe`) |
| `Paths/visual_region_script` | `visual_region_detector.py` 路径(保持 Python 实现) |
| `Paths/orientation_model` | 方向分类模型 `best.pt`;文件不存在时使用 fallback 检测 |
| `Paths/python_model_cache` | 姿态模型 `yolo26x-pose.pt` 所在目录;缺省 `python/model-cache` |

仍需系统安装 [7-Zip](https://www.7-zip.org/)(查找顺序:`NTE_7ZIP_PATH` 环境变量 → 应用目录 → PATH → Program Files)。

## 架构

```
src/shared/       主进程与渲染进程共享：类型、分类纯逻辑
src/main/         Electron 主进程
  ntemm-paths.ts    ~/.ntemm 数据目录布局与旧 userData 迁移
  config.ts         NteModManager.ini 读写(含 Python/模型路径)
  repository.ts     模组仓库:扫描/导入/安装/卸载/重命名/删除/清单
  operations.ts     互斥安装、批量安装/卸载
  archive.ts        7z 查找与解压(GBK 输出解码)
  packager.ts       内置傻瓜打包器路径解析与 bat 调用
  background.ts     背景图目录扫描
  visual-region-detector.ts  视觉识别:Python 桥、fallback 检测、视口裁剪
  background-carousel.ts     背景轮播状态机:10s 轮换/检测队列/状态推送
  ipc.ts            全部 IPC 处理器(操作串行化,进度事件推送)
  logger.ts         内存 + 文件日志,实时推送渲染进程
src/preload/      contextBridge 暴露类型化 window.api(含 webUtils 拖放路径)
src/renderer/     React 界面
  components/       sidebar(分类导航/拖拽排序)、mod-card、file-tree、
                    mod-list-header、status-bar、log-view、background-layer(交叉淡化/调试线框)、prompt-dialog
  components/ui/    shadcn/ui 组件(button/dialog/dropdown-menu/alert-dialog/…)
  components/app-header.tsx       顶部导航与任务进度
  components/mod-detail.tsx       模组详情与文件树
  components/settings-view.tsx    分组设置工作区
  components/ayakamods-page.tsx   AyakaMods 社区内嵌浏览与开发模式入口
  assets/                        都市剪影 SVG 图形与社区图标
```

## 界面

桌面窗口使用无边框模式，右上角提供最小化、最大化／还原和关闭按钮。顶部品牌栏空白区域可拖动窗口；最大化状态与系统同步。窗口按钮在隐藏界面时仍可使用，最小化与关闭继续走原有窗口生命周期处理。浏览器预览仅模拟最大化／还原状态，不会最小化或关闭浏览器。

界面采用暖白、朱红与墨黑配色，顶栏、侧栏、内容区和详情区使用半透明底色让背景图贯穿整窗，按钮、输入框和弹层保持较高不透明度以保证操作可读性。左侧角色栏直接列出分类，中间列表按安装状态筛选，点击条目后在右侧查看文件与操作。详情栏可关闭，窄窗口以侧滑方式显示。安装按同组互斥规则及豁免分组执行，文件名可双击重命名。

顶部保留模组库、运行日志、设置和启动游戏；不显示「背景展示」入口及全局底部信息栏。操作进度在顶部任务提示中显示，失败通过通知和日志呈现。多选时才出现上下文批量操作条。设置使用完整工作区，包含路径、操作偏好和高级三组；离开未保存的设置时会提示。旧版材质参数在下一次保存配置时清理。

背景轮播与视觉识别服务保持独立；管理界面使用半透明蒙层呈现背景轮播，不再执行面板材质画布或折射渲染。

Python 资源(解释器、识别脚本、模型)**不打包进应用**:运行时优先解析程序所在目录旁的 `python/`,找不到则从 exe 目录向上逐级找含 `visual_region_detector.py` 的 `python/`(开发模式即仓库根的 `python/`)。部署打包版时把仓库 `python/` 目录整个复制到 exe 旁边即可;该目录需可用 `python/requirements.txt` 装好依赖(torch/ultralytics/torchvision/Pillow),即 `python/.venv`。设置界面不再提供 Python 路径项,上述 `Paths/*` INI 键保留作手动兜底。

傻瓜打包器随应用构建到 `resources/packager`，开发模式直接使用仓库根目录的 `傻瓜打包器/`。设置界面不再提供打包器目录，旧版 `Paths/packager_directory` 键会在下次保存设置时清理。

安全:modelContextIsolation 开启、nodeIntegration 关闭;图片通过自定义 `media://` 协议按扩展名白名单提供。
