# NTE Mod Manager (NTEMM)

适用于 Neverness To Everness 的 Windows 桌面模组管理器。界面与业务逻辑位于 [`app/`](app/README.md)(Electron + React 18 + TypeScript + Tailwind CSS + shadcn/ui),功能、配置与构建说明见该文档;仓库同时包含应用依赖的 Python 视觉识别服务与模型训练代码。

## 视觉识别服务

生产环境使用的视觉推理服务是 `python/visual_region_detector.py`(Python 3.12,依赖见 `python/requirements.txt`,安装在仓库 `python/.venv`)。应用以 `--server` 参数启动该服务，并逐行发送图片路径；服务返回包含最终 `background_crop` 框、检测状态、关键点、估计的胸部/髋部区域以及每个人 `orientation` 的 JSON。服务从 `python/orientation-model/best.pt` 加载 ConvNeXt-Tiny 检查点；正面或背面结果的置信度低于 `0.50` 时，会被视为 `uncertain`。对于正面和朝向不确定的人物，当胸部和髋部无法同时放入画面时，背景框优先保留胸部区域；对于背面人物，则优先保留髋部区域。服务使用 `auto` 自动选择设备；当朝向检查点不可用时，会回退到原有的裁剪行为。

除被主程序以 `--server` 模式(stdio JSON 行协议)调用外,同一脚本还提供 `--http` 模式,供外部程序获取 AI 裁剪背景图:`GET http://127.0.0.1:26925/background?width=<宽>&height=<高>` 返回按视口比例、以识别焦点为中心裁剪好的图片字节,可直接用作背景;另有 `/health` 状态接口与 `meta=1` 的 JSON 输出(含裁剪矩形)。图库、端口等配置默认读取 `~/.ntemm/NteModManager.ini`,图库随机轮换(默认 10 秒)。启动方式与全部参数见 [docs/background-image-service.md](docs/background-image-service.md):

```powershell
& .\python\.venv\Scripts\python.exe .\python\visual_region_detector.py --http --cache-dir .\python\model-cache --orientation-model .\python\orientation-model\best.pt
```

## 朝向模型训练

独立的 ConvNeXt-Tiny 朝向训练代码和数据集目录位于 `training/` 下，与生产环境的 Python 模块分开。完整的标注规则、目录结构、环境配置、训练参数、输出格式和评估说明，请参阅 [training/README.md](training/README.md)。在仓库根目录执行的简化命令如下：

```powershell
& .\python\.venv\Scripts\python.exe .\training\orientation\train_orientation.py --epochs 15 --batch-size 16 --device auto
```
