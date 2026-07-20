#include "MainWindow.h"

#include "AppConfig.h"

#include <QAbstractButton>
#include <QAbstractItemView>
#include <QActionGroup>
#include <QApplication>
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
#include <QListView>
#include <QMenu>
#include <QMessageBox>
#include <QMetaObject>
#include <QMimeData>
#include <QMouseEvent>
#include <QPainter>
#include <QPaintEvent>
#include <QPixmap>
#include <QPointer>
#include <QPropertyAnimation>
#include <QPushButton>
#include <QProcess>
#include <QSignalBlocker>
#include <QScrollArea>
#include <QStyle>
#include <QStyledItemDelegate>
#include <QThread>
#include <QTimer>
#include <QToolButton>
#include <QUrl>
#include <QVBoxLayout>
#include <QListWidget>
#include <QListWidgetItem>
#include <QStackedWidget>

#include <array>
#include <algorithm>

namespace
{
constexpr int kDragSourceRole = Qt::UserRole + 2;
constexpr int kDropMarkerRole = Qt::UserRole + 3;
constexpr int kDragPlaceholderRole = Qt::UserRole + 4;

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

class CategoryDragPreview final : public QWidget
{
public:
    explicit CategoryDragPreview(QWidget* parent)
        : QWidget(parent)
    {
        setAttribute(Qt::WA_TransparentForMouseEvents);
        setFixedSize(220, 78);
        hide();
    }

    void setCardText(const QString& categoryName, const QString& categoryCount)
    {
        categoryName_ = categoryName;
        categoryCount_ = categoryCount;
        update();
    }

protected:
    void paintEvent(QPaintEvent*) override
    {
        QPainter painter(this);
        painter.setRenderHint(QPainter::Antialiasing);
        const QRect cardRect = rect().adjusted(1, 1, -2, -2);
        painter.setBrush(QColor(255, 255, 255, 235));
        painter.setPen(QPen(QColor(QStringLiteral("#0067b1")), 2));
        painter.drawRoundedRect(cardRect, 14, 14);

        const QRect textRect = cardRect.adjusted(14, 10, -14, -10);
        QFont nameFont = font();
        nameFont.setBold(true);
        painter.setFont(nameFont);
        painter.setPen(QColor(QStringLiteral("#003b6f")));
        painter.drawText(textRect, Qt::AlignHCenter | Qt::AlignTop, categoryName_);

        QFont countFont = font();
        countFont.setBold(false);
        painter.setFont(countFont);
        painter.setPen(QColor(QStringLiteral("#60758a")));
        painter.drawText(textRect, Qt::AlignHCenter | Qt::AlignBottom, categoryCount_);
    }

private:
    QString categoryName_;
    QString categoryCount_;
};

class CategoryCardDelegate final : public QStyledItemDelegate
{
public:
    explicit CategoryCardDelegate(QObject* parent = nullptr)
        : QStyledItemDelegate(parent)
    {
    }

    void paint(QPainter* painter, const QStyleOptionViewItem& option, const QModelIndex& index) const override
    {
        painter->save();
        painter->setRenderHint(QPainter::Antialiasing);

        const bool placeholder = index.data(kDragPlaceholderRole).toBool();
        const bool selected = option.state.testFlag(QStyle::State_Selected);
        const bool dragging = option.widget != nullptr && option.widget->property("categoryDragging").toBool();
        const bool hovered = !dragging && option.state.testFlag(QStyle::State_MouseOver);
        const bool dragged = index.data(kDragSourceRole).toBool();
        const int dropMarker = index.data(kDropMarkerRole).toInt();
        const QRect cardRect = option.rect.adjusted(0, 0, -1, -1);
        if (placeholder) {
            painter->setBrush(Qt::NoBrush);
            painter->setPen(QPen(QColor(0, 103, 177, 95), 2, Qt::DashLine));
            painter->drawRoundedRect(cardRect.adjusted(3, 3, -3, -3), 14, 14);
            painter->restore();
            return;
        }
        const QColor background = selected
            ? QColor(QStringLiteral("#d9ecff"))
            : (hovered ? QColor(240, 247, 255, 225) : QColor(255, 255, 255, 155));
        QColor cardBackground = background;
        if (dragged) {
            cardBackground.setAlpha(80);
        }
        painter->setBrush(cardBackground);
        painter->setPen(selected ? QColor(QStringLiteral("#8bc0e8")) : QColor(255, 255, 255, 145));
        painter->drawRoundedRect(cardRect, 14, 14);

        if (dropMarker != 0) {
            const int markerX = dropMarker < 0 ? cardRect.left() + 3 : cardRect.right() - 3;
            painter->setPen(QPen(QColor(QStringLiteral("#0067b1")), 3, Qt::SolidLine, Qt::RoundCap));
            painter->drawLine(markerX, cardRect.top() + 12, markerX, cardRect.bottom() - 12);
        }

        const QRect textRect = cardRect.adjusted(14, 10, -14, -10);
        QFont nameFont = option.font;
        nameFont.setBold(true);
        painter->setFont(nameFont);
        painter->setPen(selected ? QColor(QStringLiteral("#003b6f")) : QColor(QStringLiteral("#102a43")));
        painter->drawText(textRect, Qt::AlignHCenter | Qt::AlignTop, index.data(Qt::UserRole).toString());

        QFont countFont = option.font;
        countFont.setBold(false);
        painter->setFont(countFont);
        painter->setPen(QColor(QStringLiteral("#60758a")));
        painter->drawText(textRect, Qt::AlignHCenter | Qt::AlignBottom, index.data(Qt::UserRole + 1).toString());
        painter->restore();
    }

    QSize sizeHint(const QStyleOptionViewItem&, const QModelIndex&) const override
    {
        return QSize(220, 78);
    }
};

class CategoryListWidget final : public QListWidget
{
public:
    using QListWidget::QListWidget;

    std::function<void()> orderChanged;

protected:
    void mousePressEvent(QMouseEvent* event) override
    {
        if (dragging_) {
            cancelDrag();
        }
        cancelPreviewAnimation();
        pressedItem_ = event->button() == Qt::LeftButton ? itemAt(event->position().toPoint()) : nullptr;
        pressPosition_ = event->position().toPoint();
        dragging_ = false;
        QListWidget::mousePressEvent(event);
    }

    void mouseMoveEvent(QMouseEvent* event) override
    {
        if (pressedItem_ == nullptr || isFixedCategory(pressedItem_) || !(event->buttons() & Qt::LeftButton)) {
            QListWidget::mouseMoveEvent(event);
            return;
        }

        if (!dragging_ && (event->position().toPoint() - pressPosition_).manhattanLength() >= QApplication::startDragDistance()) {
            beginDrag();
            showPreview(event->position().toPoint());
            updateDropTarget(event->position().toPoint());
            viewport()->setCursor(Qt::ClosedHandCursor);
        }
        if (!dragging_) {
            QListWidget::mouseMoveEvent(event);
            return;
        }

        movePreview(event->position().toPoint());
        updateDropTarget(event->position().toPoint());
        event->accept();
    }

    void mouseReleaseEvent(QMouseEvent* event) override
    {
        const bool wasDragging = dragging_;
        if (wasDragging && event->button() == Qt::LeftButton) {
            updateDropTarget(event->position().toPoint());
            const QRect destination = commitDrag();
            animatePreviewTo(destination, draggedItem_);
            event->accept();
        } else {
            QListWidget::mouseReleaseEvent(event);
        }

        pressedItem_ = nullptr;
        draggedItem_ = nullptr;
        placeholderItem_ = nullptr;
        dragging_ = false;
        viewport()->setProperty("categoryDragging", false);
        viewport()->unsetCursor();
    }

private:
    void beginDrag()
    {
        if (pressedItem_ == nullptr) {
            return;
        }

        dragging_ = true;
        const int sourceRow = row(pressedItem_);
        draggedItem_ = takeItem(sourceRow);
        placeholderItem_ = new QListWidgetItem();
        placeholderItem_->setData(kDragPlaceholderRole, true);
        placeholderItem_->setFlags(Qt::NoItemFlags);
        placeholderItem_->setSizeHint(QSize(220, 78));
        insertItem(sourceRow, placeholderItem_);
        dropInsertionIndex_ = 0;
        for (int index = 0; index < sourceRow; ++index) {
            if (!isFixedCategory(item(index))) {
                ++dropInsertionIndex_;
            }
        }
        viewport()->setProperty("categoryDragging", true);
        doItemsLayout();
    }

    void showPreview(const QPoint& position)
    {
        if (preview_ == nullptr) {
            preview_ = new CategoryDragPreview(viewport());
            previewAnimation_ = new QPropertyAnimation(preview_, "geometry", preview_);
            previewAnimation_->setDuration(180);
            previewAnimation_->setEasingCurve(QEasingCurve::OutCubic);
            connect(previewAnimation_, &QPropertyAnimation::finished, this, [this] {
                preview_->hide();
                if (animatedItem_ != nullptr) {
                    animatedItem_->setData(kDragSourceRole, false);
                    animatedItem_ = nullptr;
                    viewport()->update();
                }
            });
        }

        preview_->setCardText(
            draggedItem_->data(Qt::UserRole).toString(),
            draggedItem_->data(Qt::UserRole + 1).toString());
        movePreview(position);
        preview_->show();
        preview_->raise();
        viewport()->update();
    }

    void movePreview(const QPoint& position)
    {
        if (preview_ != nullptr && preview_->isVisible()) {
            preview_->move(position - QPoint(preview_->width() / 2, preview_->height() / 2));
        }
    }

    void updateDropTarget(const QPoint& position)
    {
        QListWidgetItem* newTarget = itemAt(position);
        if (newTarget == nullptr || newTarget == placeholderItem_) {
            return;
        }

        int newMarker = 0;
        int newInsertionIndex = dropInsertionIndex_;
        if (newTarget != nullptr) {
            if (isAllCategory(newTarget)) {
                newMarker = 1;
                newInsertionIndex = 0;
            } else if (isOtherCategory(newTarget)) {
                newMarker = -1;
                newInsertionIndex = movableCategoryCount();
            } else {
                const QRect targetRect = visualItemRect(newTarget);
                const QPoint targetCenter = targetRect.center();
                const bool afterTarget = std::abs(position.y() - targetCenter.y()) > targetRect.height() / 3
                    ? position.y() > targetCenter.y()
                    : position.x() > targetCenter.x();
                newMarker = afterTarget ? 1 : -1;
                const int targetIndex = movableCategoryIndex(newTarget);
                if (targetIndex < 0) {
                    return;
                }
                newInsertionIndex = targetIndex + (afterTarget ? 1 : 0);
            }
        }

        const bool targetChanged = dropTargetItem_ != newTarget || dropMarker_ != newMarker;
        const bool insertionChanged = dropInsertionIndex_ != newInsertionIndex;
        if (targetChanged || insertionChanged) {
            if (dropTargetItem_ != nullptr) {
                dropTargetItem_->setData(kDropMarkerRole, 0);
            }
            dropTargetItem_ = newTarget;
            dropMarker_ = newMarker;
            dropInsertionIndex_ = newInsertionIndex;
            if (dropTargetItem_ != nullptr) {
                dropTargetItem_->setData(kDropMarkerRole, dropMarker_);
            }
            movePlaceholder();
            viewport()->update();
        }
    }

    void movePlaceholder()
    {
        if (placeholderItem_ == nullptr) {
            return;
        }

        const int destinationRow = 1 + std::clamp(dropInsertionIndex_, 0, movableCategoryCount());
        if (row(placeholderItem_) == destinationRow) {
            return;
        }

        viewport()->setUpdatesEnabled(false);
        takeItem(row(placeholderItem_));
        insertItem(destinationRow, placeholderItem_);
        doItemsLayout();
        viewport()->setUpdatesEnabled(true);
        viewport()->update();
    }

    int movableCategoryCount() const
    {
        int count = 0;
        for (int index = 0; index < this->count(); ++index) {
            const QListWidgetItem* listItem = item(index);
            if (listItem != placeholderItem_ && !isFixedCategory(listItem)) {
                ++count;
            }
        }
        return count;
    }

    int movableCategoryIndex(const QListWidgetItem* targetItem) const
    {
        int index = 0;
        for (int rowIndex = 0; rowIndex < count(); ++rowIndex) {
            const QListWidgetItem* listItem = item(rowIndex);
            if (listItem == placeholderItem_ || isFixedCategory(listItem)) {
                continue;
            }
            if (listItem == targetItem) {
                return index;
            }
            ++index;
        }
        return -1;
    }

    QRect commitDrag()
    {
        if (draggedItem_ == nullptr || placeholderItem_ == nullptr) {
            return {};
        }

        const int destinationRow = row(placeholderItem_);
        takeItem(destinationRow);
        delete placeholderItem_;
        placeholderItem_ = nullptr;
        draggedItem_->setData(kDragSourceRole, true);
        insertItem(destinationRow, draggedItem_);
        setCurrentItem(draggedItem_);
        doItemsLayout();
        if (orderChanged) {
            orderChanged();
        }
        return visualItemRect(draggedItem_);
    }

    void animatePreviewTo(const QRect& destination, QListWidgetItem* item)
    {
        if (dropTargetItem_ != nullptr) {
            dropTargetItem_->setData(kDropMarkerRole, 0);
            dropTargetItem_ = nullptr;
            dropMarker_ = 0;
        }

        if (preview_ == nullptr || !preview_->isVisible() || !destination.isValid()) {
            item->setData(kDragSourceRole, false);
            viewport()->update();
            return;
        }

        animatedItem_ = item;
        previewAnimation_->stop();
        previewAnimation_->setStartValue(preview_->geometry());
        previewAnimation_->setEndValue(destination);
        previewAnimation_->start();
    }

    void cancelPreviewAnimation()
    {
        if (previewAnimation_ != nullptr && previewAnimation_->state() == QAbstractAnimation::Running) {
            previewAnimation_->stop();
        }
        if (preview_ != nullptr) {
            preview_->hide();
        }
        if (animatedItem_ != nullptr) {
            animatedItem_->setData(kDragSourceRole, false);
            animatedItem_ = nullptr;
            viewport()->update();
        }
    }

    void cancelDrag()
    {
        if (placeholderItem_ != nullptr && draggedItem_ != nullptr) {
            const int destinationRow = row(placeholderItem_);
            takeItem(destinationRow);
            delete placeholderItem_;
            insertItem(destinationRow, draggedItem_);
            draggedItem_->setData(kDragSourceRole, false);
        }
        if (dropTargetItem_ != nullptr) {
            dropTargetItem_->setData(kDropMarkerRole, 0);
            dropTargetItem_ = nullptr;
        }
        placeholderItem_ = nullptr;
        draggedItem_ = nullptr;
        dropMarker_ = 0;
        dropInsertionIndex_ = 0;
        dragging_ = false;
        viewport()->setProperty("categoryDragging", false);
        viewport()->update();
    }

    static bool isAllCategory(const QListWidgetItem* item)
    {
        return item->data(Qt::UserRole).toString() == QStringLiteral("全部");
    }

    static bool isOtherCategory(const QListWidgetItem* item)
    {
        return item->data(Qt::UserRole).toString() == QStringLiteral("其他");
    }

    static bool isFixedCategory(const QListWidgetItem* item)
    {
        return isAllCategory(item) || isOtherCategory(item);
    }

    QListWidgetItem* pressedItem_ = nullptr;
    QListWidgetItem* draggedItem_ = nullptr;
    QListWidgetItem* placeholderItem_ = nullptr;
    QListWidgetItem* dropTargetItem_ = nullptr;
    QListWidgetItem* animatedItem_ = nullptr;
    QPoint pressPosition_;
    CategoryDragPreview* preview_ = nullptr;
    QPropertyAnimation* previewAnimation_ = nullptr;
    int dropMarker_ = 0;
    int dropInsertionIndex_ = 0;
    bool dragging_ = false;
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
    , sortOrder_(static_cast<ModSortOrder>(std::clamp(AppConfig::modListSortOrder(), 0, 6)))
    , categories_(AppConfig::modCategories())
    , categoryOrder_(AppConfig::modCategoryOrder())
{
    QStringList validCategories;
    for (const QString& category : categories_) {
        if (!category.isEmpty() && category != QStringLiteral("全部") && category != QStringLiteral("其他")
            && !validCategories.contains(category)) {
            validCategories.append(category);
        }
    }
    categories_ = validCategories;

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
    auto* importHint = new QLabel(QStringLiteral("将 .zip 或 .rar 压缩包拖放到这里即可导入"), dropZone);
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
    auto* categoryTitle = new QLabel(QStringLiteral("模组分类"), categoryPage);
    categoryTitle->setObjectName(QStringLiteral("sectionTitle"));
    addTextShadow(categoryTitle);
    categoryHeader->addWidget(categoryTitle);
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
    categoryList_->setGridSize(QSize(236, 92));
    categoryList_->setDragDropMode(QAbstractItemView::NoDragDrop);
    categoryList_->setDragEnabled(false);
    categoryList_->setAcceptDrops(false);
    categoryList_->setDropIndicatorShown(false);
    categoryList_->setItemDelegate(new CategoryCardDelegate(categoryList_));
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
    auto* backButton = new QPushButton(style()->standardIcon(QStyle::SP_ArrowBack), {}, modsPage);
    backButton->setObjectName(QStringLiteral("modListActionButton"));
    backButton->setToolTip(QStringLiteral("返回模组分类"));
    backButton->setCursor(Qt::PointingHandCursor);
    connect(backButton, &QPushButton::clicked, this, &MainWindow::showCategoryOverview);
    listHeader->addWidget(backButton);
    modCategoryLabel_ = new QLabel(QStringLiteral("已导入模组"), modsPage);
    modCategoryLabel_->setObjectName(QStringLiteral("sectionTitle"));
    addTextShadow(modCategoryLabel_);
    modCountLabel_ = new QLabel(root);
    modCountLabel_->setObjectName(QStringLiteral("count"));
    addTextShadow(modCountLabel_);
    listHeader->addWidget(modCategoryLabel_);
    listHeader->addWidget(modCountLabel_);
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

QString MainWindow::categoryForMod(const ModInfo& mod) const
{
    QString matchedCategory;
    for (const QString& category : categories_) {
        if (mod.name.startsWith(category) && category.size() > matchedCategory.size()) {
            matchedCategory = category;
        }
    }
    return matchedCategory.isEmpty() ? QStringLiteral("其他") : matchedCategory;
}

void MainWindow::refreshCategories()
{
    const QList<ModInfo> mods = repository_.scan();
    QStringList orderedCategories;
    for (const QString& category : categoryOrder_) {
        if (categories_.contains(category) && !orderedCategories.contains(category)) {
            orderedCategories.append(category);
        }
    }
    for (const QString& category : categories_) {
        if (!orderedCategories.contains(category)) {
            orderedCategories.append(category);
        }
    }
    categoryOrder_ = orderedCategories;

    QSignalBlocker blocker(categoryList_);
    categoryList_->clear();
    QStringList displayCategories{QStringLiteral("全部")};
    displayCategories += categoryOrder_;
    displayCategories.append(QStringLiteral("其他"));
    for (const QString& category : displayCategories) {
        int count = 0;
        for (const ModInfo& mod : mods) {
            if (category == QStringLiteral("全部") || categoryForMod(mod) == category) {
                ++count;
            }
        }

        auto* item = new QListWidgetItem(categoryList_);
        item->setData(Qt::UserRole, category);
        item->setData(Qt::UserRole + 1, QStringLiteral("%1 个模组").arg(count));
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
    QStringList newOrder;
    for (int index = 0; index < categoryList_->count(); ++index) {
        const QString category = categoryList_->item(index)->data(Qt::UserRole).toString();
        if (categories_.contains(category) && !newOrder.contains(category)) {
            newOrder.append(category);
        }
    }
    categoryOrder_ = newOrder;
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

    QList<ModInfo> mods = repository_.scan();
    if (currentCategory_ != QStringLiteral("全部")) {
        mods.erase(std::remove_if(mods.begin(), mods.end(), [this](const ModInfo& mod) {
            return categoryForMod(mod) != currentCategory_;
        }), mods.end());
    }
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