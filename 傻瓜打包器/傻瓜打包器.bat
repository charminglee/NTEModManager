@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
color 0B
title 异环 (NTE) 5.6 傻瓜式一键 IO 封包工具

:: ===================【只需修改这里】===================
:: 你的 Mod 文件夹名字
set "SOURCE_FOLDER=xg"
:: 最终生成的 Mod 文件名
set "FINAL_NAME=Mod_P"
:: ======================================================

:: 自动定位工具路径
set "REPAK_EXE=%~dp0repak.exe"
set "RETOC_EXE=%~dp0retoc.exe"
set "MORPH_PATCH_EXE=%~dp0NteMorphTargetPatch.exe"
set "IMPORT_SCRIPT=%~dp0ImportContentFolder.ps1"
set "CONTENT_FOLDER=%~dp0%SOURCE_FOLDER%\HT\Content"

echo =======================================================
echo          正在为 异环 (NTE) 执行傻瓜式 IO 封包
echo =======================================================
echo.

:: 1. 环境检查
if not exist "%SOURCE_FOLDER%" (
    color 0C
    echo [错误] 找不到文件夹: %SOURCE_FOLDER%
    echo 请确保文件夹和本脚本放在一起。
    pause
    exit
)

if not exist "%MORPH_PATCH_EXE%" (
    color 0C
    echo [错误] 找不到 NteMorphTargetPatch.exe
    echo 请确保补丁工具和本脚本放在一起。
    pause
    exit
)

if not exist "%IMPORT_SCRIPT%" (
    color 0C
    echo [错误] 找不到 ImportContentFolder.ps1
    echo 请确保导入脚本和本脚本放在一起。
    pause
    exit
)

:: 2. 清空并导入文件夹
echo [1/5] 正在清空 xg\HT\Content 并导入文件夹...
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%IMPORT_SCRIPT%" -TargetDirectory "%CONTENT_FOLDER%"
set "IMPORT_EXIT_CODE=%errorlevel%"

if "%IMPORT_EXIT_CODE%"=="2" (
    echo [已取消] 未选择文件夹，已停止封包。
    exit /b 0
)

if not "%IMPORT_EXIT_CODE%"=="0" (
    color 0C
    echo [错误] 文件夹导入失败，已停止封包。
    pause
    exit /b %IMPORT_EXIT_CODE%
)

:: 3. 修复 Morph Target 数据
echo [2/5] 正在修复 Morph Target 数据...
"%MORPH_PATCH_EXE%" "%~dp0%SOURCE_FOLDER%"

if errorlevel 1 (
    color 0C
    echo [错误] NteMorphTargetPatch 修复失败！
    pause
    exit
)

:: 4. 清理旧文件
echo [3/5] 正在清理旧包和缓存...
del /f /q "%FINAL_NAME%.pak" "%FINAL_NAME%.utoc" "%FINAL_NAME%.ucas" 2>nul
del /f /q "temp_base.pak" 2>nul

echo.
echo [4/5] 正在将文件夹压制为基础 Pak...
:: 使用 V11 压包
"%REPAK_EXE%" pack --version V11 "%SOURCE_FOLDER%" "temp_base.pak"

if not exist "temp_base.pak" (
    color 0C
    echo [错误] Repak 压包失败！请检查文件夹内容。
    pause
    exit
)

echo.
echo [5/5] 正在调用 Retoc 转换 IO Store 三件套...
:: 使用 UE5_6 模式进行 IO 转换
"%RETOC_EXE%" to-zen "temp_base.pak" "%FINAL_NAME%.utoc" --version UE5_6

:: 4. 结果检查与收尾
if exist "%FINAL_NAME%.utoc" (
    :: 把生成的 pak 也重命名
    move /Y "temp_base.pak" "%FINAL_NAME%.pak" >nul
    color 0A
    echo.
    echo =======================================================
    echo [大功告成] 封包完美结束！
    echo 已生成:
    echo   - %FINAL_NAME%.pak
    echo   - %FINAL_NAME%.utoc
    echo   - %FINAL_NAME%.ucas
    echo.
    echo 提示：直接把这三个文件扔进游戏 ~mods 文件夹即可！
    echo =======================================================
) else (
    color 0C
    echo.
    echo [错误] Retoc 转换失败，未生成三件套。
    pause
    exit
)
