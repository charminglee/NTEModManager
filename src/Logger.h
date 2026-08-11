#pragma once

#include <QObject>
#include <QMutex>
#include <QStringList>
#include <QtGlobal>

namespace Log
{
void initialize();
void debug(const QString& message);
void info(const QString& message);
void warning(const QString& message);
void error(const QString& message);
QStringList entries();
QString logFilePath();
QtMessageHandler getQtMessageHandler();
}

class Logger final : public QObject
{
    Q_OBJECT

public:
    enum class Level
    {
        Debug,
        Info,
        Warning,
        Error,
    };

    static Logger& instance();
    static void qtMessageHandler(QtMsgType type, const QMessageLogContext& context, const QString& message);

    void initialize();
    void debug(const QString& message);
    void info(const QString& message);
    void warning(const QString& message);
    void error(const QString& message);
    [[nodiscard]] QStringList entries() const;
    [[nodiscard]] QString logFilePath() const;

signals:
    void entriesChanged();

private:
    Logger();

    [[nodiscard]] static QString levelName(Level level);

    void append(Level level, const QString& message);

    mutable QMutex mutex_;
    QStringList entries_;
    QString logFilePath_;
    bool initialized_ = false;
};