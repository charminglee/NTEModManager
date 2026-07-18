#include "MainWindow.h"

#include <QAbstractButton>
#include <QActionGroup>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QDragEnterEvent>
#include <QDropEvent>
#include <QEvent>
#include <QFileInfo>
#include <QFrame>
#include <QGraphicsDropShadowEffect>
#include <QHBoxLayout>
#include <QIcon>
#include <QInputDialog>
#include <QLabel>
#include <QLineEdit>
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
#include <QScrollArea>
#include <QStyle>
#include <QThread>
#include <QTimer>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>

#include <array>
#include <algorithm>

namespace
{
class BackgroundWidget final : public QWidget
{
public:
    explicit BackgroundWidget(const QString& backgroundImagePath, QWidget* parent = nullptr)
        : QWidget(parent)
        , background_(backgroundImagePath)
    {
    }

protected:
    void paintEvent(QPaintEvent*) override
    {
        QPainter painter(this);
        painter.fillRect(rect(), QColor(QStringLiteral("#08111d")));
        if (background_.isNull()) {
            return;
        }

        const QSize scaledSize = background_.size().scaled(size(), Qt::KeepAspectRatioByExpanding);
        const QPoint topLeft((width() - scaledSize.width()) / 2, (height() - scaledSize.height()) / 2);
        painter.setRenderHint(QPainter::SmoothPixmapTransform);
        painter.drawPixmap(QRect(topLeft, scaledSize), background_);
    }

private:
    QPixmap background_;
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

MainWindow::MainWindow(const QString& backgroundImagePath, QWidget* parent)
    : QMainWindow(parent)
    , backgroundImagePath_(backgroundImagePath)
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
    refreshMods();
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
    auto* root = new BackgroundWidget(backgroundImagePath_, this);
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
        const QString launcherPath = QStringLiteral("E:/Neverness To Everness/NTELauncher.exe");
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
    auto* importHint = new QLabel(QStringLiteral("将 .zip 或 .rar 压缩包拖放到这里即可导入"), dropZone);
    importHint->setObjectName(QStringLiteral("dropHint"));
    importTextLayout->addWidget(importTitle);
    importTextLayout->addWidget(importHint);
    dropLayout->addLayout(importTextLayout);
    dropLayout->addStretch();
    contentLayout->addWidget(dropZone);

    auto* listHeader = new QHBoxLayout();
    auto* listTitle = new QLabel(QStringLiteral("已导入模组"), root);
    listTitle->setObjectName(QStringLiteral("sectionTitle"));
    addTextShadow(listTitle);
    modCountLabel_ = new QLabel(root);
    modCountLabel_->setObjectName(QStringLiteral("count"));
    addTextShadow(modCountLabel_);
    listHeader->addWidget(listTitle);
    listHeader->addWidget(modCountLabel_);
    listHeader->addStretch();

    auto* sortButton = new QPushButton(style()->standardIcon(QStyle::SP_FileDialogDetailedView), {}, root);
    sortButton->setObjectName(QStringLiteral("modListActionButton"));
    sortButton->setToolTip(QStringLiteral("选择模组列表排序方式"));
    sortButton->setCursor(Qt::PointingHandCursor);
    auto* sortMenu = new QMenu(sortButton);
    auto* sortActions = new QActionGroup(sortMenu);
    sortActions->setExclusive(true);
    const auto addSortAction = [this, sortMenu, sortActions](const QString& text, ModSortOrder sortOrder, bool checked = false) {
        QAction* action = sortMenu->addAction(text);
        action->setCheckable(true);
        action->setChecked(checked);
        sortActions->addAction(action);
        connect(action, &QAction::triggered, this, [this, sortOrder] {
            sortOrder_ = sortOrder;
            refreshMods();
        });
    };
    addSortAction(QStringLiteral("默认"), ModSortOrder::InstalledFirst, true);
    addSortAction(QStringLiteral("名称：A 到 Z"), ModSortOrder::NameAscending);
    addSortAction(QStringLiteral("名称：Z 到 A"), ModSortOrder::NameDescending);
    addSortAction(QStringLiteral("导入时间：最新优先"), ModSortOrder::ImportedNewestFirst);
    addSortAction(QStringLiteral("导入时间：最早优先"), ModSortOrder::ImportedOldestFirst);
    addSortAction(QStringLiteral("文件大小：从大到小"), ModSortOrder::SizeLargestFirst);
    addSortAction(QStringLiteral("文件大小：从小到大"), ModSortOrder::SizeSmallestFirst);
    sortButton->setMenu(sortMenu);

    auto* installAllButton = new QPushButton(style()->standardIcon(QStyle::SP_DialogApplyButton), QStringLiteral("全部安装"), root);
    installAllButton->setObjectName(QStringLiteral("modListActionButton"));
    installAllButton->setToolTip(QStringLiteral("将所有未安装模组复制到游戏的 ~mods 文件夹"));
    installAllButton->setCursor(Qt::PointingHandCursor);
    connect(installAllButton, &QPushButton::clicked, this, [this] {
        changeInstallationForAll(true);
    });
    listHeader->addWidget(installAllButton);

    auto* uninstallAllButton = new QPushButton(style()->standardIcon(QStyle::SP_DialogCancelButton), QStringLiteral("全部卸载"), root);
    uninstallAllButton->setObjectName(QStringLiteral("modListActionButton"));
    uninstallAllButton->setToolTip(QStringLiteral("从游戏的 ~mods 文件夹中删除所有已安装模组文件"));
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
    contentLayout->addLayout(listHeader);

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
    contentLayout->addWidget(scrollArea, 1);

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

void MainWindow::refreshMods()
{
    while (QLayoutItem* item = modListLayout_->takeAt(0)) {
        if (QWidget* widget = item->widget()) {
            widget->deleteLater();
        }
        delete item;
    }

    QList<ModInfo> mods = repository_.scan();
    switch (sortOrder_) {
    case ModSortOrder::InstalledFirst:
        break;
    case ModSortOrder::NameAscending:
        std::sort(mods.begin(), mods.end(), [](const ModInfo& left, const ModInfo& right) {
            return QString::localeAwareCompare(left.name, right.name) < 0;
        });
        break;
    case ModSortOrder::NameDescending:
        std::sort(mods.begin(), mods.end(), [](const ModInfo& left, const ModInfo& right) {
            return QString::localeAwareCompare(left.name, right.name) > 0;
        });
        break;
    case ModSortOrder::ImportedNewestFirst:
        std::sort(mods.begin(), mods.end(), [](const ModInfo& left, const ModInfo& right) {
            return left.importedAt > right.importedAt;
        });
        break;
    case ModSortOrder::ImportedOldestFirst:
        std::sort(mods.begin(), mods.end(), [](const ModInfo& left, const ModInfo& right) {
            return left.importedAt < right.importedAt;
        });
        break;
    case ModSortOrder::SizeLargestFirst:
        std::sort(mods.begin(), mods.end(), [](const ModInfo& left, const ModInfo& right) {
            return left.sizeBytes > right.sizeBytes;
        });
        break;
    case ModSortOrder::SizeSmallestFirst:
        std::sort(mods.begin(), mods.end(), [](const ModInfo& left, const ModInfo& right) {
            return left.sizeBytes < right.sizeBytes;
        });
        break;
    }
    modCountLabel_->setText(QStringLiteral("%1 个").arg(mods.size()));
    if (mods.isEmpty()) {
        auto* emptyState = new QLabel(QStringLiteral("还没有导入模组"), centralWidget());
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
        row);
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

    auto* deleteButton = createActionButton(
        row,
        {},
        style()->standardIcon(QStyle::SP_TrashIcon),
        QStringLiteral("删除已安装的模组文件及其备份文件"));
    deleteButton->setObjectName(QStringLiteral("deleteButton"));
    connect(deleteButton, &QToolButton::clicked, this, [this, mod] {
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
    layout->addWidget(deleteButton);

    auto* moreButton = createActionButton(
        row,
        QStringLiteral("•••"),
        {},
        QStringLiteral("更多选项"));
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
            &accepted);
        if (accepted) {
            handleOperation(repository_.rename(mod, newName));
        }
    });
    QAction* openAction = moreMenu->addAction(QStringLiteral("打开"));
    connect(openAction, &QAction::triggered, this, [this, mod] {
        if (!QDesktopServices::openUrl(QUrl::fromLocalFile(mod.sourcePath))) {
            QMessageBox::warning(this, QStringLiteral("无法打开文件夹"), QStringLiteral("无法在资源管理器中打开：%1").arg(mod.sourcePath));
        }
    });
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
        }
    }

    refreshMods();
    if (!failures.isEmpty()) {
        activityLabel_->setText(QStringLiteral("%1 个压缩包未能导入").arg(failures.size()));
        QMessageBox::warning(this, QStringLiteral("导入未完成"), failures.join(QLatin1Char('\n')));
    }
}

void MainWindow::packageMod()
{
    const QString packageDirectory = QString::fromUtf8(NTE_PACKAGER_DIRECTORY);
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
            if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
                const QString output = QString::fromLocal8Bit(
                    process.readAllStandardError() + process.readAllStandardOutput()).trimmed();
                return OperationResult{false, QStringLiteral("打包失败：%1").arg(output.isEmpty() ? QStringLiteral("打包脚本异常退出。") : output)};
            }
            return OperationResult{true, {}};
        },
        [this, packageDirectory](const OperationResult& result) {
            if (!result.success) {
                handleOperation(result);
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
    refreshMods();
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
    runAsyncOperation(QStringLiteral("正在批量%1模组...").arg(action), [repository = repository_, install, action](const auto& updateActivity) {
        const QList<ModInfo> mods = repository.scan();
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