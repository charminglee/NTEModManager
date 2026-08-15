# NTE Mod Manager

Windows desktop mod manager for Neverness To Everness. It is written in C++20 with Qt 6 Widgets and uses native directory symbolic links so installed mod files are not duplicated.

## Configuration

`NteModManager.ini` is copied next to `NteModManager.exe` during the build. Edit that file and restart the application to use different paths.

| Key | Purpose | Default |
| --- | --- |
| `mods_directory` | Game mod installation | `E:\Neverness To Everness\Client\WindowsNoEditor\HT\Content\Paks\~mods` |
| `backups_directory` | Mod backups and manager state | `E:\Neverness To Everness\Mods\Backups` |
| `background_images_directory` | Background image folders. Leave blank to disable background images. | `F:\pictures\真人` |
| `game_launcher` | Game launcher started by the **Launch Game** button | `E:\Neverness To Everness\NTELauncher.exe` |
| `packager_directory` | Directory containing `傻瓜打包器.bat` and generated package files | `E:\Neverness To Everness\Mods\ModManager\傻瓜打包器` |

The `[Categories] names` setting contains the normal mod categories as a comma-separated list. A mod is assigned to the first matching name prefix; unmatched mods are shown under `其他`. The special categories `全部` and `其他` are always available and must not be added to this setting.

Set `[Debug] test_images=1` to ignore `Paths/background_images_directory` and load background images directly from `F:\pictures\test`. The default is `0`.

The production visual inference service is `src/python/visual_region_detector.py`. The C++ manager starts it with `--server` and sends one image path per line; it returns JSON with the final `background_crop` frame, detection state, keypoints, estimated chest/hip regions, and each person's `orientation`. The service loads the ConvNeXt-Tiny checkpoint from `python/orientation-model/best.pt`; a front or back result below confidence `0.50` is treated as `uncertain`. For front and uncertain people, the frame keeps the chest as the priority region when chest and hip cannot both fit; for back people, the hip is the priority region. The service uses `auto` device selection and falls back to the existing crop behavior when the orientation checkpoint is unavailable. The build packages this script and checkpoint with the standalone Python runtime under `build\Release\python`.

To batch-test the same YOLO26 pose, orientation classification, and background framing, run `src/python/test_images.py`. With no path options it reads `F:\pictures\test`, writes images annotated with person boxes, keypoints, skeletons, estimated chest/hip regions, and a yellow background crop frame to `F:\pictures\test_result`, and saves the responses in `results.json`. If only one shoulder keypoint is visible, the script creates the opposite shoulder as a horizontal virtual point inside the person box and marks it with `virtual: true`. The frame uses the default `1315x1000` manager window ratio, is as large as the source image allows, and is positioned according to the orientation priority described above. Its coordinates are stored as `background_crop`. Each result includes its elapsed time in seconds, and the terminal reports the total test time:

```powershell
& .\.venv\Scripts\python.exe .\src\python\test_images.py --device cuda --model .\yolo26m-pose.pt
```

The standalone ConvNeXt-Tiny orientation training code and dataset layout are under `training/`, separate from the production Python modules. See [training/README.md](training/README.md) for the full labeling rules, directory structure, environment setup, training parameters, output format, and evaluation guidance. The short form from the repository root is:

```powershell
& .\.venv\Scripts\python.exe .\training\orientation\train_orientation.py --epochs 15 --batch-size 16 --device auto
```

The backup directory is created on first launch. The program creates `~mods` only when the parent game `Paks` directory already exists; it does not create a fake game installation tree.

## Requirements

- Windows 10 or 11.
- CMake 3.21 or newer.
- A C++20 compiler. Visual Studio 2022 Build Tools with the Desktop development with C++ workload is recommended.
- Qt 6.5 or newer with the `Widgets` component, built for the same compiler and architecture as the project.
- Python 3.12 and the project environment at `.venv`, with production dependencies installed from `requirements.txt`. The optional isolated training environment and its dependencies are documented in [training/README.md](training/README.md).
- [7-Zip](https://www.7-zip.org/) for ZIP, RAR, and 7z extraction.

The program finds `7z.exe` in this order:

1. `NTE_7ZIP_PATH` environment variable.
2. The system `PATH` (`7z`, `7z.exe`, `7zz`, or `7zz.exe`).
3. `C:\Program Files\7-Zip\7z.exe`.
4. `C:\Program Files (x86)\7-Zip\7z.exe`.

## Build

From this directory, configure CMake with the path to the Qt kit installed on the machine. For example, with a Qt MSVC 2022 kit:

```powershell
cmake -S . -B build -G "Visual Studio 18 2026" -A x64 -DCMAKE_PREFIX_PATH="C:\Qt\6.11.1\msvc2022_64"
cmake --build build --config Release
```

If 7-Zip is installed, set `NTE_7ZIP_PATH` to its executable before configuring so the Release build copies it beside `NteModManager.exe`:

```powershell
$env:NTE_7ZIP_PATH = "C:\Program Files\7-Zip\7z.exe"
cmake --fresh -S . -B build -G "Visual Studio 18 2026" -A x64 -DCMAKE_PREFIX_PATH="C:\Qt\6.11.1\msvc2022_64"
cmake --build build --config Release
```

The build copies a standalone Python runtime, the environment packages, the detector script, the trained orientation checkpoint, and any cached YOLO files into `build\Release\python`. The executable locates them relative to itself, so no Python path is stored in `NteModManager.ini`. If the YOLO model is not present in the cache, Python downloads it on first use. The YOLO pose detector estimates chest and hip regions from keypoints; the orientation checkpoint then controls which region receives priority when the fixed-ratio background frame cannot contain both.

The executable will be under `build\Release\NteModManager.exe`. Deploy Qt runtime DLLs before moving the executable to another computer, for example:

```powershell
windeployqt build\Release\NteModManager.exe
```

## Behavior

- Drop one or more `.zip`, `.rar`, or `.7z` files anywhere on the application window.
- Each archive is extracted into a distinct directory in `Backups`. If the archive contains exactly one top-level folder, that folder is used as the mod root.
- The original archive is permanently deleted only after extraction and state recording succeed. It is not sent to the Recycle Bin.
- **Package Mod** runs `傻瓜打包器\傻瓜打包器.bat`. After it succeeds, enter a mod name to copy `Mod_P.pak`, `Mod_P.ucas`, and `Mod_P.utoc` into a new folder in `Backups`.
- **Install** creates a directory symbolic link in the game `~mods` folder. It becomes disabled while that link exists.
- **Uninstall** removes only that directory symbolic link. It becomes disabled when no link exists.
- **Delete** removes the matching symbolic link, permanently deletes the backup folder, and refreshes the list.
- The selected mod list sort order is saved in `NteModManager.ini` and restored on the next launch.
- The category overview contains `全部`, the configured categories, and `其他`. `全部` is fixed at the top and `其他` is fixed at the bottom. Normal category cards can be dragged to reorder them; their order is saved in `NteModManager.ini`.
- Clicking a category opens its mod list. Use the back button to return to the category overview.
- State and action history are stored in `Backups\.nte-mod-manager.json`, including import time and every install/uninstall action.

Creating directory symbolic links may require Windows Developer Mode or starting the program as an administrator. The manager refuses to delete a same-named ordinary directory in the game folder, preventing accidental deletion of unrelated files.
