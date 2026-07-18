param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDirectory
)

function Get-NormalizedDirectoryPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $rootPath = [System.IO.Path]::GetPathRoot($fullPath)

    if ($fullPath.Length -gt $rootPath.Length) {
        return $fullPath.TrimEnd([char[]]@('\', '/'))
    }

    return $fullPath
}

function Get-LastSelectedFolder {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StateFile
    )

    if (-not (Test-Path -LiteralPath $StateFile -PathType Leaf)) {
        return $null
    }

    try {
        $savedPath = [System.IO.File]::ReadAllText($StateFile, [System.Text.Encoding]::UTF8)
        $savedPath = $savedPath.TrimEnd([char[]]@("`r", "`n"))

        if ($savedPath -and (Test-Path -LiteralPath $savedPath -PathType Container)) {
            return Get-NormalizedDirectoryPath -Path $savedPath
        }
    }
    catch {
        Write-Warning "Could not read the last selected folder: $($_.Exception.Message)"
    }

    return $null
}

function Save-LastSelectedFolder {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StateFile,

        [Parameter(Mandatory = $true)]
        [string]$SelectedFolder
    )

    try {
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($StateFile, $SelectedFolder, $utf8WithoutBom)
    }
    catch {
        Write-Warning "Could not save the last selected folder: $($_.Exception.Message)"
    }
}

if (-not ('NtePacker.NativeFolderPicker' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

namespace NtePacker
{
    [ComImport]
    [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        [PreserveSig] int SetFileTypes(uint fileTypeCount, IntPtr filterSpec);
        [PreserveSig] int SetFileTypeIndex(uint fileTypeIndex);
        [PreserveSig] int GetFileTypeIndex(out uint fileTypeIndex);
        [PreserveSig] int Advise(IntPtr events, out uint cookie);
        [PreserveSig] int Unadvise(uint cookie);
        [PreserveSig] int SetOptions(uint options);
        [PreserveSig] int GetOptions(out uint options);
        [PreserveSig] int SetDefaultFolder([MarshalAs(UnmanagedType.Interface)] IShellItem folder);
        [PreserveSig] int SetFolder([MarshalAs(UnmanagedType.Interface)] IShellItem folder);
        [PreserveSig] int GetFolder([MarshalAs(UnmanagedType.Interface)] out IShellItem folder);
        [PreserveSig] int GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out IShellItem item);
        [PreserveSig] int SetFileName([MarshalAs(UnmanagedType.LPWStr)] string fileName);
        [PreserveSig] int GetFileName(out IntPtr fileName);
        [PreserveSig] int SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        [PreserveSig] int SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        [PreserveSig] int SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        [PreserveSig] int GetResult([MarshalAs(UnmanagedType.Interface)] out IShellItem item);
        [PreserveSig] int AddPlace([MarshalAs(UnmanagedType.Interface)] IShellItem item, uint placement);
        [PreserveSig] int SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        [PreserveSig] int Close(int hresult);
        [PreserveSig] int SetClientGuid(ref Guid clientGuid);
        [PreserveSig] int ClearClientData();
        [PreserveSig] int SetFilter(IntPtr filter);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        [PreserveSig] int BindToHandler(IntPtr bindContext, ref Guid handlerId, ref Guid interfaceId, out IntPtr result);
        [PreserveSig] int GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem parent);
        [PreserveSig] int GetDisplayName(uint displayNameType, out IntPtr displayName);
        [PreserveSig] int GetAttributes(uint attributeMask, out uint attributes);
        [PreserveSig] int Compare([MarshalAs(UnmanagedType.Interface)] IShellItem item, uint hint, out int order);
    }

    public static class NativeFolderPicker
    {
        private const uint FOS_NOCHANGEDIR = 0x00000008;
        private const uint FOS_PICKFOLDERS = 0x00000020;
        private const uint FOS_FORCEFILESYSTEM = 0x00000040;
        private const uint FOS_PATHMUSTEXIST = 0x00000800;
        private const uint SIGDN_FILESYSPATH = 0x80058000;
        private const int HRESULT_CANCELLED = unchecked((int)0x800704C7);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        private static extern void SHCreateItemFromParsingName(
            string path,
            IntPtr bindContext,
            ref Guid interfaceId,
            [MarshalAs(UnmanagedType.Interface)] out IShellItem item);

        public static string SelectFolder(string initialFolder, string title)
        {
            IFileDialog dialog = null;
            IShellItem initialItem = null;
            IShellItem selectedItem = null;

            try
            {
                Type dialogType = Type.GetTypeFromCLSID(
                    new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7"));
                dialog = (IFileDialog)Activator.CreateInstance(dialogType);

                uint options;
                ThrowIfFailed(dialog.GetOptions(out options));
                ThrowIfFailed(dialog.SetOptions(
                    options | FOS_NOCHANGEDIR | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST));

                Guid clientGuid = new Guid("F0F23C0A-2E42-450F-9B94-CB9DF7A55263");
                ThrowIfFailed(dialog.SetClientGuid(ref clientGuid));
                ThrowIfFailed(dialog.SetTitle(title));
                ThrowIfFailed(dialog.SetOkButtonLabel("Select Folder"));

                if (!String.IsNullOrEmpty(initialFolder) && Directory.Exists(initialFolder))
                {
                    initialItem = CreateShellItem(initialFolder);
                    ThrowIfFailed(dialog.SetFolder(initialItem));
                }

                int showResult = dialog.Show(IntPtr.Zero);
                if (showResult == HRESULT_CANCELLED)
                {
                    return null;
                }

                ThrowIfFailed(showResult);
                ThrowIfFailed(dialog.GetResult(out selectedItem));

                IntPtr displayName = IntPtr.Zero;
                try
                {
                    ThrowIfFailed(selectedItem.GetDisplayName(SIGDN_FILESYSPATH, out displayName));
                    return Marshal.PtrToStringUni(displayName);
                }
                finally
                {
                    if (displayName != IntPtr.Zero)
                    {
                        Marshal.FreeCoTaskMem(displayName);
                    }
                }
            }
            finally
            {
                ReleaseComObject(selectedItem);
                ReleaseComObject(initialItem);
                ReleaseComObject(dialog);
            }
        }

        private static IShellItem CreateShellItem(string path)
        {
            Guid shellItemId = typeof(IShellItem).GUID;
            IShellItem item;
            SHCreateItemFromParsingName(path, IntPtr.Zero, ref shellItemId, out item);
            return item;
        }

        private static void ThrowIfFailed(int hresult)
        {
            if (hresult < 0)
            {
                Marshal.ThrowExceptionForHR(hresult);
            }
        }

        private static void ReleaseComObject(object value)
        {
            if (value != null && Marshal.IsComObject(value))
            {
                Marshal.FinalReleaseComObject(value);
            }
        }
    }
}
'@
}

try {
    $targetDirectory = Get-NormalizedDirectoryPath -Path $TargetDirectory
    $stateFile = Join-Path -Path $PSScriptRoot -ChildPath 'LastImportFolder.txt'

    if ($targetDirectory -eq [System.IO.Path]::GetPathRoot($targetDirectory)) {
        throw 'The import target cannot be a drive root.'
    }

    [System.IO.Directory]::CreateDirectory($targetDirectory) | Out-Null
    Write-Host "Clearing: $targetDirectory"
    Get-ChildItem -LiteralPath $targetDirectory -Force | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
    }
    Write-Host 'Target folder cleared.'

    $lastSelectedFolder = Get-LastSelectedFolder -StateFile $stateFile
    $sourceDirectory = [NtePacker.NativeFolderPicker]::SelectFolder(
        $lastSelectedFolder,
        'Select a folder to import into xg\HT\Content'
    )

    if ([string]::IsNullOrEmpty($sourceDirectory)) {
        exit 2
    }

    $sourceDirectory = Get-NormalizedDirectoryPath -Path $sourceDirectory

    if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
        throw "The selected folder does not exist: $sourceDirectory"
    }

    if ($sourceDirectory -eq [System.IO.Path]::GetPathRoot($sourceDirectory)) {
        throw 'A drive root cannot be selected.'
    }

    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    if (
        $sourceDirectory.Equals($targetDirectory, $comparison) -or
        $sourceDirectory.StartsWith("$targetDirectory\", $comparison) -or
        $targetDirectory.StartsWith("$sourceDirectory\", $comparison)
    ) {
        throw 'The xg\HT\Content folder and its parent or child folders cannot be selected.'
    }

    Save-LastSelectedFolder -StateFile $stateFile -SelectedFolder $sourceDirectory

    $folderName = Split-Path -Path $sourceDirectory -Leaf
    $destinationDirectory = Join-Path -Path $targetDirectory -ChildPath $folderName

    Write-Host "Importing: $sourceDirectory"
    & "$env:SystemRoot\System32\robocopy.exe" $sourceDirectory $destinationDirectory /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS
    $copyExitCode = $LASTEXITCODE

    if ($copyExitCode -ge 8) {
        throw "Robocopy failed with exit code: $copyExitCode"
    }

    Write-Host "Import complete: $destinationDirectory"
    exit 0
}
catch {
    [Console]::Error.WriteLine("Folder import failed: {0}", $_.Exception.Message)
    exit 1
}