#include "BackgroundImageCatalog.h"

#include "Logger.h"
#include "VisualRegionDetector.h"

#include <QBuffer>
#include <QCommandLineOption>
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QHostAddress>
#include <QImage>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRandomGenerator>
#include <QTcpServer>
#include <QTcpSocket>
#include <QUrl>
#include <QUrlQuery>

#include <windows.h>

#include <utility>

namespace
{
constexpr wchar_t kSingleInstanceMutexName[] = L"Local\\NteBackgroundImageServer.SingleInstance";
constexpr quint16 kDefaultPort = 48126;
constexpr qint64 kMaximumRequestBytes = 8192;
constexpr int kMaximumImageDimension = 16384;
constexpr qint64 kMaximumImagePixels = 64LL * 1024 * 1024;
constexpr auto kRequestBufferProperty = "nteRequestBuffer";
constexpr auto kRequestHandledProperty = "nteRequestHandled";

class BackgroundImageServer final : public QObject
{
public:
    explicit BackgroundImageServer(QStringList imagePaths)
        : imagePaths_(std::move(imagePaths))
    {
        connect(&server_, &QTcpServer::newConnection, this, [this] {
            acceptConnections();
        });
    }

    [[nodiscard]] bool warmup()
    {
        return detector_.warmup();
    }

    [[nodiscard]] bool listen(quint16 port)
    {
        return server_.listen(QHostAddress::LocalHost, port);
    }

    [[nodiscard]] QString errorString() const
    {
        return server_.errorString();
    }

private:
    void acceptConnections()
    {
        while (server_.hasPendingConnections()) {
            QTcpSocket* socket = server_.nextPendingConnection();
            if (socket == nullptr) {
                continue;
            }

            connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
                readRequest(socket);
            });
            connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
        }
    }

    void readRequest(QTcpSocket* socket)
    {
        if (socket->property(kRequestHandledProperty).toBool()) {
            return;
        }

        QByteArray request = socket->property(kRequestBufferProperty).toByteArray();
        request += socket->read(kMaximumRequestBytes + 1);
        const qsizetype headerEnd = request.indexOf("\r\n\r\n");
        if ((headerEnd < 0 && request.size() > kMaximumRequestBytes)
            || headerEnd > kMaximumRequestBytes) {
            sendError(socket, 431, QByteArrayLiteral("Request Header Fields Too Large"),
                QStringLiteral("request headers are too large"));
            return;
        }
        if (headerEnd < 0) {
            socket->setProperty(kRequestBufferProperty, request);
            return;
        }

        const qsizetype lineEnd = request.indexOf("\r\n");
        const QList<QByteArray> requestParts = request.left(lineEnd).simplified().split(' ');
        if (requestParts.size() != 3
            || (requestParts.at(2) != "HTTP/1.0" && requestParts.at(2) != "HTTP/1.1")) {
            sendError(socket, 400, QByteArrayLiteral("Bad Request"),
                QStringLiteral("invalid HTTP request line"));
            return;
        }
        if (requestParts.at(0) != "GET") {
            sendError(socket, 405, QByteArrayLiteral("Method Not Allowed"),
                QStringLiteral("only GET is supported"), QByteArrayLiteral("Allow: GET\r\n"));
            return;
        }

        const QUrl target = QUrl::fromEncoded(requestParts.at(1));
        if (!target.isValid() || !target.scheme().isEmpty() || !target.host().isEmpty()) {
            sendError(socket, 400, QByteArrayLiteral("Bad Request"),
                QStringLiteral("invalid request target"));
            return;
        }
        if (target.path() != QStringLiteral("/background")) {
            sendError(socket, 404, QByteArrayLiteral("Not Found"),
                QStringLiteral("endpoint not found"));
            return;
        }

        QUrlQuery query(target);
        bool widthOk = false;
        bool heightOk = false;
        const int width = query.queryItemValue(QStringLiteral("width")).toInt(&widthOk);
        const int height = query.queryItemValue(QStringLiteral("height")).toInt(&heightOk);
        const qint64 pixelCount = static_cast<qint64>(width) * height;
        if (!widthOk || !heightOk
            || width <= 0 || height <= 0
            || width > kMaximumImageDimension || height > kMaximumImageDimension
            || pixelCount > kMaximumImagePixels) {
            sendError(socket, 400, QByteArrayLiteral("Bad Request"),
                QStringLiteral("width and height must be positive and within image limits"));
            return;
        }

        const QSize viewportSize(width, height);
        const QImage image = createBackgroundImage(viewportSize);
        if (image.isNull()) {
            sendError(socket, 503, QByteArrayLiteral("Service Unavailable"),
                QStringLiteral("no readable background images are available"));
            return;
        }

        QByteArray pngData;
        QBuffer imageBuffer(&pngData);
        if (!imageBuffer.open(QIODevice::WriteOnly) || !image.save(&imageBuffer, "PNG")) {
            sendError(socket, 500, QByteArrayLiteral("Internal Server Error"),
                QStringLiteral("failed to encode the background image"));
            return;
        }
        sendResponse(socket, 200, QByteArrayLiteral("OK"), QByteArrayLiteral("image/png"), pngData);
    }

    [[nodiscard]] QImage createBackgroundImage(const QSize& viewportSize)
    {
        if (imagePaths_.isEmpty()) {
            return {};
        }

        const int imageCount = static_cast<int>(imagePaths_.size());
        const int startIndex = QRandomGenerator::global()->bounded(imageCount);
        QImage sourceImage;
        for (int offset = 0; offset < imageCount; ++offset) {
            const int index = (startIndex + offset) % imageCount;
            const QString& path = imagePaths_.at(index);
            sourceImage.load(path);
            if (!sourceImage.isNull()) {
                Log::debug(QStringLiteral("为背景服务请求选择图片：%1").arg(path));
                break;
            }
            Log::warning(QStringLiteral("无法读取背景图片：%1").arg(path));
        }
        if (sourceImage.isNull()) {
            return {};
        }

        const VisualRegion region = detector_.detect(sourceImage, viewportSize);
        const QRect crop = VisualRegionDetector::cropForViewport(
            sourceImage.size(),
            region,
            viewportSize);
        if (crop.isEmpty()) {
            return {};
        }

        return sourceImage.copy(crop).scaled(
            viewportSize,
            Qt::IgnoreAspectRatio,
            Qt::SmoothTransformation);
    }

    static void sendError(
        QTcpSocket* socket,
        int statusCode,
        const QByteArray& reason,
        const QString& message,
        const QByteArray& extraHeaders = {})
    {
        const QByteArray body = QJsonDocument(QJsonObject{
            {QStringLiteral("error"), message}
        }).toJson(QJsonDocument::Compact);
        sendResponse(socket, statusCode, reason, QByteArrayLiteral("application/json; charset=utf-8"),
            body, extraHeaders);
    }

    static void sendResponse(
        QTcpSocket* socket,
        int statusCode,
        const QByteArray& reason,
        const QByteArray& contentType,
        const QByteArray& body,
        const QByteArray& extraHeaders = {})
    {
        socket->setProperty(kRequestHandledProperty, true);
        QByteArray response;
        response.reserve(body.size() + 256);
        response.append("HTTP/1.1 ")
            .append(QByteArray::number(statusCode))
            .append(' ')
            .append(reason)
            .append("\r\nContent-Type: ")
            .append(contentType)
            .append("\r\nContent-Length: ")
            .append(QByteArray::number(body.size()))
            .append("\r\nConnection: close\r\nCache-Control: no-store\r\n")
            .append(extraHeaders)
            .append("\r\n")
            .append(body);
        socket->write(response);
        socket->disconnectFromHost();
    }

    QStringList imagePaths_;
    QTcpServer server_;
    VisualRegionDetector detector_;
};
}

int main(int argc, char* argv[])
{
    QCoreApplication application(argc, argv);
    application.setApplicationName(QStringLiteral("NteBackgroundImageServer"));
    Log::initialize();
    qInstallMessageHandler(Log::getQtMessageHandler());

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("Local AI background image service"));
    parser.addHelpOption();
    const QCommandLineOption portOption(
        {QStringLiteral("p"), QStringLiteral("port")},
        QStringLiteral("HTTP port on 127.0.0.1"),
        QStringLiteral("port"),
        QString::number(kDefaultPort));
    parser.addOption(portOption);
    parser.process(application);

    bool portOk = false;
    const uint portValue = parser.value(portOption).toUInt(&portOk);
    if (!portOk || portValue == 0 || portValue > 65535) {
        Log::error(QStringLiteral("无效的服务端口：%1").arg(parser.value(portOption)));
        return 2;
    }

    HANDLE singleInstanceMutex = CreateMutexW(nullptr, FALSE, kSingleInstanceMutexName);
    const DWORD mutexError = GetLastError();
    if (singleInstanceMutex == nullptr) {
        Log::error(QStringLiteral("无法创建背景图片服务单例互斥体，错误码：%1").arg(mutexError));
        return 1;
    }
    if (mutexError == ERROR_ALREADY_EXISTS) {
        Log::info(QStringLiteral("背景图片服务已有实例运行，退出重复实例"));
        CloseHandle(singleInstanceMutex);
        return 0;
    }

    const QStringList imagePaths = BackgroundImageCatalog::collect();
    Log::info(QStringLiteral("背景图片服务启动，已加载图片路径数：%1，日志文件：%2")
        .arg(imagePaths.size())
        .arg(Log::logFilePath()));
    if (imagePaths.isEmpty()) {
        Log::warning(QStringLiteral("没有可用背景图片；服务仍会启动并对图片请求返回 503"));
    }

    BackgroundImageServer server(imagePaths);
    if (!server.warmup()) {
        Log::warning(QStringLiteral("视觉识别模型预热失败；请求将使用现有 fallback 检测逻辑"));
    }
    if (!server.listen(static_cast<quint16>(portValue))) {
        Log::error(QStringLiteral("无法监听 127.0.0.1:%1：%2")
            .arg(portValue)
            .arg(server.errorString()));
        CloseHandle(singleInstanceMutex);
        return 1;
    }

    Log::info(QStringLiteral("背景图片服务已就绪：127.0.0.1:%1/background").arg(portValue));
    const int exitCode = application.exec();
    CloseHandle(singleInstanceMutex);
    return exitCode;
}