# NTE Mod Manager (NTEMM)

适用于 Neverness To Everness 的 Windows 桌面模组管理器。界面与业务逻辑位于 [`app/`](app/README.md)(Electron + React 18 + TypeScript + Tailwind CSS + shadcn/ui),功能、配置与构建说明见该文档;仓库同时包含应用依赖的 Python 视觉识别服务与模型训练代码。

## 视觉识别服务

生产环境使用的视觉推理服务是 `python/visual_region_detector.py`(Python 3.12,依赖见 `requirements.txt`,安装在仓库根的 `.venv`)。应用以 `--server` 参数启动该服务，并逐行发送图片路径；服务返回包含最终 `background_crop` 框、检测状态、关键点、估计的胸部/髋部区域以及每个人 `orientation` 的 JSON。服务从 `python/orientation-model/best.pt` 加载 ConvNeXt-Tiny 检查点；正面或背面结果的置信度低于 `0.50` 时，会被视为 `uncertain`。对于正面和朝向不确定的人物，当胸部和髋部无法同时放入画面时，背景框优先保留胸部区域；对于背面人物，则优先保留髋部区域。服务使用 `auto` 自动选择设备；当朝向检查点不可用时，会回退到原有的裁剪行为。

如需批量测试相同的 YOLO26 姿态检测、朝向分类和背景取景逻辑，请运行 `python/test_images.py`。不指定路径选项时，脚本会读取 `D:\pictures\test`，将标注了人物框、关键点、骨架、估计胸部/髋部区域以及黄色背景裁剪框的图片写入 `D:\pictures\test_result`，并将响应保存到 `results.json`。如果只能看到一个肩部关键点，脚本会在人物框内创建另一个水平方向的虚拟肩部点，并将其标记为 `virtual: true`。背景框使用管理器默认的 `1315x1000` 窗口比例，在源图片允许的范围内尽可能放大，并按照上文所述的朝向优先级定位。背景框坐标会保存为 `background_crop`。每个结果都包含耗时（单位为秒），终端还会报告总测试时间：

```powershell
& .\.venv\Scripts\python.exe .\python\test_images.py --device cuda --model .\yolo26m-pose.pt
```

## 朝向模型训练

独立的 ConvNeXt-Tiny 朝向训练代码和数据集目录位于 `training/` 下，与生产环境的 Python 模块分开。完整的标注规则、目录结构、环境配置、训练参数、输出格式和评估说明，请参阅 [training/README.md](training/README.md)。在仓库根目录执行的简化命令如下：

```powershell
& .\.venv\Scripts\python.exe .\training\orientation\train_orientation.py --epochs 15 --batch-size 16 --device auto
```
