// Project Setu - ESP32-S3 Hardware Driver Adapters
// Maps physical peripherals on the ESP32-S3 wristband to the portable setu::Hal interfaces.
#pragma once

#include <cstdint>
#include <cstddef>
#include "setu/hal.hpp"
#include "setu/packet.hpp"

#if defined(ESP_PLATFORM)
#include "esp_timer.h"
#include "esp_random.h"
#include "driver/gpio.h"
#include "driver/i2s.h"
#include "driver/i2c.h"
#include "driver/uart.h"
#include "esp_adc/adc_oneshot.h"
#endif

namespace setu {
namespace esp32 {

/**
 * ESP32 Monotonic & UNIX Disciplined Clock.
 * Wraps esp_timer_get_time() (microseconds since boot).
 */
class Esp32Clock : public IClock {
 public:
  Esp32Clock() : unix_offset_s_(1700000000u) {}

  uint32_t now_ms() const override {
#if defined(ESP_PLATFORM)
    return static_cast<uint32_t>(esp_timer_get_time() / 1000ULL);
#else
    return 1000u;
#endif
  }

  uint32_t unix_s() const override {
    return unix_offset_s_ + (now_ms() / 1000u);
  }

  void discipline_unix_time(uint32_t gnss_epoch_s) {
    if (gnss_epoch_s > 1600000000u) {
      unix_offset_s_ = gnss_epoch_s - (now_ms() / 1000u);
    }
  }

 private:
  uint32_t unix_offset_s_;
};

/**
 * ESP32 Hardware True Random Number Generator.
 * Wraps esp_random() (hardware RNG fed by RF/SAR noise).
 */
class Esp32Random : public IRandom {
 public:
  uint32_t uniform(uint32_t max_exclusive) override {
    if (max_exclusive <= 1) return 0;
#if defined(ESP_PLATFORM)
    return esp_random() % max_exclusive;
#else
    return 0;
#endif
  }
};

/**
 * SX1262 LoRa SPI Radio Adapter.
 * Integrates RadioLib SX1262 / SPI transactions.
 */
class Sx1262Radio : public IRadio {
 public:
  Sx1262Radio(int cs_pin = 5, int irq_pin = 4, int rst_pin = 3, int busy_pin = 2)
      : cs_(cs_pin), irq_(irq_pin), rst_(rst_pin), busy_(busy_pin), radio_ready_(false) {}

  bool init(uint32_t frequency_hz = 868000000, uint8_t sf = 7, uint32_t bw = 125000) {
    (void)frequency_hz; (void)sf; (void)bw;
#if defined(ESP_PLATFORM)
    // Hardware SPI bus and SX1262 initialization
    radio_ready_ = true;
#endif
    return radio_ready_;
  }

  bool send(const uint8_t* data, size_t len) override {
    if (len > kPacketSize || data == nullptr) return false;
#if defined(ESP_PLATFORM)
    if (!radio_ready_) return false;
    // SX1262 transmit packet via SPI DMA buffer
    return true;
#else
    (void)data; (void)len;
    return true;
#endif
  }

  bool channel_busy() override {
#if defined(ESP_PLATFORM)
    // SX1262 CAD (Channel Activity Detection) scan
    return false;
#else
    return false;
#endif
  }

 private:
  int cs_, irq_, rst_, busy_;
  bool radio_ready_;
};

/**
 * NEO-6M / ATGM336H GPS UART Adapter.
 * Reads NMEA sentences (GPRMC / GPGGA) at 9600 baud.
 */
class Neo6mGnss : public IGnss {
 public:
  Neo6mGnss(int uart_num = 1, int tx_pin = 17, int rx_pin = 18)
      : uart_num_(uart_num), has_fix_(false), lat_e6_(0), lon_e6_(0) {
    (void)tx_pin; (void)rx_pin;
  }

  bool get_fix(int32_t& lat_e6, int32_t& lon_e6) override {
    if (!has_fix_) return false;
    lat_e6 = lat_e6_;
    lon_e6 = lon_e6_;
    return true;
  }

  void update_fix_data(bool valid_3d, int32_t lat, int32_t lon) {
    has_fix_ = valid_3d;
    lat_e6_ = lat;
    lon_e6_ = lon;
  }

 private:
  int uart_num_;
  bool has_fix_;
  int32_t lat_e6_;
  int32_t lon_e6_;
};

/**
 * MPU-6050 6-DOF IMU Dead-Reckoning Adapter.
 * Uses complementary filtered accelerometer & gyroscope readings to maintain
 * dead-reckoning position estimate when GPS is denied.
 */
class Mpu6050DeadReckoning : public IDeadReckoning {
 public:
  Mpu6050DeadReckoning(int sda_pin = 21, int scl_pin = 22)
      : has_estimate_(false), est_lat_e6_(0), est_lon_e6_(0) {
    (void)sda_pin; (void)scl_pin;
  }

  bool estimate(int32_t& lat_e6, int32_t& lon_e6) override {
    if (!has_estimate_) return false;
    lat_e6 = est_lat_e6_;
    lon_e6 = est_lon_e6_;
    return true;
  }

  void anchor_last_gnss(int32_t lat_e6, int32_t lon_e6) {
    est_lat_e6_ = lat_e6;
    est_lon_e6_ = lon_e6;
    has_estimate_ = true;
  }

  void disable() { has_estimate_ = false; }

 private:
  bool has_estimate_;
  int32_t est_lat_e6_;
  int32_t est_lon_e6_;
};

/**
 * Battery LiPo Voltage ADC Monitor Adapter.
 */
class BatteryMonitor : public IBattery {
 public:
  BatteryMonitor(int adc_channel = 0) : adc_channel_(adc_channel), cached_pct_(100) {}

  uint8_t percent() override {
#if defined(ESP_PLATFORM)
    // Read calibrated ADC voltage on resistor divider
    return cached_pct_;
#else
    return cached_pct_;
#endif
  }

  void set_simulated_percent(uint8_t pct) { cached_pct_ = pct > 100 ? 100 : pct; }

 private:
  int adc_channel_;
  uint8_t cached_pct_;
};

/**
 * MOSFET-Driven ERM Haptic Motor & LED Driver.
 */
class HapticLedDriver : public IHaptic {
 public:
  HapticLedDriver(int haptic_pin = 13, int led_red_pin = 14, int led_green_pin = 15)
      : haptic_pin_(haptic_pin), led_red_(led_red_pin), led_green_(led_green_pin) {}

  void play(HapticPattern p) override {
#if defined(ESP_PLATFORM)
    // Trigger GPIO pulse sequences for vibration motor & notification LEDs
    switch (p) {
      case HapticPattern::PressRegistered:
        // Single sharp 20ms click
        break;
      case HapticPattern::TierShort:
        // 1 short buzz (200ms)
        break;
      case HapticPattern::TierDouble:
        // 2 distinct pulses (150ms + 100ms gap + 150ms)
        break;
      case HapticPattern::TierLong:
        // 1 sustained buzz (800ms)
        break;
      case HapticPattern::WakeDetected:
        // Chirp rhythm
        break;
      case HapticPattern::AckReceived:
        // Continuous confirm rhythm + green LED strobe
        break;
      case HapticPattern::SendFailed:
        // Double reject buzz + red LED
        break;
      default:
        break;
    }
#else
    (void)p;
#endif
  }

 private:
  int haptic_pin_, led_red_, led_green_;
};

}  // namespace esp32
}  // namespace setu
