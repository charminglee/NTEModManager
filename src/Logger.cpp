#include "Logger.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QStandardPaths>

#include <QMutexLocker>

namespace
{
constexpr qsizetype kMaximumInMemoryEntries = 2000;
}

Logger& Logger::instance()
{
    static Logger logger;
    return logger;
}

Logger::Logger() = default;

void Logger::initialize()
{
    QMutexLocker locker(&mutex_);
    if (initialized_) {
        return;
    }

    QString dataDirectory = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    if (dataDirectory.isEmpty()) {
        dataDirectory = QCoreApplication::applicationDirPath();
    }
    QDir().mkpath(dataDirectory);
    logFilePath_ = QDir(dataDirectory).filePath(QStringLiteral("NteModManager.log"));
    initialized_ = true;
}

void Logger::debug(const QString& message)
{
    append(Level::Debug, message);
}

void Logger::info(const QString& message)
{
    append(Level::Info, message);
}

void Logger::warning(const QString& message)
{
    append(Level::Warning, message);
}

void Logger::error(const QString& message)
{
    append(Level::Error, message);
}

QStringList Logger::entries() const
{
    QMutexLocker locker(&mutex_);
    return entries_;
}

QString Logger::logFilePath() const
{
    QMutexLocker locker(&mutex_);
    return logFilePath_;
}

void Logger::qtMessageHandler(
    QtMsgType type,
    const QMessageLogContext& context,
    const QString& message
) {
    thread_local bool handlingMessage = false;
    if (handlingMessage) {
        return;
    }
    handlingMessage = true;

    Logger& logger = instance();
    const QString category = context.category == nullptr
        ? QStringLiteral("Qt")
        : QString::fromLatin1(context.category);
    const QString formattedMessage = QStringLiteral("[%1] %2").arg(category, message);

    switch (type) {
    case QtDebugMsg:
        logger.debug(formattedMessage);
        break;
    case QtInfoMsg:
        logger.info(formattedMessage);
        break;
    case QtWarningMsg:
        logger.warning(formattedMessage);
        break;
    case QtCriticalMsg:
    case QtFatalMsg:
        logger.error(formattedMessage);
        break;
    }

    handlingMessage = false;
}

void Logger::append(Level level, const QString& message)
{
    initialize();

    const QString entry = QStringLiteral("[%1] [%2] %3")
        .arg(QDateTime::currentDateTime().toString(QStringLiteral("yyyy-MM-dd HH:mm:ss.zzz")))
        .arg(levelName(level), message);

    {
        QMutexLocker locker(&mutex_);
        entries_.append(entry);
        while (entries_.size() > kMaximumInMemoryEntries) {
            entries_.removeFirst();
        }

        QFile logFile(logFilePath_);
        if (logFile.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
            logFile.write(entry.toUtf8());
            logFile.putChar('\n');
        }
    }

    emit entriesChanged();
}

QString Logger::levelName(Level level)
{
    switch (level) {
    case Level::Debug:
        return QStringLiteral("DEBUG");
    case Level::Info:
        return QStringLiteral("INFO");
    case Level::Warning:
        return QStringLiteral("WARN");
    case Level::Error:
        return QStringLiteral("ERROR");
    }
    return QStringLiteral("INFO");
}