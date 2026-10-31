// Project Setu - ESP32-S3 Firmware Application Main
// Integrates the portable C++ protocol core (setu::Node) with FreeRTOS multitasking,
// interrupt service routines, peripheral adapters, NVS sequence persistence, and low-power event loops.

#include <cstdint>
#include <cstdio>
#include <atomic>
#include "setu/node.hpp"
#include "setu/hal.hpp"
#include "esp32_adapters.hpp"

#if defined(ESP_PLATFORM)
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_mac.h"
#include "driver/gpio.h"
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
static TaskHandle_t s_radio_task_handle = nullptr;

// Forward reference to hardware adapters
static setu::esp32::Esp32Clock s_clock;
static setu::esp32::Esp32Random s_rng;
static setu::esp32::Sx1262Radio s_radio(5 /*CS*/, 4 /*IRQ*/, 3 /*RST*/, 2 /*BUSY*/);
static setu::esp32::Neo6mGnss s_gnss(1 /*UART1*/, 17 /*TX*/, 18 /*RX*/);
static setu::esp32::Mpu6050DeadReckoning s_dr(21 /*SDA*/, 22 /*SCL*/);
static setu::esp32::BatteryMonitor s_battery(0 /*ADC1_CH0*/);
static setu::esp32::HapticLedDriver s_haptics(13 /*MOTOR*/, 14 /*LED_R*/, 15 /*LED_G*/);

// GPIO Button Interrupt Handler - minimal work, dispatches to FreeRTOS queue
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

// SX1262 DIO1 Interrupt Handler - notifies dedicated radio task
static void IRAM_ATTR sx1262_dio1_isr_handler(void* arg) {
  (void)arg;
  BaseType_t high_task_awoken = pdFALSE;
  if (s_radio_task_handle) {
    vTaskNotifyGiveFromISR(s_radio_task_handle, &high_task_awoken);
  }
  if (high_task_awoken) {
    portYIELD_FROM_ISR();
  }
}
#endif

// Application Context passed to FreeRTOS tasks
struct AppContext {
  setu::Node* node;
  setu::esp32::Esp32Clock* clock;
  setu::esp32::BatteryMonitor* battery;
  setu::esp32::Sx1262Radio* radio;
  setu::esp32::Neo6mGnss* gnss;
  setu::esp32::Mpu6050DeadReckoning* dr;
  setu::esp32::HapticLedDriver* haptics;
};

static std::atomic<uint32_t> s_radio_rx_packets{0};
static std::atomic<uint32_t> s_radio_rx_drops{0};

// Core Protocol Tick Task (100 Hz / 10ms cycle, Core 1 - Sole Owner of setu::Node)
[[maybe_unused]] static void core_protocol_task(void* param) {
  AppContext* ctx = static_cast<AppContext*>(param);
  printf("[SETU] Core protocol task started at 100 Hz on Core 1 (Sole Owner of setu::Node)\n");

#if defined(ESP_PLATFORM)
  uint32_t last_sensor_poll = 0;
#endif

  while (true) {
#if defined(ESP_PLATFORM)
    // 1. Drain pending radio RX packets sequentially into protocol engine
    RadioRxEvent rx_evt;
    while (xQueueReceive(s_radio_rx_queue, &rx_evt, 0) == pdTRUE) {
      if (rx_evt.length == setu::kPacketSize) {
        ctx->node->on_radio_rx(rx_evt.buffer, rx_evt.length);
      }
    }

    // 2. Drain pending button events from ISR queue
    ButtonEvent btn_evt;
    while (xQueueReceive(s_button_queue, &btn_evt, 0) == pdTRUE) {
      ctx->node->on_button_edge(btn_evt.is_pressed);
    }

    // 3. Advance authoritative protocol tick
    ctx->node->tick();

    // 4. Periodic battery & telemetry check every 5 seconds
    uint32_t now = ctx->clock->now_ms();
    if (now - last_sensor_poll >= 5000) {
      last_sensor_poll = now;
      ESP_LOGI(TAG, "Heartbeat: Node seq=%u, battery=%u%%, state=%s, rx_pkts=%u, rx_drops=%u",
               ctx->node->seq(), ctx->battery->percent(),
               ctx->node->sos_active() ? "EMERGENCY_ACTIVE" : "STANDBY",
               s_radio_rx_packets.load(), s_radio_rx_drops.load());
    }

    vTaskDelay(pdMS_TO_TICKS(10));
#else
    ctx->node->tick();
    break;
#endif
  }
}

// Dedicated Radio RX Processing Task (Core 0)
[[maybe_unused]] static void radio_rx_task(void* param) {
  AppContext* ctx = static_cast<AppContext*>(param);
  printf("[SETU] Radio RX processing task started on Core 0\n");

#if defined(ESP_PLATFORM)
  while (true) {
    // Wait for notification from DIO1 interrupt
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

    // Read packet from SX1262 SPI FIFO via authoritative selective IRQ processor
    uint8_t rx_buf[setu::kPacketSize];
    setu::esp32::Sx1262Radio::IrqResult res;
    if (ctx->radio->process_irqs(res, rx_buf, sizeof(rx_buf))) {
      if (res.rx_done && res.rx_len == setu::kPacketSize) {
        RadioRxEvent rx_evt;
        std::memcpy(rx_evt.buffer, rx_buf, setu::kPacketSize);
        rx_evt.length = res.rx_len;
        rx_evt.rssi = res.rx_rssi;
        rx_evt.snr = res.rx_snr;

        // Deliver to bounded event queue for single-owner protocol task
        if (xQueueSend(s_radio_rx_queue, &rx_evt, 0) == pdTRUE) {
          s_radio_rx_packets++;
        } else {
          // Bounded queue saturated: record and document drop
          s_radio_rx_drops++;
          ESP_LOGW(TAG, "s_radio_rx_queue saturated! Dropped packet. Total drops=%u", s_radio_rx_drops.load());
        }
      }
    }
  }
#else
  (void)ctx;
#endif
}

// Dedicated GPS UART Ingestion Task (Core 0)
[[maybe_unused]] static void gps_service_task(void* param) {
  AppContext* ctx = static_cast<AppContext*>(param);
  printf("[SETU] GPS UART ingestion task started on Core 0\n");

#if defined(ESP_PLATFORM)
  uint8_t uart_buf[128];
  while (true) {
    int len = uart_read_bytes(UART_NUM_1, uart_buf, sizeof(uart_buf), pdMS_TO_TICKS(100));
    if (len > 0) {
      ctx->gnss->framer().push_bytes(reinterpret_cast<const char*>(uart_buf), len, [&](const char* sentence) {
        ctx->gnss->feed_nmea(sentence, ctx->clock);
      });
    }
  }
#else
  (void)ctx;
#endif
}

// Dedicated Motion/Dead-Reckoning Task (Core 0, 50 Hz)
[[maybe_unused]] static void motion_service_task(void* param) {
  AppContext* ctx = static_cast<AppContext*>(param);
  printf("[SETU] Motion/Dead-Reckoning task started at 50 Hz on Core 0\n");

#if defined(ESP_PLATFORM)
  while (true) {
    // Poll hardware registers and advance step/heading estimator
    ctx->dr->poll_hardware(20);

    // Apply explicit GNSS anchoring policy if GPS fix is active
    int32_t lat = 0, lon = 0;
    if (ctx->gnss->get_fix(lat, lon)) {
      ctx->dr->anchor_gnss_filtered(lat, lon, ctx->gnss->satellites(), ctx->gnss->fix_sequence());
    }

    vTaskDelay(pdMS_TO_TICKS(20));
  }
#else
  (void)ctx;
#endif
}

// Dedicated Asynchronous Haptic/LED Task (Core 0)
[[maybe_unused]] static void haptic_service_task(void* param) {
  AppContext* ctx = static_cast<AppContext*>(param);
  printf("[SETU] Asynchronous haptic feedback task started on Core 0\n");

#if defined(ESP_PLATFORM)
  setu::HapticPattern p;
  while (true) {
    if (ctx->haptics->queue() && xQueueReceive(ctx->haptics->queue(), &p, portMAX_DELAY) == pdTRUE) {
      ctx->haptics->execute_pattern(p);
    }
  }
#else
  (void)ctx;
#endif
}

extern "C" void app_main() {
  printf("====================================================\n");
  printf("  PROJECT SETU — ESP32-S3 DISASTER RESCUE WRISTBAND\n");
  printf("====================================================\n");

#if defined(ESP_PLATFORM)
  // 1. Initialize Non-Volatile Storage (NVS)
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }
  ESP_ERROR_CHECK(ret);

  // 2. Persistent Monotonic Sequence Counter via NVS
  nvs_handle_t nvs_handle;
  uint16_t saved_seq = 100;
  ret = nvs_open("setu_cfg", NVS_READWRITE, &nvs_handle);
  if (ret == ESP_OK) {
    ret = nvs_get_u16(nvs_handle, "seq", &saved_seq);
    if (ret != ESP_OK) {
      saved_seq = 100;
    }
    // Reserve 100 sequence IDs to prevent reboot duplicate collision and wear-level flash
    nvs_set_u16(nvs_handle, "seq", saved_seq + 100);
    nvs_commit(nvs_handle);
    nvs_close(nvs_handle);
    ESP_LOGI(TAG, "Restored persistent sequence counter: %u", saved_seq);
  } else {
    ESP_LOGW(TAG, "Failed to open NVS storage; using fallback sequence: %u", saved_seq);
  }

  // 3. Derive unique Node ID from ESP32 MAC eFuse
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  uint16_t derived_node_id = static_cast<uint16_t>((mac[4] << 8) | mac[5]);
  if (derived_node_id == 0 || derived_node_id >= 65535) derived_node_id = 1;
  ESP_LOGI(TAG, "Initialized Device with MAC-derived Node ID: %u", derived_node_id);

  // 4. Initialize FreeRTOS Queues
  s_button_queue = xQueueCreate(16, sizeof(ButtonEvent));
  s_radio_rx_queue = xQueueCreate(16, sizeof(RadioRxEvent));
  if (!s_button_queue || !s_radio_rx_queue) {
    ESP_LOGE(TAG, "FATAL: Failed to allocate FreeRTOS queues");
    return;
  }

  // 5. Initialize Hardware Driver Adapters
  bool radio_ok = s_radio.init(868000000, 7, 125000, 14);
  bool gnss_ok = s_gnss.init_uart();
  bool dr_ok = s_dr.init_i2c();
  bool batt_ok = s_battery.init_adc();
  bool haptic_ok = s_haptics.init_outputs();

  ESP_LOGI(TAG, "Peripherals: Radio=%s, GNSS=%s, DR=%s, Batt=%s, Haptic=%s",
           radio_ok ? "OK" : "FAILED", gnss_ok ? "OK" : "FAILED",
           dr_ok ? "OK" : "FAILED", batt_ok ? "OK" : "FAILED",
           haptic_ok ? "OK" : "FAILED");

  if (!radio_ok) {
    ESP_LOGE(TAG, "CRITICAL FAULT: SX1262 LoRa Radio failed to initialize! Device cannot transmit SOS.");
  }

  // 6. Configure GPIO Button (GPIO 0 / BOOT button, Active LOW, Both Edges)
  gpio_config_t btn_conf = {};
  btn_conf.pin_bit_mask = (1ULL << GPIO_NUM_0);
  btn_conf.mode = GPIO_MODE_INPUT;
  btn_conf.pull_up_en = GPIO_PULLUP_ENABLE;
  btn_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
  btn_conf.intr_type = GPIO_INTR_ANYEDGE;
  gpio_config(&btn_conf);

  // 7. Configure SX1262 DIO1 Interrupt (GPIO 4, Rising Edge)
  gpio_config_t dio1_conf = {};
  dio1_conf.pin_bit_mask = (1ULL << GPIO_NUM_4);
  dio1_conf.mode = GPIO_MODE_INPUT;
  dio1_conf.pull_up_en = GPIO_PULLUP_DISABLE;
  dio1_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
  dio1_conf.intr_type = GPIO_INTR_POSEDGE;
  gpio_config(&dio1_conf);

  // 8. Install GPIO ISR Service and handlers
  gpio_install_isr_service(0);
  gpio_isr_handler_add(GPIO_NUM_0, gpio_button_isr_handler, reinterpret_cast<void*>(GPIO_NUM_0));
  gpio_isr_handler_add(GPIO_NUM_4, sx1262_dio1_isr_handler, reinterpret_cast<void*>(GPIO_NUM_4));

  // 9. Assemble Hardware Abstraction Layer
  setu::Hal hal;
  hal.clock = &s_clock;
  hal.rng = &s_rng;
  hal.radio = &s_radio;
  hal.gnss = &s_gnss;
  hal.dr = &s_dr;
  hal.battery = &s_battery;
  hal.haptic = &s_haptics;
  hal.trace = nullptr;

  // 10. Instantiate Portable Protocol Core Node
  setu::NodeConfig config;
  config.node_id = derived_node_id;
  config.role = setu::Role::Survivor;
  config.initial_seq = saved_seq;
  config.max_hops = 3;
  config.retry_timeout_ms = 4000;
  config.max_retries = 3;
  static setu::Node s_node(config, hal);

  static AppContext s_ctx;
  s_ctx.node = &s_node;
  s_ctx.clock = &s_clock;
  s_ctx.battery = &s_battery;
  s_ctx.radio = &s_radio;
  s_ctx.gnss = &s_gnss;
  s_ctx.dr = &s_dr;
  s_ctx.haptics = &s_haptics;

  // 11. Spawn FreeRTOS Tasks with Core Affinity
  // Radio, GPS, Motion, and Haptic Tasks on Core 0; Protocol Core on Core 1 (Sole Owner of setu::Node)
  BaseType_t t_radio = xTaskCreatePinnedToCore(radio_rx_task, "setu_radio", 4096, &s_ctx, 6, &s_radio_task_handle, 0);
  BaseType_t t_gps = xTaskCreatePinnedToCore(gps_service_task, "setu_gps", 3072, &s_ctx, 3, nullptr, 0);
  BaseType_t t_motion = xTaskCreatePinnedToCore(motion_service_task, "setu_motion", 3072, &s_ctx, 3, nullptr, 0);
  BaseType_t t_haptic = xTaskCreatePinnedToCore(haptic_service_task, "setu_haptic", 2048, &s_ctx, 2, nullptr, 0);
  BaseType_t t_core = xTaskCreatePinnedToCore(core_protocol_task, "setu_core", 4096, &s_ctx, 5, nullptr, 1);

  if (t_radio != pdPASS || t_gps != pdPASS || t_motion != pdPASS || t_haptic != pdPASS || t_core != pdPASS) {
    ESP_LOGE(TAG, "FATAL: Failed to spawn all FreeRTOS tasks (radio=%d, gps=%d, motion=%d, haptic=%d, core=%d)",
             t_radio, t_gps, t_motion, t_haptic, t_core);
  }

  ESP_LOGI(TAG, "Project Setu Wristband Firmware Online & Operational");
#else
  static setu::esp32::Esp32Clock host_clock;
  static setu::esp32::Esp32Random host_rng;
  static setu::esp32::BatteryMonitor host_batt;
  static setu::esp32::Sx1262Radio host_radio;
  static setu::esp32::Neo6mGnss host_gnss;
  static setu::esp32::Mpu6050DeadReckoning host_dr;
  static setu::esp32::HapticLedDriver host_haptics;
  setu::Hal host_hal;
  host_hal.clock = &host_clock;
  host_hal.rng = &host_rng;
  host_hal.radio = &host_radio;
  host_hal.gnss = &host_gnss;
  host_hal.dr = &host_dr;
  host_hal.battery = &host_batt;
  host_hal.haptic = &host_haptics;
  setu::NodeConfig host_cfg;
  setu::Node host_node(host_cfg, host_hal);
  AppContext host_ctx{
    &host_node,
    &host_clock,
    &host_batt,
    &host_radio,
    &host_gnss,
    &host_dr,
    &host_haptics
  };
  core_protocol_task(&host_ctx);
  radio_rx_task(&host_ctx);
  gps_service_task(&host_ctx);
  motion_service_task(&host_ctx);
  haptic_service_task(&host_ctx);
  printf("[INFO] Host compilation mode: ESP32-S3 firmware target is ready for IDF build.\n");
#endif
}
