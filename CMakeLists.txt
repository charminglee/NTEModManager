cmake_minimum_required(VERSION 3.21)

project(NteModManager VERSION 0.1.0 LANGUAGES CXX)

if(NOT WIN32)
    message(FATAL_ERROR "NteModManager currently supports Windows only.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Widgets)

get_filename_component(NTE_QT_ROOT "${Qt6_DIR}/../../.." ABSOLUTE)
find_program(NTE_WINDEPLOYQT_EXECUTABLE
    NAMES windeployqt windeployqt6
    HINTS "${NTE_QT_ROOT}/bin"
    REQUIRED
)

set(NTE_7ZIP_SOURCE "")
if(DEFINED ENV{NTE_7ZIP_PATH} AND EXISTS "$ENV{NTE_7ZIP_PATH}")
    set(NTE_7ZIP_SOURCE "$ENV{NTE_7ZIP_PATH}")
elseif(EXISTS "C:/7-Zip/7z.exe")
    set(NTE_7ZIP_SOURCE "C:/7-Zip/7z.exe")
else()
    find_program(NTE_7ZIP_SOURCE
        NAMES 7z.exe 7zz.exe 7z 7zz
        HINTS
            "$ENV{ProgramFiles}/7-Zip"
            "$ENV{ProgramW6432}/7-Zip"
            "C:/Program Files (x86)/7-Zip"
    )
endif()
set(NTE_7ZIP_DEPLOY_COMMAND)
if(NTE_7ZIP_SOURCE)
    get_filename_component(NTE_7ZIP_FILE_NAME "${NTE_7ZIP_SOURCE}" NAME)
    get_filename_component(NTE_7ZIP_SOURCE_DIR "${NTE_7ZIP_SOURCE}" DIRECTORY)
    list(APPEND NTE_7ZIP_DEPLOY_COMMAND
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${NTE_7ZIP_SOURCE}"
            "$<TARGET_FILE_DIR:NteModManager>/${NTE_7ZIP_FILE_NAME}")
    if(EXISTS "${NTE_7ZIP_SOURCE_DIR}/7z.dll")
        list(APPEND NTE_7ZIP_DEPLOY_COMMAND
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${NTE_7ZIP_SOURCE_DIR}/7z.dll"
                "$<TARGET_FILE_DIR:NteModManager>/7z.dll")
    endif()
else()
    message(WARNING "7-Zip was not found; it will not be copied to the Release directory. Set NTE_7ZIP_PATH to 7z.exe or 7zz.exe to deploy it.")
endif()

qt_standard_project_setup()

set(NTE_PYTHON_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/python")
set(NTE_PYTHON_VENV_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.venv")
set(NTE_ORIENTATION_MODEL_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/training/orientation/checkpoints/weighted_unfrozen/best.pt")
set(NTE_ORIENTATION_MODEL_AVAILABLE OFF)
if(EXISTS "${NTE_ORIENTATION_MODEL_SOURCE}")
    set(NTE_ORIENTATION_MODEL_AVAILABLE ON)
else()
    message(WARNING "Orientation model is missing; continuing with fallback visual detection: ${NTE_ORIENTATION_MODEL_SOURCE}")
endif()
if(NOT EXISTS "${NTE_PYTHON_VENV_DIR}/pyvenv.cfg")
    message(FATAL_ERROR "Python virtual environment is missing: ${NTE_PYTHON_VENV_DIR}")
endif()

file(STRINGS "${NTE_PYTHON_VENV_DIR}/pyvenv.cfg" NTE_PYTHON_HOME_LINE REGEX "^home[ ]*=")
if(NOT NTE_PYTHON_HOME_LINE)
    message(FATAL_ERROR "Unable to find the base Python installation in pyvenv.cfg")
endif()
string(REGEX REPLACE "^[^=]*=[ ]*" "" NTE_PYTHON_BASE_DIR "${NTE_PYTHON_HOME_LINE}")
file(TO_CMAKE_PATH "${NTE_PYTHON_BASE_DIR}" NTE_PYTHON_BASE_DIR)
if(NOT EXISTS "${NTE_PYTHON_BASE_DIR}/python.exe")
    message(FATAL_ERROR "Base Python installation is missing: ${NTE_PYTHON_BASE_DIR}")
endif()

qt_add_executable(NteModManager WIN32
    src/AppConfig.cpp
    src/CategoryListWidget.cpp
    src/CategoryListWidget.h
    src/MainWindow.cpp
    src/Logger.cpp
    src/Logger.h
    src/ModListLogic.cpp
    src/ModListLogic.h
    src/ModRepository.cpp
    src/main.cpp
    src/VisualRegionDetector.cpp
    src/VisualRegionDetector.h
    NteModManager.rc
)

qt_add_resources(NteModManager "branding"
    PREFIX "/"
    FILES img/nte-mod-manager.ico
)

target_link_libraries(NteModManager PRIVATE Qt6::Widgets)

set(NTE_PYTHON_PACKAGE_DIR "${CMAKE_CURRENT_BINARY_DIR}/$<CONFIG>/python")
set(NTE_PYTHON_PACKAGE_MARKER "${NTE_PYTHON_PACKAGE_DIR}/.package-complete")
set(NTE_PYTHON_PACKAGE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/CMakeLists.txt"
    "${NTE_PYTHON_VENV_DIR}/pyvenv.cfg"
    "${CMAKE_CURRENT_SOURCE_DIR}/requirements.txt"
    "${NTE_PYTHON_SOURCE_DIR}/visual_region_detector.py"
)
set(NTE_ORIENTATION_MODEL_COPY_COMMAND)
if(NTE_ORIENTATION_MODEL_AVAILABLE)
    list(APPEND NTE_PYTHON_PACKAGE_DEPENDS "${NTE_ORIENTATION_MODEL_SOURCE}")
    set(NTE_ORIENTATION_MODEL_COPY_COMMAND
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${NTE_ORIENTATION_MODEL_SOURCE}"
            "${NTE_PYTHON_PACKAGE_DIR}/orientation-model/best.pt")
endif()

add_custom_command(
    OUTPUT "${NTE_PYTHON_PACKAGE_MARKER}"
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "${NTE_PYTHON_PACKAGE_DIR}"
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "${NTE_PYTHON_PACKAGE_DIR}/orientation-model"
    COMMAND ${CMAKE_COMMAND} -E remove_directory
        "${NTE_PYTHON_PACKAGE_DIR}/model-cache/torch"
    COMMAND ${CMAKE_COMMAND} -E remove_directory
        "${NTE_PYTHON_PACKAGE_DIR}/model-cache/hub"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NTE_PYTHON_BASE_DIR}/python.exe"
        "${NTE_PYTHON_PACKAGE_DIR}/python.exe"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NTE_PYTHON_BASE_DIR}/pythonw.exe"
        "${NTE_PYTHON_PACKAGE_DIR}/pythonw.exe"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NTE_PYTHON_BASE_DIR}/python312.dll"
        "${NTE_PYTHON_PACKAGE_DIR}/python312.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NTE_PYTHON_BASE_DIR}/python3.dll"
        "${NTE_PYTHON_PACKAGE_DIR}/python3.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NTE_PYTHON_BASE_DIR}/vcruntime140.dll"
        "${NTE_PYTHON_PACKAGE_DIR}/vcruntime140.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NTE_PYTHON_BASE_DIR}/vcruntime140_1.dll"
        "${NTE_PYTHON_PACKAGE_DIR}/vcruntime140_1.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${NTE_PYTHON_BASE_DIR}/DLLs"
        "${NTE_PYTHON_PACKAGE_DIR}/DLLs"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${NTE_PYTHON_BASE_DIR}/Lib"
        "${NTE_PYTHON_PACKAGE_DIR}/Lib"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${NTE_PYTHON_VENV_DIR}/Lib/site-packages"
        "${NTE_PYTHON_PACKAGE_DIR}/Lib/site-packages"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${NTE_PYTHON_SOURCE_DIR}/visual_region_detector.py"
        "${NTE_PYTHON_PACKAGE_DIR}/visual_region_detector.py"
    ${NTE_ORIENTATION_MODEL_COPY_COMMAND}
    COMMAND ${CMAKE_COMMAND} -E touch "${NTE_PYTHON_PACKAGE_MARKER}"
    DEPENDS ${NTE_PYTHON_PACKAGE_DEPENDS}
    VERBATIM
)

add_custom_target(NteModManagerPythonPackage DEPENDS "${NTE_PYTHON_PACKAGE_MARKER}")
add_dependencies(NteModManager NteModManagerPythonPackage)

add_custom_command(TARGET NteModManager POST_BUILD
    COMMAND "${NTE_WINDEPLOYQT_EXECUTABLE}"
        --release
        --no-translations
        "$<TARGET_FILE:NteModManager>"
    ${NTE_7ZIP_DEPLOY_COMMAND}
    COMMENT "Deploying Qt runtime libraries"
    VERBATIM
)

target_compile_definitions(NteModManager PRIVATE
    UNICODE
    _UNICODE
)
