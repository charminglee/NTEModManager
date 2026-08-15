#include "ModRepository.h"

#include "AppConfig.h"

#include <QCoreApplication>
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

ModFileEntry scanDirectoryEntry(const QFileInfo& directoryInfo)
{
    ModFileEntry entry;
    entry.name = directoryInfo.fileName();
    entry.directory = true;

    const QDir directory(directoryInfo.absoluteFilePath());
    const QFileInfoList entries = directory.entryInfoList(
        QDir::AllEntries | QDir::NoDotAndDotDot,
        QDir::DirsFirst | QDir::Name | QDir::IgnoreCase);
    for (const QFileInfo& childInfo : entries) {
        if (childInfo.isSymLink()) {
            continue;
        }
        if (childInfo.isDir()) {
            ModFileEntry child = scanDirectoryEntry(childInfo);
            entry.sizeBytes += child.sizeBytes;
            entry.children.append(std::move(child));
        } else if (childInfo.isFile()) {
            entry.children.append(ModFileEntry{childInfo.fileName(), childInfo.size(), false, {}});
            entry.sizeBytes += childInfo.size();
        }
    }
    return entry;
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

QString sanitizeFileName(QString name)
{
    name.replace(QRegularExpression(QStringLiteral(R"([<>:"/\\|?*])")), QStringLiteral("_"));
    while (name.endsWith(QLatin1Char('.'))) {
        name.chop(1);
    }
    return name;
}

bool isPackageExtension(const QString& extension)
{
    return extension == QStringLiteral("pak")
        || extension == QStringLiteral("ucas")
        || extension == QStringLiteral("utoc");
}

struct FileRenameOperation
{
    QString oldPath;
    QString newPath;
};



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

OperationResult ensureWritableDirectory(const QString& directoryPath, const QString& displayName)
{
    if (!QDir().mkpath(directoryPath)) {
        return {false, QStringLiteral("无法创建%1：%2").arg(displayName, directoryPath)};
    }

    const QString probePath = QDir(directoryPath).filePath(
        QStringLiteral(".nte-write-test-%1").arg(QUuid::createUuid().toString(QUuid::WithoutBraces)));
    if (!QDir().mkpath(probePath)) {
        return {false,
                QStringLiteral("无法写入%1：%2。请修改 NteModManager.ini 中的 Paths/backups_directory，"
                               "或以管理员身份运行程序。")
                    .arg(displayName, directoryPath)};
    }
    if (!QDir(probePath).removeRecursively()) {
        return {false, QStringLiteral("无法清理%1的写入测试目录：%2").arg(displayName, probePath)};
    }
    return {true, {}};
}

QString find7ZipExecutable()
{
    const QString configuredPath = qEnvironmentVariable("NTE_7ZIP_PATH");
    if (!configuredPath.isEmpty() && QFileInfo::exists(configuredPath)) {
        return configuredPath;
    }

    for (const QString& fileName : {QStringLiteral("7z.exe"), QStringLiteral("7zz.exe")}) {
        const QString bundledExecutable = QDir(QCoreApplication::applicationDirPath()).filePath(fileName);
        if (QFileInfo::exists(bundledExecutable)) {
            return bundledExecutable;
        }
    }

    for (const QString& command : {QStringLiteral("7z"), QStringLiteral("7z.exe"), QStringLiteral("7zz"), QStringLiteral("7zz.exe")}) {
        const QString executable = QStandardPaths::findExecutable(command);
        if (!executable.isEmpty()) {
            return executable;
        }
    }

    for (const QString& candidate : {
             QStringLiteral("C:/7-Zip/7z.exe"),
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
    return AppConfig::modsDirectory();
}

QString ModRepository::backupsDirectory()
{
    return AppConfig::backupsDirectory();
}

bool ModRepository::isSupportedArchive(const QString& archivePath)
{
    const QString suffix = QFileInfo(archivePath).suffix().toLower();
    return suffix == QStringLiteral("zip") || suffix == QStringLiteral("rar") || suffix == QStringLiteral("7z");
}

OperationResult ModRepository::initialize() const
{
    const OperationResult backupDirectory = ensureWritableDirectory(
        backupsDirectory(),
        QStringLiteral("模组备份目录"));
    if (!backupDirectory.success) {
        return backupDirectory;
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
        const QFileInfoList entries = QDir(mod.sourcePath).entryInfoList(
            QDir::AllEntries | QDir::NoDotAndDotDot,
            QDir::DirsFirst | QDir::Name | QDir::IgnoreCase);
        for (const QFileInfo& entryInfo : entries) {
            if (entryInfo.isSymLink()) {
                continue;
            }
            if (entryInfo.isDir()) {
                mod.files.append(scanDirectoryEntry(entryInfo));
            } else if (entryInfo.isFile()) {
                mod.files.append(ModFileEntry{entryInfo.fileName(), entryInfo.size(), false, {}});
            }
        }
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
        return {false, QStringLiteral("只支持 .zip、.rar 和 .7z 压缩包：%1").arg(archiveInfo.fileName())};
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
        return {false, QStringLiteral("无法创建临时解压目录：%1").arg(stagingPath)};
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

OperationResult ModRepository::replacePackagedMod(const ModInfo& mod, const QString& packageDirectory) const
{
    if (!QFileInfo(mod.sourcePath).isDir()) {
        return {false, QStringLiteral("模组源文件夹不存在：%1").arg(mod.sourcePath)};
    }

    const QDir sourceDirectory(packageDirectory);
    const QDir targetDirectory(mod.sourcePath);
    const QStringList packageExtensions = {
        QStringLiteral("pak"),
        QStringLiteral("ucas"),
        QStringLiteral("utoc"),
    };
    const QStringList packagedFiles = {
        QStringLiteral("Mod_P.pak"),
        QStringLiteral("Mod_P.ucas"),
        QStringLiteral("Mod_P.utoc"),
    };

    QStringList targetFiles;
    const QFileInfoList sourceFiles = targetDirectory.entryInfoList(QDir::Files | QDir::NoDotAndDotDot);
    for (const QString& extension : packageExtensions) {
        QFileInfoList matchingFiles;
        for (const QFileInfo& sourceFile : sourceFiles) {
            if (sourceFile.suffix().compare(extension, Qt::CaseInsensitive) == 0) {
                matchingFiles.append(sourceFile);
            }
        }
        if (matchingFiles.isEmpty()) {
            return {false, QStringLiteral("模组源文件夹中找不到对应的 .%1 文件。 ").arg(extension)};
        }
        if (matchingFiles.size() > 1) {
            return {false, QStringLiteral("模组源文件夹中存在多个 .%1 文件，无法确定替换目标。 ").arg(extension)};
        }
        targetFiles.append(matchingFiles.constFirst().fileName());
    }

    for (qsizetype index = 0; index < packagedFiles.size(); ++index) {
        const QString& packageFile = packagedFiles.at(index);
        const QString sourcePath = sourceDirectory.filePath(packageFile);
        const QFileInfo sourceFile(sourcePath);
        if (!sourceFile.isFile()) {
            return {false, QStringLiteral("找不到打包产物：%1").arg(sourceFile.absoluteFilePath())};
        }

        const QString targetPath = targetDirectory.filePath(targetFiles.at(index));
        const QString temporaryPath = targetPath + QStringLiteral(".repack.tmp");
        QFile::remove(temporaryPath);
        if (!QFile::copy(sourcePath, temporaryPath)) {
            QFile::remove(temporaryPath);
            return {false, QStringLiteral("无法准备替换文件：%1").arg(packageFile)};
        }
        if (QFileInfo::exists(targetPath) && !QFile::remove(targetPath)) {
            QFile::remove(temporaryPath);
            return {false, QStringLiteral("无法替换源文件：%1").arg(packageFile)};
        }
        if (!QFile::rename(temporaryPath, targetPath)) {
            QFile::remove(temporaryPath);
            return {false, QStringLiteral("无法写入源文件：%1").arg(packageFile)};
        }
        QFile::setPermissions(targetPath, QFileInfo(sourcePath).permissions());
    }

    return {true, QStringLiteral("已重新打包并替换 %1 的源文件").arg(mod.name)};
}

OperationResult ModRepository::replaceFromArchive(const ModInfo& mod, const QString& archivePath) const
{
    const QFileInfo archiveInfo(archivePath);
    if (!archiveInfo.exists() || !archiveInfo.isFile()) {
        return {false, QStringLiteral("找不到压缩包：%1").arg(archivePath)};
    }
    if (!isSupportedArchive(archivePath)) {
        return {false, QStringLiteral("只支持 .zip、.rar 和 .7z 压缩包：%1").arg(archiveInfo.fileName())};
    }
    if (!QFileInfo(mod.sourcePath).isDir()) {
        return {false, QStringLiteral("模组源文件夹不存在：%1").arg(mod.sourcePath)};
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
    const QString stagingName = QStringLiteral(".replace-%1").arg(QUuid::createUuid().toString(QUuid::WithoutBraces));
    const QString stagingPath = backupRoot.filePath(stagingName);
    if (!QDir().mkpath(stagingPath)) {
        return {false, QStringLiteral("无法创建临时解压目录：%1").arg(stagingPath)};
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

    QString extractedRoot = stagingPath;
    if (extractedEntries.size() == 1 && extractedEntries.constFirst().isDir() && !extractedEntries.constFirst().isSymLink()) {
        extractedRoot = extractedEntries.constFirst().absoluteFilePath();
    }

    // 替换模组源文件夹内容：先清空再移入解压结果。
    if (!QDir(mod.sourcePath).removeRecursively()) {
        QDir(stagingPath).removeRecursively();
        return {false, QStringLiteral("无法清空原模组源文件夹：%1").arg(mod.sourcePath)};
    }
    if (!QDir().mkpath(QFileInfo(mod.sourcePath).path())) {
        QDir(stagingPath).removeRecursively();
        return {false, QStringLiteral("无法重建模组源文件夹：%1").arg(mod.sourcePath)};
    }
    const OperationResult moved = moveDirectory(extractedRoot, mod.sourcePath);
    if (!moved.success) {
        QDir(stagingPath).removeRecursively();
        return moved;
    }
    if (extractedRoot != stagingPath) {
        QDir(stagingPath).removeRecursively();
    }

    // 如已安装，同步替换安装目录中的模组文件。
    if (mod.installed) {
        const QString installPath = QDir(modsDirectory()).filePath(mod.name);
        if (isDirectoryLink(installPath)) {
            const OperationResult deletedLink = deleteDirectoryLink(installPath);
            if (!deletedLink.success) {
                return deletedLink;
            }
        } else if (pathExists(installPath)) {
            const OperationResult deletedInstall = removeInstalledModDirectory(installPath);
            if (!deletedInstall.success) {
                return deletedInstall;
            }
        }
        const OperationResult copied = copyDirectory(mod.sourcePath, installPath);
        if (!copied.success) {
            return copied;
        }
    }

    return {true, QStringLiteral("已更新 %1 的源文件").arg(mod.name)};
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

OperationResult ModRepository::renameFile(
    const ModInfo& mod,
    const QString& relativeFilePath,
    const QString& newFileName) const
{
    const QString cleanRelativeFilePath = QDir::cleanPath(relativeFilePath);
    if (relativeFilePath.trimmed().isEmpty()
        || QDir::isAbsolutePath(relativeFilePath)
        || cleanRelativeFilePath == QStringLiteral("..")
        || cleanRelativeFilePath.startsWith(QStringLiteral("../"))) {
        return {false, QStringLiteral("无法重命名无效的模组文件路径。")};
    }

    const QFileInfo oldFileInfo(QDir(mod.sourcePath).filePath(cleanRelativeFilePath));
    if (!oldFileInfo.isFile()) {
        return {false, QStringLiteral("模组文件不存在：%1").arg(relativeFilePath)};
    }

    const QString oldFileName = oldFileInfo.fileName();
    QString targetFileName = newFileName.trimmed();
    if (targetFileName.isEmpty()) {
        return {false, QStringLiteral("文件名不能为空。")};
    }
    if (targetFileName.contains(QLatin1Char('/')) || targetFileName.contains(QLatin1Char('\\'))) {
        return {false, QStringLiteral("文件名不能包含路径。")};
    }

    const QString sanitizedName = sanitizeFileName(targetFileName);
    if (sanitizedName != targetFileName || targetFileName == QStringLiteral(".") || targetFileName == QStringLiteral("..")) {
        return {false, QStringLiteral("文件名包含无效字符，无法重命名。")};
    }

    const QString oldExtension = oldFileInfo.suffix().toLower();
    const bool packageFile = isPackageExtension(oldExtension);
    const QString enteredExtension = QFileInfo(targetFileName).suffix().toLower();
    if (enteredExtension.isEmpty()) {
        targetFileName += QLatin1Char('.') + oldFileInfo.suffix();
    } else if (packageFile && !isPackageExtension(enteredExtension)) {
        return {false, QStringLiteral("pak、ucas 和 utoc 文件只能保留这三种后缀。")};
    }

    const QString targetStem = QFileInfo(targetFileName).completeBaseName();
    if (packageFile && !targetStem.endsWith(QStringLiteral("_P"))) {
        return {false, QStringLiteral("文件名后缀名前必须以“_P”结尾，已取消重命名。")};
    }
    if (targetFileName == oldFileName) {
        return {true, QStringLiteral("文件名未变更。")};
    }

    const QString relativeDirectory = QFileInfo(cleanRelativeFilePath).path();
    const auto relativePathForName = [relativeDirectory](const QString& fileName) {
        return relativeDirectory == QStringLiteral(".")
            ? fileName
            : QDir(relativeDirectory).filePath(fileName);
    };

    QList<QPair<QString, QString>> relativeRenames;
    if (packageFile) {
        const QString oldStem = oldFileInfo.completeBaseName();
        for (const QString& extension : {QStringLiteral("pak"), QStringLiteral("ucas"), QStringLiteral("utoc")}) {
            const QString oldRelativePath = relativePathForName(oldStem + QLatin1Char('.') + extension);
            if (!QFileInfo(QDir(mod.sourcePath).filePath(oldRelativePath)).isFile()) {
                return {false, QStringLiteral("文件组不完整，必须同时存在同名的 .pak、.ucas 和 .utoc 文件。")};
            }
            relativeRenames.append({oldRelativePath, relativePathForName(targetStem + QLatin1Char('.') + extension)});
        }
    } else {
        relativeRenames.append({cleanRelativeFilePath, relativePathForName(targetFileName)});
    }

    QList<FileRenameOperation> operations;
    const auto appendOperations = [&relativeRenames, &operations](
                                      const QString& rootPath,
                                      const QString& rootDescription,
                                      bool allowMissing) -> OperationResult {
        for (const auto& relativeRename : relativeRenames) {
            const QString oldPath = QDir(rootPath).filePath(relativeRename.first);
            const QString newPath = QDir(rootPath).filePath(relativeRename.second);
            if (!QFileInfo(oldPath).isFile()) {
                if (allowMissing) {
                    continue;
                }
                return {false, QStringLiteral("%1中缺少文件：%2").arg(rootDescription, relativeRename.first)};
            }
            if (pathExists(newPath) && oldPath.compare(newPath, Qt::CaseInsensitive) != 0) {
                return {false, QStringLiteral("%1中已存在同名文件：%2").arg(rootDescription, relativeRename.second)};
            }
            operations.append({oldPath, newPath});
        }
        return {true, {}};
    };

    const OperationResult sourceOperations = appendOperations(
        mod.sourcePath,
        QStringLiteral("模组源文件夹"),
        false);
    if (!sourceOperations.success) {
        return sourceOperations;
    }
    if (mod.installed) {
        const QString installedRoot = QDir(modsDirectory()).filePath(mod.name);
        const OperationResult installedOperations = appendOperations(
            installedRoot,
            QStringLiteral("已安装模组文件夹"),
            !packageFile);
        if (!installedOperations.success) {
            return installedOperations;
        }
    }

    QList<FileRenameOperation> completedOperations;
    for (const FileRenameOperation& operation : operations) {
        if (!QFile::rename(operation.oldPath, operation.newPath)) {
            bool rollbackSucceeded = true;
            for (auto iterator = completedOperations.crbegin(); iterator != completedOperations.crend(); ++iterator) {
                if (!QFile::rename(iterator->newPath, iterator->oldPath)) {
                    rollbackSucceeded = false;
                }
            }
            const QString rollbackMessage = rollbackSucceeded
                ? QStringLiteral("已回滚已完成的文件操作。")
                : QStringLiteral("部分文件无法回滚，请检查源文件夹和安装文件夹。 ");
            return {false, QStringLiteral("重命名模组文件失败：无法将 %1 重命名为 %2。%3")
                                .arg(operation.oldPath, operation.newPath, rollbackMessage)};
        }
        completedOperations.append(operation);
    }

    const QString oldDisplayName = oldFileName;
    const QString newDisplayName = packageFile
        ? targetStem + QLatin1Char('.') + oldExtension
        : targetFileName;
    return {true, QStringLiteral("已将 %1 重命名为 %2").arg(oldDisplayName, newDisplayName)};
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