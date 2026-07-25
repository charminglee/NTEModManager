#pragma once

#include <QDateTime>
#include <QList>
#include <QString>

struct ModInfo
{
    QString name;
    QString sourcePath;
    qint64 sizeBytes = 0;
    QDateTime importedAt;
    bool installed = false;
};

struct OperationResult
{
    bool success = false;
    QString message;
    bool cancelled = false;
};

class ModRepository
{
public:
    [[nodiscard]] static QString modsDirectory();
    [[nodiscard]] static QString backupsDirectory();
    [[nodiscard]] static bool isSupportedArchive(const QString& archivePath);

    [[nodiscard]] OperationResult initialize() const;
    [[nodiscard]] QList<ModInfo> scan() const;
    [[nodiscard]] OperationResult importArchive(const QString& archivePath) const;
    [[nodiscard]] OperationResult importPackagedMod(const QString& modName, const QString& packageDirectory) const;
    [[nodiscard]] OperationResult replacePackagedMod(const ModInfo& mod, const QString& packageDirectory) const;
    [[nodiscard]] OperationResult install(const ModInfo& mod) const;
    [[nodiscard]] OperationResult uninstall(const ModInfo& mod) const;
    [[nodiscard]] OperationResult rename(const ModInfo& mod, const QString& newName) const;
    [[nodiscard]] OperationResult remove(const ModInfo& mod) const;

private:
    [[nodiscard]] QString manifestPath() const;
};