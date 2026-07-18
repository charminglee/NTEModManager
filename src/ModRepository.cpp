#include "ModRepository.h"

#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSet>
#include <QStandardPaths>
#include <QUuid>

#include <windows.h>

#include <algorithm>

namespace
{
constexpr auto kModsDirectory = "E:/Neverness To Everness/Client/WindowsNoEditor/HT/Content/Paks/~mods";
constexpr auto kBackupsDirectory = "E:/Neverness To Everness/Mods/Backups";
constexpr auto kManifestFileName = ".nte-mod-manager.json";

QString windowsErrorMessage(DWORD errorCode)
{
    LPWSTR buffer = nullptr;
    const DWORD length = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr,
        errorCode,
        0,
        reinterpret_cast<LPWSTR>(&buffer),
        0,
        nullptr);

    QString message = length == 0 ? QStringLiteral("Windows error %1").arg(errorCode)
                                  : QString::fromWCharArray(buffer, static_cast<qsizetype>(length)).trimmed();
    if (buffer != nullptr) {
        LocalFree(buffer);
    }
    return message;
}

bool pathExists(const QString& path)
{
    return GetFileAttributesW(reinterpret_cast<LPCWSTR>(path.utf16())) != INVALID_FILE_ATTRIBUTES;
}

bool isDirectoryLink(const QString& path)
{
    const DWORD attributes = GetFileAttributesW(reinterpret_cast<LPCWSTR>(path.utf16()));
    return attributes != INVALID_FILE_ATTRIBUTES
        && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0
        && (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
}

OperationResult deleteDirectoryLink(const QString& linkPath)
{
    if (!isDirectoryLink(linkPath)) {
        return {false, QStringLiteral("目标不是可安全删除的目录符号链接：%1").arg(linkPath)};
    }

    if (!RemoveDirectoryW(reinterpret_cast<LPCWSTR>(linkPath.utf16()))) {
        return {false, QStringLiteral("删除符号链接失败：%1").arg(windowsErrorMessage(GetLastError()))};
    }
    return {true, {}};
}

OperationResult copyDirectory(const QString& sourcePath, const QString& targetPath)
{
    static const QSet<QString> ignoredExtensions = {
        QStringLiteral("zip"),
        QStringLiteral("txt"),
        QStringLiteral("png"),
        QStringLiteral("jpg"),
        QStringLiteral("md"),
        QStringLiteral("json"),
    };

    const QDir sourceDirectory(sourcePath);
    if (!sourceDirectory.exists()) {
        return {false, QStringLiteral("模组源文件夹不存在：%1").arg(sourcePath)};
    }
    if (!QDir().mkpath(targetPath)) {
        return {false, QStringLiteral("无法创建模组安装目录：%1").arg(targetPath)};
    }

    QDirIterator iterator(sourcePath, QDir::AllEntries | QDir::NoDotAndDotDot, QDirIterator::Subdirectories);
    while (iterator.hasNext()) {
        iterator.next();
        const QFileInfo sourceInfo = iterator.fileInfo();
        const QString relativePath = sourceDirectory.relativeFilePath(sourceInfo.absoluteFilePath());
        const QString targetEntryPath = QDir(targetPath).filePath(relativePath);

        if (!sourceInfo.isDir() && ignoredExtensions.contains(sourceInfo.suffix().toLower())) {
            continue;
        }
        if (sourceInfo.isSymLink()) {
            QDir(targetPath).removeRecursively();
            return {false, QStringLiteral("模组包含不支持复制的符号链接：%1").arg(relativePath)};
        }
        if (sourceInfo.isDir()) {
            if (!QDir().mkpath(targetEntryPath)) {
                QDir(targetPath).removeRecursively();
                return {false, QStringLiteral("无法创建目录：%1").arg(relativePath)};
            }
            continue;
        }
        if (!QFile::copy(sourceInfo.absoluteFilePath(), targetEntryPath)) {
            QDir(targetPath).removeRecursively();
            return {false, QStringLiteral("无法复制文件：%1").arg(relativePath)};
        }
        QFile::setPermissions(targetEntryPath, sourceInfo.permissions());
    }
    return {true, {}};
}

OperationResult removeInstalledModDirectory(const QString& installPath)
{
    if (isDirectoryLink(installPath)) {
        return deleteDirectoryLink(installPath);
    }
    if (!QFileInfo(installPath).isDir()) {
        return {false, QStringLiteral("目标不是可删除的模组目录：%1").arg(installPath)};
    }
    if (!QDir(installPath).removeRecursively()) {
        return {false, QStringLiteral("无法删除已安装的模组文件：%1").arg(installPath)};
    }
    return {true, {}};
}

qint64 directorySize(const QString& path)
{
    qint64 totalSize = 0;
    QDirIterator iterator(path, QDir::Files | QDir::NoDotAndDotDot, QDirIterator::Subdirectories);
    while (iterator.hasNext()) {
        iterator.next();
        const QFileInfo fileInfo = iterator.fileInfo();
        if (!fileInfo.isSymLink()) {
            totalSize += fileInfo.size();
        }
    }
    return totalSize;
}

QString sanitizeDirectoryName(QString name)
{
    name.replace(QRegularExpression(QStringLiteral(R"([<>:"/\\|?*])")), QStringLiteral("_"));
    name = name.trimmed();
    while (name.endsWith(QLatin1Char('.'))) {
        name.chop(1);
    }
    return name.isEmpty() ? QStringLiteral("Imported Mod") : name;
}



QString uniqueDirectoryName(const QString& preferredName)
{
    const QDir backupRoot(ModRepository::backupsDirectory());
    QString candidate = preferredName;
    int copyNumber = 2;
    while (backupRoot.exists(candidate)) {
        candidate = QStringLiteral("%1 (%2)").arg(preferredName).arg(copyNumber++);
    }
    return candidate;
}

QString find7ZipExecutable()
{
    const QString configuredPath = qEnvironmentVariable("NTE_7ZIP_PATH");
    if (!configuredPath.isEmpty() && QFileInfo::exists(configuredPath)) {
        return configuredPath;
    }

    for (const QString& command : {QStringLiteral("7z"), QStringLiteral("7z.exe"), QStringLiteral("7zz"), QStringLiteral("7zz.exe")}) {
        const QString executable = QStandardPaths::findExecutable(command);
        if (!executable.isEmpty()) {
            return executable;
        }
    }

    for (const QString& candidate : {
             QStringLiteral("C:/Program Files/7-Zip/7z.exe"),
             QStringLiteral("C:/Program Files (x86)/7-Zip/7z.exe")}) {
        if (QFileInfo::exists(candidate)) {
            return candidate;
        }
    }

    return {};
}

QJsonObject loadManifest(const QString& manifestPath)
{
    QFile manifestFile(manifestPath);
    if (!manifestFile.exists() || !manifestFile.open(QIODevice::ReadOnly)) {
        return {{QStringLiteral("version"), 1}, {QStringLiteral("mods"), QJsonObject()}};
    }

    const QJsonDocument document = QJsonDocument::fromJson(manifestFile.readAll());
    if (!document.isObject()) {
        return {{QStringLiteral("version"), 1}, {QStringLiteral("mods"), QJsonObject()}};
    }
    return document.object();
}

OperationResult saveManifest(const QString& manifestPath, const QJsonObject& manifest)
{
    QSaveFile manifestFile(manifestPath);
    if (!manifestFile.open(QIODevice::WriteOnly)) {
        return {false, QStringLiteral("无法写入状态清单：%1").arg(manifestFile.errorString())};
    }
    manifestFile.write(QJsonDocument(manifest).toJson(QJsonDocument::Indented));
    if (!manifestFile.commit()) {
        return {false, QStringLiteral("无法保存状态清单：%1").arg(manifestFile.errorString())};
    }
    return {true, {}};
}

OperationResult recordAction(const QString& manifestPath, const QString& modName, const QString& action)
{
    QJsonObject manifest = loadManifest(manifestPath);
    QJsonObject mods = manifest.value(QStringLiteral("mods")).toObject();
    QJsonObject mod = mods.value(modName).toObject();
    const QString now = QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);

    if (action == QStringLiteral("imported")) {
        mod.insert(QStringLiteral("importedAt"), now);
    } else if (action == QStringLiteral("installed")) {
        mod.insert(QStringLiteral("lastInstalledAt"), now);
    } else if (action == QStringLiteral("uninstalled")) {
        mod.insert(QStringLiteral("lastUninstalledAt"), now);
    }
    mod.insert(QStringLiteral("status"), action == QStringLiteral("installed") ? QStringLiteral("installed") : QStringLiteral("not-installed"));

    QJsonArray history = mod.value(QStringLiteral("history")).toArray();
    history.append(QJsonObject{{QStringLiteral("action"), action}, {QStringLiteral("at"), now}});
    mod.insert(QStringLiteral("history"), history);

    mods.insert(modName, mod);
    manifest.insert(QStringLiteral("version"), 1);
    manifest.insert(QStringLiteral("mods"), mods);
    return saveManifest(manifestPath, manifest);
}

OperationResult removeManifestEntry(const QString& manifestPath, const QString& modName)
{
    QJsonObject manifest = loadManifest(manifestPath);
    QJsonObject mods = manifest.value(QStringLiteral("mods")).toObject();
    mods.remove(modName);
    manifest.insert(QStringLiteral("mods"), mods);
    return saveManifest(manifestPath, manifest);
}

OperationResult renameManifestEntry(const QString& manifestPath, const QString& oldName, const QString& newName)
{
    QJsonObject manifest = loadManifest(manifestPath);
    QJsonObject mods = manifest.value(QStringLiteral("mods")).toObject();
    if (mods.contains(newName)) {
        return {false, QStringLiteral("状态清单中已存在同名模组：%1").arg(newName)};
    }

    const QJsonObject mod = mods.take(oldName).toObject();
    mods.insert(newName, mod);
    manifest.insert(QStringLiteral("mods"), mods);
    return saveManifest(manifestPath, manifest);
}

OperationResult moveDirectory(const QString& sourcePath, const QString& targetPath)
{
    if (MoveFileW(
            reinterpret_cast<LPCWSTR>(sourcePath.utf16()),
            reinterpret_cast<LPCWSTR>(targetPath.utf16()))) {
        return {true, {}};
    }
    return {false, QStringLiteral("移动解压后的模组失败：%1").arg(windowsErrorMessage(GetLastError()))};
}
}

QString ModRepository::modsDirectory()
{
    return QString::fromUtf8(kModsDirectory);
}

QString ModRepository::backupsDirectory()
{
    return QString::fromUtf8(kBackupsDirectory);
}

bool ModRepository::isSupportedArchive(const QString& archivePath)
{
    const QString suffix = QFileInfo(archivePath).suffix().toLower();
    return suffix == QStringLiteral("zip") || suffix == QStringLiteral("rar");
}

OperationResult ModRepository::initialize() const
{
    if (!QDir().mkpath(backupsDirectory())) {
        return {false, QStringLiteral("无法创建模组备份目录：%1").arg(backupsDirectory())};
    }

    const QFileInfo installDirectory(modsDirectory());
    QDir paksDirectory = installDirectory.dir();
    if (!paksDirectory.exists()) {
        return {false, QStringLiteral("找不到游戏 Paks 目录：%1").arg(paksDirectory.absolutePath())};
    }
    if (!QDir(modsDirectory()).exists() && !paksDirectory.mkpath(installDirectory.fileName())) {
        return {false, QStringLiteral("无法创建模组安装目录：%1").arg(modsDirectory())};
    }
    return {true, {}};
}

QList<ModInfo> ModRepository::scan() const
{
    const QJsonObject mods = loadManifest(manifestPath()).value(QStringLiteral("mods")).toObject();
    const QDir backupRoot(backupsDirectory());
    const QFileInfoList directories = backupRoot.entryInfoList(
        QDir::Dirs | QDir::NoDotAndDotDot,
        QDir::Name | QDir::IgnoreCase);

    QList<ModInfo> result;
    result.reserve(directories.size());
    for (const QFileInfo& directory : directories) {
        if (directory.fileName().startsWith(QLatin1Char('.')) || directory.isSymLink()) {
            continue;
        }

        const QJsonObject metadata = mods.value(directory.fileName()).toObject();
        ModInfo mod;
        mod.name = directory.fileName();
        mod.sourcePath = directory.absoluteFilePath();
        mod.sizeBytes = directorySize(mod.sourcePath);
        mod.importedAt = QDateTime::fromString(metadata.value(QStringLiteral("importedAt")).toString(), Qt::ISODateWithMs);
        if (!mod.importedAt.isValid()) {
            mod.importedAt = directory.birthTime();
        }
        if (!mod.importedAt.isValid()) {
            mod.importedAt = directory.lastModified();
        }
        const QFileInfo installedDirectory(QDir(modsDirectory()).filePath(mod.name));
        mod.installed = installedDirectory.isDir();
        result.append(mod);
    }
    std::stable_sort(result.begin(), result.end(), [](const ModInfo& left, const ModInfo& right) {
        return left.installed && !right.installed;
    });
    return result;
}

OperationResult ModRepository::importArchive(const QString& archivePath) const
{
    const QFileInfo archiveInfo(archivePath);
    if (!archiveInfo.exists() || !archiveInfo.isFile()) {
        return {false, QStringLiteral("找不到压缩包：%1").arg(archivePath)};
    }
    if (!isSupportedArchive(archivePath)) {
        return {false, QStringLiteral("只支持 .zip 和 .rar 压缩包：%1").arg(archiveInfo.fileName())};
    }

    const OperationResult initialization = initialize();
    if (!initialization.success) {
        return initialization;
    }

    const QString extractor = find7ZipExecutable();
    if (extractor.isEmpty()) {
        return {false, QStringLiteral("未找到 7-Zip。请安装 7-Zip，或设置环境变量 NTE_7ZIP_PATH 指向 7z.exe。")};
    }

    const QDir backupRoot(backupsDirectory());
    const QString stagingName = QStringLiteral(".import-%1").arg(QUuid::createUuid().toString(QUuid::WithoutBraces));
    const QString stagingPath = backupRoot.filePath(stagingName);
    if (!QDir().mkpath(stagingPath)) {
        return {false, QStringLiteral("无法创建临时解压目录。")};
    }

    QProcess extractorProcess;
    extractorProcess.setProgram(extractor);
    extractorProcess.setArguments({
        QStringLiteral("x"),
        QStringLiteral("-y"),
        QStringLiteral("-aoa"),
        QStringLiteral("-o%1").arg(QDir::toNativeSeparators(stagingPath)),
        archiveInfo.absoluteFilePath(),
    });
    extractorProcess.start();
    if (!extractorProcess.waitForStarted(10000)) {
        QDir(stagingPath).removeRecursively();
        return {false, QStringLiteral("无法启动 7-Zip：%1").arg(extractorProcess.errorString())};
    }
    extractorProcess.waitForFinished(-1);
    if (extractorProcess.exitStatus() != QProcess::NormalExit || extractorProcess.exitCode() != 0) {
        const QByteArray output = extractorProcess.readAllStandardError() + extractorProcess.readAllStandardOutput();
        QDir(stagingPath).removeRecursively();
        return {false, QStringLiteral("解压失败：%1").arg(QString::fromLocal8Bit(output).trimmed())};
    }

    const QFileInfoList extractedEntries = QDir(stagingPath).entryInfoList(QDir::NoDotAndDotDot | QDir::AllEntries);
    if (extractedEntries.isEmpty()) {
        QDir(stagingPath).removeRecursively();
        return {false, QStringLiteral("压缩包中没有可导入的文件。")};
    }

    const QString modName = uniqueDirectoryName(sanitizeDirectoryName(archiveInfo.completeBaseName()));
    const QString targetPath = backupRoot.filePath(modName);
    QString extractedRoot = stagingPath;
    if (extractedEntries.size() == 1 && extractedEntries.constFirst().isDir() && !extractedEntries.constFirst().isSymLink()) {
        extractedRoot = extractedEntries.constFirst().absoluteFilePath();
    }

    const OperationResult moved = moveDirectory(extractedRoot, targetPath);
    if (!moved.success) {
        QDir(stagingPath).removeRecursively();
        return moved;
    }
    if (extractedRoot != stagingPath) {
        QDir(stagingPath).removeRecursively();
    }

    const OperationResult stateSaved = recordAction(manifestPath(), modName, QStringLiteral("imported"));
    if (!stateSaved.success) {
        return {false, QStringLiteral("模组已导入，但状态记录失败：%1").arg(stateSaved.message)};
    }
    if (!QFile::remove(archiveInfo.absoluteFilePath())) {
        return {false, QStringLiteral("模组已导入，但无法永久删除原压缩包：%1").arg(archiveInfo.fileName())};
    }

    return {true, QStringLiteral("已导入 %1").arg(modName)};
}

OperationResult ModRepository::importPackagedMod(const QString& modName, const QString& packageDirectory) const
{
    if (modName.trimmed().isEmpty()) {
        return {false, QStringLiteral("模组名称不能为空。")};
    }
    const QString sanitizedName = sanitizeDirectoryName(modName);
    if (sanitizedName != modName.trimmed()) {
        return {false, QStringLiteral("模组名称包含无效字符。")};
    }

    const OperationResult initialization = initialize();
    if (!initialization.success) {
        return initialization;
    }

    const QDir sourceDirectory(packageDirectory);
    const QDir backupRoot(backupsDirectory());
    const QString targetPath = backupRoot.filePath(sanitizedName);
    if (pathExists(targetPath)) {
        return {false, QStringLiteral("已存在同名模组文件夹：%1").arg(sanitizedName)};
    }

    const QStringList packageFiles = {
        QStringLiteral("Mod_P.pak"),
        QStringLiteral("Mod_P.ucas"),
        QStringLiteral("Mod_P.utoc"),
    };
    for (const QString& packageFile : packageFiles) {
        const QFileInfo sourceFile(sourceDirectory.filePath(packageFile));
        if (!sourceFile.isFile()) {
            return {false, QStringLiteral("找不到打包产物：%1").arg(sourceFile.absoluteFilePath())};
        }
    }

    if (!QDir().mkpath(targetPath)) {
        return {false, QStringLiteral("无法创建模组备份目录：%1").arg(targetPath)};
    }
    for (const QString& packageFile : packageFiles) {
        const QString sourcePath = sourceDirectory.filePath(packageFile);
        const QString targetFilePath = QDir(targetPath).filePath(packageFile);
        if (!QFile::copy(sourcePath, targetFilePath)) {
            QDir(targetPath).removeRecursively();
            return {false, QStringLiteral("无法复制打包产物：%1").arg(packageFile)};
        }
        QFile::setPermissions(targetFilePath, QFileInfo(sourcePath).permissions());
    }

    const OperationResult stateSaved = recordAction(manifestPath(), sanitizedName, QStringLiteral("imported"));
    if (!stateSaved.success) {
        QDir(targetPath).removeRecursively();
        return {false, QStringLiteral("模组文件已复制，但状态记录失败：%1").arg(stateSaved.message)};
    }
    return {true, QStringLiteral("已导入 %1").arg(sanitizedName)};
}

OperationResult ModRepository::install(const ModInfo& mod) const
{
    if (!QFileInfo(mod.sourcePath).isDir()) {
        return {false, QStringLiteral("模组源文件夹不存在：%1").arg(mod.name)};
    }

    const OperationResult initialization = initialize();
    if (!initialization.success) {
        return initialization;
    }

    const QString installPath = QDir(modsDirectory()).filePath(mod.name);
    if (pathExists(installPath)) {
        if (isDirectoryLink(installPath)) {
            const OperationResult deletedLink = deleteDirectoryLink(installPath);
            if (!deletedLink.success) {
                return deletedLink;
            }
        } else if (QFileInfo(installPath).isDir()) {
            return {true, QStringLiteral("模组已经安装。")};
        } else {
            return {false, QStringLiteral("安装目录中存在同名文件，已停止以保护该文件：%1").arg(mod.name)};
        }
    }

    const OperationResult copied = copyDirectory(mod.sourcePath, installPath);
    if (!copied.success) {
        return copied;
    }
    const OperationResult recorded = recordAction(manifestPath(), mod.name, QStringLiteral("installed"));
    if (!recorded.success) {
        return {false, QStringLiteral("模组文件已复制，但状态记录失败：%1").arg(recorded.message)};
    }
    return {true, QStringLiteral("已安装 %1").arg(mod.name)};
}

OperationResult ModRepository::uninstall(const ModInfo& mod) const
{
    const QString installPath = QDir(modsDirectory()).filePath(mod.name);
    if (!pathExists(installPath)) {
        return {true, QStringLiteral("模组未安装。")};
    }

    const OperationResult deleted = removeInstalledModDirectory(installPath);
    if (!deleted.success) {
        return deleted;
    }
    const OperationResult recorded = recordAction(manifestPath(), mod.name, QStringLiteral("uninstalled"));
    if (!recorded.success) {
        return {false, QStringLiteral("已复制的模组文件已删除，但状态记录失败：%1").arg(recorded.message)};
    }
    return {true, QStringLiteral("已卸载 %1").arg(mod.name)};
}

OperationResult ModRepository::rename(const ModInfo& mod, const QString& newName) const
{
    if (newName.trimmed().isEmpty()) {
        return {false, QStringLiteral("模组名称不能为空。")};
    }
    const QString sanitizedName = sanitizeDirectoryName(newName);
    if (sanitizedName != newName.trimmed()) {
        return {false, QStringLiteral("模组名称包含无效字符，无法重命名。")};
    }
    if (sanitizedName == mod.name) {
        return {true, QStringLiteral("模组名称未变更。")};
    }
    if (!QFileInfo(mod.sourcePath).isDir()) {
        return {false, QStringLiteral("模组源文件夹不存在：%1").arg(mod.name)};
    }

    const QDir backupRoot(backupsDirectory());
    const QString targetPath = backupRoot.filePath(sanitizedName);
    if (pathExists(targetPath)) {
        return {false, QStringLiteral("已存在同名模组文件夹：%1").arg(sanitizedName)};
    }
    if (loadManifest(manifestPath()).value(QStringLiteral("mods")).toObject().contains(sanitizedName)) {
        return {false, QStringLiteral("状态清单中已存在同名模组：%1").arg(sanitizedName)};
    }

    const QString oldInstallPath = QDir(modsDirectory()).filePath(mod.name);
    const QString newInstallPath = QDir(modsDirectory()).filePath(sanitizedName);
    if (mod.installed && pathExists(newInstallPath)) {
        return {false, QStringLiteral("安装目录中已存在同名项目：%1").arg(sanitizedName)};
    }

    const OperationResult moved = moveDirectory(mod.sourcePath, targetPath);
    if (!moved.success) {
        return {false, QStringLiteral("重命名模组失败：%1").arg(moved.message)};
    }

    if (mod.installed) {
        OperationResult movedInstallation;
        if (isDirectoryLink(oldInstallPath)) {
            const OperationResult deletedLink = deleteDirectoryLink(oldInstallPath);
            if (deletedLink.success) {
                movedInstallation = copyDirectory(targetPath, newInstallPath);
            } else {
                movedInstallation = deletedLink;
            }
        } else {
            movedInstallation = moveDirectory(oldInstallPath, newInstallPath);
        }
        if (!movedInstallation.success) {
            moveDirectory(targetPath, mod.sourcePath);
            return {false, QStringLiteral("重命名模组失败：无法更新已安装文件：%1").arg(movedInstallation.message)};
        }
    }

    const OperationResult manifestRenamed = renameManifestEntry(manifestPath(), mod.name, sanitizedName);
    if (!manifestRenamed.success) {
        if (mod.installed) {
            moveDirectory(newInstallPath, oldInstallPath);
        }
        moveDirectory(targetPath, mod.sourcePath);
        return {false, QStringLiteral("重命名模组失败：%1").arg(manifestRenamed.message)};
    }

    return {true, QStringLiteral("已将 %1 重命名为 %2").arg(mod.name, sanitizedName)};
}

OperationResult ModRepository::remove(const ModInfo& mod) const
{
    const QString installPath = QDir(modsDirectory()).filePath(mod.name);
    if (pathExists(installPath)) {
        const OperationResult deletedInstallation = removeInstalledModDirectory(installPath);
        if (!deletedInstallation.success) {
            return deletedInstallation;
        }
    }

    QDir sourceDirectory(mod.sourcePath);
    if (sourceDirectory.exists() && !sourceDirectory.removeRecursively()) {
        return {false, QStringLiteral("无法删除模组备份文件夹：%1").arg(mod.name)};
    }

    const OperationResult stateRemoved = removeManifestEntry(manifestPath(), mod.name);
    if (!stateRemoved.success) {
        return {false, QStringLiteral("模组文件已删除，但无法更新状态清单：%1").arg(stateRemoved.message)};
    }
    return {true, QStringLiteral("已删除 %1").arg(mod.name)};
}

QString ModRepository::manifestPath() const
{
    return QDir(backupsDirectory()).filePath(QString::fromUtf8(kManifestFileName));
}