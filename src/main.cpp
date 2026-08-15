#include <QApplication>
#include <QDir>
#include <QFileInfo>
#include <QFont>
#include <QIcon>
#include <QSysInfo>
#include <QStyleHints>

#include <windows.h>

#include "AppConfig.h"
#include "Logger.h"
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

QStringList collectBackgroundImagePaths()
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

void logStartupInformation(const QStringList& backgroundImagePaths)
{
    Log::info(QStringLiteral("========== NTE 模组管理器启动 =========="));
    Log::info(QStringLiteral("环境：操作系统=%1，内核=%2 %3，架构=%4，Qt=%5，ABI=%6")
        .arg(QSysInfo::prettyProductName())
        .arg(QSysInfo::kernelType())
        .arg(QSysInfo::kernelVersion())
        .arg(QSysInfo::currentCpuArchitecture())
        .arg(QString::fromLatin1(qVersion()))
        .arg(QSysInfo::buildAbi())
    );
    Log::info(QStringLiteral("环境：应用目录=%1，当前目录=%2，日志文件=%3")
        .arg(QCoreApplication::applicationDirPath())
        .arg(QDir::currentPath())
        .arg(Log::logFilePath())
    );
    Log::info(QStringLiteral("配置文件：%1")
        .arg(QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("NteModManager.ini")))
    );
    Log::info(QStringLiteral("配置：mods_directory=%1")
        .arg(AppConfig::modsDirectory())
    );
    Log::info(QStringLiteral("配置：backups_directory=%1")
        .arg(AppConfig::backupsDirectory())
    );
    Log::info(QStringLiteral("配置：background_images_directory=%1，test_images=%2，已加载图片=%3")
        .arg(AppConfig::backgroundImagesDirectory())
        .arg(AppConfig::testImagesEnabled() ? QStringLiteral("1") : QStringLiteral("0"))
        .arg(backgroundImagePaths.size())
    );
    Log::info(QStringLiteral("配置：python_executable=%1，visual_region_script=%2")
        .arg(AppConfig::pythonExecutable())
        .arg(AppConfig::visualRegionScript())
    );
    Log::info(QStringLiteral("配置：orientation_model=%1，python_model_cache=%2")
        .arg(AppConfig::orientationModel())
        .arg(AppConfig::pythonModelCache())
    );
    Log::info(QStringLiteral("配置：game_launcher=%1，packager_directory=%2")
        .arg(AppConfig::gameLauncherPath())
        .arg(AppConfig::packagerDirectory())
    );
    Log::info(QStringLiteral("配置：mod_list_sort_order=%1，mod_categories=%2，mod_category_order=%3")
        .arg(AppConfig::modListSortOrder())
        .arg(AppConfig::modCategories().join(QStringLiteral(",")))
        .arg(AppConfig::modCategoryOrder().join(QStringLiteral(",")))
    );
}

QString materialStyleSheet(Qt::ColorScheme colorScheme)
{
    return QStringLiteral(R"(
        QMainWindow, #root { color: #102a43; }
        #title { color: #ffffff; font-size: 35px; font-weight: 700; }
        #subtitle { color: #ffffff; font-size: 20px; }
        #activity { color: #ffffff; }

        #dropZone { background: rgba(255, 255, 255, 195); border: 1px solid rgba(255, 255, 255, 220); border-radius: 16px; }
        #dropZone:hover { border: 1px solid rgba(139, 192, 232, 235); }
        #dropTitle { color: #102a43; font-weight: 700; font-size: 18px; }
        #dropHint { color: #60758a; font-size: 14px; }
        #importDivider { background: rgba(79, 145, 201, 100); }
        #importFileButton {
            background: #0067b1; border: 1px solid #0067b1; border-radius: 10px;
            color: #ffffff; padding: 0px 14px; font-weight: 600;
        }
        #importFileButton:hover { background: #00558f; border-color: #00558f; }
        #importFileButton:pressed { background: #003b6f; border-color: #003b6f; }

        #sectionTitle { color: #ffffff; font-weight: 600; font-size: 20px; padding: 0px; }
        #count { color: #ffffff; font-size: 14px; }

        #modName { color: #000000; font-weight: 600; font-size: 18px; }
        #metadata { color: #606060; font-size: 14px; }
        #modHeader { background: transparent; }
        #modFilesCard { background: rgba(226, 242, 255, 105); border: 1px solid rgba(79, 145, 201, 90); border-radius: 12px; }
        #modFolderEntry { color: #16466b; font-weight: 600; padding: 2px 0px; }
        #modFileEntry, #modFileSize { color: #31506d; font-size: 13px; }
        #modFileSize { color: #60758a; }
        #modFileNameEditor { color: #102a43; background: rgba(255, 255, 255, 210); border: 1px solid #4f91c9; border-radius: 4px; padding: 1px 4px; }

        #categoryList { 
            background: transparent; 
            font-size: 17px; 
            color: #000000; 
            qproperty-categoryCardTextColor: #000000;
            qproperty-categoryCardTextHorizontalMargin: 14;
            qproperty-categoryCardTextVerticalMargin: 16;
            qproperty-categoryCardSelectedTextColor: #003b6f;
            qproperty-categoryCardCountColor: #60758a;
            qproperty-categoryCardCountFontSize: 13;
            qproperty-categoryCardCountBold: false;
            qproperty-categoryCardMarkerColor: rgba(0, 0, 0, 0);
            qproperty-categoryCardMarkerMargin: 10;
            qproperty-categoryCardMarkerWidth: 3;
            qproperty-categoryCardPreviewBackgroundColor: rgba(255, 255, 255, 235);
            qproperty-categoryCardPreviewBorderColor: #0067b1;
            qproperty-categoryCardPreviewTextColor: #003b6f;
            qproperty-categoryCardPlaceholderColor: rgba(0, 103, 177, 95);
            qproperty-categoryCardPlaceholderMargin: 3;
            qproperty-categoryCardPlaceholderWidth: 2;
            qproperty-categoryCardCornerRadius: 14;
            qproperty-categoryCardBorderWidth: 3;
            qproperty-categoryCardWidth: 220;
            qproperty-categoryCardHeight: 78;
            qproperty-categoryGridWidth: 236;
            qproperty-categoryGridHeight: 92;
            qproperty-categoryCardNameBold: true;
        }
        #categoryList::item {
            background: rgba(255, 255, 255, 155); 
            border: 2px solid rgba(255, 255, 255, 255);
            border-radius: 14px; 
            color: #000000; 
            padding: 0px;
        }
        #categoryList::item:hover { 
            background: rgba(240, 247, 255, 225); 
            border: 2px solid rgba(255, 255, 255, 255);
            border-radius: 14px; 
            color: #003b6f; 
        }
        #categoryList::item:selected { 
            background: #d9ecff; 
            border: 3px solid #8bc0e8; 
            color: #003b6f; 
        }

        #modListActionButton {
            background: rgba(236, 247, 255, 95); border: 1px solid rgba(255, 255, 255, 175); border-radius: 18px;
            color: #003b6f; min-height: 32px; padding: 3px 16px;
        }
        #modListActionButton:hover { background: #bdddff; }
        #modListActionButton:pressed { background: #8bc0e8; color: #ffffff; }
        #modRow { background: rgba(255, 255, 255, 155); border: 1px solid rgba(255, 255, 255, 145); border-radius: 16px; }
        #modRow:hover { background: rgba(240, 247, 255, 225); }

        #stateInstalled, #stateUninstalled {
            border: 1px solid transparent; border-radius: 12px; font-size: 12px;
            padding: 4px 8px; min-height: 24px;
        }
        #stateInstalled { background: #00ec76; color: #00533e; }
        #stateInstalled:hover { background: #00d86c; }
        #stateInstalled:pressed { background: #00b85a; color: #003b2f; }
        #stateUninstalled { background: #e5eef7; color: #52677d; }
        #stateUninstalled:hover { background: #d4e4f2; color: #31506d; }
        #stateUninstalled:pressed { background: #bdd3e5; color: #243b53; }

        #deleteButton { color: #c42b1c; }
        #deleteButton:hover { background: #ffdad6; }

        #moreButton { font-size: 18px; font-weight: 600; padding: 0px; }
        #moreButton::menu-indicator { image: none; width: 0px; }

        #modScrollArea, #modScrollArea::viewport, #modScrollArea::corner, #listContainer { background: transparent; }
        #logView { background: rgba(255, 255, 255, 190); border: 1px solid rgba(79, 145, 201, 120); border-radius: 12px; color: #243b53; padding: 10px; selection-background-color: #bdddff; selection-color: #102a43; }
        QScrollBar:vertical { background: transparent; width: 12px; margin: 4px 2px; }
        QScrollBar::handle:vertical { background: #9bbbd8; min-height: 32px; border-radius: 5px; }
        QScrollBar::handle:vertical:hover { background: #0067b1; }
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }
        QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
        QScrollBar:horizontal { background: transparent; height: 12px; margin: 2px 4px; }
        QScrollBar::handle:horizontal { background: #9bbbd8; min-width: 32px; border-radius: 5px; }
        QScrollBar::handle:horizontal:hover { background: #0067b1; }
        QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0px; }
        QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal { background: transparent; }
        QAbstractScrollArea::corner {
            background: transparent;
        }
        QToolButton { background: rgba(236, 247, 255, 80); border: 1px solid rgba(255, 255, 255, 165); border-radius: 18px; color: #31506d; padding: 6px 9px; }
        QToolButton:hover:enabled { background: rgba(214, 238, 255, 185); }
        #modFolderButton, #modFolderButton:hover, #modFolderButton:pressed, #modFolderButton:focus {
            background: transparent;
            border: none;
            border-radius: 0px;
            padding: 0px;
        }
        QToolButton:disabled, #modListActionButton:disabled { color: #a6a6a6; }
        #emptyState { color: #ffffff; padding: 56px; font-size: 20px; }
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
    application.setApplicationName(QStringLiteral("NteModManager"));
    application.setWindowIcon(QIcon(QStringLiteral(":/img/nte-mod-manager.ico")));
    application.setStyle(QStringLiteral("Fusion"));
    application.setFont(QFont(QStringLiteral("Segoe UI Variable"), 10));
    Log::initialize();
    qInstallMessageHandler(Log::getQtMessageHandler());
    const QStringList backgroundImagePaths = collectBackgroundImagePaths();
    logStartupInformation(backgroundImagePaths);
    applyMaterialTheme(application);
    QObject::connect(
        application.styleHints(),
        &QStyleHints::colorSchemeChanged,
        &application,
        [&application](Qt::ColorScheme) { applyMaterialTheme(application); });

    MainWindow window(backgroundImagePaths);
    window.show();

    const int exitCode = application.exec();
    if (singleInstanceMutex != nullptr) {
        CloseHandle(singleInstanceMutex);
    }
    return exitCode;
}