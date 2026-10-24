# Project Setu - ESP-IDF Main Component Registration
# Compiles app_main.cpp and links the shared portable C++ core into the firmware image.

idf_component_register(
    SRCS
        "app_main.cpp"
        "../../shared/src/packet.cpp"
        "../../shared/src/button.cpp"
        "../../shared/src/dedup.cpp"
        "../../shared/src/duty_cycle.cpp"
        "../../shared/src/node.cpp"
    INCLUDE_DIRS
        "."
        "../esp32s3/include"
        "../../shared/include"
    REQUIRES
        nvs_flash
        esp_timer
        driver
        esp_adc
        esp_hw_support
        freertos
)
