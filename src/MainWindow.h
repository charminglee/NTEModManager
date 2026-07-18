#pragma once

#include "ModRepository.h"

#include <functional>
#include <QMainWindow>
#include <QString>

class QLabel;
class QDragEnterEvent;
class QDragMoveEvent;
class QDropEvent;
class QEvent;
class QMimeData;
class QObject;
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
    void refreshMods();
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

    ModRepository repository_;
    QString backgroundImagePath_;
    QVBoxLayout* modListLayout_ = nullptr;
    QLabel* modCountLabel_ = nullptr;
    QLabel* activityLabel_ = nullptr;
    QWidget* activitySpinner_ = nullptr;
    bool operationInProgress_ = false;
    ModSortOrder sortOrder_ = ModSortOrder::InstalledFirst;
};