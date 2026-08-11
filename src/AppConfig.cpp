#include "AppConfig.h"

#include <QCoreApplication>
#include <QDir>
#include <QSettings>

namespace
{
constexpr auto kConfigFileName = "NteModManager.ini";

QString configFilePath()
{
    return QDir(QCoreApplication::applicationDirPath()).filePath(QString::fromLatin1(kConfigFileName));
}

QString configuredPath(const QString& key, const QString& fallback, bool allowEmpty = false)
{
    QSettings settings(configFilePath(), QSettings::IniFormat);
    const QString configured = settings.value(key, fallback).toString().trimmed();
    if (configured.isEmpty() && !allowEmpty) {
        return fallback;
    }
    return QDir::fromNativeSeparators(configured);
}

QStringList configuredList(const QString& key, const QStringList& fallback)
{
    QSettings settings(configFilePath(), QSettings::IniFormat);
    const QVariant configuredValue = settings.value(key);
    if (!configuredValue.isValid()) {
        return fallback;
    }

    QStringList values = configuredValue.toStringList();
    if (values.size() == 1) {
        values = values.constFirst().split(QLatin1Char(','), Qt::SkipEmptyParts);
    }
    for (QString& value : values) {
        value = value.trimmed();
    }
    values.removeAll(QString());
    return values;
}
}

QString AppConfig::modsDirectory()
{
    return configuredPath(
        QStringLiteral("Paths/mods_directory"),
        QStringLiteral("E:/Neverness To Everness/Client/WindowsNoEditor/HT/Content/Paks/~mods"));
}

QString AppConfig::backupsDirectory()
{
    return configuredPath(
        QStringLiteral("Paths/backups_directory"),
        QStringLiteral("E:/Neverness To Everness/Mods/Backups"));
}

QString AppConfig::backgroundImagesDirectory()
{
    return configuredPath(
        QStringLiteral("Paths/background_images_directory"),
        QStringLiteral("F:/pictures/真人"),
        true);
}

bool AppConfig::testImagesEnabled()
{
    QSettings settings(configFilePath(), QSettings::IniFormat);
    return settings.value(QStringLiteral("Debug/test_images"), 0).toInt() == 1;
}

QString AppConfig::pythonExecutable()
{
    return QDir(QCoreApplication::applicationDirPath()).filePath(
        QStringLiteral("python/python.exe"));
}

QString AppConfig::visualRegionScript()
{
    return QDir(QCoreApplication::applicationDirPath()).filePath(
        QStringLiteral("python/visual_region_detector.py"));
}

QString AppConfig::orientationModel()
{
    return QDir(QCoreApplication::applicationDirPath()).filePath(
        QStringLiteral("python/orientation-model/best.pt"));
}

QString AppConfig::pythonModelCache()
{
    return QDir(QCoreApplication::applicationDirPath()).filePath(
        QStringLiteral("python/model-cache"));
}

QString AppConfig::gameLauncherPath()
{
    return configuredPath(
        QStringLiteral("Paths/game_launcher"),
        QStringLiteral("E:/Neverness To Everness/NTELauncher.exe"));
}

QString AppConfig::packagerDirectory()
{
    return configuredPath(
        QStringLiteral("Paths/packager_directory"),
        QStringLiteral("E:/Neverness To Everness/Mods/ModManager/傻瓜打包器"));
}

int AppConfig::modListSortOrder()
{
    QSettings settings(configFilePath(), QSettings::IniFormat);
    return settings.value(QStringLiteral("Preferences/mod_list_sort_order"), 0).toInt();
}

void AppConfig::setModListSortOrder(int sortOrder)
{
    QSettings settings(configFilePath(), QSettings::IniFormat);
    settings.setValue(QStringLiteral("Preferences/mod_list_sort_order"), sortOrder);
    settings.sync();
}

QStringList AppConfig::modCategories()
{
    return configuredList(
        QStringLiteral("Categories/names"),
        {
            QStringLiteral("安魂曲"),
            QStringLiteral("薄荷"),
            QStringLiteral("达芙蒂尔"),
            QStringLiteral("法帝娅"),
            QStringLiteral("九原"),
            QStringLiteral("卡厄斯"),
            QStringLiteral("娜娜莉"),
            QStringLiteral("主角"),
            QStringLiteral("小吱"),
            QStringLiteral("浔"),
            QStringLiteral("伊洛伊"),
            QStringLiteral("早雾"),
            QStringLiteral("真红"),
        });
}

QStringList AppConfig::modCategoryOrder()
{
    return configuredList(QStringLiteral("Preferences/mod_category_order"), {});
}

void AppConfig::setModCategoryOrder(const QStringList& categoryOrder)
{
    QSettings settings(configFilePath(), QSettings::IniFormat);
    settings.setValue(QStringLiteral("Preferences/mod_category_order"), categoryOrder);
    settings.sync();
}