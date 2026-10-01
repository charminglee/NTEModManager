#include "BackgroundImageCatalog.h"

#include "AppConfig.h"

#include <QDir>
#include <QFileInfo>

namespace
{
bool isSupportedBackgroundImage(const QString& fileName)
{
    const QString suffix = QFileInfo(fileName).suffix().toLower();
    return suffix == QStringLiteral("jpg")
        || suffix == QStringLiteral("jpeg")
        || suffix == QStringLiteral("png");
}
}

QStringList BackgroundImageCatalog::collect()
{
    if (AppConfig::testImagesEnabled()) {
        const QDir testPicturesRoot(QStringLiteral("F:/pictures/test"));
        QStringList imagePaths;
        for (const QString& fileName : testPicturesRoot.entryList(QDir::Files, QDir::Name)) {
            if (isSupportedBackgroundImage(fileName)) {
                imagePaths.append(testPicturesRoot.absoluteFilePath(fileName));
            }
        }
        return imagePaths;
    }

    const QDir picturesRoot(AppConfig::backgroundImagesDirectory());
    QStringList imagePaths;

    const QFileInfoList directories = picturesRoot.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
    for (const QFileInfo& directory : directories) {
        bool isNumericDirectory = false;
        directory.fileName().toULongLong(&isNumericDirectory);
        if (!isNumericDirectory) {
            continue;
        }

        const QDir folder(directory.absoluteFilePath());
        for (const QString& fileName : folder.entryList(QDir::Files, QDir::Name)) {
            if (isSupportedBackgroundImage(fileName)) {
                imagePaths.append(folder.absoluteFilePath(fileName));
            }
        }
    }

    return imagePaths;
}