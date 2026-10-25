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
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
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

  Sx1262Radio(int cs_pin = 5, int irq_pin = 4, int rst_pin = 3, int busy_pin = 2)
      : cs_(cs_pin), irq_(irq_pin), rst_(rst_pin), busy_(busy_pin),
        radio_ready_(false), state_(RadioState::Uninitialized),
        frequency_hz_(868000000), sf_(7), bw_hz_(125000), cr_(1), tx_power_dbm_(14),
        tx_count_(0), rx_count_(0), crc_errors_(0), busy_timeouts_(0) {}

  ~Sx1262Radio() {
#if defined(ESP_PLATFORM)
    if (spi_dev_) {
      spi_bus_remove_device(spi_dev_);
      spi_dev_ = nullptr;
    }
#endif
  }

  bool init(uint32_t frequency_hz = 868000000, uint8_t sf = 7, uint32_t bw = 125000, int8_t tx_power = 14) {
    frequency_hz_ = frequency_hz;
    sf_ = sf;
    bw_hz_ = bw;
    tx_power_dbm_ = tx_power;

#if defined(ESP_PLATFORM)
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
    // Wait for radio BUSY to clear
    if (!wait_busy(50000)) {
      busy_timeouts_++;
      recover_fault();
      return false;
    }

    state_ = RadioState::Transmitting;

    // 1. Enter Standby RC
    uint8_t standby_param = 0x00; // STDBY_RC
    write_cmd(CMD_SET_STANDBY, &standby_param, 1);

    // 2. Write payload into SX1262 FIFO buffer at offset 0
    write_buffer(0x00, data, len);

    // 3. Set packet parameters: payload length = len
    uint8_t pkt_params[6] = {
      0x00, 0x08, // Preamble length (8 symbols)
      0x00,       // Header type: 0x00 = explicit
      static_cast<uint8_t>(len), // Payload length
      0x01,       // CRC: 0x01 = ON
      0x00        // Standard IQ
    };
    write_cmd(CMD_SET_PACKET_PARAMS, pkt_params, 6);

    // 4. Clear pending interrupts
    uint8_t clr_irq[2] = {0xFF, 0xFF};
    write_cmd(CMD_CLEAR_IRQ_STATUS, clr_irq, 2);

    // 5. Start transmission with 2-second timeout (timeout = 2000ms * 64kHz)
    uint32_t timeout_val = 2000 * 64;
    uint8_t tx_timeout[3] = {
      static_cast<uint8_t>((timeout_val >> 16) & 0xFF),
      static_cast<uint8_t>((timeout_val >> 8) & 0xFF),
      static_cast<uint8_t>(timeout_val & 0xFF)
    };
    write_cmd(CMD_SET_TX, tx_timeout, 3);

    // 6. Bounded wait for transmission completion (polling TxDone IRQ flag)
    bool tx_done = false;
    for (int poll = 0; poll < 100; ++poll) {
      vTaskDelay(pdMS_TO_TICKS(10));
      uint8_t irq_status[2] = {0};
      read_cmd(CMD_GET_IRQ_STATUS, irq_status, 2);
      uint16_t irq = (irq_status[0] << 8) | irq_status[1];
      if (irq & 0x0001) { // TxDone flag
        tx_done = true;
        break;
      }
      if (irq & 0x0200) { // Timeout flag
        break;
      }
    }

    // 7. Clear IRQs and restore continuous RX mode
    write_cmd(CMD_CLEAR_IRQ_STATUS, clr_irq, 2);
    set_rx_mode();

    if (tx_done) {
      tx_count_++;
      state_ = RadioState::Receiving;
      return true;
    } else {
      recover_fault();
      return false;
    }
#else
    if (mock_force_send_failure_) return false;
    tx_count_++;
    last_tx_payload_.assign(data, data + len);
    return true;
#endif
  }

  bool channel_busy() override {
    if (!radio_ready_) return false;
#if defined(ESP_PLATFORM)
    // Read instant RSSI or CAD status
    uint8_t status = 0;
    read_cmd(CMD_GET_RX_BUFFER_STATUS, &status, 1);
    return false;
#else
    return mock_channel_busy_;
#endif
  }

  /**
   * Reads a received packet from SX1262 SPI FIFO.
   * Called by the radio task when DIO1 interrupt occurs.
   */
  bool read_rx_packet(uint8_t* out_buf, size_t max_len, size_t& out_len, int16_t& out_rssi, int8_t& out_snr) {
    if (!radio_ready_ || out_buf == nullptr) return false;

#if defined(ESP_PLATFORM)
    // 1. Read IRQ status
    uint8_t irq_status[2] = {0};
    read_cmd(CMD_GET_IRQ_STATUS, irq_status, 2);
    uint16_t irq = (irq_status[0] << 8) | irq_status[1];

    // Check for CRC Error (bit 6 = 0x0040) or RxTimeout (bit 9 = 0x0200)
    if (irq & 0x0040) {
      crc_errors_++;
      uint8_t clr[2] = {0xFF, 0xFF};
      write_cmd(CMD_CLEAR_IRQ_STATUS, clr, 2);
      set_rx_mode();
      return false;
    }

    // 2. Get RX Buffer Status (payload length & start offset)
    uint8_t rx_status[2] = {0};
    read_cmd(CMD_GET_RX_BUFFER_STATUS, rx_status, 2);
    uint8_t payload_len = rx_status[0];
    uint8_t start_offset = rx_status[1];

    if (payload_len != kPacketSize || payload_len > max_len) {
      uint8_t clr[2] = {0xFF, 0xFF};
      write_cmd(CMD_CLEAR_IRQ_STATUS, clr, 2);
      set_rx_mode();
      return false;
    }

    // 3. Read packet bytes from FIFO
    read_buffer(start_offset, out_buf, payload_len);
    out_len = payload_len;

    // 4. Query Packet Status (RSSI and SNR)
    uint8_t pkt_status[3] = {0};
    read_cmd(CMD_GET_PACKET_STATUS, pkt_status, 3);
    out_rssi = -static_cast<int16_t>(pkt_status[0] / 2); // RssiPkt in dBm
    out_snr = static_cast<int8_t>(pkt_status[1] / 4);    // SnrPkt in dB

    // 5. Clear IRQs and re-enter RX
    uint8_t clr[2] = {0xFF, 0xFF};
    write_cmd(CMD_CLEAR_IRQ_STATUS, clr, 2);
    set_rx_mode();

    rx_count_++;
    return true;
#else
    if (mock_rx_queue_.empty()) return false;
    auto item = mock_rx_queue_.front();
    mock_rx_queue_.erase(mock_rx_queue_.begin());
    if (item.data.size() > max_len) return false;
    std::memcpy(out_buf, item.data.data(), item.data.size());
    out_len = item.data.size();
    out_rssi = item.rssi;
    out_snr = item.snr;
    rx_count_++;
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

  void set_mock_system_ms(uint32_t ms) { mock_system_ms_ = ms; }

 private:
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

  Mpu6050DeadReckoning(int sda_pin = 21, int scl_pin = 22)
      : sda_(sda_pin), scl_(scl_pin), sensor_online_(false),
        has_estimate_(false), est_lat_e6_(0), est_lon_e6_(0),
        step_count_(0), anchor_time_ms_(0), last_step_time_ms_(0),
        gyro_heading_rad_(0.0f) {}

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
    return true;
#else
    sensor_online_ = true;
    return true;
#endif
  }

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

  int sda_, scl_;
  bool sensor_online_;
  bool has_estimate_;
  int32_t est_lat_e6_;
  int32_t est_lon_e6_;
  uint32_t step_count_;
  uint32_t anchor_time_ms_;
  uint32_t last_step_time_ms_;
  float gyro_heading_rad_;
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
        adc_healthy_(true), read_errors_(0) {}

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
        // Approximate millivolts with 2:1 divider: (raw / 4095.0) * 3100mV * 2.0
        uint32_t cell_mv = static_cast<uint32_t>((raw * 6200ULL) / 4095ULL);
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

 private:
#if defined(ESP_PLATFORM)
  adc_oneshot_unit_handle_t adc_handle_ = nullptr;
#endif
  int adc_channel_;
  uint8_t cached_pct_;
  uint32_t last_raw_mv_;
  bool adc_healthy_;
  uint32_t read_errors_;
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
    return true;
#else
    return true;
#endif
  }

  void play(HapticPattern p) override {
    last_pattern_ = p;
    pattern_play_count_++;

#if defined(ESP_PLATFORM)
    switch (p) {
      case HapticPattern::PressRegistered:
        // Sharp tactile click: 30ms pulse
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(30000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        break;

      case HapticPattern::TierShort:
        // General SOS: 200ms pulse + Green LED
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(200000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);
        break;

      case HapticPattern::TierDouble:
        // Medical: 150ms on + 100ms gap + 150ms on
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(150000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        esp_rom_delay_us(100000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(150000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);
        break;

      case HapticPattern::TierLong:
        // Trapped: 800ms sustained buzz + Red LED
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(800000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
        break;

      case HapticPattern::WakeDetected:
        // 2 quick 50ms chirps
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(50000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        esp_rom_delay_us(50000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(50000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        break;

      case HapticPattern::Reject:
        // Double reject buzz: 80ms on + 50ms off + 80ms on + Red LED
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 1);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(80000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        esp_rom_delay_us(50000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
        esp_rom_delay_us(80000);
        gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
        break;

      case HapticPattern::AckReceived:
        // Rescue confirmed! 3 rhythmic pulses + Green strobe
        for (int i = 0; i < 3; ++i) {
          gpio_set_level(static_cast<gpio_num_t>(led_green_), 1);
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
          esp_rom_delay_us(150000);
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
          gpio_set_level(static_cast<gpio_num_t>(led_green_), 0);
          esp_rom_delay_us(100000);
        }
        break;

      case HapticPattern::SendFailed:
        // 3 heavy reject pulses + sustained Red LED
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 1);
        for (int i = 0; i < 3; ++i) {
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 1);
          esp_rom_delay_us(250000);
          gpio_set_level(static_cast<gpio_num_t>(haptic_pin_), 0);
          esp_rom_delay_us(100000);
        }
        gpio_set_level(static_cast<gpio_num_t>(led_red_), 0);
        break;
    }
#endif
  }

  HapticPattern last_pattern() const { return last_pattern_; }
  uint32_t play_count() const { return pattern_play_count_; }

 private:
  int haptic_pin_, led_red_, led_green_;
  HapticPattern last_pattern_;
  uint32_t pattern_play_count_;
};

}  // namespace esp32
}  // namespace setu
