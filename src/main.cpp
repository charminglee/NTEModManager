#include <QApplication>
#include <QDir>
#include <QFileInfo>
#include <QFont>
#include <QRandomGenerator>
#include <QStyleHints>

#include <windows.h>

#include "AppConfig.h"
#include "MainWindow.h"

namespace
{
constexpr wchar_t kSingleInstanceMutexName[] = L"Local\\NteModManager.SingleInstance";
constexpr wchar_t kMainWindowTitle[] = L"NTE \u6a21\u7ec4\u7ba1\u7406\u5668";

void activateExistingWindow()
{
    for (int attempt = 0; attempt < 40; ++attempt) {
        const HWND window = FindWindowW(nullptr, kMainWindowTitle);
        if (window != nullptr) {
            ShowWindow(window, IsIconic(window) ? SW_RESTORE : SW_SHOW);
            BringWindowToTop(window);
            SetForegroundWindow(window);
            return;
        }
        Sleep(50);
    }
}

bool isSupportedBackgroundImage(const QString& fileName)
{
    const QString suffix = QFileInfo(fileName).suffix().toLower();
    return suffix == QStringLiteral("jpg")
        || suffix == QStringLiteral("jpeg")
        || suffix == QStringLiteral("png");
}

QString selectStartupBackground()
{
    const QDir picturesRoot(AppConfig::backgroundImagesDirectory());
    QList<QPair<QString, QStringList>> foldersWithImages;

    const QFileInfoList directories = picturesRoot.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
    for (const QFileInfo& directory : directories) {
        bool isNumericDirectory = false;
        directory.fileName().toULongLong(&isNumericDirectory);
        if (!isNumericDirectory) {
            continue;
        }

        const QDir folder(directory.absoluteFilePath());
        QStringList imageFiles;
        for (const QString& fileName : folder.entryList(QDir::Files, QDir::Name)) {
            if (isSupportedBackgroundImage(fileName)) {
                imageFiles.append(fileName);
            }
        }
        if (!imageFiles.isEmpty()) {
            foldersWithImages.append({folder.absolutePath(), imageFiles});
        }
    }

    if (foldersWithImages.isEmpty()) {
        return {};
    }

    const auto& folder = foldersWithImages.at(QRandomGenerator::global()->bounded(foldersWithImages.size()));
    return QDir(folder.first).filePath(folder.second.at(QRandomGenerator::global()->bounded(folder.second.size())));
}

QString materialStyleSheet(Qt::ColorScheme colorScheme)
{
    //if (colorScheme == Qt::ColorScheme::Dark) {
    //    return QStringLiteral(R"(
    //        QMainWindow, #root { background: #08111d; color: #f4f8ff; }
    //        #glassPanel { background: transparent; border: none; }
    //        #title { color: #ffffff; font-size: 26px; font-weight: 700; }
    //        #subtitle, #metadata, #dropHint, #count, #activity { color: #c5d4e6; }
    //        #modListActionButton {
    //            background: rgba(91, 154, 211, 95); border: 1px solid rgba(219, 239, 255, 110); border-radius: 18px;
    //            color: #f5faff; min-height: 32px; padding: 3px 16px;
    //        }
    //        #modListActionButton:hover { background: rgba(81, 154, 217, 220); }
    //        #modListActionButton:pressed { background: #9bd3ff; color: #09213a; }
    //        #dropZone { background: rgba(29, 61, 94, 130); border: 1px dashed #9acbff; border-radius: 16px; }
    //        #dropTitle, #sectionTitle, #modName { color: #ffffff; font-weight: 600; }
    //        #sectionTitle { font-size: 16px; }
    //        #modScrollArea, #modScrollArea::viewport, #listContainer { background: transparent; }
    //        QScrollBar:vertical { background: transparent; width: 12px; margin: 4px 2px; }
    //        QScrollBar::handle:vertical { background: #4779a6; min-height: 32px; border-radius: 5px; }
    //        QScrollBar::handle:vertical:hover { background: #90caf9; }
    //        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }
    //        QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
    //        #modRow { background: rgba(21, 46, 72, 145); border: 1px solid rgba(187, 220, 255, 42); border-radius: 16px; }
    //        #modRow:hover { background: rgba(38, 78, 118, 215); }
    //        #stateInstalled, #stateUninstalled { border-radius: 12px; font-size: 12px; padding: 4px 8px; }
    //        #stateInstalled { background: #00533e; color: #b5f2d4; }
    //        #stateUninstalled { background: #294563; color: #c5d7e8; }
    //        QToolButton { background: rgba(91, 154, 211, 70); border: 1px solid rgba(219, 239, 255, 100); border-radius: 18px; color: #f4f8ff; padding: 6px 9px; }
    //        QToolButton:hover:enabled { background: rgba(116, 184, 240, 155); }
    //        #moreButton { font-size: 18px; font-weight: 600; padding: 0px; }
    //        #moreButton::menu-indicator { image: none; width: 0px; }
    //        QToolButton:disabled, #modListActionButton:disabled { color: #777777; }
    //        #deleteButton { color: #ffb4ab; }
    //        #deleteButton:hover { background: #601410; }
    //        #emptyState { color: #b9c7d8; padding: 56px; }
    //        QMenu { background: #142a43; color: #f4f8ff; border: 1px solid #3f6f9d; border-radius: 8px; padding: 6px; }
    //        QMenu::item { border-radius: 18px; padding: 8px 26px 8px 12px; }
    //        QMenu::item:selected { background: #294f75; }
    //    )");
    //}

    return QStringLiteral(R"(
        QMainWindow, #root { background: #f8fbff; color: #102a43; }
        #glassPanel { background: transparent; border: none; }
        #title { color: #ffffff; font-size: 35px; font-weight: 700; }
        #subtitle { color: #ffffff; font-size: 20px; }
        #activity { color: #ffffff; }

        #dropZone { background: rgba(226, 242, 255, 145); border: 1px dashed #4f91c9; border-radius: 16px; }
        #dropTitle { color: #000000; font-weight: 600; font-size: 18px; }
        #dropHint { color: #606060; font-size: 14px; }

        #sectionTitle { color: #ffffff; font-weight: 600; font-size: 20px; }
        #count { color: #ffffff; font-size: 14px; }

        #modName { color: #000000; font-weight: 600; font-size: 18px; }
        #metadata { color: #606060; font-size: 14px; }

        #categoryList { background: transparent; }
        #categoryList::item {
            background: rgba(255, 255, 255, 155); border: 1px solid rgba(255, 255, 255, 145);
            border-radius: 14px; color: #102a43; padding: 0px;
        }
        #categoryList::item:hover { background: rgba(240, 247, 255, 225); }
        #categoryList::item:selected { background: #d9ecff; border: 1px solid #8bc0e8; color: #003b6f; }
        #categoryCard { background: transparent; }
        #categoryName { color: #102a43; font-size: 17px; font-weight: 600; }
        #categoryCount { color: #60758a; font-size: 13px; }

        #modListActionButton {
            background: rgba(236, 247, 255, 95); border: 1px solid rgba(255, 255, 255, 175); border-radius: 18px;
            color: #003b6f; min-height: 32px; padding: 3px 16px;
        }
        #modListActionButton:hover { background: #bdddff; }
        #modListActionButton:pressed { background: #0067b1; color: #ffffff; }
        #modRow { background: rgba(255, 255, 255, 155); border: 1px solid rgba(255, 255, 255, 145); border-radius: 16px; }
        #modRow:hover { background: rgba(240, 247, 255, 225); }

        #stateInstalled, #stateUninstalled { border-radius: 12px; font-size: 12px; padding: 4px 8px; }
        #stateInstalled { background: #b5f2d4; color: #00533e; }
        #stateUninstalled { background: #e5eef7; color: #52677d; }

        #deleteButton { color: #c42b1c; }
        #deleteButton:hover { background: #ffdad6; }

        #moreButton { font-size: 18px; font-weight: 600; padding: 0px; }
        #moreButton::menu-indicator { image: none; width: 0px; }

        #modScrollArea, #modScrollArea::viewport, #listContainer { background: transparent; }
        QScrollBar:vertical { background: transparent; width: 12px; margin: 4px 2px; }
        QScrollBar::handle:vertical { background: #9bbbd8; min-height: 32px; border-radius: 5px; }
        QScrollBar::handle:vertical:hover { background: #0067b1; }
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }
        QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
        QToolButton { background: rgba(236, 247, 255, 80); border: 1px solid rgba(255, 255, 255, 165); border-radius: 18px; color: #31506d; padding: 6px 9px; }
        QToolButton:hover:enabled { background: rgba(214, 238, 255, 185); }
        QToolButton:disabled, #modListActionButton:disabled { color: #a6a6a6; }
        #emptyState { color: #6b8197; padding: 56px; }
        QMenu { background: #ffffff; color: #102a43; border: none; border-radius: 8px; padding: 6px; }
        QMenu::item { border-radius: 18px; padding: 8px 26px 8px 12px; }
        QMenu::item:selected { background: #d9ecff; }
    )");
}

void applyMaterialTheme(QApplication& application)
{
    application.setStyleSheet(materialStyleSheet(application.styleHints()->colorScheme()));
}
}

int main(int argc, char* argv[])
{
    HANDLE singleInstanceMutex = CreateMutexW(nullptr, FALSE, kSingleInstanceMutexName);
    if (singleInstanceMutex != nullptr && GetLastError() == ERROR_ALREADY_EXISTS) {
        activateExistingWindow();
        CloseHandle(singleInstanceMutex);
        return 0;
    }

    QApplication application(argc, argv);
    application.setStyle(QStringLiteral("Fusion"));
    application.setFont(QFont(QStringLiteral("Segoe UI Variable"), 10));
    const QString backgroundImagePath = selectStartupBackground();
    applyMaterialTheme(application);
    QObject::connect(
        application.styleHints(),
        &QStyleHints::colorSchemeChanged,
        &application,
        [&application](Qt::ColorScheme) { applyMaterialTheme(application); });

    MainWindow window(backgroundImagePath);
    window.show();

    const int exitCode = application.exec();
    if (singleInstanceMutex != nullptr) {
        CloseHandle(singleInstanceMutex);
    }
    return exitCode;
}