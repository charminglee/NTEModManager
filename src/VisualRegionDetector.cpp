#include "VisualRegionDetector.h"

#include "AppConfig.h"
#include "Logger.h"

#include <QByteArray>
#include <QColor>
#include <QDir>
#include <QElapsedTimer>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointF>
#include <QProcess>
#include <QTemporaryFile>
#include <QThread>

#include <algorithm>
#include <cmath>

namespace
{
QRect fullImageRegion(const QSize& imageSize)
{
    return QRect(QPoint(0, 0), imageSize);
}

VisualRegion fallbackDetect(const QImage& image)
{
    const QImage sample = image.convertToFormat(QImage::Format_RGB32).scaled(
        QSize(128, 128), Qt::KeepAspectRatio, Qt::SmoothTransformation);
    if (sample.isNull()) {
        return {};
    }

    double totalWeight = 0.0;
    QPointF weightedCenter;
    double minimumWeight = 0.0;
    double maximumWeight = 0.0;

    for (int y = 1; y < sample.height() - 1; ++y) {
        for (int x = 1; x < sample.width() - 1; ++x) {
            const QColor current(sample.pixel(x, y));
            const QColor left(sample.pixel(x - 1, y));
            const QColor right(sample.pixel(x + 1, y));
            const QColor top(sample.pixel(x, y - 1));
            const QColor bottom(sample.pixel(x, y + 1));

            const double luminance =
                0.2126 * current.red() + 0.7152 * current.green() + 0.0722 * current.blue();
            const double neighbourAverage = (
                0.2126 * (left.red() + right.red() + top.red() + bottom.red())
                + 0.7152 * (left.green() + right.green() + top.green() + bottom.green())
                + 0.0722 * (left.blue() + right.blue() + top.blue() + bottom.blue())) / 4.0;
            const double contrast = std::abs(luminance - neighbourAverage);
            const double saturation = current.hsvSaturation() / 255.0;
            const double weight = contrast + saturation * 24.0;

            minimumWeight = std::min(minimumWeight, weight);
            maximumWeight = std::max(maximumWeight, weight);
            totalWeight += weight;
            weightedCenter += QPointF(x * weight, y * weight);
        }
    }

    if (totalWeight <= 0.0 || maximumWeight - minimumWeight < 2.0) {
        return {fullImageRegion(image.size()), false};
    }

    const QPointF center = weightedCenter / totalWeight;
    const int regionWidth = std::max(1, static_cast<int>(sample.width() * 0.58));
    const int regionHeight = std::max(1, static_cast<int>(sample.height() * 0.58));
    QRect region(
        static_cast<int>(center.x() - regionWidth / 2.0),
        static_cast<int>(center.y() - regionHeight / 2.0),
        regionWidth,
        regionHeight);
    region = region.intersected(sample.rect());

    const qreal scaleX = static_cast<qreal>(image.width()) / sample.width();
    const qreal scaleY = static_cast<qreal>(image.height()) / sample.height();
    return {
        QRect(
            static_cast<int>(region.left() * scaleX),
            static_cast<int>(region.top() * scaleY),
            std::max(1, static_cast<int>(region.width() * scaleX)),
            std::max(1, static_cast<int>(region.height() * scaleY))),
        true};
}
}

class VisualRegionDetector::PythonBridge final
{
public:
    PythonBridge()
    {
        process_.setProcessChannelMode(QProcess::SeparateChannels);
        QObject::connect(&process_, &QProcess::readyReadStandardError, &process_, [this] {
            drainStandardError();
        });
        QObject::connect(&process_, &QProcess::errorOccurred, &process_, [this](QProcess::ProcessError error) {
            processErrorLogged_ = true;
            Log::error(QStringLiteral("Python 视觉识别进程错误（%1）：%2")
                                          .arg(static_cast<int>(error))
                                          .arg(process_.errorString()));
        });
        Log::info(QStringLiteral("启动 Python 视觉识别进程：%1").arg(AppConfig::pythonExecutable()));
        process_.start(
            AppConfig::pythonExecutable(),
            {
                AppConfig::visualRegionScript(),
                QStringLiteral("--server"),
                QStringLiteral("--device"),
                QStringLiteral("auto"),
                QStringLiteral("--cache-dir"),
                AppConfig::pythonModelCache(),
                QStringLiteral("--orientation-model"),
                AppConfig::orientationModel(),
            }
        );
        if (!process_.waitForStarted(5000)) {
            if (!processErrorLogged_) {
                Log::error(QStringLiteral("无法启动 Python 视觉识别进程：%1").arg(process_.errorString()));
            }
            return;
        }

        const QByteArray readyResponse = readLine(120000);
        if (readyResponse.isEmpty()) {
            Log::error(QStringLiteral("Python 视觉识别进程未返回 ready 响应"));
            stopProcess();
            return;
        }

        const QJsonDocument document = QJsonDocument::fromJson(readyResponse);
        ready_ = document.isObject() && document.object().value(QStringLiteral("ready")).toBool();
        if (ready_) {
            Log::info(QStringLiteral("Python 视觉识别进程已就绪"));
        } else {
            Log::error(QStringLiteral("Python 视觉识别进程初始化失败：%1")
                                          .arg(QString::fromUtf8(readyResponse).left(500)));
            stopProcess();
        }
    }

    ~PythonBridge()
    {
        drainStandardError(true);
        if (process_.state() != QProcess::Running) {
            return;
        }

        if (QThread::currentThread()->isInterruptionRequested()) {
            process_.kill();
            process_.waitForFinished(1000);
            return;
        }

        process_.write("__quit__\n");
        process_.waitForBytesWritten(1000);
        if (!process_.waitForFinished(3000)) {
            process_.kill();
            process_.waitForFinished(1000);
        }
        drainStandardError(true);
    }

    [[nodiscard]] bool isReady() const
    {
        return ready_ && process_.state() == QProcess::Running;
    }

    [[nodiscard]] VisualRegion detect(const QImage& image, const QSize& viewportSize)
    {
        if (!isReady()) {
            return {};
        }

        QTemporaryFile temporaryFile(
            QDir(QDir::tempPath()).filePath(QStringLiteral("NteModManager-XXXXXX.jpg")));
        temporaryFile.setAutoRemove(true);
        if (!temporaryFile.open() || !image.save(&temporaryFile, "JPG", 92)) {
            Log::error(QStringLiteral("无法创建视觉识别临时图像"));
            return {};
        }
        const QString imagePath = temporaryFile.fileName();
        temporaryFile.close();

        QJsonArray viewportSizeJson;
        viewportSizeJson.append(viewportSize.width());
        viewportSizeJson.append(viewportSize.height());
        const QJsonObject request{
            {QStringLiteral("image"), imagePath},
            {QStringLiteral("viewport_size"), viewportSizeJson},
        };
        const QByteArray requestLine = QJsonDocument(request).toJson(QJsonDocument::Compact) + '\n';
        if (process_.write(requestLine) < 0 || !process_.waitForBytesWritten(5000)) {
            ready_ = false;
            Log::error(QStringLiteral("无法向 Python 视觉识别进程发送图像路径：%1")
                                          .arg(process_.errorString()));
            return {};
        }

        const QByteArray response = readLine(120000);
        if (response.isEmpty()) {
            ready_ = false;
            Log::error(QStringLiteral("Python 视觉识别进程未返回检测结果"));
            return {};
        }

        const QJsonDocument document = QJsonDocument::fromJson(response);
        if (!document.isObject()) {
            Log::error(QStringLiteral("Python 视觉识别进程返回了无效 JSON：%1")
                                          .arg(QString::fromUtf8(response).left(500)));
            return {};
        }

        const QJsonObject result = document.object();
        if (result.contains(QStringLiteral("error"))) {
            Log::error(QStringLiteral("Python 视觉识别失败：%1")
                                          .arg(result.value(QStringLiteral("error")).toString()));
            return {};
        }

        VisualRegion region;
        region.detected = result.value(QStringLiteral("detected")).toBool();
        const QString encodedOverlay = result.value(QStringLiteral("debug_overlay")).toString();
        const QByteArray overlayData = QByteArray::fromBase64(
            encodedOverlay.toLatin1()
        );
        const QJsonArray overlaySize = result.value(QStringLiteral("debug_overlay_size")).toArray();
        if (encodedOverlay.isEmpty()) {
            region.debugOverlayStatus = QStringLiteral("Python 未返回调试线框");
        } else if (overlaySize.size() != 2) {
            region.debugOverlayStatus = QStringLiteral("调试线框尺寸缺失");
        } else if (overlayData.isEmpty()) {
            region.debugOverlayStatus = QStringLiteral("调试线框 Base64 解码失败");
        } else {
            const int width = overlaySize.at(0).toInt();
            const int height = overlaySize.at(1).toInt();
            if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
                region.debugOverlayStatus = QStringLiteral("调试线框尺寸无效");
            } else {
                const QImage overlayImg = QImage::fromData(overlayData, "PNG");
                if (overlayImg.isNull()) {
                    region.debugOverlayStatus = QStringLiteral("调试线框 PNG 解码失败");
                } else if (overlayImg.size() != QSize(width, height)) {
                    region.debugOverlayStatus = QStringLiteral("调试线框图像尺寸不匹配");
                } else {
                    region.debugOverlay = overlayImg.convertToFormat(QImage::Format_RGBA8888);
                    region.debugOverlayStatus = QStringLiteral("调试线框已解码");
                }
            }
        }

        QJsonObject bounds = result.value(QStringLiteral("background_crop")).toObject();
        if (bounds.isEmpty()) {
            bounds = result.value(QStringLiteral("bounds")).toObject();
        }
        if (bounds.isEmpty()) {
            return region;
        }

        const QRect imageRect(QPoint(0, 0), image.size());
        const QRect detectedBounds(
            bounds.value(QStringLiteral("x")).toInt(),
            bounds.value(QStringLiteral("y")).toInt(),
            bounds.value(QStringLiteral("width")).toInt(),
            bounds.value(QStringLiteral("height")).toInt()
        );
        const QRect crop = detectedBounds.intersected(imageRect);
        if (crop.isEmpty()) {
            return region;
        }
        region.bounds = crop;
        region.hasCrop = true;
        return region;
    }

private:
    void stopProcess()
    {
        if (process_.state() != QProcess::NotRunning) {
            process_.kill();
            process_.waitForFinished(1000);
        }
        drainStandardError(true);
    }

    void drainStandardError(bool flush = false)
    {
        pendingErrorOutput_ += process_.readAllStandardError();
        while (true) {
            const qsizetype lineEnd = pendingErrorOutput_.indexOf('\n');
            if (lineEnd < 0) {
                break;
            }
            const QByteArray line = pendingErrorOutput_.left(lineEnd);
            pendingErrorOutput_.remove(0, lineEnd + 1);
            logStandardErrorLine(line);
        }
        if (flush && !pendingErrorOutput_.trimmed().isEmpty()) {
            logStandardErrorLine(pendingErrorOutput_);
            pendingErrorOutput_.clear();
        }
    }

    static void logStandardErrorLine(const QByteArray& line)
    {
        const QString message = QString::fromUtf8(line).trimmed();
        if (!message.isEmpty()) {
            Log::warning(QStringLiteral("Python stderr：%1").arg(message));
        }
    }

    [[nodiscard]] QByteArray readLine(int timeoutMilliseconds)
    {
        QElapsedTimer timer;
        timer.start();
        while (timer.elapsed() < timeoutMilliseconds) {
            drainStandardError();
            if (QThread::currentThread()->isInterruptionRequested()) {
                return {};
            }
            if (process_.canReadLine()) {
                return process_.readLine().trimmed();
            }
            process_.waitForReadyRead(1000);
            drainStandardError();
            if (process_.state() != QProcess::Running && !process_.canReadLine()) {
                break;
            }
        }
        return {};
    }

    QProcess process_;
    QByteArray pendingErrorOutput_;
    bool processErrorLogged_ = false;
    bool ready_ = false;
};

VisualRegionDetector::VisualRegionDetector() = default;

VisualRegionDetector::~VisualRegionDetector() = default;

bool VisualRegionDetector::warmup() const
{
    if (!pythonBridge_) {
        pythonBridge_ = std::make_unique<PythonBridge>();
    }
    return pythonBridge_->isReady();
}

VisualRegion VisualRegionDetector::detect(const QImage& image, const QSize& viewportSize) const
{
    if (image.isNull() || image.size().isEmpty()) {
        return {};
    }

    if (!pythonBridge_) {
        pythonBridge_ = std::make_unique<PythonBridge>();
    }
    const VisualRegion pythonRegion = pythonBridge_->detect(image, viewportSize);
    if ((pythonRegion.hasCrop && !pythonRegion.bounds.isEmpty())
        || !pythonRegion.debugOverlay.isNull()) {
        return pythonRegion;
    }

    return fallbackDetect(image);
}

QRect VisualRegionDetector::cropForViewport(
    const QSize& imageSize,
    const VisualRegion& region,
    const QSize& viewportSize)
{
    if (imageSize.isEmpty() || viewportSize.isEmpty()) {
        return {};
    }

    const QRect imageRect(QPoint(0, 0), imageSize);
    if (region.hasCrop && !region.bounds.isEmpty()) {
        return region.bounds.intersected(imageRect);
    }

    const qreal viewportRatio = static_cast<qreal>(viewportSize.width()) / viewportSize.height();
    int cropWidth = imageSize.width();
    int cropHeight = imageSize.height();
    if (static_cast<qreal>(imageSize.width()) / imageSize.height() > viewportRatio) {
        cropWidth = std::max(1, static_cast<int>(std::round(imageSize.height() * viewportRatio)));
    } else {
        cropHeight = std::max(1, static_cast<int>(std::round(imageSize.width() / viewportRatio)));
    }

    const QPoint focus = region.detected && !region.bounds.isEmpty()
        ? region.bounds.center()
        : imageRect.center();
    const int left = std::clamp(focus.x() - cropWidth / 2, 0, imageSize.width() - cropWidth);
    const int top = std::clamp(focus.y() - cropHeight / 2, 0, imageSize.height() - cropHeight);
    return QRect(left, top, cropWidth, cropHeight);
}