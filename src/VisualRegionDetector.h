#pragma once

#include <QImage>
#include <QMetaType>
#include <QRect>
#include <QSize>
#include <QString>

#include <memory>

struct VisualRegion
{
    QRect bounds;
    bool detected = false;
    bool hasCrop = false;
    QImage debugOverlay;
    QString debugOverlayStatus;
};

Q_DECLARE_METATYPE(VisualRegion)

class VisualRegionDetector final
{
public:
    VisualRegionDetector();
    ~VisualRegionDetector();

    VisualRegionDetector(const VisualRegionDetector&) = delete;
    VisualRegionDetector& operator=(const VisualRegionDetector&) = delete;

    [[nodiscard]] bool warmup() const;
    [[nodiscard]] VisualRegion detect(const QImage& image, const QSize& viewportSize) const;

    [[nodiscard]] static QRect cropForViewport(
        const QSize& imageSize,
        const VisualRegion& region,
        const QSize& viewportSize);

private:
    class PythonBridge;
    mutable std::unique_ptr<PythonBridge> pythonBridge_;
};