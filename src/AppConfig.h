#pragma once

#include <QSize>
#include <QString>
#include <QStringList>

class AppConfig
{
public:
    [[nodiscard]] static QString modsDirectory();
    [[nodiscard]] static QString backupsDirectory();
    [[nodiscard]] static QString backgroundImagesDirectory();
    [[nodiscard]] static bool testImagesEnabled();
    [[nodiscard]] static QString pythonExecutable();
    [[nodiscard]] static QString visualRegionScript();
    [[nodiscard]] static QString orientationModel();
    [[nodiscard]] static QString pythonModelCache();
    [[nodiscard]] static QString gameLauncherPath();
    [[nodiscard]] static QString packagerDirectory();
    [[nodiscard]] static QSize windowSize();
    static void setWindowSize(const QSize& size);
    [[nodiscard]] static int modListSortOrder();
    static void setModListSortOrder(int sortOrder);
    [[nodiscard]] static QStringList modCategories();
    [[nodiscard]] static QStringList modCategoryOrder();
    static void setModCategoryOrder(const QStringList& categoryOrder);
};