// Project Setu - ESP32-S3 Hardware Driver Adapters
// Maps physical peripherals on the ESP32-S3 wristband to the portable setu::Hal interfaces.
// Provides complete hardware drivers for ESP-IDF target compilation and rich host simulation/test hooks.
#pragma once

#include <cstdint>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <vector>
#include <string>
#include <mutex>
#include <functional>
#include "setu/hal.hpp"
#include "setu/packet.hpp"

#if defined(ESP_PLATFORM)
#include "esp_timer.h"
#include "esp_random.h"
#include "esp_log.h"
#include "esp_err.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "driver/i2c.h"
#include "driver/uart.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "freertos/queue.h"
#endif

namespace setu {
namespace esp32 {

/**
 * ESP32 Monotonic & UNIX Disciplined Clock.
 * Wraps esp_timer_get_time() (microseconds since boot).
 */
class Esp32Clock : public IClock {
 public:
  Esp32Clock() : unix_offset_s_(1700000000u), is_disciplined_(false) {}

  uint32_t now_ms() const override {
#if defined(ESP_PLATFORM)
    return static_cast<uint32_t>(esp_timer_get_time() / 1000ULL);
#else
    return mock_now_ms_;
#endif
  }

  uint32_t unix_s() const override {
    return unix_offset_s_ + (now_ms() / 1000u);
  }

  void discipline_unix_time(uint32_t gnss_epoch_s) {
    if (gnss_epoch_s > 1600000000u) {
      unix_offset_s_ = gnss_epoch_s - (now_ms() / 1000u);
      is_disciplined_ = true;
    }
  }

  bool is_disciplined() const { return is_disciplined_; }

  void set_mock_time_ms(uint32_t ms) { mock_now_ms_ = ms; }
  void advance_mock_time_ms(uint32_t delta_ms) { mock_now_ms_ += delta_ms; }

 private:
  uint32_t unix_offset_s_;
  bool is_disciplined_;
  uint32_t mock_now_ms_ = 1000u;
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
    return static_cast<uint32_t>(std::rand()) % max_exclusive;
#endif
  }
};

/**
 * Semtech SX1262 LoRa SPI Radio Adapter.
 * Integrates SPI master bus, GPIO reset, BUSY pin polling, DIO1 IRQ,
 * RF frequency, PA power, modulation parameters, and half-duplex TX/RX.
 */
class Sx1262Radio : public IRadio {
 public:
  enum class RadioState : uint8_t {
    Uninitialized,
    Standby,
    Transmitting,
    Receiving,
    Fault
  };

  // Semtech SX1262 OpCodes
  static constexpr uint8_t CMD_SET_STANDBY = 0x80;
  static constexpr uint8_t CMD_SET_PACKET_TYPE = 0x8A;
  static constexpr uint8_t CMD_SET_RF_FREQUENCY = 0x86;
  static constexpr uint8_t CMD_SET_PA_CONFIG = 0x95;
  static constexpr uint8_t CMD_SET_TX_PARAMS = 0x8E;
  static constexpr uint8_t CMD_SET_BUFFER_BASE_ADDRESS = 0x8F;
  static constexpr uint8_t CMD_SET_MODULATION_PARAMS = 0x8B;
  static constexpr uint8_t CMD_SET_PACKET_PARAMS = 0x8C;
  static constexpr uint8_t CMD_SET_DIO_IRQ_PARAMS = 0x08;
  static constexpr uint8_t CMD_GET_IRQ_STATUS = 0x12;
  static constexpr uint8_t CMD_CLEAR_IRQ_STATUS = 0x02;
  static constexpr uint8_t CMD_SET_TX = 0x83;
  static constexpr uint8_t CMD_SET_RX = 0x82;
  static constexpr uint8_t CMD_WRITE_BUFFER = 0x0E;
  static constexpr uint8_t CMD_READ_BUFFER = 0x1E;
  static constexpr uint8_t CMD_GET_RX_BUFFER_STATUS = 0x13;
  static constexpr uint8_t CMD_GET_PACKET_STATUS = 0x14;
  static constexpr uint8_t CMD_SET_DIO2_AS_RF_SWITCH_CTRL = 0x9D;
  static constexpr uint8_t CMD_SET_REGULATOR_MODE = 0x96;

  // Semtech SX1262 IRQ Status Masks (16-bit register)
  static constexpr uint16_t IRQ_NONE               = 0x0000;
  static constexpr uint16_t IRQ_TX_DONE            = 0x0001;
  static constexpr uint16_t IRQ_RX_DONE            = 0x0002;
  static constexpr uint16_t IRQ_PREAMBLE_DETECTED  = 0x0004;
  static constexpr uint16_t IRQ_SYNCWORD_VALID     = 0x0008;
  static constexpr uint16_t IRQ_HEADER_VALID       = 0x0010;
  static constexpr uint16_t IRQ_HEADER_ERR         = 0x0020;
  static constexpr uint16_t IRQ_CRC_ERR            = 0x0040;
  static constexpr uint16_t IRQ_CAD_DONE           = 0x0080;
  static constexpr uint16_t IRQ_CAD_DETECTED       = 0x0100;
  static constexpr uint16_t IRQ_TIMEOUT            = 0x0200;
  static constexpr uint16_t IRQ_ALL                = 0xFFFF;

  struct IrqResult {
    uint16_t raw_irqs = 0;
    bool tx_done = false;
    bool rx_done = false;
    bool timeout = false;
    bool crc_error = false;
    size_t rx_len = 0;
    int16_t rx_rssi = 0;
    int8_t rx_snr = 0;
  };

  Sx1262Radio(int cs_pin = 5, int irq_pin = 4, int rst_pin = 3, int busy_pin = 2)
      : cs_(cs_pin), irq_(irq_pin), rst_(rst_pin), busy_(busy_pin),
        radio_ready_(false), state_(RadioState::Uninitialized),
        frequency_hz_(868000000), sf_(7), bw_hz_(125000), cr_(1), tx_power_dbm_(14),
        tx_count_(0), rx_count_(0), crc_errors_(0), busy_timeouts_(0),
        tx_completed_(false), tx_timeout_(false) {
#if defined(ESP_PLATFORM)
    spi_mutex_ = xSemaphoreCreateMutex();
    tx_done_sem_ = xSemaphoreCreateBinary();
#endif
  }

  ~Sx1262Radio() {
#if defined(ESP_PLATFORM)
    if (spi_dev_) {
      spi_bus_remove_device(spi_dev_);
      spi_dev_ = nullptr;
    }
    if (spi_mutex_) {
      vSemaphoreDelete(spi_mutex_);
      spi_mutex_ = nullptr;
    }
    if (tx_done_sem_) {
      vSemaphoreDelete(tx_done_sem_);
      tx_done_sem_ = nullptr;
    }
#endif
  }

  bool init(uint32_t frequency_hz = 868000000, uint8_t sf = 7, uint32_t bw = 125000, int8_t tx_power = 14) {
    frequency_hz_ = frequency_hz;
    sf_ = sf;
    bw_hz_ = bw;
    tx_power_dbm_ = tx_power;

#if defined(ESP_PLATFORM)
    if (!spi_mutex_) spi_mutex_ = xSemaphoreCreateMutex();
    if (!tx_done_sem_) tx_done_sem_ = xSemaphoreCreateBinary();

    // 1. Configure GPIO pins (RST as output, BUSY and DIO1 as input)
    gpio_config_t io_conf = {};
    io_conf.pin_bit_mask = (1ULL << rst_);
    io_conf.mode = GPIO_MODE_OUTPUT;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    gpio_config(&io_conf);

    io_conf.pin_bit_mask = (1ULL << busy_) | (1ULL << irq_);
    io_conf.mode = GPIO_MODE_INPUT;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    gpio_config(&io_conf);

    // 2. Initialize SPI bus (SPI2_HOST / FSPI: MOSI=7, MISO=8, SCK=6)
    spi_bus_config_t buscfg = {};
    buscfg.mosi_io_num = 7;
    buscfg.miso_io_num = 8;
    buscfg.sclk_io_num = 6;
    buscfg.quadwp_io_num = -1;
    buscfg.quadhd_io_num = -1;
    buscfg.max_transfer_sz = 256;

    esp_err_t ret = spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) { // ESP_ERR_INVALID_STATE if already initialized
      state_ = RadioState::Fault;
      return false;
    }

    // 3. Add SX1262 SPI device interface
    spi_device_interface_config_t devcfg = {};
    devcfg.clock_speed_hz = 8 * 1000 * 1000; // 8 MHz
    devcfg.mode = 0;                         // SPI Mode 0 (CPOL=0, CPHA=0)
    devcfg.spics_io_num = cs_;
    devcfg.queue_size = 4;

    ret = spi_bus_add_device(SPI2_HOST, &devcfg, &spi_dev_);
    if (ret != ESP_OK) {
      state_ = RadioState::Fault;
      return false;
    }

    // 4. Hardware reset sequence
    if (!reset_hardware()) {
      state_ = RadioState::Fault;
      return false;
    }

    // 5. Configure SX1262 registers
    if (!configure_radio_parameters()) {
      state_ = RadioState::Fault;
      return false;
    }

    // 6. Enter continuous receive mode
    if (!set_rx_mode()) {
      state_ = RadioState::Fault;
      return false;
    }

    radio_ready_ = true;
    state_ = RadioState::Receiving;
    return true;
#else
    if (mock_force_init_failure_) {
      state_ = RadioState::Fault;
      radio_ready_ = false;
      return false;
    }
    radio_ready_ = true;
    state_ = RadioState::Receiving;
    return true;
#endif
  }

  bool send(const uint8_t* data, size_t len) override {
    if (len > kPacketSize || len == 0 || data == nullptr) return false;
    if (!radio_ready_) return false;

#if defined(ESP_PLATFORM)
    if (!spi_mutex_) return false;
    if (xSemaphoreTake(spi_mutex_, pdMS_TO_TICKS(500)) != pdTRUE) {
      return false; // Radio lock acquisition timeout
    }

    if (state_ == RadioState::Transmitting) {
      xSemaphoreGive(spi_mutex_);
      return false; // Hardware busy transmitting
    }

    if (!wait_busy(50000)) {
      busy_timeouts_++;
      recover_fault();
      xSemaphoreGive(spi_mutex_);
      return false;
    }

    state_ = RadioState::Transmitting;
    tx_completed_ = false;
    tx_timeout_ = false;
    if (tx_done_sem_) {
      xSemaphoreTake(tx_done_sem_, 0); // Drain any stale token
    }

    // 1. Enter Standby RC
    uint8_t standby_param = 0x00; // STDBY_RC
    write_cmd(CMD_SET_STANDBY, &standby_param, 1);

    // 2. Write payload into FIFO at offset 0
    write_buffer(0x00, data, len);

    // 3. Set packet parameters
    uint8_t pkt_params[6] = {
      0x00, 0x08, // Preamble (8 symbols)
      0x00,       // Explicit header
      static_cast<uint8_t>(len),
      0x01,       // CRC ON
      0x00        // Standard IQ
    };
    write_cmd(CMD_SET_PACKET_PARAMS, pkt_params, 6);

    // 4. Clear any stale TxDone or Timeout flags
    uint8_t clr_irq[2] = {0x02, 0x01}; // TxDone (0x01) | Timeout (0x0200)
    write_cmd(CMD_CLEAR_IRQ_STATUS, clr_irq, 2);

    // 5. Start transmission with 2-second timeout (timeout = 2000ms * 64kHz)
    uint32_t timeout_val = 2000 * 64;
    uint8_t tx_timeout[3] = {
      static_cast<uint8_t>((timeout_val >> 16) & 0xFF),
      static_cast<uint8_t>((timeout_val >> 8) & 0xFF),
      static_cast<uint8_t>(timeout_val & 0xFF)
    };
    write_cmd(CMD_SET_TX, tx_timeout, 3);

    // 6. Release SPI mutex so radio_rx_task can safely query IRQ status when DIO1 fires
    xSemaphoreGive(spi_mutex_);

    // 7. Bounded wait on tx_done_sem_ (unblocked by process_irqs on Core 0)
    bool wait_ok = (xSemaphoreTake(tx_done_sem_, pdMS_TO_TICKS(1500)) == pdTRUE);

    // 8. Re-acquire SPI mutex to finalize transceiver state
    if (xSemaphoreTake(spi_mutex_, pdMS_TO_TICKS(500)) != pdTRUE) {
      return false;
    }

    if (wait_ok && tx_completed_ && !tx_timeout_) {
      tx_count_++;
      state_ = RadioState::Receiving;
      set_rx_mode();
      xSemaphoreGive(spi_mutex_);
      return true;
    } else {
      recover_fault();
      xSemaphoreGive(spi_mutex_);
      return false;
    }
#else
    std::lock_guard<std::mutex> lock(mock_mutex_);
    if (mock_force_send_failure_) return false;
    tx_count_++;
    tx_completed_ = true;
    state_ = RadioState::Receiving;
    last_tx_payload_.assign(data, data + len);
    mock_pending_irqs_ |= IRQ_TX_DONE;
    return true;
#endif
  }

  bool channel_busy() override {
    if (!radio_ready_) return false;
#if defined(ESP_PLATFORM)
    if (!spi_mutex_) return false;
    if (xSemaphoreTake(spi_mutex_, pdMS_TO_TICKS(10)) != pdTRUE) return true;
    uint8_t status = 0;
    read_cmd(CMD_GET_RX_BUFFER_STATUS, &status, 1);
    xSemaphoreGive(spi_mutex_);
    return false;
#else
    return mock_channel_busy_;
#endif
  }

  /**
   * Authoritative, thread-safe SX1262 IRQ dispatcher.
   * Inspects pending IRQs, clears ONLY the handled flags (selective clearing),
   * extracts RX payloads, and handles TX completion/timeout without clearing unconsumed flags.
   */
  bool process_irqs(IrqResult& result, uint8_t* rx_out_buf = nullptr, size_t max_rx_len = 0) {
    if (!radio_ready_) return false;

#if defined(ESP_PLATFORM)
    if (!spi_mutex_) return false;
    if (xSemaphoreTake(spi_mutex_, pdMS_TO_TICKS(100)) != pdTRUE) return false;

    uint8_t irq_status[2] = {0};
    if (!read_cmd(CMD_GET_IRQ_STATUS, irq_status, 2)) {
      xSemaphoreGive(spi_mutex_);
      return false;
    }
    uint16_t irq = (static_cast<uint16_t>(irq_status[0]) << 8) | irq_status[1];
    result.raw_irqs = irq;
    if (irq == 0) {
      xSemaphoreGive(spi_mutex_);
      return false;
    }

    uint16_t handled_mask = 0;

    // 1. Inspect TX completion
    if (irq & IRQ_TX_DONE) {
      result.tx_done = true;
      tx_completed_ = true;
      handled_mask |= IRQ_TX_DONE;
      if (tx_done_sem_) {
        xSemaphoreGive(tx_done_sem_);
      }
    }

    // 2. Inspect Timeout
    if (irq & IRQ_TIMEOUT) {
      result.timeout = true;
      tx_timeout_ = true;
      handled_mask |= IRQ_TIMEOUT;
      if (tx_done_sem_) {
        xSemaphoreGive(tx_done_sem_);
      }
    }

    // 3. Inspect RX completion
    if (irq & IRQ_RX_DONE) {
      handled_mask |= IRQ_RX_DONE;
      if (irq & IRQ_CRC_ERR) {
        result.crc_error = true;
        crc_errors_++;
        handled_mask |= IRQ_CRC_ERR;
      } else {
        uint8_t rx_status[2] = {0};
        read_cmd(CMD_GET_RX_BUFFER_STATUS, rx_status, 2);
        uint8_t payload_len = rx_status[0];
        uint8_t start_offset = rx_status[1];

        if (payload_len == kPacketSize && rx_out_buf != nullptr && max_rx_len >= kPacketSize) {
          read_buffer(start_offset, rx_out_buf, payload_len);
          result.rx_len = payload_len;

          uint8_t pkt_status[3] = {0};
          read_cmd(CMD_GET_PACKET_STATUS, pkt_status, 3);
          result.rx_rssi = -static_cast<int16_t>(pkt_status[0] / 2);
          result.rx_snr = static_cast<int8_t>(pkt_status[1] / 4);
          result.rx_done = true;
          rx_count_++;
        }
      }
      set_rx_mode();
    }

    // 4. Handle informational flags (preamble, syncword, header, CAD)
    uint16_t info_mask = irq & (IRQ_PREAMBLE_DETECTED | IRQ_SYNCWORD_VALID | IRQ_HEADER_VALID | IRQ_HEADER_ERR | IRQ_CAD_DONE | IRQ_CAD_DETECTED);
    if (info_mask != 0) {
      handled_mask |= info_mask;
    }

    // 5. Selectively clear ONLY handled flags
    if (handled_mask != 0) {
      uint8_t clr[2] = {
        static_cast<uint8_t>((handled_mask >> 8) & 0xFF),
        static_cast<uint8_t>(handled_mask & 0xFF)
      };
      write_cmd(CMD_CLEAR_IRQ_STATUS, clr, 2);
    }

    xSemaphoreGive(spi_mutex_);
    return true;
#else
    std::lock_guard<std::mutex> lock(mock_mutex_);
    result.raw_irqs = mock_pending_irqs_;
    if (mock_pending_irqs_ == 0) return false;

    uint16_t handled_mask = 0;

    if (mock_pending_irqs_ & IRQ_TX_DONE) {
      result.tx_done = true;
      tx_completed_ = true;
      handled_mask |= IRQ_TX_DONE;
    }
    if (mock_pending_irqs_ & IRQ_TIMEOUT) {
      result.timeout = true;
      tx_timeout_ = true;
      handled_mask |= IRQ_TIMEOUT;
    }
    if (mock_pending_irqs_ & IRQ_RX_DONE) {
      handled_mask |= IRQ_RX_DONE;
      if (mock_pending_irqs_ & IRQ_CRC_ERR) {
        result.crc_error = true;
        crc_errors_++;
        handled_mask |= IRQ_CRC_ERR;
      } else if (!mock_rx_queue_.empty()) {
        auto item = mock_rx_queue_.front();
        mock_rx_queue_.erase(mock_rx_queue_.begin());
        if (rx_out_buf && max_rx_len >= item.data.size()) {
          std::memcpy(rx_out_buf, item.data.data(), item.data.size());
          result.rx_len = item.data.size();
          result.rx_rssi = item.rssi;
          result.rx_snr = item.snr;
          result.rx_done = true;
          rx_count_++;
        }
      }
    }
    uint16_t info_mask = mock_pending_irqs_ & (IRQ_PREAMBLE_DETECTED | IRQ_SYNCWORD_VALID | IRQ_HEADER_VALID | IRQ_HEADER_ERR | IRQ_CAD_DONE | IRQ_CAD_DETECTED);
    if (info_mask != 0) {
      handled_mask |= info_mask;
    }

    mock_pending_irqs_ &= ~handled_mask;
    return true;
#endif
  }

  /**
   * Reads a received packet from SX1262 SPI FIFO.
   * Backward-compatible wrapper delegating to process_irqs with selective IRQ clearing.
   */
  bool read_rx_packet(uint8_t* out_buf, size_t max_len, size_t& out_len, int16_t& out_rssi, int8_t& out_snr) {
    if (!radio_ready_ || out_buf == nullptr) return false;
    IrqResult res;
    if (process_irqs(res, out_buf, max_len) && res.rx_done) {
      out_len = res.rx_len;
      out_rssi = res.rx_rssi;
      out_snr = res.rx_snr;
      return true;
    }
    return false;
  }

  uint16_t get_irq_status() {
#if defined(ESP_PLATFORM)
    if (!spi_mutex_) return 0;
    if (xSemaphoreTake(spi_mutex_, pdMS_TO_TICKS(100)) != pdTRUE) return 0;
    uint8_t irq_status[2] = {0};
    read_cmd(CMD_GET_IRQ_STATUS, irq_status, 2);
    xSemaphoreGive(spi_mutex_);
    return (static_cast<uint16_t>(irq_status[0]) << 8) | irq_status[1];
#else
    std::lock_guard<std::mutex> lock(mock_mutex_);
    return mock_pending_irqs_;
#endif
  }

  bool clear_irq_status(uint16_t irq_mask) {
#if defined(ESP_PLATFORM)
    if (!spi_mutex_) return false;
    if (xSemaphoreTake(spi_mutex_, pdMS_TO_TICKS(100)) != pdTRUE) return false;
    uint8_t clr[2] = {
      static_cast<uint8_t>((irq_mask >> 8) & 0xFF),
      static_cast<uint8_t>(irq_mask & 0xFF)
    };
    bool ok = write_cmd(CMD_CLEAR_IRQ_STATUS, clr, 2);
    xSemaphoreGive(spi_mutex_);
    return ok;
#else
    std::lock_guard<std::mutex> lock(mock_mutex_);
    mock_pending_irqs_ &= ~irq_mask;
    return true;
#endif
  }

  bool is_ready() const { return radio_ready_; }
  RadioState state() const { return state_; }
  uint32_t tx_count() const { return tx_count_; }
  uint32_t rx_count() const { return rx_count_; }
  uint32_t crc_errors() const { return crc_errors_; }
  uint32_t busy_timeouts() const { return busy_timeouts_; }

  // Host testing / simulation methods
  void set_mock_force_init_failure(bool fail) { mock_force_init_failure_ = fail; }
  void set_mock_force_send_failure(bool fail) { mock_force_send_failure_ = fail; }
  void set_mock_channel_busy(bool busy) { mock_channel_busy_ = busy; }
  void inject_mock_rx_packet(const uint8_t* data, size_t len, int16_t rssi = -80, int8_t snr = 7) {
    MockRxItem item;
    item.data.assign(data, data + len);
    item.rssi = rssi;
    item.snr = snr;
    mock_rx_queue_.push_back(item);
#if !defined(ESP_PLATFORM)
    mock_pending_irqs_ |= IRQ_RX_DONE;
#endif
  }

  void inject_mock_irq(uint16_t flags) {
#if !defined(ESP_PLATFORM)
    std::lock_guard<std::mutex> lock(mock_mutex_);
    mock_pending_irqs_ |= flags;
#else
    (void)flags;
#endif
  }

  uint16_t mock_pending_irqs() const {
#if !defined(ESP_PLATFORM)
    std::lock_guard<std::mutex> lock(mock_mutex_);
    return mock_pending_irqs_;
#else
    return 0;
#endif
  }

 private:
#if defined(ESP_PLATFORM)
  spi_device_handle_t spi_dev_ = nullptr;

  bool wait_busy(uint32_t timeout_us = 100000) {
    uint32_t elapsed = 0;
    while (gpio_get_level(static_cast<gpio_num_t>(busy_)) == 1) {
      esp_rom_delay_us(10);
      elapsed += 10;
      if (elapsed >= timeout_us) return false;
    }
    return true;
  }

  bool reset_hardware() {
    gpio_set_level(static_cast<gpio_num_t>(rst_), 0);
    esp_rom_delay_us(150);
    gpio_set_level(static_cast<gpio_num_t>(rst_), 1);
    esp_rom_delay_us(1000);
    return wait_busy(100000);
  }

  bool write_cmd(uint8_t cmd, const uint8_t* params, size_t len) {
    if (!wait_busy(50000)) return false;
    uint8_t tx_buf[16] = {cmd};
    if (len > 0 && params) {
      std::memcpy(tx_buf + 1, params, (std::min)(len, sizeof(tx_buf) - 1));
    }
    spi_transaction_t t = {};
    t.length = (1 + len) * 8;
    t.tx_buffer = tx_buf;
    return spi_device_transmit(spi_dev_, &t) == ESP_OK;
  }

  bool read_cmd(uint8_t cmd, uint8_t* out, size_t len) {
    if (!wait_busy(50000)) return false;
    uint8_t tx_buf[16] = {cmd, 0x00}; // cmd + dummy byte
    uint8_t rx_buf[16] = {0};
    size_t total_len = 2 + len;
    spi_transaction_t t = {};
    t.length = total_len * 8;
    t.tx_buffer = tx_buf;
    t.rx_buffer = rx_buf;
    if (spi_device_transmit(spi_dev_, &t) != ESP_OK) return false;
    if (out && len > 0) {
      std::memcpy(out, rx_buf + 2, len);
    }
    return true;
  }

  bool write_buffer(uint8_t offset, const uint8_t* data, size_t len) {
    if (!wait_busy(50000)) return false;
    uint8_t tx_buf[256];
    tx_buf[0] = CMD_WRITE_BUFFER;
    tx_buf[1] = offset;
    std::memcpy(tx_buf + 2, data, (std::min)(len, sizeof(tx_buf) - 2));
    spi_transaction_t t = {};
    t.length = (2 + len) * 8;
    t.tx_buffer = tx_buf;
    return spi_device_transmit(spi_dev_, &t) == ESP_OK;
  }

  bool read_buffer(uint8_t offset, uint8_t* out, size_t len) {
    if (!wait_busy(50000)) return false;
    uint8_t tx_buf[256] = {CMD_READ_BUFFER, offset, 0x00}; // cmd + offset + dummy
    uint8_t rx_buf[256] = {0};
    spi_transaction_t t = {};
    t.length = (3 + len) * 8;
    t.tx_buffer = tx_buf;
    t.rx_buffer = rx_buf;
    if (spi_device_transmit(spi_dev_, &t) != ESP_OK) return false;
    if (out && len > 0) {
      std::memcpy(out, rx_buf + 3, len);
    }
    return true;
  }

  bool configure_radio_parameters() {
    // 1. Regulator mode: DC-DC + LDO
    uint8_t reg_mode = 0x01;
    write_cmd(CMD_SET_REGULATOR_MODE, &reg_mode, 1);

    // 2. Set Packet Type to LoRa (0x01)
    uint8_t pkt_type = 0x01;
    write_cmd(CMD_SET_PACKET_TYPE, &pkt_type, 1);

    // 3. Set RF Frequency: freq_hz / (32000000 / 2^25)
    uint32_t freq_reg = static_cast<uint32_t>((static_cast<uint64_t>(frequency_hz_) << 25) / 32000000ULL);
    uint8_t freq_bytes[4] = {
      static_cast<uint8_t>((freq_reg >> 24) & 0xFF),
      static_cast<uint8_t>((freq_reg >> 16) & 0xFF),
      static_cast<uint8_t>((freq_reg >> 8) & 0xFF),
      static_cast<uint8_t>(freq_reg & 0xFF)
    };
    write_cmd(CMD_SET_RF_FREQUENCY, freq_bytes, 4);

    // 4. Set PA Config for +22 dBm High Power SX1262
    uint8_t pa_config[4] = {0x04, 0x07, 0x00, 0x01}; // paDutyCycle=0x04, hpMax=0x07, deviceSel=0x00, paLut=0x01
    write_cmd(CMD_SET_PA_CONFIG, pa_config, 4);

    // 5. Set TX parameters (Power and ramp time)
    uint8_t tx_params[2] = {static_cast<uint8_t>(tx_power_dbm_), 0x02}; // 0x02 = 40us ramp
    write_cmd(CMD_SET_TX_PARAMS, tx_params, 2);

    // 6. Set Modulation Params (SF, BW, CR, LowDataRateOptimize)
    uint8_t bw_param = 0x04; // 125 kHz
    if (bw_hz_ >= 250000) bw_param = 0x05;
    else if (bw_hz_ >= 500000) bw_param = 0x06;

    uint8_t ldro = (sf_ >= 11 && bw_hz_ <= 125000) ? 0x01 : 0x00;
    uint8_t mod_params[4] = {sf_, bw_param, cr_, ldro};
    write_cmd(CMD_SET_MODULATION_PARAMS, mod_params, 4);

    // 7. Configure DIO2 as RF Switch control
    uint8_t dio2_rf = 0x01;
    write_cmd(CMD_SET_DIO2_AS_RF_SWITCH_CTRL, &dio2_rf, 1);

    // 8. Configure DIO1 IRQ mask for TxDone (0x0001) and RxDone (0x0002)
    uint8_t irq_mask[8] = {
      0x02, 0x03, // IRQ Mask: TxDone (1) | RxDone (2) | Timeout (0x0200)
      0x02, 0x03, // DIO1 Mask: TxDone | RxDone | Timeout
      0x00, 0x00, // DIO2 Mask
      0x00, 0x00  // DIO3 Mask
    };
    write_cmd(CMD_SET_DIO_IRQ_PARAMS, irq_mask, 8);

    return true;
  }

  bool set_rx_mode() {
    uint8_t rx_timeout[3] = {0xFF, 0xFF, 0xFF}; // Continuous RX mode
    return write_cmd(CMD_SET_RX, rx_timeout, 3);
  }

  void recover_fault() {
    state_ = RadioState::Fault;
    reset_hardware();
    configure_radio_parameters();
    set_rx_mode();
    state_ = RadioState::Receiving;
  }
#endif

  int cs_, irq_, rst_, busy_;
  bool radio_ready_;
  RadioState state_;
  uint32_t frequency_hz_;
  uint8_t sf_;
  uint32_t bw_hz_;
  uint8_t cr_;
  int8_t tx_power_dbm_;

  uint32_t tx_count_;
  uint32_t rx_count_;
  uint32_t crc_errors_;
  uint32_t busy_timeouts_;

  bool tx_completed_;
  bool tx_timeout_;

#if defined(ESP_PLATFORM)
  SemaphoreHandle_t spi_mutex_ = nullptr;
  SemaphoreHandle_t tx_done_sem_ = nullptr;
#else
  mutable std::mutex mock_mutex_;
  uint16_t mock_pending_irqs_ = 0;
#endif

  // Mock simulation state
  bool mock_force_init_failure_ = false;
  bool mock_force_send_failure_ = false;
  bool mock_channel_busy_ = false;
  std::vector<uint8_t> last_tx_payload_;
  struct MockRxItem {
    std::vector<uint8_t> data;
    int16_t rssi;
    int8_t snr;
  };
  std::vector<MockRxItem> mock_rx_queue_;
};

/**
 * Streaming NMEA sentence framer with persistent accumulation buffer.
 * Defends against chunk fragmentation, multiple sentences per read,
 * leading serial noise/garbage, missing terminators, and buffer overflows.
 */
class NmeaFramer {
 public:
  static constexpr size_t kMaxSentenceLen = 128;
  using SentenceCallback = std::function<void(const char* sentence)>;

  NmeaFramer()
      : in_sentence_(false), pos_(0), overflowed_(false),
        dropped_bytes_(0), sentences_framed_(0) {
    buf_[0] = '\0';
  }

  void push_byte(char c, const SentenceCallback& cb) {
    if (!in_sentence_) {
      if (c == '$') {
        in_sentence_ = true;
        buf_[0] = '$';
        pos_ = 1;
        overflowed_ = false;
      } else {
        dropped_bytes_++;
      }
      return;
    }

    // If an unexpected new '$' arrives while already in a sentence, reset
    if (c == '$') {
      dropped_bytes_ += pos_;
      buf_[0] = '$';
      pos_ = 1;
      overflowed_ = false;
      return;
    }

    if (c == '\r' || c == '\n') {
      if (in_sentence_ && !overflowed_ && pos_ >= 4) {
        buf_[pos_] = '\0';
        sentences_framed_++;
        cb(buf_);
      }
      in_sentence_ = false;
      pos_ = 0;
      overflowed_ = false;
      return;
    }

    if (pos_ < kMaxSentenceLen - 1) {
      buf_[pos_++] = c;
    } else {
      overflowed_ = true;
      dropped_bytes_++;
    }
  }

  void push_bytes(const char* data, size_t len, const SentenceCallback& cb) {
    if (!data) return;
    for (size_t i = 0; i < len; ++i) {
      push_byte(data[i], cb);
    }
  }

  void reset() {
    in_sentence_ = false;
    pos_ = 0;
    overflowed_ = false;
  }

  size_t sentences_framed() const { return sentences_framed_; }
  size_t dropped_bytes() const { return dropped_bytes_; }
  bool is_in_sentence() const { return in_sentence_; }

 private:
  bool in_sentence_;
  size_t pos_;
  bool overflowed_;
  size_t dropped_bytes_;
  size_t sentences_framed_;
  char buf_[kMaxSentenceLen];
};

/**
 * NEO-6M / ATGM336H GPS UART Adapter.
 * Continuous NMEA sentence processor ($GPRMC, $GNRMC, $GPGGA, $GNGGA)
 * with strict XOR checksum validation, hemisphere conversion,
 * stale fix timeout auto-expiration, and clock discipline.
 */
class Neo6mGnss : public IGnss {
 public:
  static constexpr uint32_t kStaleTimeoutMs = 10000; // 10-second fix validity window

  Neo6mGnss(int uart_num = 1, int tx_pin = 17, int rx_pin = 18)
      : uart_num_(uart_num), tx_pin_(tx_pin), rx_pin_(rx_pin),
        has_fix_(false), lat_e6_(0), lon_e6_(0), altitude_m_(0),
        satellites_(0), last_fix_ms_(0), sentences_parsed_(0), checksum_errors_(0) {}

  bool init_uart() {
#if defined(ESP_PLATFORM)
    uart_config_t uart_config = {};
    uart_config.baud_rate = 9600;
    uart_config.data_bits = UART_DATA_8_BITS;
    uart_config.parity = UART_PARITY_DISABLE;
    uart_config.stop_bits = UART_STOP_BITS_1;
    uart_config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    uart_config.source_clk = UART_SCLK_DEFAULT;

    esp_err_t ret = uart_param_config(static_cast<uart_port_t>(uart_num_), &uart_config);
    if (ret != ESP_OK) return false;

    ret = uart_set_pin(static_cast<uart_port_t>(uart_num_), tx_pin_, rx_pin_, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    if (ret != ESP_OK) return false;

    ret = uart_driver_install(static_cast<uart_port_t>(uart_num_), 512, 0, 0, nullptr, 0);
    return ret == ESP_OK;
#else
    return true;
#endif
  }

  bool get_fix(int32_t& lat_e6, int32_t& lon_e6) override {
    // Auto-expire stale fix if no valid sentence received within timeout
    if (!has_fix_) return false;
    uint32_t now = get_system_ms();
    if (now >= last_fix_ms_ && (now - last_fix_ms_) > kStaleTimeoutMs) {
      has_fix_ = false;
      return false;
    }
    lat_e6 = lat_e6_;
    lon_e6 = lon_e6_;
    return true;
  }

  void update_fix_data(bool valid_3d, int32_t lat, int32_t lon) {
    has_fix_ = valid_3d;
    lat_e6_ = lat;
    lon_e6_ = lon;
    if (valid_3d) last_fix_ms_ = get_system_ms();
  }

  /**
   * Feed a complete raw NMEA sentence.
   * Performs XOR checksum verification and updates coordinates and UTC clock.
   */
  bool feed_nmea(const char* sentence, Esp32Clock* clock_discipline = nullptr) {
    if (!sentence || sentence[0] != '$') return false;

    // 1. Verify NMEA XOR Checksum: *HH at end
    const char* star = strchr(sentence, '*');
    if (star) {
      uint8_t calculated_cs = 0;
      for (const char* c = sentence + 1; c < star; ++c) {
        calculated_cs ^= static_cast<uint8_t>(*c);
      }
      char* endptr = nullptr;
      unsigned long expected_cs = strtoul(star + 1, &endptr, 16);
      if (calculated_cs != static_cast<uint8_t>(expected_cs)) {
        checksum_errors_++;
        return false;
      }
    }

    // 2. Parse RMC Sentence (Recommended Minimum Navigation Information)
    if (strstr(sentence, "RMC")) {
      return parse_rmc(sentence, clock_discipline);
    }

    // 3. Parse GGA Sentence (Global Positioning System Fix Data)
    if (strstr(sentence, "GGA")) {
      return parse_gga(sentence);
    }

    return false;
  }

  bool has_valid_fix() const { return has_fix_; }
  uint32_t satellites() const { return satellites_; }
  uint32_t sentences_parsed() const { return sentences_parsed_; }
  uint32_t checksum_errors() const { return checksum_errors_; }
  uint32_t last_fix_age_ms() const {
    uint32_t now = get_system_ms();
    return now >= last_fix_ms_ ? (now - last_fix_ms_) : 0;
  }

  NmeaFramer& framer() { return framer_; }

  /**
   * Streams a chunk of raw UART bytes through the persistent framer.
   * Feeds each cleanly framed sentence to feed_nmea().
   */
  bool feed_uart_chunk(const char* data, size_t len, Esp32Clock* clock_discipline = nullptr) {
    bool parsed_any = false;
    framer_.push_bytes(data, len, [&](const char* sentence) {
      if (feed_nmea(sentence, clock_discipline)) {
        parsed_any = true;
      }
    });
    return parsed_any;
  }

  void set_mock_system_ms(uint32_t ms) { mock_system_ms_ = ms; }

 private:
  NmeaFramer framer_;
  uint32_t get_system_ms() const {
#if defined(ESP_PLATFORM)
    return static_cast<uint32_t>(esp_timer_get_time() / 1000ULL);
#else
    return mock_system_ms_;
#endif
  }

  bool parse_rmc(const char* sentence, Esp32Clock* clock_discipline) {
    // $GPRMC,hhmmss.sss,A,llll.ll,a,yyyyy.yy,a,x.x,x.x,ddmmyy,x.x,a*hh
    const char* p = strchr(sentence, ',');
    if (!p) return false;

    // Time field (hhmmss.sss)
    p++;
    char time_str[10] = {0};
    const char* next = strchr(p, ',');
    if (!next) return false;
    size_t time_len = (std::min)(static_cast<size_t>(next - p), sizeof(time_str) - 1);
    std::memcpy(time_str, p, time_len);

    // Status field: 'A' = Valid, 'V' = Void
    p = next + 1;
    if (*p != 'A') {
      has_fix_ = false;
      return false;
    }

    // Latitude field (ddmm.mmmm)
    p = strchr(p, ',');
    if (!p || *(p + 1) == ',') return false;
    double raw_lat = atof(p + 1);
    int lat_deg = static_cast<int>(raw_lat / 100.0);
    double lat_min = raw_lat - (lat_deg * 100.0);

    // N/S field
    p = strchr(p + 1, ',');
    if (!p) return false;
    char ns = *(p + 1);

    // Longitude field (dddmm.mmmm)
    p = strchr(p + 1, ',');
    if (!p || *(p + 1) == ',') return false;
    double raw_lon = atof(p + 1);
    int lon_deg = static_cast<int>(raw_lon / 100.0);
    double lon_min = raw_lon - (lon_deg * 100.0);

    // E/W field
    p = strchr(p + 1, ',');
    if (!p) return false;
    char ew = *(p + 1);

    // Skip speed and COG to date field (ddmmyy)
    p = strchr(p + 1, ','); // skip to speed
    if (p) p = strchr(p + 1, ','); // skip to cog
    if (p) p = strchr(p + 1, ','); // skip to date
    if (p && *(p + 1) != ',' && *(p + 1) != '*') {
      char date_str[8] = {0};
      next = strchr(p + 1, ',');
      if (!next) next = strchr(p + 1, '*');
      if (next) {
        size_t date_len = (std::min)(static_cast<size_t>(next - (p + 1)), sizeof(date_str) - 1);
        std::memcpy(date_str, p + 1, date_len);
        if (clock_discipline && date_len == 6 && time_len >= 6) {
          uint32_t epoch = parse_utc_epoch(date_str, time_str);
          if (epoch > 1700000000u) {
            clock_discipline->discipline_unix_time(epoch);
          }
        }
      }
    }

    double lat_dec = lat_deg + (lat_min / 60.0);
    if (ns == 'S' || ns == 's') lat_dec = -lat_dec;

    double lon_dec = lon_deg + (lon_min / 60.0);
    if (ew == 'W' || ew == 'w') lon_dec = -lon_dec;

    // Bounds check
    if (lat_dec < -90.0 || lat_dec > 90.0 || lon_dec < -180.0 || lon_dec > 180.0) {
      return false;
    }

    lat_e6_ = static_cast<int32_t>(lat_dec * 1e6);
    lon_e6_ = static_cast<int32_t>(lon_dec * 1e6);
    has_fix_ = true;
    last_fix_ms_ = get_system_ms();
    sentences_parsed_++;
    return true;
  }

  bool parse_gga(const char* sentence) {
    // $GPGGA,hhmmss.sss,llll.ll,a,yyyyy.yy,a,x,xx,x.x,x.x,M,x.x,M,x.x,xxxx*hh
    const char* p = strchr(sentence, ',');
    if (!p) return false;
    p = strchr(p + 1, ','); // skip time
    if (!p) return false;
    p = strchr(p + 1, ','); // skip lat
    if (!p) return false;
    p = strchr(p + 1, ','); // skip ns
    if (!p) return false;
    p = strchr(p + 1, ','); // skip lon
    if (!p) return false;
    p = strchr(p + 1, ','); // skip ew
    if (!p || *(p + 1) == ',') return false;

    // Quality indicator: 0 = Fix not available, 1 = GPS SPS, 2 = Differential GPS
    int quality = atoi(p + 1);
    if (quality == 0) {
      has_fix_ = false;
      return false;
    }

    // Number of satellites
    p = strchr(p + 1, ',');
    if (p && *(p + 1) != ',') {
      satellites_ = static_cast<uint32_t>(atoi(p + 1));
    }

    sentences_parsed_++;
    return true;
  }

  static uint32_t parse_utc_epoch(const char* ddmmyy, const char* hhmmss) {
    if (std::strlen(ddmmyy) < 6 || std::strlen(hhmmss) < 6) return 0;
    int day = (ddmmyy[0] - '0') * 10 + (ddmmyy[1] - '0');
    int mon = (ddmmyy[2] - '0') * 10 + (ddmmyy[3] - '0');
    int year = 2000 + (ddmmyy[4] - '0') * 10 + (ddmmyy[5] - '0');
    int hour = (hhmmss[0] - '0') * 10 + (hhmmss[1] - '0');
    int min = (hhmmss[2] - '0') * 10 + (hhmmss[3] - '0');
    int sec = (hhmmss[4] - '0') * 10 + (hhmmss[5] - '0');

    // Simple Days Since Unix Epoch (1970-01-01) calculation
    int y = year - (mon <= 2 ? 1 : 0);
    int m = mon <= 2 ? mon + 12 : mon;
    int era = (y >= 0 ? y : y - 399) / 400;
    unsigned yoe = static_cast<unsigned>(y - era * 400);
    unsigned doy = (153 * (m - 3) + 2) / 5 + day - 1;
    unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    int days = era * 146097 + static_cast<int>(doe) - 719468;

    return static_cast<uint32_t>(days * 86400 + hour * 3600 + min * 60 + sec);
  }

  int uart_num_, tx_pin_, rx_pin_;
  bool has_fix_;
  int32_t lat_e6_;
  int32_t lon_e6_;
  int32_t altitude_m_;
  uint32_t satellites_;
  uint32_t last_fix_ms_;
  uint32_t sentences_parsed_;
  uint32_t checksum_errors_;
  uint32_t mock_system_ms_ = 0;
};

/**
 * InvenSense MPU-6050 6-DOF IMU Dead-Reckoning Adapter.
 * Integrates peak acceleration step detection and gyro Z-axis integration.
 * Enforces explicit confidence decay: estimate expires after 5 minutes
 * or 500 steps without GNSS anchoring to prevent hazardous drift.
 */
class Mpu6050DeadReckoning : public IDeadReckoning {
 public:
  static constexpr uint32_t kMaxDrAgeMs = 300000; // 5 minutes max dead-reckoning window
  static constexpr uint32_t kMaxStepsWithoutGnss = 500;

  static constexpr uint8_t MPU6050_ADDR = 0x68;
  static constexpr uint8_t REG_WHO_AM_I = 0x75;
  static constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
  static constexpr uint8_t REG_ACCEL_CONFIG = 0x1C;
  static constexpr uint8_t REG_GYRO_CONFIG = 0x1B;
  static constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B;

  // Scale factors for +/- 4g and +/- 500 deg/s configured ranges
  static constexpr float kAccelScale = 9.80665f / 8192.0f; // m/s^2 per LSB
  static constexpr float kGyroScale = (3.14159265358979323846f / 180.0f) / 65.5f; // rad/s per LSB

  // Step detection thresholds and timing window
  static constexpr float kStepPeakThresh = 11.8f;   // ~1.20g
  static constexpr float kStepTroughThresh = 8.6f;  // ~0.88g
  static constexpr uint32_t kMinStepCadenceMs = 250;  // Max 4 steps/sec
  static constexpr uint32_t kMaxStepCadenceMs = 2000; // Min 0.5 steps/sec

  enum class StepState {
    WaitingForPeak,
    WaitingForTrough
  };

  Mpu6050DeadReckoning(int sda_pin = 21, int scl_pin = 22)
      : sda_(sda_pin), scl_(scl_pin), sensor_online_(false),
        has_estimate_(false), est_lat_e6_(0), est_lon_e6_(0),
        step_count_(0), anchor_time_ms_(0), last_step_time_ms_(0),
        gyro_heading_rad_(0.0f), gz_bias_(0.0f),
        step_state_(StepState::WaitingForPeak), peak_time_ms_(0) {}

  bool init_i2c() {
#if defined(ESP_PLATFORM)
    i2c_config_t conf = {};
    conf.mode = I2C_MODE_MASTER;
    conf.sda_io_num = static_cast<gpio_num_t>(sda_);
    conf.sda_pullup_en = GPIO_PULLUP_ENABLE;
    conf.scl_io_num = static_cast<gpio_num_t>(scl_);
    conf.scl_pullup_en = GPIO_PULLUP_ENABLE;
    conf.master.clk_speed = 400000;

    esp_err_t ret = i2c_param_config(I2C_NUM_0, &conf);
    if (ret != ESP_OK) return false;

    ret = i2c_driver_install(I2C_NUM_0, conf.mode, 0, 0, 0);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) return false;

    // Verify WHO_AM_I register (0x75 expects 0x68)
    uint8_t who_am_i = 0;
    if (!read_reg(REG_WHO_AM_I, who_am_i) || who_am_i != 0x68) {
      sensor_online_ = false;
      return false;
    }

    // Wake device from sleep
    write_reg(REG_PWR_MGMT_1, 0x00);
    // Accel config: +/- 4g (0x08)
    write_reg(REG_ACCEL_CONFIG, 0x08);
    // Gyro config: +/- 500 deg/s (0x08)
    write_reg(REG_GYRO_CONFIG, 0x08);

    sensor_online_ = true;
    calibrate_gyro();
    return true;
#else
    sensor_online_ = true;
    return true;
#endif
  }

  /**
   * Processes a raw IMU sample, performs unit conversion, bias compensation,
   * heading integration, and cadence-validated step detection.
   */
  void sample(int16_t ax, int16_t ay, int16_t az, int16_t gx, int16_t gy, int16_t gz, uint32_t dt_ms) {
    (void)gx; (void)gy;
    // 1. Angular velocity around z-axis (heading change)
    float omega_z = (static_cast<float>(gz) - gz_bias_) * kGyroScale;
    gyro_heading_rad_ += omega_z * (static_cast<float>(dt_ms) / 1000.0f);
    // Wrap to [-PI, +PI]
    while (gyro_heading_rad_ > 3.14159265f) gyro_heading_rad_ -= 6.2831853f;
    while (gyro_heading_rad_ < -3.14159265f) gyro_heading_rad_ += 6.2831853f;

    // 2. Acceleration vector magnitude in m/s^2
    float ax_m = static_cast<float>(ax) * kAccelScale;
    float ay_m = static_cast<float>(ay) * kAccelScale;
    float az_m = static_cast<float>(az) * kAccelScale;
    float a_mag = std::sqrt(ax_m * ax_m + ay_m * ay_m + az_m * az_m);

    // 3. Cadence-validated Step Detector state machine
    uint32_t now = get_system_ms();
    if (step_state_ == StepState::WaitingForPeak) {
      if (a_mag >= kStepPeakThresh) {
        step_state_ = StepState::WaitingForTrough;
        peak_time_ms_ = now;
      }
    } else if (step_state_ == StepState::WaitingForTrough) {
      if (now >= peak_time_ms_ && (now - peak_time_ms_ > 1000)) {
        step_state_ = StepState::WaitingForPeak; // Trough timeout
      } else if (a_mag <= kStepTroughThresh) {
        uint32_t cadence = (now >= last_step_time_ms_) ? (now - last_step_time_ms_) : 0;
        if (cadence >= kMinStepCadenceMs && cadence <= kMaxStepCadenceMs) {
          update_step(0.72f, gyro_heading_rad_);
          last_step_time_ms_ = now;
        } else if (cadence > kMaxStepCadenceMs) {
          // First step after standing still
          update_step(0.72f, gyro_heading_rad_);
          last_step_time_ms_ = now;
        }
        step_state_ = StepState::WaitingForPeak;
      }
    }
  }

  /**
   * Explicit GNSS Anchoring Policy:
   * - Un-anchored estimator: accepts first valid GNSS fix immediately.
   * - Already anchored: re-anchors ONLY if satellites >= 5 AND (time > 30s OR distance > 15m)
   *   to prevent GPS multipath noise from continually thrashing relative dead-reckoning trajectory.
   */
  bool anchor_gnss_filtered(int32_t lat_e6, int32_t lon_e6, uint32_t satellites) {
    if (!has_estimate_) {
      anchor_last_gnss(lat_e6, lon_e6);
      return true;
    }
    if (satellites < 5) return false;

    uint32_t now = get_system_ms();
    bool time_elapsed = (now >= anchor_time_ms_) && ((now - anchor_time_ms_) >= 30000);

    constexpr double kMetersPerDegreeLat = 111132.95;
    double d_lat = ((lat_e6 - est_lat_e6_) * 1e-6) * kMetersPerDegreeLat;
    double lat_rad = (est_lat_e6_ * 1e-6) * (3.14159265358979323846 / 180.0);
    double d_lon = ((lon_e6 - est_lon_e6_) * 1e-6) * kMetersPerDegreeLat * cos(lat_rad);
    double dist_m = std::sqrt(d_lat * d_lat + d_lon * d_lon);

    if (time_elapsed || dist_m >= 15.0) {
      anchor_last_gnss(lat_e6, lon_e6);
      return true;
    }
    return false;
  }

  void set_gyro_bias(float gz_bias) { gz_bias_ = gz_bias; }
  float gyro_bias() const { return gz_bias_; }
  float heading_rad() const { return gyro_heading_rad_; }

  bool estimate(int32_t& lat_e6, int32_t& lon_e6) override {
    if (!has_estimate_) return false;

    // Confidence decay check: estimate expires after 5 minutes or 500 steps
    uint32_t now = get_system_ms();
    if (now >= anchor_time_ms_ && (now - anchor_time_ms_) > kMaxDrAgeMs) {
      has_estimate_ = false;
      return false;
    }
    if (step_count_ > kMaxStepsWithoutGnss) {
      has_estimate_ = false;
      return false;
    }

    lat_e6 = est_lat_e6_;
    lon_e6 = est_lon_e6_;
    return true;
  }

  void anchor_last_gnss(int32_t lat_e6, int32_t lon_e6) {
    est_lat_e6_ = lat_e6;
    est_lon_e6_ = lon_e6;
    has_estimate_ = true;
    step_count_ = 0;
    anchor_time_ms_ = get_system_ms();
  }

  /**
   * Geodesic step displacement update (flat-earth approximation for micro-movements).
   */
  void update_step(float step_meters, float heading_rad) {
    if (!has_estimate_) return;
    step_count_++;
    last_step_time_ms_ = get_system_ms();

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
  bool is_online() const { return sensor_online_; }
  bool has_valid_estimate() const { return has_estimate_; }
  uint32_t steps() const { return step_count_; }
  void set_mock_system_ms(uint32_t ms) { mock_system_ms_ = ms; }

 private:
  uint32_t get_system_ms() const {
#if defined(ESP_PLATFORM)
    return static_cast<uint32_t>(esp_timer_get_time() / 1000ULL);
#else
    return mock_system_ms_;
#endif
  }

#if defined(ESP_PLATFORM)
  bool write_reg(uint8_t reg, uint8_t val) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (MPU6050_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg, true);
    i2c_master_write_byte(cmd, val, true);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_NUM_0, cmd, pdMS_TO_TICKS(50));
    i2c_cmd_link_delete(cmd);
    return ret == ESP_OK;
  }

  bool read_reg(uint8_t reg, uint8_t& val) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (MPU6050_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (MPU6050_ADDR << 1) | I2C_MASTER_READ, true);
    i2c_master_read_byte(cmd, &val, I2C_MASTER_NACK);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_NUM_0, cmd, pdMS_TO_TICKS(50));
    i2c_cmd_link_delete(cmd);
    return ret == ESP_OK;
  }
#endif

  bool read_sensors(int16_t& ax, int16_t& ay, int16_t& az, int16_t& gx, int16_t& gy, int16_t& gz) {
#if defined(ESP_PLATFORM)
    if (!sensor_online_) return false;
    uint8_t data[14] = {0};
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (MPU6050_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, REG_ACCEL_XOUT_H, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (MPU6050_ADDR << 1) | I2C_MASTER_READ, true);
    i2c_master_read(cmd, data, 13, I2C_MASTER_ACK);
    i2c_master_read_byte(cmd, data + 13, I2C_MASTER_NACK);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_NUM_0, cmd, pdMS_TO_TICKS(20));
    i2c_cmd_link_delete(cmd);
    if (ret != ESP_OK) return false;

    ax = static_cast<int16_t>((data[0] << 8) | data[1]);
    ay = static_cast<int16_t>((data[2] << 8) | data[3]);
    az = static_cast<int16_t>((data[4] << 8) | data[5]);
    gx = static_cast<int16_t>((data[8] << 8) | data[9]);
    gy = static_cast<int16_t>((data[10] << 8) | data[11]);
    gz = static_cast<int16_t>((data[12] << 8) | data[13]);
    return true;
#else
    (void)ax; (void)ay; (void)az; (void)gx; (void)gy; (void)gz;
    return false;
#endif
  }

  void poll_hardware(uint32_t dt_ms) {
    int16_t ax = 0, ay = 0, az = 0, gx = 0, gy = 0, gz = 0;
    if (read_sensors(ax, ay, az, gx, gy, gz)) {
      sample(ax, ay, az, gx, gy, gz, dt_ms);
    }
  }

  void calibrate_gyro(size_t samples = 30) {
#if defined(ESP_PLATFORM)
    float sum_gz = 0.0f;
    size_t count = 0;
    for (size_t i = 0; i < samples; ++i) {
      int16_t ax, ay, az, gx, gy, gz;
      if (read_sensors(ax, ay, az, gx, gy, gz)) {
        sum_gz += static_cast<float>(gz);
        count++;
      }
      vTaskDelay(pdMS_TO_TICKS(10));
    }
    if (count > 0) {
      gz_bias_ = sum_gz / static_cast<float>(count);
    }
#else
    (void)samples;
#endif
  }

  int sda_, scl_;
  bool sensor_online_;
  bool has_estimate_;
  int32_t est_lat_e6_;
  int32_t est_lon_e6_;
  uint32_t step_count_;
  uint32_t anchor_time_ms_;
  uint32_t last_step_time_ms_;
  float gyro_heading_rad_;
  float gz_bias_;
  StepState step_state_;
  uint32_t peak_time_ms_;
  uint32_t mock_system_ms_ = 0;
};

/**
 * Battery LiPo Voltage ADC Monitor Adapter.
 * Measures battery cell voltage via 2:1 resistive divider on ESP32-S3 ADC1.
 * Uses realistic non-linear discharge curve and explicit read failure reporting.
 */
class BatteryMonitor : public IBattery {
 public:
  BatteryMonitor(int adc_channel = 0)
      : adc_channel_(adc_channel), cached_pct_(100), last_raw_mv_(4200),
        adc_healthy_(true), read_errors_(0), has_cali_(false) {}

  ~BatteryMonitor() {
#if defined(ESP_PLATFORM)
    if (cali_handle_) {
      adc_cali_delete_scheme_curve_fitting(cali_handle_);
      cali_handle_ = nullptr;
    }
    if (adc_handle_) {
      adc_oneshot_del_unit(adc_handle_);
      adc_handle_ = nullptr;
    }
#endif
  }

  bool init_adc() {
#if defined(ESP_PLATFORM)
    adc_oneshot_unit_init_cfg_t init_config = {};
    init_config.unit_id = ADC_UNIT_1;
    esp_err_t ret = adc_oneshot_new_unit(&init_config, &adc_handle_);
    if (ret != ESP_OK) {
      adc_healthy_ = false;
      return false;
    }

    adc_oneshot_chan_cfg_t config = {};
    config.bitwidth = ADC_BITWIDTH_DEFAULT;
    config.atten = ADC_ATTEN_DB_12; // 0 to ~3.1V range
    ret = adc_oneshot_config_channel(adc_handle_, static_cast<adc_channel_t>(adc_channel_), &config);
    adc_healthy_ = (ret == ESP_OK);

    // Attempt eFuse curve fitting calibration scheme
    adc_cali_curve_fitting_config_t cali_config = {};
    cali_config.unit_id = ADC_UNIT_1;
    cali_config.chan = static_cast<adc_channel_t>(adc_channel_);
    cali_config.atten = ADC_ATTEN_DB_12;
    cali_config.bitwidth = ADC_BITWIDTH_DEFAULT;
    esp_err_t cali_ret = adc_cali_create_scheme_curve_fitting(&cali_config, &cali_handle_);
    has_cali_ = (cali_ret == ESP_OK);
    return adc_healthy_;
#else
    return true;
#endif
  }

  uint8_t percent() override {
#if defined(ESP_PLATFORM)
    if (adc_handle_ && adc_healthy_) {
      int raw = 0;
      esp_err_t ret = adc_oneshot_read(adc_handle_, static_cast<adc_channel_t>(adc_channel_), &raw);
      if (ret == ESP_OK) {
        uint32_t cell_mv = 0;
        if (has_cali_ && cali_handle_) {
          int voltage_mv = 0;
          if (adc_cali_raw_to_voltage(cali_handle_, raw, &voltage_mv) == ESP_OK) {
            cell_mv = static_cast<uint32_t>(voltage_mv * 2); // 2:1 resistive divider
          } else {
            cell_mv = static_cast<uint32_t>((raw * 6200ULL) / 4095ULL);
          }
        } else {
          // Uncalibrated linear fallback
          cell_mv = static_cast<uint32_t>((raw * 6200ULL) / 4095ULL);
        }
        last_raw_mv_ = cell_mv;
        cached_pct_ = voltage_mv_to_percent(cell_mv);
      } else {
        read_errors_++;
      }
    }
#endif
    return cached_pct_;
  }

  static uint8_t voltage_mv_to_percent(uint32_t mv) {
    if (mv >= 4200) return 100;
    if (mv <= 3300) return 0;
    if (mv >= 4000) return static_cast<uint8_t>(85 + (mv - 4000) * 15 / 200);
    if (mv >= 3800) return static_cast<uint8_t>(50 + (mv - 3800) * 35 / 200);
    if (mv >= 3600) return static_cast<uint8_t>(15 + (mv - 3600) * 35 / 200);
    return static_cast<uint8_t>((mv - 3300) * 15 / 300);
  }

  void update_adc_voltage(uint32_t millivolts) {
    last_raw_mv_ = millivolts;
    cached_pct_ = voltage_mv_to_percent(millivolts);
  }

  void set_simulated_percent(uint8_t pct) { cached_pct_ = pct > 100 ? 100 : pct; }
  uint32_t raw_millivolts() const { return last_raw_mv_; }
  bool is_healthy() const { return adc_healthy_; }
  bool is_critical() const { return last_raw_mv_ <= 3350; }
  bool is_calibrated() const { return has_cali_; }

 private:
#if defined(ESP_PLATFORM)
  adc_oneshot_unit_handle_t adc_handle_ = nullptr;
  adc_cali_handle_t cali_handle_ = nullptr;
#endif
  int adc_channel_;
  uint8_t cached_pct_;
  uint32_t last_raw_mv_;
  bool adc_healthy_;
  uint32_t read_errors_;
  bool has_cali_;
};

/**
 * MOSFET-Driven ERM Haptic Motor & LED Driver.
 * Provides non-blocking tactical feedback patterns without stalling FreeRTOS tasks.
 */
class HapticLedDriver : public IHaptic {
 public:
  HapticLedDriver(int haptic_pin = 13, int led_red_pin = 14, int led_green_pin = 15)
      : haptic_pin_(haptic_pin), led_red_(led_red_pin), led_green_(led_green_pin),
        last_pattern_(HapticPattern::PressRegistered), pattern_play_count_(0) {}

  bool init_outputs() {
#if defined(ESP_PLATFORM)
    gpio_config_t io_conf = {};
    io_conf.pin_bit_mask = (1ULL << haptic_pin_) | (1ULL << led_red_) | (1ULL << led_green_);
    io_conf.mode = GPIO_MODE_OUTPUT;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
    esp_err_t ret = gpio_config(&io_conf);
    if (ret != ESP_OK) return false;

    gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
    gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
    gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);

    if (!haptic_queue_) {
      haptic_queue_ = xQueueCreate(8, sizeof(HapticPattern));
    }
    return haptic_queue_ != nullptr;
#else
    return true;
#endif
  }

  ~HapticLedDriver() {
#if defined(ESP_PLATFORM)
    if (haptic_queue_) {
      vQueueDelete(haptic_queue_);
      haptic_queue_ = nullptr;
    }
#endif
  }

  void play(HapticPattern p) override {
    last_pattern_ = p;
    pattern_play_count_++;

#if defined(ESP_PLATFORM)
    if (haptic_queue_) {
      // Non-blocking asynchronous push to haptic service queue
      xQueueSend(haptic_queue_, &p, 0);
    }
#endif
  }

  /**
   * Executes pattern steps asynchronously using FreeRTOS vTaskDelay.
   * Yields the CPU on Core 0 and never stalls the protocol core on Core 1.
   */
  void execute_pattern(HapticPattern p) {
#if defined(ESP_PLATFORM)
    switch (p) {
      case HapticPattern::PressRegistered:
        // Sharp tactile click: 30ms pulse
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(30));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        break;

      case HapticPattern::TierShort:
        // General SOS: 200ms pulse + Green LED
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(200));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);
        break;

      case HapticPattern::TierDouble:
        // Medical: 150ms on + 100ms gap + 150ms on
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(150));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        vTaskDelay(pdMS_TO_TICKS(100));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(150));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);
        break;

      case HapticPattern::TierLong:
        // Trapped: 800ms sustained buzz + Red LED
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(800));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
        break;

      case HapticPattern::WakeDetected:
        // 2 quick 50ms chirps
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(50));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        vTaskDelay(pdMS_TO_TICKS(50));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(50));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        break;

      case HapticPattern::Reject:
        // Double reject buzz: 80ms on + 50ms off + 80ms on + Red LED
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(80));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        vTaskDelay(pdMS_TO_TICKS(50));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        vTaskDelay(pdMS_TO_TICKS(80));
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
        break;

      case HapticPattern::AckReceived:
        // Rescue confirmed! 3 rhythmic pulses + Green strobe
        for (int i = 0; i < 3; ++i) {
          gpio_set_level(static_cast<gpio_num_t>(led_green_), 1);
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
          vTaskDelay(pdMS_TO_TICKS(150));
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
          gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);
          vTaskDelay(pdMS_TO_TICKS(100));
        }
        break;

      case HapticPattern::SendFailed:
        // 3 heavy reject pulses + sustained Red LED
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 1);
        for (int i = 0; i < 3; ++i) {
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
          vTaskDelay(pdMS_TO_TICKS(250));
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
          vTaskDelay(pdMS_TO_TICKS(100));
        }
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
        break;
    }
    // Return all output pins to safe low level
    gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
    gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
    gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);
#else
    (void)p;
#endif
  }

#if defined(ESP_PLATFORM)
  QueueHandle_t queue() const { return haptic_queue_; }
#endif

  HapticPattern last_pattern() const { return last_pattern_; }
  uint32_t play_count() const { return pattern_play_count_; }

 private:
#if defined(ESP_PLATFORM)
  QueueHandle_t haptic_queue_ = nullptr;
#endif
  int haptic_pin_, led_red_, led_green_;
  HapticPattern last_pattern_;
  uint32_t pattern_play_count_;
};

}  // namespace esp32
}  // namespace setu
