cmake_minimum_required(VERSION 3.16)

if(DEFINED ENV{IDF_PATH})
  # ESP-IDF Target Firmware Build (PlatformIO or native idf.py)
  set(EXTRA_COMPONENT_DIRS "firmware/main")
  include($ENV{IDF_PATH}/tools/cmake/project.cmake)
  project(project_setu_firmware)
else()
  # Native Host Build (MSVC, Linux GCC, Simulator, Unit Tests, Integration Tests)
  project(setu CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
if(MSVC)
  add_compile_options(/W4 /permissive-)
else()
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Portable core: no ESP-IDF, no simulator dependencies. Same sources go into the firmware.
add_library(setu_core STATIC
  shared/src/packet.cpp shared/src/button.cpp shared/src/dedup.cpp
  shared/src/duty_cycle.cpp shared/src/node.cpp)
target_include_directories(setu_core PUBLIC shared/include)

# Native RF/world simulator that runs the real core on many virtual nodes.
add_library(setu_world STATIC simulation/native/world.cpp)
target_include_directories(setu_world PUBLIC simulation/native firmware/esp32s3/include)
target_link_libraries(setu_world PUBLIC setu_core)

add_executable(setu_sim simulation/native/main.cpp)
target_link_libraries(setu_sim PRIVATE setu_world)

# Firmware entry point host verification target (ensures app_main.cpp and esp32_adapters.hpp compile cleanly)
add_library(setu_firmware_host STATIC firmware/main/app_main.cpp)
target_include_directories(setu_firmware_host PUBLIC shared/include firmware/esp32s3/include)
target_link_libraries(setu_firmware_host PUBLIC setu_core)


enable_testing()
add_executable(setu_unit_tests
  tests/unit/test_main.cpp tests/unit/test_packet.cpp tests/unit/test_button.cpp
  tests/unit/test_misc.cpp tests/unit/test_node.cpp tests/unit/test_firmware_mocks.cpp
  tests/unit/test_firmware_in_the_loop.cpp tests/unit/test_sensors.cpp)
target_include_directories(setu_unit_tests PRIVATE firmware/esp32s3/include)
target_link_libraries(setu_unit_tests PRIVATE setu_core setu_world)
add_test(NAME unit COMMAND setu_unit_tests)

add_executable(setu_integration_tests tests/integration/test_mesh.cpp tests/unit/test_main.cpp)
target_link_libraries(setu_integration_tests PRIVATE setu_world)
target_include_directories(setu_integration_tests PRIVATE tests/unit)
add_test(NAME integration COMMAND setu_integration_tests)

endif() # NOT DEFINED ENV{IDF_PATH}

