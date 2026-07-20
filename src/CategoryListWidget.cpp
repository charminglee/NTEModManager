#include "CategoryListWidget.h"

#include <QApplication>
#include <QMouseEvent>
#include <QPainter>
#include <QStyledItemDelegate>
#include <QStyleOptionViewItem>

#include <algorithm>

namespace
{
constexpr int kDragSourceRole = Qt::UserRole + 2;
constexpr int kDropMarkerRole = Qt::UserRole + 3;
constexpr int kDragPlaceholderRole = Qt::UserRole + 4;

class CategoryDragPreview final : public QWidget
{
public:
    explicit CategoryDragPreview(QWidget* parent)
        : QWidget(parent)
    {
        setAttribute(Qt::WA_TransparentForMouseEvents);
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
        const QWidget* styleSource = parentWidget() == nullptr ? nullptr : parentWidget()->parentWidget();
        const auto colorProperty = [styleSource](const char* name) {
            return styleSource == nullptr ? QColor() : styleSource->property(name).value<QColor>();
        };
        const auto intProperty = [styleSource](const char* name) {
            return styleSource == nullptr ? 0 : styleSource->property(name).toInt();
        };
        painter.setBrush(colorProperty("categoryCardPreviewBackgroundColor"));
        painter.setPen(QPen(colorProperty("categoryCardPreviewBorderColor"), intProperty("categoryCardBorderWidth")));
        painter.drawRoundedRect(cardRect, intProperty("categoryCardCornerRadius"), intProperty("categoryCardCornerRadius"));

        const int horizontalMargin = intProperty("categoryCardTextHorizontalMargin");
        const int verticalMargin = intProperty("categoryCardTextVerticalMargin");
        const QRect textRect = cardRect.adjusted(horizontalMargin, verticalMargin, -horizontalMargin, -verticalMargin);
        QFont nameFont = font();
        nameFont.setBold(styleSource != nullptr && styleSource->property("categoryCardNameBold").toBool());
        painter.setFont(nameFont);
        painter.setPen(colorProperty("categoryCardPreviewTextColor"));
        painter.drawText(textRect, Qt::AlignHCenter | Qt::AlignTop, categoryName_);

        QFont countFont = font();
        countFont.setBold(styleSource != nullptr && styleSource->property("categoryCardCountBold").toBool());
        countFont.setPointSize(intProperty("categoryCardCountFontSize"));
        painter.setFont(countFont);
        painter.setPen(colorProperty("categoryCardCountColor"));
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
            const int placeholderMargin = option.widget->property("categoryCardPlaceholderMargin").toInt();
            const int placeholderWidth = option.widget->property("categoryCardPlaceholderWidth").toInt();
            const int cornerRadius = option.widget->property("categoryCardCornerRadius").toInt();
            painter->setPen(QPen(
                option.widget->property("categoryCardPlaceholderColor").value<QColor>(),
                placeholderWidth,
                Qt::DashLine));
            painter->drawRoundedRect(
                cardRect.adjusted(placeholderMargin, placeholderMargin, -placeholderMargin, -placeholderMargin),
                cornerRadius,
                cornerRadius);
            painter->restore();
            return;
        }
        QStyleOptionViewItem styledOption(option);
        styledOption.rect = cardRect;
        styledOption.state &= ~QStyle::State_HasFocus;
        styledOption.state.setFlag(QStyle::State_MouseOver, hovered);
        styledOption.state.setFlag(QStyle::State_Selected, selected);
        if (dragged) {
            styledOption.state &= ~QStyle::State_Enabled;
        }
        if (option.widget != nullptr) {
            option.widget->style()->drawControl(QStyle::CE_ItemViewItem, &styledOption, painter, option.widget);
        }

        if (dropMarker != 0) {
            const int markerMargin = option.widget->property("categoryCardMarkerMargin").toInt();
            const int markerX = dropMarker < 0 ? cardRect.left() + markerMargin : cardRect.right() - markerMargin;
            const QColor markerColor = option.widget->property("categoryCardMarkerColor").value<QColor>();
            const int markerWidth = option.widget->property("categoryCardMarkerWidth").toInt();
            painter->setPen(QPen(markerColor, markerWidth, Qt::SolidLine, Qt::RoundCap));
            painter->drawLine(markerX, cardRect.top() + markerMargin, markerX, cardRect.bottom() - markerMargin);
        }

        const int horizontalMargin = option.widget->property("categoryCardTextHorizontalMargin").toInt();
        const int verticalMargin = option.widget->property("categoryCardTextVerticalMargin").toInt();
        const QRect textRect = cardRect.adjusted(horizontalMargin, verticalMargin, -horizontalMargin, -verticalMargin);
        QFont nameFont = option.font;
        nameFont.setBold(option.widget->property("categoryCardNameBold").toBool());
        painter->setFont(nameFont);
        const QColor nameColor = selected
            ? option.widget->property("categoryCardSelectedTextColor").value<QColor>()
            : option.widget->property("categoryCardTextColor").value<QColor>();
        painter->setPen(nameColor);
        painter->drawText(textRect, Qt::AlignHCenter | Qt::AlignTop, index.data(Qt::UserRole).toString());

        QFont countFont = option.font;
        countFont.setBold(option.widget->property("categoryCardCountBold").toBool());
        countFont.setPointSize(option.widget->property("categoryCardCountFontSize").toInt());
        painter->setFont(countFont);
        painter->setPen(option.widget->property("categoryCardCountColor").value<QColor>());
        painter->drawText(textRect, Qt::AlignHCenter | Qt::AlignBottom, index.data(Qt::UserRole + 1).toString());
        painter->restore();
    }

    QSize sizeHint(const QStyleOptionViewItem& option, const QModelIndex&) const override
    {
        const int cardWidth = option.widget->property("categoryCardWidth").toInt();
        const int cardHeight = option.widget->property("categoryCardHeight").toInt();
        return QSize(
            cardWidth > 0 ? cardWidth : 220,
            cardHeight > 0 ? cardHeight : 78);
    }
};
}

CategoryListWidget::CategoryListWidget(QWidget* parent)
    : QListWidget(parent)
{
    setItemDelegate(new CategoryCardDelegate(this));
}

void CategoryListWidget::mousePressEvent(QMouseEvent* event)
{
    if (dragging_) {
        cancelDrag();
    }
    hidePreview();
    pressedItem_ = event->button() == Qt::LeftButton ? itemAt(event->position().toPoint()) : nullptr;
    pressPosition_ = event->position().toPoint();
    dragging_ = false;
    QListWidget::mousePressEvent(event);
}

void CategoryListWidget::mouseMoveEvent(QMouseEvent* event)
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

void CategoryListWidget::mouseReleaseEvent(QMouseEvent* event)
{
    const bool wasDragging = dragging_;
    if (wasDragging && event->button() == Qt::LeftButton) {
        updateDropTarget(event->position().toPoint());
        commitDrag();
        hidePreview();
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

void CategoryListWidget::beginDrag()
{
    if (pressedItem_ == nullptr) {
        return;
    }

    dragging_ = true;
    const int sourceRow = row(pressedItem_);
    clearSelection();
    setCurrentItem(nullptr);
    draggedItem_ = takeItem(sourceRow);
    placeholderItem_ = new QListWidgetItem();
    placeholderItem_->setData(kDragPlaceholderRole, true);
    placeholderItem_->setFlags(Qt::NoItemFlags);
    placeholderItem_->setSizeHint(QSize(
        categoryCardWidth_ > 0 ? categoryCardWidth_ : 220,
        categoryCardHeight_ > 0 ? categoryCardHeight_ : 78));
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

void CategoryListWidget::showPreview(const QPoint& position)
{
    if (preview_ == nullptr) {
        auto* preview = new CategoryDragPreview(viewport());
        preview_ = preview;
        preview_->setFixedSize(
            categoryCardWidth_ > 0 ? categoryCardWidth_ : 220,
            categoryCardHeight_ > 0 ? categoryCardHeight_ : 78);
    }

    static_cast<CategoryDragPreview*>(preview_)->setCardText(
        draggedItem_->data(Qt::UserRole).toString(),
        draggedItem_->data(Qt::UserRole + 1).toString());
    movePreview(position);
    preview_->show();
    preview_->raise();
    viewport()->update();
}

void CategoryListWidget::movePreview(const QPoint& position)
{
    if (preview_ != nullptr && preview_->isVisible()) {
        preview_->move(position - QPoint(preview_->width() / 2, preview_->height() / 2));
    }
}

void CategoryListWidget::updateDropTarget(const QPoint& position)
{
    QListWidgetItem* newTarget = itemAt(position);
    if (newTarget == nullptr || newTarget == placeholderItem_) {
        return;
    }

    int newMarker = 0;
    int newInsertionIndex = dropInsertionIndex_;
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

void CategoryListWidget::movePlaceholder()
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

int CategoryListWidget::movableCategoryCount() const
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

int CategoryListWidget::movableCategoryIndex(const QListWidgetItem* targetItem) const
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

void CategoryListWidget::commitDrag()
{
    if (draggedItem_ == nullptr || placeholderItem_ == nullptr) {
        return;
    }

    const int destinationRow = row(placeholderItem_);
    takeItem(destinationRow);
    delete placeholderItem_;
    placeholderItem_ = nullptr;
    insertItem(destinationRow, draggedItem_);
    doItemsLayout();
    if (orderChanged) {
        orderChanged();
    }
}

void CategoryListWidget::hidePreview()
{
    if (preview_ != nullptr) {
        preview_->hide();
    }
}

void CategoryListWidget::cancelDrag()
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

bool CategoryListWidget::isAllCategory(const QListWidgetItem* item)
{
    return item->data(Qt::UserRole).toString() == QStringLiteral("全部");
}

bool CategoryListWidget::isOtherCategory(const QListWidgetItem* item)
{
    return item->data(Qt::UserRole).toString() == QStringLiteral("其他");
}

bool CategoryListWidget::isFixedCategory(const QListWidgetItem* item)
{
    return isAllCategory(item) || isOtherCategory(item);
}