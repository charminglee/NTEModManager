# 预置 electron-builder 的 winCodeSign 缓存,绕过解压 macOS 符号链接需要的管理员特权。
# 用法:powershell -NoProfile -ExecutionPolicy Bypass -File scripts\seed-wincodesign.ps1
$ErrorActionPreference = 'Stop'

$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$finalDir = Join-Path $cacheRoot 'winCodeSign-2.6.0'

if (Test-Path (Join-Path $finalDir 'rcedit-x64.exe')) {
    Write-Output "已预置,跳过:$finalDir"
    exit 0
}
New-Item -ItemType Directory -Force -Path $finalDir | Out-Null

# 优先复用 electron-builder 下载过的 .7z,否则自行下载。
$archive = Get-ChildItem $cacheRoot -Filter '*.7z' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $archive) {
    $archivePath = Join-Path $cacheRoot 'winCodeSign-2.6.0.7z'
    Write-Output '下载 winCodeSign-2.6.0.7z ...'
    Invoke-WebRequest `
        -Uri 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' `
        -OutFile $archivePath
    $archive = Get-Item $archivePath
}

# darwin 目录中的 libcrypto.dylib / libssl.dylib 是符号链接,Windows 无特权无法创建;
# 它们只用于跨平台给 macOS 签名,打包 Windows 应用完全不需要,排除之。
$sevenZip = Join-Path $PSScriptRoot '..\node_modules\7zip-bin\win\x64\7za.exe'
& $sevenZip x -y '-xr!libcrypto.dylib' '-xr!libssl.dylib' "-o$finalDir" $archive.FullName | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "7z 解压失败,退出码 $LASTEXITCODE" }

Write-Output "已预置:$finalDir"
