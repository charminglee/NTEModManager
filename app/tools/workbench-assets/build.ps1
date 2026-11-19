param([string]$Dotnet)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$work = Join-Path $root '.tmp/assets'
if (-not $Dotnet) {
  $localSdk = Join-Path $work 'dotnet/dotnet.exe'
  $Dotnet = if (Test-Path -LiteralPath $localSdk) { $localSdk } else { 'dotnet' }
}
& $Dotnet publish (Join-Path $PSScriptRoot 'WorkbenchAssets.csproj') -c Release -r win-x64 --self-contained true --artifacts-path (Join-Path $work 'build') -p:RestorePackagesPath="$(Join-Path $work 'nuget')" -o (Join-Path $work 'publish')
exit $LASTEXITCODE
