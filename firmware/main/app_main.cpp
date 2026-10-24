// Project Setu - ESP32-S3 Firmware Application Main
// Integrates the portable C++ protocol core (setu::Node) with FreeRTOS multitasking,
// interrupt service routines, peripheral adapters, and low-power event loops.

#include <cstdint>
#include <cstdio>
#include "setu/node.hpp"
#include "setu/hal.hpp"
#include "esp32_adapters.hpp"

#if defined(ESP_PLATFORM)
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "esp_mac.h"
#endif

static const char* TAG = "SETU_MAIN";

// Event structure passed from GPIO Button ISR to Core Task
struct ButtonEvent {
  uint32_t timestamp_ms;
  bool is_pressed;
};

// Event structure passed from SX1262 DIO1 Radio IRQ to Radio Task
struct RadioRxEvent {
  uint8_t buffer[setu::kPacketSize];
  size_t length;
  int16_t rssi;
  int8_t snr;
};

#if defined(ESP_PLATFORM)
static QueueHandle_t s_button_queue = nullptr;
static QueueHandle_t s_radio_rx_queue = nullptr;

// GPIO Button Interrupt Handler - minimal work, dispatches to queue
static void IRAM_ATTR gpio_button_isr_handler(void* arg) {
  int pin = reinterpret_cast<int>(arg);
  ButtonEvent evt;
  evt.timestamp_ms = static_cast<uint32_t>(esp_timer_get_time() / 1000ULL);
  evt.is_pressed = (gpio_get_level(static_cast<gpio_num_t>(pin)) == 0); // Active LOW with pull-up
  BaseType_t high_task_awoken = pdFALSE;
  xQueueSendFromISR(s_button_queue, &evt, &high_task_awoken);
  if (high_task_awoken) {
    portYIELD_FROM_ISR();
  }
}
#endif

// Core Protocol Tick Task (100 Hz / 10ms cycle)
static void core_protocol_task(void* param) {
  setu::Node* node = static_cast<setu::Node*>(param);
  printf("[SETU] Core protocol task started at 100 Hz\n");

  uint32_t last_sensor_poll = 0;

  while (true) {
#if defined(ESP_PLATFORM)
    // 1. Drain pending button events from ISR
    ButtonEvent btn_evt;
    while (xQueueReceive(s_button_queue, &btn_evt, 0) == pdTRUE) {
      node->on_button_edge(btn_evt.is_pressed);
    }

    // 2. Advance authoritative protocol tick
    node->tick();

    // 3. Periodic battery & GNSS health telemetry check every 5 seconds
    uint32_t now = node->now_ms();
    if (now - last_sensor_poll >= 5000) {
      last_sensor_poll = now;
      ESP_LOGI(TAG, "Heartbeat: Node seq=%u, battery=%u%%, state=%s",
               node->seq(), node->battery_percent(),
               node->is_active_sos() ? "EMERGENCY_ACTIVE" : "STANDBY");
    }

    vTaskDelay(pdMS_TO_TICKS(10));
#else
    node->tick();
    break;
#endif
  }
}

// Dedicated Radio RX Processing Task
static void radio_rx_task(void* param) {
  setu::Node* node = static_cast<setu::Node*>(param);
  printf("[SETU] Radio RX processing task started\n");

#if defined(ESP_PLATFORM)
  RadioRxEvent rx_evt;
  while (true) {
    if (xQueueReceive(s_radio_rx_queue, &rx_evt, portMAX_DELAY) == pdTRUE) {
      if (rx_evt.length == setu::kPacketSize) {
        node->on_radio_rx(rx_evt.buffer, rx_evt.length);
      }
    }
  }
#else
  (void)node;
#endif
}

extern "C" void app_main() {
  printf("====================================================\n");
  printf("  PROJECT SETU — ESP32-S3 DISASTER RESCUE WRISTBAND\n");
  printf("====================================================\n");

#if defined(ESP_PLATFORM)
  // 1. Initialize Non-Volatile Storage (NVS) for persistent sequence IDs
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }
  ESP_ERROR_CHECK(ret);

  // 2. Derive unique Node ID from ESP32 MAC eFuse
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  uint16_t derived_node_id = static_cast<uint16_t>((mac[4] << 8) | mac[5]);
  if (derived_node_id == 0 || derived_node_id >= 65535) derived_node_id = 1;
  ESP_LOGI(TAG, "Initialized Device with MAC-derived Node ID: %u", derived_node_id);

  // 3. Initialize FreeRTOS Queues
  s_button_queue = xQueueCreate(16, sizeof(ButtonEvent));
  s_radio_rx_queue = xQueueCreate(8, sizeof(RadioRxEvent));

  // 4. Instantiate Hardware HAL Adapters
  static setu::esp32::Esp32Clock s_clock;
  static setu::esp32::Esp32Random s_rng;
  static setu::esp32::Sx1262Radio s_radio(5 /*CS*/, 4 /*IRQ*/, 3 /*RST*/, 2 /*BUSY*/);
  static setu::esp32::Neo6mGnss s_gnss(1 /*UART1*/, 17 /*TX*/, 18 /*RX*/);
  static setu::esp32::Mpu6050DeadReckoning s_dr(21 /*SDA*/, 22 /*SCL*/);
  static setu::esp32::BatteryMonitor s_battery(0 /*ADC1_CH0*/);
  static setu::esp32::HapticLedDriver s_haptics(13 /*MOTOR*/, 14 /*LED_R*/, 15 /*LED_G*/);

  setu::Hal hal;
  hal.clock = &s_clock;
  hal.rng = &s_rng;
  hal.radio = &s_radio;
  hal.gnss = &s_gnss;
  hal.dr = &s_dr;
  hal.battery = &s_battery;
  hal.haptic = &s_haptics;
  hal.tracer = nullptr;

  // 5. Instantiate Portable Protocol Core Node
  setu::NodeConfig config;
  config.node_id = derived_node_id;
  config.role = setu::NodeRole::Survivor;
  config.max_hops = 3;
  config.retry_timeout_ms = 4000;
  config.max_retries = 3;
  static setu::Node s_node(config, hal);

  // 6. Spawn FreeRTOS Tasks
  xTaskCreatePinnedToCore(core_protocol_task, "setu_core", 4096, &s_node, 5, nullptr, 1);
  xTaskCreatePinnedToCore(radio_rx_task, "setu_radio", 4096, &s_node, 6, nullptr, 0);

  ESP_LOGI(TAG, "Project Setu Wristband Firmware Online & Operational");
#else
  printf("[INFO] Host compilation mode: ESP32-S3 firmware target is ready for IDF build.\n");
#endif
}
