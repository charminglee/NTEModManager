#include "ModListLogic.h"

#include <algorithm>

namespace
{
const QString kAllCategory = QStringLiteral("全部");
const QString kOtherCategory = QStringLiteral("其他");

bool compareNameAscending(const ModInfo& left, const ModInfo& right)
{
    return QString::localeAwareCompare(left.name, right.name) < 0;
}

bool compareNameDescending(const ModInfo& left, const ModInfo& right)
{
    return QString::localeAwareCompare(left.name, right.name) > 0;
}

bool compareImportedNewestFirst(const ModInfo& left, const ModInfo& right)
{
    return left.importedAt > right.importedAt;
}

bool compareImportedOldestFirst(const ModInfo& left, const ModInfo& right)
{
    return left.importedAt < right.importedAt;
}

bool compareSizeLargestFirst(const ModInfo& left, const ModInfo& right)
{
    return left.sizeBytes > right.sizeBytes;
}

bool compareSizeSmallestFirst(const ModInfo& left, const ModInfo& right)
{
    return left.sizeBytes < right.sizeBytes;
}
}

namespace ModListLogic
{
QStringList normalizeCategories(const QStringList& categories)
{
    QStringList normalized;
    for (const QString& category : categories) {
        const QString name = category.trimmed();
        if (name.isEmpty() || name == kAllCategory || name == kOtherCategory) {
            continue;
        }
        if (!normalized.contains(name)) {
            normalized.append(name);
        }
    }
    return normalized;
}

QStringList orderedCategories(const QStringList& categories, const QStringList& requestedOrder)
{
    QStringList ordered;
    for (const QString& category : requestedOrder) {
        if (categories.contains(category) && !ordered.contains(category)) {
            ordered.append(category);
        }
    }
    for (const QString& category : categories) {
        if (!ordered.contains(category)) {
            ordered.append(category);
        }
    }
    return ordered;
}

QString categoryForMod(const ModInfo& mod, const QStringList& categories)
{
    QString matchedCategory;
    for (const QString& category : categories) {
        if (mod.name.startsWith(category) && category.size() > matchedCategory.size()) {
            matchedCategory = category;
        }
    }
    return matchedCategory.isEmpty() ? kOtherCategory : matchedCategory;
}

QHash<QString, int> countByCategory(const QList<ModInfo>& mods, const QStringList& categories)
{
    QHash<QString, int> counts;
    counts.insert(kAllCategory, mods.size());
    for (const ModInfo& mod : mods) {
        ++counts[categoryForMod(mod, categories)];
    }
    return counts;
}

QList<ModInfo> filterAndSort(
    QList<ModInfo> mods,
    const QString& category,
    const QStringList& categories,
    SortOrder sortOrder)
{
    if (category != kAllCategory) {
        mods.erase(std::remove_if(mods.begin(), mods.end(), [&category, &categories](const ModInfo& mod) {
            return categoryForMod(mod, categories) != category;
        }), mods.end());
    }

    using Comparator = bool (*)(const ModInfo&, const ModInfo&);
    Comparator comparator = nullptr;
    switch (sortOrder) {
    case SortOrder::InstalledFirst:
        break;
    case SortOrder::NameAscending:
        comparator = compareNameAscending;
        break;
    case SortOrder::NameDescending:
        comparator = compareNameDescending;
        break;
    case SortOrder::ImportedNewestFirst:
        comparator = compareImportedNewestFirst;
        break;
    case SortOrder::ImportedOldestFirst:
        comparator = compareImportedOldestFirst;
        break;
    case SortOrder::SizeLargestFirst:
        comparator = compareSizeLargestFirst;
        break;
    case SortOrder::SizeSmallestFirst:
        comparator = compareSizeSmallestFirst;
        break;
    }

    if (comparator != nullptr) {
        std::sort(mods.begin(), mods.end(), comparator);
    }
    return mods;
}
}