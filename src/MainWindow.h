#pragma once

#include "ModRepository.h"

#include <functional>
#include <QMainWindow>
#include <QString>
#include <QStringList>

class QLabel;
class QDragEnterEvent;
class QDragMoveEvent;
class QDropEvent;
class QEvent;
class QMimeData;
class QObject;
class QListWidget;
class QListWidgetItem;
class QStackedWidget;
class QVBoxLayout;
class QWidget;

class MainWindow final : public QMainWindow
{
public:
    explicit MainWindow(const QString& backgroundImagePath, QWidget* parent = nullptr);

protected:
    void dragEnterEvent(QDragEnterEvent* event) override;
    void dragMoveEvent(QDragMoveEvent* event) override;
    void dropEvent(QDropEvent* event) override;
    bool eventFilter(QObject* watched, QEvent* event) override;

private:
    enum class ModSortOrder
    {
        InstalledFirst,
        NameAscending,
        NameDescending,
        ImportedNewestFirst,
        ImportedOldestFirst,
        SizeLargestFirst,
        SizeSmallestFirst,
    };

    void buildUi();
    void refreshCategories();
    void refreshMods();
    void showCategoryOverview();
    void showCategory(const QString& category);
    void updateCategoryOrderFromList();
    void refreshModsWithFeedback();
    void addModRow(const ModInfo& mod);
    void importArchives(const QStringList& archivePaths);
    void packageMod();
    void handleOperation(const OperationResult& result);
    void changeInstallationForAll(bool install);
    void runAsyncOperation(
        const QString& activity,
        std::function<OperationResult(const std::function<void(const QString&)>&)> operation,
        std::function<void(const OperationResult&)> completion = {});
    void setOperationInProgress(bool inProgress);

    [[nodiscard]] static QStringList archivePathsFromDrop(const QMimeData* mimeData);
    [[nodiscard]] static QString formatFileSize(qint64 byteCount);
    [[nodiscard]] QString categoryForMod(const ModInfo& mod) const;

    ModRepository repository_;
    QString backgroundImagePath_;
    QStackedWidget* contentStack_ = nullptr;
    QListWidget* categoryList_ = nullptr;
    QVBoxLayout* modListLayout_ = nullptr;
    QLabel* modCategoryLabel_ = nullptr;
    QLabel* modCountLabel_ = nullptr;
    QLabel* activityLabel_ = nullptr;
    QWidget* activitySpinner_ = nullptr;
    bool operationInProgress_ = false;
    ModSortOrder sortOrder_ = ModSortOrder::InstalledFirst;
    QStringList categories_;
    QStringList categoryOrder_;
    QString currentCategory_;
};