#pragma once

#include <QColor>
#include <QListWidget>
#include <QPoint>
#include <QRect>

#include <functional>

class QMouseEvent;

class CategoryListWidget final : public QListWidget
{
    Q_OBJECT
    Q_PROPERTY(QColor categoryCardTextColor READ categoryCardTextColor WRITE setCategoryCardTextColor)
    Q_PROPERTY(QColor categoryCardSelectedTextColor READ categoryCardSelectedTextColor WRITE setCategoryCardSelectedTextColor)
    Q_PROPERTY(QColor categoryCardCountColor READ categoryCardCountColor WRITE setCategoryCardCountColor)
    Q_PROPERTY(QColor categoryCardMarkerColor READ categoryCardMarkerColor WRITE setCategoryCardMarkerColor)
    Q_PROPERTY(QColor categoryCardPreviewBackgroundColor READ categoryCardPreviewBackgroundColor WRITE setCategoryCardPreviewBackgroundColor)
    Q_PROPERTY(QColor categoryCardPreviewBorderColor READ categoryCardPreviewBorderColor WRITE setCategoryCardPreviewBorderColor)
    Q_PROPERTY(QColor categoryCardPreviewTextColor READ categoryCardPreviewTextColor WRITE setCategoryCardPreviewTextColor)
    Q_PROPERTY(QColor categoryCardPlaceholderColor READ categoryCardPlaceholderColor WRITE setCategoryCardPlaceholderColor)
    Q_PROPERTY(int categoryCardTextHorizontalMargin READ categoryCardTextHorizontalMargin WRITE setCategoryCardTextHorizontalMargin)
    Q_PROPERTY(int categoryCardTextVerticalMargin READ categoryCardTextVerticalMargin WRITE setCategoryCardTextVerticalMargin)
    Q_PROPERTY(int categoryCardCountFontSize READ categoryCardCountFontSize WRITE setCategoryCardCountFontSize)
    Q_PROPERTY(int categoryCardCornerRadius READ categoryCardCornerRadius WRITE setCategoryCardCornerRadius)
    Q_PROPERTY(int categoryCardBorderWidth READ categoryCardBorderWidth WRITE setCategoryCardBorderWidth)
    Q_PROPERTY(int categoryCardMarkerMargin READ categoryCardMarkerMargin WRITE setCategoryCardMarkerMargin)
    Q_PROPERTY(int categoryCardMarkerWidth READ categoryCardMarkerWidth WRITE setCategoryCardMarkerWidth)
    Q_PROPERTY(int categoryCardPlaceholderMargin READ categoryCardPlaceholderMargin WRITE setCategoryCardPlaceholderMargin)
    Q_PROPERTY(int categoryCardPlaceholderWidth READ categoryCardPlaceholderWidth WRITE setCategoryCardPlaceholderWidth)
    Q_PROPERTY(int categoryCardWidth READ categoryCardWidth WRITE setCategoryCardWidth)
    Q_PROPERTY(int categoryCardHeight READ categoryCardHeight WRITE setCategoryCardHeight)
    Q_PROPERTY(int categoryGridWidth READ categoryGridWidth WRITE setCategoryGridWidth)
    Q_PROPERTY(int categoryGridHeight READ categoryGridHeight WRITE setCategoryGridHeight)
    Q_PROPERTY(bool categoryCardNameBold READ categoryCardNameBold WRITE setCategoryCardNameBold)
    Q_PROPERTY(bool categoryCardCountBold READ categoryCardCountBold WRITE setCategoryCardCountBold)

public:
    explicit CategoryListWidget(QWidget* parent = nullptr);

    QColor categoryCardTextColor() const { return categoryCardTextColor_; }
    void setCategoryCardTextColor(const QColor& value) { categoryCardTextColor_ = value; }
    QColor categoryCardSelectedTextColor() const { return categoryCardSelectedTextColor_; }
    void setCategoryCardSelectedTextColor(const QColor& value) { categoryCardSelectedTextColor_ = value; }
    QColor categoryCardCountColor() const { return categoryCardCountColor_; }
    void setCategoryCardCountColor(const QColor& value) { categoryCardCountColor_ = value; }
    QColor categoryCardMarkerColor() const { return categoryCardMarkerColor_; }
    void setCategoryCardMarkerColor(const QColor& value) { categoryCardMarkerColor_ = value; }
    QColor categoryCardPreviewBackgroundColor() const { return categoryCardPreviewBackgroundColor_; }
    void setCategoryCardPreviewBackgroundColor(const QColor& value) { categoryCardPreviewBackgroundColor_ = value; }
    QColor categoryCardPreviewBorderColor() const { return categoryCardPreviewBorderColor_; }
    void setCategoryCardPreviewBorderColor(const QColor& value) { categoryCardPreviewBorderColor_ = value; }
    QColor categoryCardPreviewTextColor() const { return categoryCardPreviewTextColor_; }
    void setCategoryCardPreviewTextColor(const QColor& value) { categoryCardPreviewTextColor_ = value; }
    QColor categoryCardPlaceholderColor() const { return categoryCardPlaceholderColor_; }
    void setCategoryCardPlaceholderColor(const QColor& value) { categoryCardPlaceholderColor_ = value; }
    int categoryCardTextHorizontalMargin() const { return categoryCardTextHorizontalMargin_; }
    void setCategoryCardTextHorizontalMargin(int value) { categoryCardTextHorizontalMargin_ = value; }
    int categoryCardTextVerticalMargin() const { return categoryCardTextVerticalMargin_; }
    void setCategoryCardTextVerticalMargin(int value) { categoryCardTextVerticalMargin_ = value; }
    int categoryCardCountFontSize() const { return categoryCardCountFontSize_; }
    void setCategoryCardCountFontSize(int value) { categoryCardCountFontSize_ = value; }
    int categoryCardCornerRadius() const { return categoryCardCornerRadius_; }
    void setCategoryCardCornerRadius(int value) { categoryCardCornerRadius_ = value; }
    int categoryCardBorderWidth() const { return categoryCardBorderWidth_; }
    void setCategoryCardBorderWidth(int value) { categoryCardBorderWidth_ = value; }
    int categoryCardMarkerMargin() const { return categoryCardMarkerMargin_; }
    void setCategoryCardMarkerMargin(int value) { categoryCardMarkerMargin_ = value; }
    int categoryCardMarkerWidth() const { return categoryCardMarkerWidth_; }
    void setCategoryCardMarkerWidth(int value) { categoryCardMarkerWidth_ = value; }
    int categoryCardPlaceholderMargin() const { return categoryCardPlaceholderMargin_; }
    void setCategoryCardPlaceholderMargin(int value) { categoryCardPlaceholderMargin_ = value; }
    int categoryCardPlaceholderWidth() const { return categoryCardPlaceholderWidth_; }
    void setCategoryCardPlaceholderWidth(int value) { categoryCardPlaceholderWidth_ = value; }
    int categoryCardWidth() const { return categoryCardWidth_; }
    void setCategoryCardWidth(int value) { categoryCardWidth_ = value; }
    int categoryCardHeight() const { return categoryCardHeight_; }
    void setCategoryCardHeight(int value) { categoryCardHeight_ = value; }
    int categoryGridWidth() const { return categoryGridWidth_; }
    void setCategoryGridWidth(int value) { categoryGridWidth_ = value; }
    int categoryGridHeight() const { return categoryGridHeight_; }
    void setCategoryGridHeight(int value) { categoryGridHeight_ = value; }
    bool categoryCardNameBold() const { return categoryCardNameBold_; }
    void setCategoryCardNameBold(bool value) { categoryCardNameBold_ = value; }
    bool categoryCardCountBold() const { return categoryCardCountBold_; }
    void setCategoryCardCountBold(bool value) { categoryCardCountBold_ = value; }

    std::function<void()> orderChanged;

protected:
    void mousePressEvent(QMouseEvent* event) override;
    void mouseMoveEvent(QMouseEvent* event) override;
    void mouseReleaseEvent(QMouseEvent* event) override;

private:
    void beginDrag();
    void showPreview(const QPoint& position);
    void movePreview(const QPoint& position);
    void updateDropTarget(const QPoint& position);
    void movePlaceholder();
    [[nodiscard]] int movableCategoryCount() const;
    [[nodiscard]] int movableCategoryIndex(const QListWidgetItem* targetItem) const;
    void commitDrag();
    void hidePreview();
    void cancelDrag();

    [[nodiscard]] static bool isAllCategory(const QListWidgetItem* item);
    [[nodiscard]] static bool isOtherCategory(const QListWidgetItem* item);
    [[nodiscard]] static bool isFixedCategory(const QListWidgetItem* item);

    QListWidgetItem* pressedItem_ = nullptr;
    QListWidgetItem* draggedItem_ = nullptr;
    QListWidgetItem* placeholderItem_ = nullptr;
    QListWidgetItem* dropTargetItem_ = nullptr;
    QPoint pressPosition_;
    QWidget* preview_ = nullptr;
    int dropMarker_ = 0;
    int dropInsertionIndex_ = 0;
    bool dragging_ = false;
    QColor categoryCardTextColor_;
    QColor categoryCardSelectedTextColor_;
    QColor categoryCardCountColor_;
    QColor categoryCardMarkerColor_;
    QColor categoryCardPreviewBackgroundColor_;
    QColor categoryCardPreviewBorderColor_;
    QColor categoryCardPreviewTextColor_;
    QColor categoryCardPlaceholderColor_;
    int categoryCardTextHorizontalMargin_ = 0;
    int categoryCardTextVerticalMargin_ = 0;
    int categoryCardCountFontSize_ = 0;
    int categoryCardCornerRadius_ = 0;
    int categoryCardBorderWidth_ = 0;
    int categoryCardMarkerMargin_ = 0;
    int categoryCardMarkerWidth_ = 0;
    int categoryCardPlaceholderMargin_ = 0;
    int categoryCardPlaceholderWidth_ = 0;
    int categoryCardWidth_ = 220;
    int categoryCardHeight_ = 78;
    int categoryGridWidth_ = 236;
    int categoryGridHeight_ = 92;
    bool categoryCardNameBold_ = false;
    bool categoryCardCountBold_ = false;
};