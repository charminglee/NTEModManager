#pragma once

#include "ModRepository.h"

#include <QHash>
#include <QList>
#include <QString>
#include <QStringList>

namespace ModListLogic
{
enum class SortOrder
{
    InstalledFirst,
    NameAscending,
    NameDescending,
    ImportedNewestFirst,
    ImportedOldestFirst,
    SizeLargestFirst,
    SizeSmallestFirst,
};

[[nodiscard]] QStringList normalizeCategories(const QStringList& categories);
[[nodiscard]] QStringList orderedCategories(
    const QStringList& categories,
    const QStringList& requestedOrder);
[[nodiscard]] QString categoryForMod(const ModInfo& mod, const QStringList& categories);
[[nodiscard]] QHash<QString, int> countByCategory(
    const QList<ModInfo>& mods,
    const QStringList& categories);
[[nodiscard]] QList<ModInfo> filterAndSort(
    QList<ModInfo> mods,
    const QString& category,
    const QStringList& categories,
    SortOrder sortOrder);
}