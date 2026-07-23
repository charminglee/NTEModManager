#include "MainWindow.h"

#include "AppConfig.h"
#include "CategoryListWidget.h"
#include "ModListLogic.h"

#include <QAbstractButton>
#include <QAbstractItemView>
#include <QActionGroup>
#include <QApplication>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QColor>
#include <QEvent>
#include <QFileInfo>
#include <QFrame>
#include <QGraphicsDropShadowEffect>
#include <QHBoxLayout>
#include <QIcon>
#include <QInputDialog>
#include <QLabel>
#include <QLineEdit>
#include <QListView>
#include <QMenu>
#include <QMessageBox>
#include <QMetaObject>
#include <QMimeData>
#include <QPainter>
#include <QPaintEvent>
#include <QPixmap>
#include <QPointer>
#include <QPushButton>
#include <QProcess>
#include <QRandomGenerator>
#include <QSignalBlocker>
#include <QScrollArea>
#include <QStyle>
#include <QThread>
#include <QTimer>
#include <QToolButton>
#include <QUrl>
#include <QVariantAnimation>
#include <QVBoxLayout>
#include <QListWidget>
#include <QListWidgetItem>
#include <QStackedWidget>

#include <array>
#include <algorithm>

namespace
{
class BackgroundWidget final : public QWidget
{
public:
    explicit BackgroundWidget(const QStringList& backgroundImagePaths, QWidget* parent = nullptr)
        : QWidget(parent)
        , backgroundImagePaths_(backgroundImagePaths)
    {
        if (backgroundImagePaths_.isEmpty()) {
            return;
        }

        backgroundIndex_ = QRandomGenerator::global()->bounded(backgroundImagePaths_.size());
        background_ = QPixmap(backgroundImagePaths_.at(backgroundIndex_));

        connect(&rotationTimer_, &QTimer::timeout, this, &BackgroundWidget::switchBackground);
        rotationTimer_.start(10000);

        connect(&transitionAnimation_, &QVariantAnimation::valueChanged, this, [this](const QVariant& value) {
            transitionProgress_ = value.toReal();
            update();
        });
        connect(&transitionAnimation_, &QVariantAnimation::finished, this, [this] {
            background_ = nextBackground_;
            nextBackground_ = QPixmap();
            transitionProgress_ = 0.0;
            update();
        });
    }

protected:
    void paintEvent(QPaintEvent*) override
    {
        QPainter painter(this);
        painter.fillRect(rect(), QColor(QStringLiteral("#08111d")));
        drawBackground(painter, background_, 1.0 - transitionProgress_);
        drawBackground(painter, nextBackground_, transitionProgress_);
    }

private:
    void switchBackground()
    {
        if (backgroundImagePaths_.size() < 2 || transitionAnimation_.state() == QAbstractAnimation::Running) {
            return;
        }

        const int nextIndex = (backgroundIndex_ + 1) % backgroundImagePaths_.size();
        const QPixmap nextBackground(backgroundImagePaths_.at(nextIndex));
        if (nextBackground.isNull()) {
            backgroundIndex_ = nextIndex;
            return;
        }

        backgroundIndex_ = nextIndex;
        nextBackground_ = nextBackground;
        transitionAnimation_.setStartValue(0.0);
        transitionAnimation_.setEndValue(1.0);
        transitionAnimation_.setDuration(900);
        transitionAnimation_.setEasingCurve(QEasingCurve::InOutCubic);
        transitionAnimation_.start();
    }

    void drawBackground(QPainter& painter, const QPixmap& background, qreal opacity) const
    {
        if (background.isNull() || opacity <= 0.0) {
            return;
        }

        const QSize scaledSize = background.size().scaled(size(), Qt::KeepAspectRatioByExpanding);
        const QPoint topLeft((width() - scaledSize.width()) / 2, (height() - scaledSize.height()) / 2);
        painter.save();
        painter.setOpacity(opacity);
        painter.setRenderHint(QPainter::SmoothPixmapTransform);
        painter.drawPixmap(QRect(topLeft, scaledSize), background);
        painter.restore();
    }

    QStringList backgroundImagePaths_;
    int backgroundIndex_ = 0;
    QPixmap background_;
    QPixmap nextBackground_;
    QTimer rotationTimer_;
    QVariantAnimation transitionAnimation_;
    qreal transitionProgress_ = 0.0;
};

class BusyIndicator final : public QWidget
{
public:
    explicit BusyIndicator(QWidget* parent = nullptr)
        : QWidget(parent)
    {
        setFixedSize(18, 18);
        connect(&timer_, &QTimer::timeout, this, [this] {
            angle_ = (angle_ + 30) % 360;
            update();
        });
        timer_.start(80);
    }

protected:
    void paintEvent(QPaintEvent*) override
    {
        QPainter painter(this);
        painter.setRenderHint(QPainter::Antialiasing);
        painter.translate(width() / 2.0, height() / 2.0);
        painter.rotate(angle_);

        for (int index = 0; index < 12; ++index) {
            QColor color(QStringLiteral("#4f735b"));
            color.setAlphaF((index + 1) / 12.0);
            painter.setPen(QPen(color, 2.0, Qt::SolidLine, Qt::RoundCap));
            painter.drawLine(0, -7, 0, -4);
            painter.rotate(30.0);
        }
    }

private:
    QTimer timer_;
    int angle_ = 0;
};

QToolButton* createActionButton(
    QWidget* parent,
    const QString& text,
    const QIcon& icon,
    const QString& tooltip)
{
    auto* button = new QToolButton(parent);
    button->setText(text);
    button->setIcon(icon);
    button->setToolButtonStyle(text.isEmpty() ? Qt::ToolButtonIconOnly : Qt::ToolButtonTextBesideIcon);
    button->setToolTip(tooltip);
    button->setCursor(Qt::PointingHandCursor);
    button->setAutoRaise(true);
    return button;
}

void addTextShadow(QLabel* label)
{
    auto* shadow = new QGraphicsDropShadowEffect(label);
    shadow->setBlurRadius(6.0);
    shadow->setOffset(3.0, 3.0);
    shadow->setColor(QColor(0, 0, 0, 255));
    label->setGraphicsEffect(shadow);
}
}

MainWindow::MainWindow(const QStringList& backgroundImagePaths, QWidget* parent)
    : QMainWindow(parent)
    , backgroundImagePaths_(backgroundImagePaths)
    , sortOrder_(static_cast<ModSortOrder>(std::clamp(AppConfig::modListSortOrder(), 0, 6)))
    , categories_(ModListLogic::normalizeCategories(AppConfig::modCategories()))
    , categoryOrder_(AppConfig::modCategoryOrder())
{
    setAcceptDrops(true);
    setWindowTitle(QStringLiteral("NTE 模组管理器"));
    setMinimumSize(820, 560);
    resize(1080, 720);

    buildUi();
    const OperationResult initialization = repository_.initialize();
    if (!initialization.success) {
        activityLabel_->setText(initialization.message);
    }
    refreshCategories();
}

void MainWindow::dragEnterEvent(QDragEnterEvent* event)
{
    if (!archivePathsFromDrop(event->mimeData()).isEmpty()) {
        event->acceptProposedAction();
        return;
    }
    event->ignore();
}

void MainWindow::dragMoveEvent(QDragMoveEvent* event)
{
    if (!archivePathsFromDrop(event->mimeData()).isEmpty()) {
        event->acceptProposedAction();
        return;
    }
    event->ignore();
}

void MainWindow::dropEvent(QDropEvent* event)
{
    if (operationInProgress_) {
        event->ignore();
        return;
    }

    const QStringList archivePaths = archivePathsFromDrop(event->mimeData());
    if (archivePaths.isEmpty()) {
        event->ignore();
        return;
    }

    event->acceptProposedAction();
    importArchives(archivePaths);
}

bool MainWindow::eventFilter(QObject* watched, QEvent* event)
{
    if (watched == centralWidget()) {
        switch (event->type()) {
        case QEvent::DragEnter:
            dragEnterEvent(static_cast<QDragEnterEvent*>(event));
            return event->isAccepted();
        case QEvent::DragMove:
            dragMoveEvent(static_cast<QDragMoveEvent*>(event));
            return event->isAccepted();
        case QEvent::Drop:
            dropEvent(static_cast<QDropEvent*>(event));
            return event->isAccepted();
        default:
            break;
        }
    }
    return QMainWindow::eventFilter(watched, event);
}

void MainWindow::buildUi()
{
    auto* root = new BackgroundWidget(backgroundImagePaths_, this);
    root->setObjectName(QStringLiteral("root"));
    root->setAcceptDrops(true);
    auto* rootLayout = new QVBoxLayout(root);
    rootLayout->setContentsMargins(24, 20, 24, 20);

    auto* glassPanel = new QFrame(root);
    glassPanel->setObjectName(QStringLiteral("glassPanel"));
    auto* contentLayout = new QVBoxLayout(glassPanel);
    contentLayout->setContentsMargins(34, 28, 34, 28);
    contentLayout->setSpacing(18);
    rootLayout->addWidget(glassPanel);

    auto* headerLayout = new QHBoxLayout();
    headerLayout->setSpacing(12);

    auto* titleLayout = new QVBoxLayout();
    titleLayout->setSpacing(2);
    auto* title = new QLabel(QStringLiteral("NTE 模组管理器"), root);
    title->setObjectName(QStringLiteral("title"));
    addTextShadow(title);
    auto* subtitle = new QLabel(QStringLiteral("Neverness to Everness"), root);
    subtitle->setObjectName(QStringLiteral("subtitle"));
    addTextShadow(subtitle);
    titleLayout->addWidget(title);
    titleLayout->addWidget(subtitle);
    headerLayout->addLayout(titleLayout);
    headerLayout->addStretch();

    auto* launchGameButton = new QPushButton(style()->standardIcon(QStyle::SP_MediaPlay), QStringLiteral("启动游戏"), root);
    launchGameButton->setObjectName(QStringLiteral("modListActionButton"));
    launchGameButton->setToolTip(QStringLiteral("启动 Neverness To Everness"));
    launchGameButton->setCursor(Qt::PointingHandCursor);
    connect(launchGameButton, &QPushButton::clicked, this, [this] {
        const QString launcherPath = AppConfig::gameLauncherPath();
        if (!QFileInfo::exists(launcherPath)) {
            QMessageBox::warning(this, QStringLiteral("无法启动游戏"), QStringLiteral("找不到游戏启动器：%1").arg(launcherPath));
            return;
        }
        if (!QProcess::startDetached(launcherPath)) {
            QMessageBox::warning(this, QStringLiteral("无法启动游戏"), QStringLiteral("无法启动游戏启动器。"));
            return;
        }
        activityLabel_->setText(QStringLiteral("已启动游戏启动器"));
    });
    headerLayout->addWidget(launchGameButton);

    auto* packageModButton = new QPushButton(style()->standardIcon(QStyle::SP_DialogSaveButton), QStringLiteral("打包模组"), root);
    packageModButton->setObjectName(QStringLiteral("modListActionButton"));
    packageModButton->setToolTip(QStringLiteral("使用傻瓜打包器生成并导入模组文件"));
    packageModButton->setCursor(Qt::PointingHandCursor);
    connect(packageModButton, &QPushButton::clicked, this, &MainWindow::packageMod);
    headerLayout->addWidget(packageModButton);
    contentLayout->addLayout(headerLayout);

    auto* dropZone = new QFrame(root);
    dropZone->setObjectName(QStringLiteral("dropZone"));
    dropZone->setFrameShape(QFrame::StyledPanel);
    dropZone->setMinimumHeight(104);
    auto* dropLayout = new QHBoxLayout(dropZone);
    dropLayout->setContentsMargins(24, 18, 24, 18);
    dropLayout->setSpacing(16);

    auto* importIcon = new QLabel(dropZone);
    importIcon->setPixmap(style()->standardIcon(QStyle::SP_DialogOpenButton).pixmap(32, 32));
    importIcon->setFixedSize(38, 38);
    importIcon->setAlignment(Qt::AlignCenter);
    dropLayout->addWidget(importIcon);

    auto* importTextLayout = new QVBoxLayout();
    importTextLayout->setSpacing(2);
    auto* importTitle = new QLabel(QStringLiteral("拖放导入模组"), dropZone);
    importTitle->setObjectName(QStringLiteral("dropTitle"));
    auto* importHint = new QLabel(QStringLiteral("将压缩包拖放到此处即可导入"), dropZone);
    importHint->setObjectName(QStringLiteral("dropHint"));
    importTextLayout->addWidget(importTitle);
    importTextLayout->addWidget(importHint);
    dropLayout->addLayout(importTextLayout);
    dropLayout->addStretch();
    contentLayout->addWidget(dropZone);

    contentStack_ = new QStackedWidget(root);

    auto* categoryPage = new QWidget(contentStack_);
    auto* categoryPageLayout = new QVBoxLayout(categoryPage);
    categoryPageLayout->setContentsMargins(0, 0, 0, 0);
    auto* categoryHeader = new QHBoxLayout();
    categoryHeader->setContentsMargins(0, 8, 0, 8);
    auto* categoryTitle = new QLabel(QStringLiteral("模组分类"), categoryPage);
    categoryTitle->setObjectName(QStringLiteral("sectionTitle"));
    categoryTitle->setMinimumHeight(32);
    categoryTitle->setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
    addTextShadow(categoryTitle);
    categoryHeader->addWidget(categoryTitle);
    categoryHeader->setAlignment(categoryTitle, Qt::AlignTop);
    categoryHeader->addStretch();
    categoryPageLayout->addLayout(categoryHeader);

    auto* categoryList = new CategoryListWidget(categoryPage);
    categoryList_ = categoryList;
    categoryList_->setObjectName(QStringLiteral("categoryList"));
    categoryList_->setViewMode(QListView::IconMode);
    categoryList_->setFlow(QListView::LeftToRight);
    categoryList_->setWrapping(true);
    categoryList_->setResizeMode(QListView::Adjust);
    categoryList_->setMovement(QListView::Snap);
    const int categoryGridWidth = categoryList_->property("categoryGridWidth").toInt();
    const int categoryGridHeight = categoryList_->property("categoryGridHeight").toInt();
    categoryList_->setGridSize(QSize(
        categoryGridWidth > 0 ? categoryGridWidth : 236,
        categoryGridHeight > 0 ? categoryGridHeight : 92));
    categoryList_->setDragDropMode(QAbstractItemView::NoDragDrop);
    categoryList_->setDragEnabled(false);
    categoryList_->setAcceptDrops(false);
    categoryList_->setDropIndicatorShown(false);
    categoryList->orderChanged = [this] {
        updateCategoryOrderFromList();
    };
    categoryList_->setSelectionMode(QAbstractItemView::SingleSelection);
    categoryList_->setSpacing(8);
    categoryList_->setFrameShape(QFrame::NoFrame);
    categoryList_->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
    connect(categoryList_, &QListWidget::itemClicked, this, [this](QListWidgetItem* item) {
        showCategory(item->data(Qt::UserRole).toString());
    });
    categoryPageLayout->addWidget(categoryList_, 1);
    contentStack_->addWidget(categoryPage);

    auto* modsPage = new QWidget(contentStack_);
    auto* modsPageLayout = new QVBoxLayout(modsPage);
    modsPageLayout->setContentsMargins(0, 0, 0, 0);
    auto* listHeader = new QHBoxLayout();
    listHeader->setContentsMargins(0, 8, 0, 8);
    auto* backButton = new QPushButton(style()->standardIcon(QStyle::SP_ArrowBack), {}, modsPage);
    backButton->setObjectName(QStringLiteral("modListActionButton"));
    backButton->setToolTip(QStringLiteral("返回模组分类"));
    backButton->setCursor(Qt::PointingHandCursor);
    connect(backButton, &QPushButton::clicked, this, &MainWindow::showCategoryOverview);
    listHeader->addWidget(backButton);
    modCategoryLabel_ = new QLabel(QStringLiteral("已导入模组"), modsPage);
    modCategoryLabel_->setObjectName(QStringLiteral("sectionTitle"));
    modCategoryLabel_->setMinimumHeight(32);
    modCategoryLabel_->setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
    addTextShadow(modCategoryLabel_);
    modCountLabel_ = new QLabel(root);
    modCountLabel_->setObjectName(QStringLiteral("count"));
    modCountLabel_->setMinimumHeight(32);
    modCountLabel_->setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
    addTextShadow(modCountLabel_);
    listHeader->addWidget(modCategoryLabel_);
    listHeader->setAlignment(modCategoryLabel_, Qt::AlignTop);
    listHeader->addWidget(modCountLabel_);
    listHeader->setAlignment(modCountLabel_, Qt::AlignTop);
    listHeader->addStretch();

    auto* sortButton = new QPushButton(style()->standardIcon(QStyle::SP_FileDialogDetailedView), {}, root);
    sortButton->setObjectName(QStringLiteral("modListActionButton"));
    sortButton->setToolTip(QStringLiteral("选择模组列表排序方式"));
    sortButton->setCursor(Qt::PointingHandCursor);
    auto* sortMenu = new QMenu(sortButton);
    auto* sortActions = new QActionGroup(sortMenu);
    sortActions->setExclusive(true);
    const auto addSortAction = [this, sortMenu, sortActions](const QString& text, ModSortOrder sortOrder) {
        QAction* action = sortMenu->addAction(text);
        action->setCheckable(true);
        action->setChecked(sortOrder_ == sortOrder);
        sortActions->addAction(action);
        connect(action, &QAction::triggered, this, [this, sortOrder] {
            sortOrder_ = sortOrder;
            AppConfig::setModListSortOrder(static_cast<int>(sortOrder_));
            refreshMods();
        });
    };
    addSortAction(QStringLiteral("默认"), ModSortOrder::InstalledFirst);
    addSortAction(QStringLiteral("名称：A 到 Z"), ModSortOrder::NameAscending);
    addSortAction(QStringLiteral("名称：Z 到 A"), ModSortOrder::NameDescending);
    addSortAction(QStringLiteral("导入时间：最新优先"), ModSortOrder::ImportedNewestFirst);
    addSortAction(QStringLiteral("导入时间：最早优先"), ModSortOrder::ImportedOldestFirst);
    addSortAction(QStringLiteral("文件大小：从大到小"), ModSortOrder::SizeLargestFirst);
    addSortAction(QStringLiteral("文件大小：从小到大"), ModSortOrder::SizeSmallestFirst);
    sortButton->setMenu(sortMenu);

    auto* installAllButton = new QPushButton(style()->standardIcon(QStyle::SP_DialogApplyButton), QStringLiteral("全部安装"), root);
    installAllButton->setObjectName(QStringLiteral("modListActionButton"));
    installAllButton->setToolTip(QStringLiteral("将当前分类中所有未安装模组复制到游戏的 ~mods 文件夹"));
    installAllButton->setCursor(Qt::PointingHandCursor);
    connect(installAllButton, &QPushButton::clicked, this, [this] {
        changeInstallationForAll(true);
    });
    listHeader->addWidget(installAllButton);

    auto* uninstallAllButton = new QPushButton(style()->standardIcon(QStyle::SP_DialogCancelButton), QStringLiteral("全部卸载"), root);
    uninstallAllButton->setObjectName(QStringLiteral("modListActionButton"));
    uninstallAllButton->setToolTip(QStringLiteral("从游戏的 ~mods 文件夹中删除当前分类的所有已安装模组文件"));
    uninstallAllButton->setCursor(Qt::PointingHandCursor);
    connect(uninstallAllButton, &QPushButton::clicked, this, [this] {
        changeInstallationForAll(false);
    });
    listHeader->addWidget(uninstallAllButton);

    auto* refreshButton = new QPushButton(style()->standardIcon(QStyle::SP_BrowserReload), {}, root);
    refreshButton->setObjectName(QStringLiteral("modListActionButton"));
    refreshButton->setToolTip(QStringLiteral("重新扫描模组备份目录"));
    refreshButton->setCursor(Qt::PointingHandCursor);
    connect(refreshButton, &QPushButton::clicked, this, &MainWindow::refreshModsWithFeedback);
    listHeader->addWidget(refreshButton);
    listHeader->addWidget(sortButton);
    modsPageLayout->addLayout(listHeader);

    auto* scrollArea = new QScrollArea(root);
    scrollArea->setObjectName(QStringLiteral("modScrollArea"));
    scrollArea->setWidgetResizable(true);
    scrollArea->setFrameShape(QFrame::NoFrame);
    scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);

    auto* listContainer = new QWidget(scrollArea);
    listContainer->setObjectName(QStringLiteral("listContainer"));
    modListLayout_ = new QVBoxLayout(listContainer);
    modListLayout_->setContentsMargins(0, 0, 4, 0);
    modListLayout_->setSpacing(8);
    modListLayout_->addStretch();
    scrollArea->setWidget(listContainer);
    modsPageLayout->addWidget(scrollArea, 1);
    contentStack_->addWidget(modsPage);
    contentLayout->addWidget(contentStack_, 1);

    auto* activityLayout = new QHBoxLayout();
    activityLayout->setContentsMargins(0, 0, 0, 0);
    activityLayout->setSpacing(8);
    activitySpinner_ = new BusyIndicator(root);
    activitySpinner_->hide();
    activityLayout->addWidget(activitySpinner_);
    activityLabel_ = new QLabel(root);
    activityLabel_->setObjectName(QStringLiteral("activity"));
    activityLabel_->setText(QStringLiteral("就绪"));
    addTextShadow(activityLabel_);
    activityLayout->addWidget(activityLabel_);
    activityLayout->addStretch();
    contentLayout->addLayout(activityLayout);

    setCentralWidget(root);
    root->installEventFilter(this);
}

void MainWindow::refreshCategories()
{
    const QList<ModInfo> mods = repository_.scan();
    categoryOrder_ = ModListLogic::orderedCategories(categories_, categoryOrder_);
    const QHash<QString, int> categoryCounts = ModListLogic::countByCategory(mods, categories_);

    QSignalBlocker blocker(categoryList_);
    categoryList_->clear();
    QStringList displayCategories{QStringLiteral("全部")};
    displayCategories += categoryOrder_;
    displayCategories.append(QStringLiteral("其他"));
    for (const QString& category : displayCategories) {
        auto* item = new QListWidgetItem(categoryList_);
        item->setData(Qt::UserRole, category);
        item->setData(Qt::UserRole + 1, QStringLiteral("%1 个模组").arg(categoryCounts.value(category)));
        Qt::ItemFlags itemFlags = item->flags() | Qt::ItemIsDragEnabled | Qt::ItemIsDropEnabled;
        if (category == QStringLiteral("全部") || category == QStringLiteral("其他")) {
            itemFlags &= ~Qt::ItemIsDragEnabled;
        }
        item->setFlags(itemFlags);
    }
}

void MainWindow::showCategoryOverview()
{
    currentCategory_.clear();
    contentStack_->setCurrentIndex(0);
    refreshCategories();
}

void MainWindow::showCategory(const QString& category)
{
    if (category != QStringLiteral("全部") && category != QStringLiteral("其他") && !categories_.contains(category)) {
        return;
    }

    currentCategory_ = category;
    contentStack_->setCurrentIndex(1);
    refreshMods();
}

void MainWindow::updateCategoryOrderFromList()
{
    QStringList requestedOrder;
    for (int index = 0; index < categoryList_->count(); ++index) {
        const QString category = categoryList_->item(index)->data(Qt::UserRole).toString();
        if (categories_.contains(category)) {
            requestedOrder.append(category);
        }
    }
    categoryOrder_ = ModListLogic::orderedCategories(categories_, requestedOrder);
    AppConfig::setModCategoryOrder(categoryOrder_);
}

void MainWindow::refreshMods()
{
    while (QLayoutItem* item = modListLayout_->takeAt(0)) {
        if (QWidget* widget = item->widget()) {
            widget->deleteLater();
        }
        delete item;
    }

    const QList<ModInfo> mods = ModListLogic::filterAndSort(
        repository_.scan(),
        currentCategory_,
        categories_,
        sortOrder_);
    modCategoryLabel_->setText(currentCategory_);
    modCountLabel_->setText(QStringLiteral("%1 个").arg(mods.size()));
    if (mods.isEmpty()) {
        auto* emptyState = new QLabel(QStringLiteral("该类别还没有导入模组"), centralWidget());
        emptyState->setObjectName(QStringLiteral("emptyState"));
        emptyState->setAlignment(Qt::AlignCenter);
        addTextShadow(emptyState);
        modListLayout_->addWidget(emptyState);
    } else {
        for (const ModInfo& mod : mods) {
            addModRow(mod);
        }
    }
    modListLayout_->addStretch();
}

void MainWindow::refreshModsWithFeedback()
{
    if (operationInProgress_) {
        return;
    }

    setOperationInProgress(true);
    activityLabel_->setText(QStringLiteral("正在刷新模组列表..."));
    QTimer::singleShot(100, this, [this] {
        refreshMods();
        setOperationInProgress(false);
        activityLabel_->setText(QStringLiteral("模组列表已刷新"));
    });
}

void MainWindow::addModRow(const ModInfo& mod)
{
    auto* row = new QFrame(centralWidget());
    row->setObjectName(QStringLiteral("modRow"));
    row->setFrameShape(QFrame::StyledPanel);
    auto* layout = new QHBoxLayout(row);
    layout->setContentsMargins(18, 14, 14, 14);
    layout->setSpacing(14);

    auto* detailsLayout = new QVBoxLayout();
    detailsLayout->setSpacing(4);
    auto* name = new QLabel(mod.name, row);
    name->setObjectName(QStringLiteral("modName"));
    name->setTextInteractionFlags(Qt::TextSelectableByMouse);
    auto* metadata = new QLabel(
        QStringLiteral("%1  |  导入于 %2")
            .arg(formatFileSize(mod.sizeBytes), mod.importedAt.toLocalTime().toString(QStringLiteral("yyyy-MM-dd HH:mm"))),
        row
    );
    metadata->setObjectName(QStringLiteral("metadata"));
    detailsLayout->addWidget(name);
    detailsLayout->addWidget(metadata);
    layout->addLayout(detailsLayout, 1);

    auto* state = new QLabel(mod.installed ? QStringLiteral("已安装") : QStringLiteral("未安装"), row);
    state->setObjectName(mod.installed ? QStringLiteral("stateInstalled") : QStringLiteral("stateUninstalled"));
    state->setAlignment(Qt::AlignCenter);
    state->setMinimumWidth(58);
    layout->addWidget(state);

    auto* installButton = createActionButton(
        row,
        {},
        style()->standardIcon(mod.installed ? QStyle::SP_DialogCancelButton : QStyle::SP_DialogApplyButton),
        mod.installed ? QStringLiteral("从游戏的 ~mods 文件夹中删除此模组的文件")
                      : QStringLiteral("将此模组的文件复制到游戏的 ~mods 文件夹"));
    connect(installButton, &QToolButton::clicked, this, [this, mod] {
        runAsyncOperation(
            mod.installed ? QStringLiteral("正在卸载 %1...").arg(mod.name) : QStringLiteral("正在安装 %1...").arg(mod.name),
            [repository = repository_, mod](const auto&) {
                return mod.installed ? repository.uninstall(mod) : repository.install(mod);
            });
    });
    layout->addWidget(installButton);

    // auto* deleteButton = createActionButton(
    //     row,
    //     {},
    //     style()->standardIcon(QStyle::SP_TrashIcon),
    //     QStringLiteral("删除已安装的模组文件及其备份文件")
    // );
    // deleteButton->setObjectName(QStringLiteral("deleteButton"));
    // connect(deleteButton, &QToolButton::clicked, this, [this, mod] {
    //     QMessageBox confirmation(this);
    //     confirmation.setWindowTitle(QStringLiteral("删除模组"));
    //     confirmation.setIcon(QMessageBox::Warning);
    //     confirmation.setText(QStringLiteral("将永久删除“%1”的备份文件及已安装的模组文件。此操作无法撤销。").arg(mod.name));
    //     QPushButton* confirmDelete = confirmation.addButton(QStringLiteral("删除"), QMessageBox::DestructiveRole);
    //     confirmation.addButton(QMessageBox::Cancel);
    //     confirmation.exec();
    //     if (confirmation.clickedButton() == confirmDelete) {
    //         runAsyncOperation(QStringLiteral("正在删除 %1...").arg(mod.name), [repository = repository_, mod](const auto&) {
    //             return repository.remove(mod);
    //         });
    //     }
    // });
    // layout->addWidget(deleteButton);

    auto* moreButton = createActionButton(
        row,
        QStringLiteral("•••"),
        {},
        QStringLiteral("更多选项")
    );
    moreButton->setObjectName(QStringLiteral("moreButton"));
    moreButton->setToolButtonStyle(Qt::ToolButtonTextOnly);
    moreButton->setFixedSize(32, 32);

    auto* moreMenu = new QMenu(moreButton);
    QAction* renameAction = moreMenu->addAction(QStringLiteral("重命名"));
    connect(renameAction, &QAction::triggered, this, [this, mod] {
        bool accepted = false;
        const QString newName = QInputDialog::getText(
            this,
            QStringLiteral("重命名模组"),
            QStringLiteral("模组名称："),
            QLineEdit::Normal,
            mod.name,
            &accepted
        );
        if (accepted) {
            handleOperation(repository_.rename(mod, newName));
        }
    });

    QAction* delAction = moreMenu->addAction(QStringLiteral("删除"));
    connect(delAction, &QAction::triggered, this, [this, mod] {
        QMessageBox confirmation(this);
        confirmation.setWindowTitle(QStringLiteral("删除模组"));
        confirmation.setIcon(QMessageBox::Warning);
        confirmation.setText(QStringLiteral("将永久删除“%1”的备份文件及已安装的模组文件。此操作无法撤销。").arg(mod.name));
        QPushButton* confirmDelete = confirmation.addButton(QStringLiteral("删除"), QMessageBox::DestructiveRole);
        confirmation.addButton(QMessageBox::Cancel);
        confirmation.exec();
        if (confirmation.clickedButton() == confirmDelete) {
            runAsyncOperation(QStringLiteral("正在删除 %1...").arg(mod.name), [repository = repository_, mod](const auto&) {
                return repository.remove(mod);
            });
        }
    });
    
    QAction* openAction = moreMenu->addAction(QStringLiteral("打开源文件位置"));
    connect(openAction, &QAction::triggered, this, [this, mod] {
        if (!QDesktopServices::openUrl(QUrl::fromLocalFile(mod.sourcePath))) {
            QMessageBox::warning(this, QStringLiteral("无法打开文件夹"), QStringLiteral("无法在资源管理器中打开：%1").arg(mod.sourcePath));
        }
    });

    if (mod.installed) {
        QAction* openInstallLocationAction = moreMenu->addAction(QStringLiteral("打开安装位置"));
        connect(openInstallLocationAction, &QAction::triggered, this, [this, mod] {
            const QString installPath = QStringLiteral("%1/%2").arg(ModRepository::modsDirectory()).arg(mod.name);
            if (!QDesktopServices::openUrl(QUrl::fromLocalFile(installPath))) {
                QMessageBox::warning(this, QStringLiteral("无法打开文件夹"), QStringLiteral("无法在资源管理器中打开：%1").arg(installPath));
            }
        });
    }

    moreButton->setMenu(moreMenu);
    moreButton->setPopupMode(QToolButton::InstantPopup);
    layout->addWidget(moreButton);

    modListLayout_->addWidget(row);
}

void MainWindow::importArchives(const QStringList& archivePaths)
{
    QStringList failures;
    for (const QString& archivePath : archivePaths) {
        const QString fileName = QFileInfo(archivePath).fileName();
        activityLabel_->setText(QStringLiteral("正在导入 %1...").arg(fileName));

        const OperationResult result = repository_.importArchive(archivePath);
        if (!result.success) {
            failures.append(QStringLiteral("%1：%2").arg(fileName, result.message));
        } else {
            activityLabel_->setText(result.message);
            const QString importedName = result.message.mid(QStringLiteral("已导入 ").size());
            const QList<ModInfo> importedMods = repository_.scan();
            const auto importedMod = std::find_if(importedMods.cbegin(), importedMods.cend(), [&importedName](const ModInfo& mod) {
                return mod.name == importedName;
            });
            if (importedMod != importedMods.cend()) {
                bool accepted = false;
                const QString newName = QInputDialog::getText(
                    this,
                    QStringLiteral("重命名模组"),
                    QStringLiteral("模组名称："),
                    QLineEdit::Normal,
                    QFileInfo(archivePath).completeBaseName(),
                    &accepted);
                if (accepted && newName != importedMod->name) {
                    const OperationResult renamed = repository_.rename(*importedMod, newName);
                    if (!renamed.success) {
                        failures.append(QStringLiteral("%1：%2").arg(fileName, renamed.message));
                    } else {
                        activityLabel_->setText(renamed.message);
                    }
                }
            }
        }
    }

    if (currentCategory_.isEmpty()) {
        refreshCategories();
    } else {
        refreshMods();
    }
    if (!failures.isEmpty()) {
        activityLabel_->setText(QStringLiteral("%1 个压缩包未能导入").arg(failures.size()));
        QMessageBox::warning(this, QStringLiteral("导入未完成"), failures.join(QLatin1Char('\n')));
    }
}

void MainWindow::packageMod()
{
    const QString packageDirectory = AppConfig::packagerDirectory();
    const QString batchPath = QDir(packageDirectory).filePath(QStringLiteral("傻瓜打包器.bat"));
    if (!QFileInfo(batchPath).isFile()) {
        QMessageBox::warning(this, QStringLiteral("无法打包模组"), QStringLiteral("找不到打包脚本：%1").arg(batchPath));
        return;
    }

    runAsyncOperation(
        QStringLiteral("正在打包模组..."),
        [batchPath, packageDirectory](const auto&) {
            QProcess process;
            process.setWorkingDirectory(packageDirectory);
            process.start(QStringLiteral("cmd.exe"), {QStringLiteral("/c"), QDir::toNativeSeparators(batchPath)});
            if (!process.waitForStarted(10000)) {
                return OperationResult{false, QStringLiteral("无法启动打包脚本：%1").arg(process.errorString())};
            }
            process.waitForFinished(-1);
            if (process.exitStatus() == QProcess::NormalExit && process.exitCode() == 2) {
                return OperationResult{false, {}, true};
            }
            if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
                const QString output = QString::fromLocal8Bit(
                    process.readAllStandardError() + process.readAllStandardOutput()).trimmed();
                return OperationResult{false, QStringLiteral("打包失败：%1").arg(output.isEmpty() ? QStringLiteral("打包脚本异常退出。") : output)};
            }
            return OperationResult{true, {}};
        },
        [this, packageDirectory](const OperationResult& result) {
            if (!result.success) {
                if (result.cancelled) {
                    activityLabel_->setText(QStringLiteral("已取消打包模组"));
                } else {
                    handleOperation(result);
                }
                return;
            }

            bool accepted = false;
            const QString modName = QInputDialog::getText(
                this,
                QStringLiteral("导入已打包模组"),
                QStringLiteral("模组名称："),
                QLineEdit::Normal,
                {},
                &accepted);
            if (!accepted) {
                activityLabel_->setText(QStringLiteral("已取消导入打包模组"));
                return;
            }

            runAsyncOperation(
                QStringLiteral("正在导入打包模组..."),
                [repository = repository_, modName, packageDirectory](const auto&) {
                    return repository.importPackagedMod(modName, packageDirectory);
                });
        });
}

void MainWindow::handleOperation(const OperationResult& result)
{
    if (currentCategory_.isEmpty()) {
        refreshCategories();
    } else {
        refreshMods();
    }
    if (result.success) {
        activityLabel_->setText(result.message);
        return;
    }

    activityLabel_->setText(QStringLiteral("操作未完成"));
    QMessageBox::warning(this, QStringLiteral("操作未完成"), result.message);
}

void MainWindow::changeInstallationForAll(bool install)
{
    const QString action = install ? QStringLiteral("安装") : QStringLiteral("卸载");
    const QString category = currentCategory_;
    const QStringList categories = categories_;
    const ModSortOrder sortOrder = sortOrder_;
    runAsyncOperation(QStringLiteral("正在批量%1模组...").arg(action), [repository = repository_, install, action, category, categories, sortOrder](const auto& updateActivity) {
        const QList<ModInfo> mods = ModListLogic::filterAndSort(repository.scan(), category, categories, sortOrder);
        QList<ModInfo> pendingMods;
        for (const ModInfo& mod : mods) {
            if (mod.installed != install) {
                pendingMods.append(mod);
            }
        }

        QStringList failures;
        int changedCount = 0;

        for (qsizetype index = 0; index < pendingMods.size(); ++index) {
            const ModInfo& mod = pendingMods.at(index);
            updateActivity(QStringLiteral("正在%1 %2（%3/%4）...")
                               .arg(action, mod.name)
                               .arg(index + 1)
                               .arg(pendingMods.size()));
            const OperationResult result = install ? repository.install(mod) : repository.uninstall(mod);
            if (result.success) {
                ++changedCount;
            } else {
                failures.append(QStringLiteral("%1：%2").arg(mod.name, result.message));
            }
        }

        const QString summary = QStringLiteral("已%1 %2 个模组").arg(action).arg(changedCount);
        return failures.isEmpty()
            ? OperationResult{true, summary}
            : OperationResult{false, QStringLiteral("%1\n%2").arg(summary, failures.join(QLatin1Char('\n')))};
    });
}

void MainWindow::runAsyncOperation(
    const QString& activity,
    std::function<OperationResult(const std::function<void(const QString&)>&)> operation,
    std::function<void(const OperationResult&)> completion)
{
    if (operationInProgress_) {
        return;
    }

    setOperationInProgress(true);
    activityLabel_->setText(activity);

    QPointer<MainWindow> window(this);
    auto* worker = QThread::create([window, operation = std::move(operation), completion = std::move(completion)]() mutable {
        const auto updateActivity = [window](const QString& message) {
            if (!window) {
                return;
            }
            QMetaObject::invokeMethod(window, [window, message] {
                if (window) {
                    window->activityLabel_->setText(message);
                }
            }, Qt::QueuedConnection);
        };
        const OperationResult result = operation(updateActivity);
        if (!window) {
            return;
        }
        QMetaObject::invokeMethod(window, [window, result, completion = std::move(completion)]() mutable {
            if (!window) {
                return;
            }
            window->setOperationInProgress(false);
            if (completion) {
                completion(result);
            } else {
                window->handleOperation(result);
            }
        }, Qt::QueuedConnection);
    });
    connect(worker, &QThread::finished, worker, &QObject::deleteLater);
    worker->start();
}

void MainWindow::setOperationInProgress(bool inProgress)
{
    operationInProgress_ = inProgress;
    activitySpinner_->setVisible(inProgress);
    categoryList_->setEnabled(!inProgress);
    for (QAbstractButton* button : centralWidget()->findChildren<QAbstractButton*>()) {
        button->setEnabled(!inProgress);
    }
}

QStringList MainWindow::archivePathsFromDrop(const QMimeData* mimeData)
{
    QStringList archivePaths;
    if (!mimeData->hasUrls()) {
        return archivePaths;
    }

    for (const QUrl& url : mimeData->urls()) {
        if (!url.isLocalFile()) {
            continue;
        }
        const QString localPath = url.toLocalFile();
        if (ModRepository::isSupportedArchive(localPath)) {
            archivePaths.append(localPath);
        }
    }
    return archivePaths;
}

QString MainWindow::formatFileSize(qint64 byteCount)
{
    static constexpr std::array<const char*, 5> units = {"B", "KB", "MB", "GB", "TB"};
    double size = static_cast<double>(byteCount);
    int unitIndex = 0;
    while (size >= 1024.0 && unitIndex < static_cast<int>(units.size()) - 1) {
        size /= 1024.0;
        ++unitIndex;
    }

    const int precision = unitIndex == 0 ? 0 : (size < 10.0 ? 1 : 0);
    return QStringLiteral("%1 %2").arg(size, 0, 'f', precision).arg(QString::fromLatin1(units.at(unitIndex)));
}