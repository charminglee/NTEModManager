#pragma once

#include <QObject>
#include <QMutex>
#include <QStringList>

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

    void initialize();
    void debug(const QString& message);
    void info(const QString& message);
    void warning(const QString& message);
    void error(const QString& message);

    [[nodiscard]] QStringList entries() const;
    [[nodiscard]] QString logFilePath() const;

    static void qtMessageHandler(
        QtMsgType type,
        const QMessageLogContext& context,
        const QString& message);

signals:
    void entriesChanged();

private:
    Logger();

    void append(Level level, const QString& message);
    [[nodiscard]] static QString levelName(Level level);

    mutable QMutex mutex_;
    QStringList entries_;
    QString logFilePath_;
    bool initialized_ = false;
};