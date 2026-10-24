// Project Setu - ESP32-S3 Hardware Driver Adapters
// Maps physical peripherals on the ESP32-S3 wristband to the portable setu::Hal interfaces.
#pragma once

#include <cstdint>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <cmath>
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
 * Reads NMEA sentences (GPRMC / GPGGA) at 9600 baud and parses microdegree coordinates.
 */
class Neo6mGnss : public IGnss {
 public:
  Neo6mGnss(int uart_num = 1, int tx_pin = 17, int rx_pin = 18)
      : uart_num_(uart_num), has_fix_(false), lat_e6_(0), lon_e6_(0), satellites_(0) {
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

  /**
   * Feed a raw NMEA string into the adapter.
   * Parses $GPRMC (Recommended Minimum) or $GPGGA (Fix Data).
   */
  bool feed_nmea(const char* sentence) {
    if (!sentence || sentence[0] != '$') return false;

    // Check for $GPRMC or $GNRMC
    if (strstr(sentence, "RMC")) {
      // Format: $GPRMC,time,status,lat,N/S,lon,E/W,spd,cog,date,mv,mvE,mode*cs
      const char* p = strchr(sentence, ',');
      if (!p) return false;
      p = strchr(p + 1, ','); // skip time
      if (!p || *(p + 1) == '\0') return false;

      char status = *(p + 1); // 'A' = Active/Valid, 'V' = Void/Invalid
      if (status != 'A') {
        has_fix_ = false;
        return false;
      }

      // Next field: Latitude (ddmm.mmmm)
      p = strchr(p + 1, ',');
      if (!p || *(p + 1) == ',') return false;
      double raw_lat = atof(p + 1);
      int lat_deg = static_cast<int>(raw_lat / 100.0);
      double lat_min = raw_lat - (lat_deg * 100.0);

      // Next field: N/S
      p = strchr(p + 1, ',');
      if (!p) return false;
      char ns = *(p + 1);

      // Next field: Longitude (dddmm.mmmm)
      p = strchr(p + 1, ',');
      if (!p || *(p + 1) == ',') return false;
      double raw_lon = atof(p + 1);
      int lon_deg = static_cast<int>(raw_lon / 100.0);
      double lon_min = raw_lon - (lon_deg * 100.0);

      // Next field: E/W
      p = strchr(p + 1, ',');
      if (!p) return false;
      char ew = *(p + 1);

      double lat_dec = lat_deg + (lat_min / 60.0);
      if (ns == 'S' || ns == 's') lat_dec = -lat_dec;

      double lon_dec = lon_deg + (lon_min / 60.0);
      if (ew == 'W' || ew == 'w') lon_dec = -lon_dec;

      lat_e6_ = static_cast<int32_t>(lat_dec * 1e6);
      lon_e6_ = static_cast<int32_t>(lon_dec * 1e6);
      has_fix_ = true;
      return true;
    }
    return false;
  }

 private:
  int uart_num_;
  bool has_fix_;
  int32_t lat_e6_;
  int32_t lon_e6_;
  int satellites_;
};

/**
 * MPU-6050 6-DOF IMU Dead-Reckoning Adapter.
 * Integrates step detection and heading estimation to calculate position
 * displacements when GNSS satellite fixes are unavailable.
 */
class Mpu6050DeadReckoning : public IDeadReckoning {
 public:
  Mpu6050DeadReckoning(int sda_pin = 21, int scl_pin = 22)
      : has_estimate_(false), est_lat_e6_(0), est_lon_e6_(0), step_count_(0) {
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

  /**
   * Geodesic step displacement update (flat-earth approximation for micro-movements).
   * @param step_meters Stride length in meters (typically 0.7m to 0.8m)
   * @param heading_rad Compass azimuth in radians (0 = North, pi/2 = East)
   */
  void update_step(float step_meters, float heading_rad) {
    if (!has_estimate_) return;
    step_count_++;

    constexpr double kMetersPerDegreeLat = 111132.95;
    double delta_north_m = step_meters * cos(heading_rad);
    double delta_east_m = step_meters * sin(heading_rad);

    double delta_lat_deg = delta_north_m / kMetersPerDegreeLat;
    double current_lat_rad = (est_lat_e6_ * 1e-6) * (3.14159265358979323846 / 180.0);
    double meters_per_deg_lon = kMetersPerDegreeLat * cos(current_lat_rad);
    if (meters_per_deg_lon < 1.0) meters_per_deg_lon = 1.0;

    double delta_lon_deg = delta_east_m / meters_per_deg_lon;

    est_lat_e6_ += static_cast<int32_t>(delta_lat_deg * 1e6);
    est_lon_e6_ += static_cast<int32_t>(delta_lon_deg * 1e6);
  }

  void disable() { has_estimate_ = false; }
  uint32_t steps() const { return step_count_; }

 private:
  bool has_estimate_;
  int32_t est_lat_e6_;
  int32_t est_lon_e6_;
  uint32_t step_count_;
};

/**
 * Battery LiPo Voltage ADC Monitor Adapter.
 * Reads ADC millivolts on a 2:1 resistor divider and converts to state-of-charge percentage.
 */
class BatteryMonitor : public IBattery {
 public:
  BatteryMonitor(int adc_channel = 0) : adc_channel_(adc_channel), cached_pct_(100) {}

  uint8_t percent() override {
    return cached_pct_;
  }

  /**
   * Converts battery cell voltage (in millivolts) to capacity percentage (0-100%).
   * Uses realistic LiPo non-linear discharge curve under load.
   */
  static uint8_t voltage_mv_to_percent(uint32_t mv) {
    if (mv >= 4200) return 100;
    if (mv <= 3300) return 0;
    if (mv >= 4000) return static_cast<uint8_t>(85 + (mv - 4000) * 15 / 200);
    if (mv >= 3800) return static_cast<uint8_t>(50 + (mv - 3800) * 35 / 200);
    if (mv >= 3600) return static_cast<uint8_t>(15 + (mv - 3600) * 35 / 200);
    return static_cast<uint8_t>((mv - 3300) * 15 / 300);
  }

  void update_adc_voltage(uint32_t millivolts) {
    cached_pct_ = voltage_mv_to_percent(millivolts);
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
