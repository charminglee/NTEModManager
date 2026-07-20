#pragma once

#include <QString>
#include <QStringList>

class AppConfig
{
public:
    [[nodiscard]] static QString modsDirectory();
    [[nodiscard]] static QString backupsDirectory();
    [[nodiscard]] static QString backgroundImagesDirectory();
    [[nodiscard]] static QString gameLauncherPath();
    [[nodiscard]] static QString packagerDirectory();
    [[nodiscard]] static int modListSortOrder();
    static void setModListSortOrder(int sortOrder);
    [[nodiscard]] static QStringList modCategories();
    [[nodiscard]] static QStringList modCategoryOrder();
    static void setModCategoryOrder(const QStringList& categoryOrder);
};