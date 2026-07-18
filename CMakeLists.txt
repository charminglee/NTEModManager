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

qt_standard_project_setup()

qt_add_executable(NteModManager WIN32
    src/MainWindow.cpp
    src/ModRepository.cpp
    src/main.cpp
)

target_link_libraries(NteModManager PRIVATE Qt6::Widgets)

target_compile_definitions(NteModManager PRIVATE
    UNICODE
    _UNICODE
    NTE_PACKAGER_DIRECTORY="${CMAKE_SOURCE_DIR}/傻瓜打包器"
)