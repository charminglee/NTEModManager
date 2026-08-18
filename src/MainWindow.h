#pragma once

#include "ModListLogic.h"
#include "ModRepository.h"
#include "VisualRegionDetector.h"

#include <functional>
#include <QMainWindow>
#include <QString>
#include <QStringList>
#include <QVariantAnimation>
#include <QTimer>
#include <QObject>
#include <QThread>

class QLabel;
class QCloseEvent;
class QDragEnterEvent;
class QDragMoveEvent;
class QDropEvent;
class QEvent;
class QKeyEvent;
class QMimeData;
class QObject;
class QListWidget;
class QListWidgetItem;
class QPlainTextEdit;
class QPushButton;
class QResizeEvent;
class QStackedWidget;
class QVBoxLayout;
class QWidget;
class QPixmap;
class QImage;

class BackgroundDetectionWorker final : public QObject
{
    Q_OBJECT

public slots:
    void prepareModel();
    void detect(const QString& imagePath, const QSize& viewportSize);

signals:
    void modelReady(bool ready);
    void detectionFinished(const QString& imagePath, const VisualRegion& region);

private:
    VisualRegionDetector detector_;
};

class BackgroundWidget final : public QWidget
{
public:

    struct BackgroundImage
    {
        QString path;
        QPixmap pixmap;
        VisualRegion visualRegion;
    };

    explicit BackgroundWidget(
        const QStringList& backgroundImagePaths,
        QWidget* parent = nullptr
    );
    ~BackgroundWidget() override;

    void setStatusCallback(std::function<void(const QString&)> callback);
    void switchBackground();

    BackgroundImage background_;
    BackgroundImage nextBackground_;
    int backgroundIndex_ = 0;
    QStringList backgroundImagePaths_;
    bool modelReady_ = false;

protected:
    void paintEvent(QPaintEvent*) override;
    void resizeEvent(QResizeEvent* event) override;

private:
    void requestDetection(const QString& path);
    void handleDetection(const QString& path, const VisualRegion& region);
    void handleModelReady(bool ready);
    void drawBackground(QPainter& painter, const BackgroundImage& background, qreal opacity) const;

    [[nodiscard]] BackgroundImage loadBackground(const QString& path) const;

    std::function<void(const QString&)> notifyStatus_;
    QThread* detectionThread_ = nullptr;
    BackgroundDetectionWorker* detectionWorker_ = nullptr;
    bool detectionInProgress_ = false;
    QStringList pendingDetectionPaths_;
    QTimer resizeDetectionTimer_;
    QTimer rotationTimer_;
    QVariantAnimation transitionAnimation_;
    qreal transitionProgress_ = 0.0;
};

class MainWindow final : public QMainWindow
{
public:
    explicit MainWindow(const QStringList& backgroundImagePaths, QWidget* parent = nullptr);

protected:
    void closeEvent(QCloseEvent* event) override;
    void dragEnterEvent(QDragEnterEvent* event) override;
    void dragMoveEvent(QDragMoveEvent* event) override;
    void dropEvent(QDropEvent* event) override;
    void keyPressEvent(QKeyEvent* event) override;
    bool eventFilter(QObject* watched, QEvent* event) override;

private:
    using ModSortOrder = ModListLogic::SortOrder;

    void toggleDebugMode();
    void notifyStatus(const QString& statusText);
    void updateLogBottomButtonVisibility();
    void buildUi();
    void refreshCategories();
    void refreshMods();
    void showCategoryOverview();
    void showCategory(const QString& category);
    void refreshLogView();
    void updateCategoryOrderFromList();
    void refreshModsWithFeedback();
    void addModRow(const ModInfo& mod);
    void importArchives(const QStringList& archivePaths);
    void packageMod();
    void repackageMod(const ModInfo& mod);
    void replaceModFromArchive(const ModInfo& mod);
    void handleOperation(const OperationResult& result);
    void changeInstallationForAll(bool install);
    void runAsyncOperation(
        const QString& activity,
        std::function<OperationResult(const std::function<void(const QString&)>&)> operation,
        std::function<void(const OperationResult&)> completion = {}
    );
    void setOperationInProgress(bool inProgress);

    [[nodiscard]] static QStringList archivePathsFromDrop(const QMimeData* mimeData);
    [[nodiscard]] static QString formatFileSize(qint64 byteCount);

    ModRepository repository_;
    QStringList backgroundImagePaths_;
    BackgroundWidget* backgroundWidget_ = nullptr;
    QWidget* root_ = nullptr;
    QStackedWidget* contentStack_ = nullptr;
    QWidget* logPage_ = nullptr;
    QPlainTextEdit* logView_ = nullptr;
    QPushButton* logButton_ = nullptr;
    QPushButton* logBottomButton_ = nullptr;
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
    int previousContentIndex_ = 0;
    bool logRefreshPending_ = false;
    bool logFollowTail_ = false;
    bool logScrollUpdateInProgress_ = false;
};