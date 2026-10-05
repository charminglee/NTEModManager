# NTE Mod Manager (NTEMM)

适用于 Neverness To Everness 的 Windows 桌面模组管理器。项目使用 C++20 和 Qt 6 Widgets 编写，并使用原生目录符号链接，因此已安装的模组文件不会被重复占用空间。

## 配置

首次启动 NTEMM 时，会在 `NteModManager.exe` 所在目录生成 `NteModManager.ini` 配置文件，修改该文件后需重启应用。

| 配置键 | 用途 | 默认值 |
| --- | --- | --- |
| `mods_directory` | 游戏模组安装目录 | `E:\Neverness To Everness\Client\WindowsNoEditor\HT\Content\Paks\~mods` |
| `backups_directory` | 模组备份和管理器状态目录 | `E:\NteMod\Backups` |
| `background_images_directory` | 背景图片目录。留空可禁用背景图片。 | `D:\pictures\真人` |
| `game_launcher` | **Launch Game** 按钮启动的游戏启动器 | `E:\Neverness To Everness\NTELauncher.exe` |
| `packager_directory` | 包含 `傻瓜打包器.bat` 和生成的打包文件的目录 | `E:\Projects\ModManager\傻瓜打包器` |
| `Preferences/auto_use_last_packaging_path` | 重新打包时是否自动使用该模组上次选择的源文件夹。设为 `0` 可每次重新选择。 | `1` |

`[Categories] names` 设置以逗号分隔的角色名列表。模组名称必须符合 `角色名-二级名称` 或 `角色名-二级名称-三级名称` 格式，其中角色名必须在此列表中；不符合格式的模组会显示在 `其他` 分类中。特殊分类 `全部` 和 `其他` 始终可用，不要将它们添加到此设置中。

生产环境使用的视觉推理服务是 `src/python/visual_region_detector.py`。C++ 管理器使用 `--server` 参数启动该服务，并逐行发送图片路径；服务返回包含最终 `background_crop` 框、检测状态、关键点、估计的胸部/髋部区域以及每个人 `orientation` 的 JSON。服务从 `python/orientation-model/best.pt` 加载 ConvNeXt-Tiny 检查点；正面或背面结果的置信度低于 `0.50` 时，会被视为 `uncertain`。对于正面和朝向不确定的人物，当胸部和髋部无法同时放入画面时，背景框优先保留胸部区域；对于背面人物，则优先保留髋部区域。服务使用 `auto` 自动选择设备；当朝向检查点不可用时，会回退到原有的裁剪行为。构建时，该脚本和检查点会与独立 Python 运行时一起打包到 `build\Release\python` 下。

如需批量测试相同的 YOLO26 姿态检测、朝向分类和背景取景逻辑，请运行 `src/python/test_images.py`。不指定路径选项时，脚本会读取 `D:\pictures\test`，将标注了人物框、关键点、骨架、估计胸部/髋部区域以及黄色背景裁剪框的图片写入 `D:\pictures\test_result`，并将响应保存到 `results.json`。如果只能看到一个肩部关键点，脚本会在人物框内创建另一个水平方向的虚拟肩部点，并将其标记为 `virtual: true`。背景框使用管理器默认的 `1315x1000` 窗口比例，在源图片允许的范围内尽可能放大，并按照上文所述的朝向优先级定位。背景框坐标会保存为 `background_crop`。每个结果都包含耗时（单位为秒），终端还会报告总测试时间：

```powershell
& .\.venv\Scripts\python.exe .\src\python\test_images.py --device cuda --model .\yolo26m-pose.pt
```

独立的 ConvNeXt-Tiny 朝向训练代码和数据集目录位于 `training/` 下，与生产环境的 Python 模块分开。完整的标注规则、目录结构、环境配置、训练参数、输出格式和评估说明，请参阅 [training/README.md](training/README.md)。在仓库根目录执行的简化命令如下：

```powershell
& .\.venv\Scripts\python.exe .\training\orientation\train_orientation.py --epochs 15 --batch-size 16 --device auto
```

备份目录会在首次启动时创建。只有当游戏的父级 `Paks` 目录已经存在时，程序才会创建 `~mods`；程序不会创建虚假的游戏安装目录树。

## 环境要求

- Windows 10 或 11。
- CMake 3.21 或更高版本。
- C++20 编译器。推荐安装带有“使用 C++ 的桌面开发”工作负载的 Visual Studio 2022 Build Tools。
- Qt 6.5 或更高版本，并包含 `Widgets` 组件；Qt 必须使用与本项目相同的编译器和架构构建。
- Python 3.12，以及位于 `.venv` 的项目环境，并从 `requirements.txt` 安装生产环境依赖。可选的独立训练环境及其依赖项见 [training/README.md](training/README.md)。
- 用于解压 ZIP、RAR 和 7z 文件的 [7-Zip](https://www.7-zip.org/)。

程序按以下顺序查找 `7z.exe`：

1. CMake 的 `NTE_7ZIP_PATH` 缓存变量。
2. `NTE_7ZIP_PATH` 环境变量。
3. 系统 `PATH`（`7z`、`7z.exe`、`7zz` 或 `7zz.exe`）。
4. `C:\Program Files\7-Zip\7z.exe`。
5. `C:\Program Files (x86)\7-Zip\7z.exe`。

## 构建

Qt 和 7-Zip 的路径保存在 `CMakeUserPresets.json` 中，首次使用时可复制示例文件。

需要关注的配置项是：`NTE_QT_ROOT` 指向包含 `lib/cmake/Qt6` 的 Qt kit 根目录，`NTE_7ZIP_PATH` 指向 `7z.exe` 或 `7zz.exe`。

构建过程会将独立 Python 运行时、环境包、检测脚本、训练得到的朝向检查点以及缓存的 YOLO 文件复制到 `build\Release\python`。可执行文件会根据自身位置查找这些文件，因此 `NteModManager.ini` 中不需要保存 Python 路径。如果缓存中没有 YOLO 模型，Python 会在首次使用时下载。

同一构建还会生成无界面的 `NteBackgroundImageServer.exe`。服务自身采用单例互斥体，重复启动的服务进程会退出；该互斥体与 `NteModManager` 不同，两者可以同时运行。服务默认监听 `127.0.0.1:48126`，仅接受本机连接；可以用 `--port 48127` 指定其他端口。

请求接口为 `GET /background?width=<窗口宽度>&height=<窗口高度>`，例如 `http://127.0.0.1:48126/background?width=1315&height=1000`。成功时响应体是 PNG 图片，像素尺寸与请求的宽、高一致；每次请求从 `background_images_directory` 中随机选择图片，并复用桌面版的 AI 检测与裁剪逻辑。请求错误以 HTTP 状态码和 JSON `error` 字段返回；宽或高不能超过 16384，且总像素不能超过 64 Mi。

## 使用说明

- 将一个或多个 `.zip`、`.rar` 或 `.7z` 文件拖放到应用窗口的任意位置。
- 每个压缩包都会被解压到 `Backups` 中独立的目录。如果压缩包中恰好包含一个顶层文件夹，则使用该文件夹作为模组根目录。
- 只有在解压和状态记录都成功后，原始压缩包才会被永久删除，不会被移入回收站。
- **Package Mod**（打包模组）会运行 `傻瓜打包器\傻瓜打包器.bat`。运行成功后，输入模组名称，程序会将 `Mod_P.pak`、`Mod_P.ucas` 和 `Mod_P.utoc` 复制到 `Backups` 中的新文件夹。
- **重新打包**会为每个模组分别记住上次选择的源文件夹，并将路径保存到 `Backups\\.nte-mod-manager.json`；当 `Preferences/auto_use_last_packaging_path=1` 且该文件夹仍存在时，后续操作会直接复用它，不再弹出选择窗口。关闭该配置后，每次操作都会重新选择文件夹。
- **Install**（安装）会在游戏的 `~mods` 文件夹中创建目录符号链接。链接存在期间，该按钮会被禁用。
- **Uninstall**（卸载）只会移除该目录符号链接。不存在链接时，该按钮会被禁用。
- **Delete**（删除）会移除对应的符号链接，永久删除备份文件夹，并刷新列表。
- 当前选中的模组列表排序会保存到 `NteModManager.ini`，下次启动时自动恢复。
- 使用 `默认`、`名称：A 到 Z` 或 `名称：Z 到 A` 排序时，模组列表会按名称中的二级名称分组显示标题。
- 同一个一级角色名下的二级名称分组同时只能安装一个模组。安装模组时，如果该角色的该分组已有已安装模组，程序会先自动卸载它。
- 可在模组的更多选项中标记或取消标记“失效”。标记失效时会自动卸载该模组；安装失效模组前会要求确认。
- 分类总览包含 `全部`、已配置的分类和 `其他`。`全部` 固定在顶部，`其他` 固定在底部。普通分类卡片可以拖动排序，排序结果会保存到 `NteModManager.ini`。
- 点击分类即可打开该分类的模组列表。使用返回按钮回到分类总览。
- 状态和操作历史保存在 `Backups\.nte-mod-manager.json` 中，包括导入时间以及每次安装/卸载操作。
