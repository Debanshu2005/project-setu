// Project Setu - Firmware-in-the-Loop (FITL) Virtual FreeRTOS Queue & Task Abstraction
// Accurately reproduces the FreeRTOS task, queue, and ISR architecture from firmware/main/app_main.cpp
// allowing the exact firmware state machines to execute on host simulation targets.
#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>
#include <deque>
#include <functional>
#include <memory>
#include <string>

#include "setu/node.hpp"
#include "setu/hal.hpp"
#include "setu/packet.hpp"
#include "esp32_adapters.hpp"

namespace setu {
namespace fitl {

// Matches ButtonEvent in firmware/main/app_main.cpp
struct ButtonEvent {
  uint32_t timestamp_ms;
  bool is_pressed;
};

// Matches RadioRxEvent in firmware/main/app_main.cpp
struct RadioRxEvent {
  uint8_t buffer[kPacketSize];
  size_t length;
  int16_t rssi;
  int8_t snr;
};

/**
 * Bounded deterministic FreeRTOS queue simulation.
 * Replicates xQueueSendFromISR and xQueueReceive behavior with bounded buffer.
 */
template <typename T, size_t Capacity>
class VirtualQueue {
 public:
  bool send_from_isr(const T& item) {
    if (items_.size() >= Capacity) {
      overflow_count_++;
      return false; // Queue full - drops event as FreeRTOS does
    }
    items_.push_back(item);
    peak_depth_ = std::max(peak_depth_, items_.size());
    return true;
  }

  bool receive(T& item) {
    if (items_.empty()) return false;
    item = items_.front();
    items_.pop_front();
    return true;
  }

  size_t size() const { return items_.size(); }
  size_t capacity() const { return Capacity; }
  size_t peak_depth() const { return peak_depth_; }
  uint32_t overflows() const { return overflow_count_; }
  uint32_t overflow_count() const { return overflow_count_; }
  void reset() { items_.clear(); overflow_count_ = 0; peak_depth_ = 0; }

 private:
  std::deque<T> items_;
  size_t peak_depth_ = 0;
  uint32_t overflow_count_ = 0;
};

/**
 * FirmwareNode: Isolated virtual device executing firmware logic.
 * Contains its own FreeRTOS queues, peripheral adapters, and setu::Node instance.
 */
class FirmwareNode {
 public:
  using RadioTxCallback = std::function<bool(uint16_t sender_id, const uint8_t* data, size_t len)>;
  using TraceCallback = std::function<void(uint16_t id, const char* ev, const char* extra)>;
  using AlertCallback = std::function<void(const Packet& p, uint32_t t)>;

  FirmwareNode(const NodeConfig& cfg, RadioTxCallback tx_cb, TraceCallback trace_cb = nullptr, AlertCallback alert_cb = nullptr)
      : cfg_(cfg), tx_callback_(std::move(tx_cb)), trace_callback_(std::move(trace_cb)), alert_callback_(std::move(alert_cb)) {
    init_hal();
  }

  // --- Hardware Interrupt Simulation (Dispatches into FreeRTOS queues) ---

  /**
   * Simulates GPIO Button Interrupt Service Routine.
   * Matches gpio_button_isr_handler in app_main.cpp: minimal work, sends to queue.
   */
  bool simulate_gpio_button_isr(uint32_t timestamp_ms, bool is_pressed) {
    if (!online_) return false;
    ButtonEvent evt{timestamp_ms, is_pressed};
    bool sent = button_queue_.send_from_isr(evt);
    if (trace_callback_) {
      char extra[64];
      std::snprintf(extra, sizeof(extra), ",\"edge\":%s,\"queue_depth\":%zu", is_pressed ? "1" : "0", button_queue_.size());
      trace_callback_(cfg_.node_id, "gpio_btn_isr", extra);
    }
    return sent;
  }

  /**
   * Simulates SX1262 Radio DIO1 Interrupt Service Routine.
   * When radio finishes decoding valid packet preamble and payload, pushes to radio queue.
   */
  bool simulate_radio_rx_isr(const uint8_t* data, size_t len, int16_t rssi, int8_t snr) {
    if (len > kPacketSize || !online_) return false;
    RadioRxEvent rx_evt;
    std::memcpy(rx_evt.buffer, data, len);
    rx_evt.length = len;
    rx_evt.rssi = rssi;
    rx_evt.snr = snr;

    bool sent = radio_rx_queue_.send_from_isr(rx_evt);
    if (trace_callback_) {
      char extra[64];
      std::snprintf(extra, sizeof(extra), ",\"rssi\":%d,\"snr\":%d,\"queue_depth\":%zu", rssi, snr, radio_rx_queue_.size());
      trace_callback_(cfg_.node_id, "radio_dio1_isr", extra);
    }
    return sent;
  }

  // --- Virtual FreeRTOS Task Loops ---

  /**
   * Runs one tick of the core protocol task (100 Hz / 10ms in app_main.cpp).
   * Drains button queue, updates protocol core, and checks telemetry.
   */
  void tick_core_task(uint32_t now_ms) {
    if (!online_) return;
    sim_time_ms_ = now_ms;

    // 1. Drain pending button events from ISR queue
    ButtonEvent btn_evt;
    while (button_queue_.receive(btn_evt)) {
      node_->on_button_edge(btn_evt.is_pressed);
    }

    // 2. Advance authoritative protocol tick
    node_->tick();
  }

  /**
   * Runs radio task: drains radio RX queue and processes received packets.
   */
  void tick_radio_task() {
    if (!online_) return;

    RadioRxEvent rx_evt;
    while (radio_rx_queue_.receive(rx_evt)) {
      if (rx_evt.length == kPacketSize) {
        node_->on_radio_rx(rx_evt.buffer, rx_evt.length);
      }
    }
  }

  /**
   * Combined task tick for deterministic simulation stepping.
   */
  void tick(uint32_t now_ms) {
    tick_radio_task();
    tick_core_task(now_ms);
  }

  // --- Virtual Hardware Fault Injection ---

  void set_online(bool on) {
    online_ = on;
    if (!on) {
      button_queue_.reset();
      radio_rx_queue_.reset();
    }
  }

  bool is_online() const { return online_; }
  void set_battery(uint8_t pct) { battery_adapter_.set_simulated_percent(pct); }
  uint8_t battery() { return battery_adapter_.percent(); }
  void set_gnss(bool has_fix, int32_t lat_e6 = 0, int32_t lon_e6 = 0) {
    gnss_adapter_.update_fix_data(has_fix, lat_e6, lon_e6);
  }
  void set_dr(bool has_dr, int32_t lat_e6 = 0, int32_t lon_e6 = 0) {
    if (has_dr) dr_adapter_.anchor_last_gnss(lat_e6, lon_e6);
    else dr_adapter_.disable();
  }

  void wake_word() { if (online_) node_->on_wake_word(); }
  void voice_command(uint8_t contact, Hazard hz) { if (online_) node_->on_voice_command(contact, hz); }

  // --- Introspection & Diagnostics ---
  Node& core_node() { return *node_; }
  const Node& core_node() const { return *node_; }
  uint16_t id() const { return cfg_.node_id; }
  Role role() const { return cfg_.role; }
  size_t button_queue_depth() const { return button_queue_.size(); }
  size_t radio_queue_depth() const { return radio_rx_queue_.size(); }
  uint32_t button_queue_overflows() const { return button_queue_.overflows(); }
  uint32_t radio_queue_overflows() const { return radio_rx_queue_.overflows(); }

 private:
  void init_hal() {
    // Clock Adapter
    struct FitlClock : IClock {
      FirmwareNode& fn;
      explicit FitlClock(FirmwareNode& n) : fn(n) {}
      uint32_t now_ms() const override { return fn.sim_time_ms_; }
      uint32_t unix_s() const override { return 1700000000u + (fn.sim_time_ms_ / 1000u); }
    };
    clock_ = std::make_unique<FitlClock>(*this);

    // Random Adapter
    struct FitlRandom : IRandom {
      FirmwareNode& fn;
      explicit FitlRandom(FirmwareNode& n) : fn(n) {}
      uint32_t uniform(uint32_t m) override { return m ? (fn.rng_val_ = (fn.rng_val_ * 1103515245 + 12345)) % m : 0; }
    };
    rng_ = std::make_unique<FitlRandom>(*this);

    // Radio Adapter
    struct FitlRadio : IRadio {
      FirmwareNode& fn;
      explicit FitlRadio(FirmwareNode& n) : fn(n) {}
      bool send(const uint8_t* data, size_t len) override {
        if (!fn.online_ || !fn.tx_callback_) return false;
        return fn.tx_callback_(fn.cfg_.node_id, data, len);
      }
      bool channel_busy() override { return false; } // Handled by channel simulation
    };
    radio_ = std::make_unique<FitlRadio>(*this);

    // Haptic Adapter
    struct FitlHaptic : IHaptic {
      FirmwareNode& fn;
      explicit FitlHaptic(FirmwareNode& n) : fn(n) {}
      void play(HapticPattern p) override {
        fn.haptics_.play(p);
        if (fn.trace_callback_) {
          char extra[32];
          std::snprintf(extra, sizeof(extra), ",\"pattern\":%d", static_cast<int>(p));
          fn.trace_callback_(fn.cfg_.node_id, "haptic", extra);
        }
      }
    };
    haptic_ = std::make_unique<FitlHaptic>(*this);

    // Alert Sink Adapter (for Hubs)
    struct FitlAlertSink : IAlertSink {
      FirmwareNode& fn;
      explicit FitlAlertSink(FirmwareNode& n) : fn(n) {}
      void on_alert(const Packet& p, uint32_t t) override {
        if (fn.alert_callback_) fn.alert_callback_(p, t);
      }
    };
    alert_sink_ = std::make_unique<FitlAlertSink>(*this);

    // Trace Sink Adapter
    struct FitlTraceSink : ITraceSink {
      FirmwareNode& fn;
      explicit FitlTraceSink(FirmwareNode& n) : fn(n) {}
      void on_node_event(uint16_t id, const char* ev, const char* extra) override {
        if (fn.trace_callback_) fn.trace_callback_(id, ev, extra);
      }
    };
    trace_sink_ = std::make_unique<FitlTraceSink>(*this);

    Hal hal;
    hal.clock = clock_.get();
    hal.rng = rng_.get();
    hal.radio = radio_.get();
    hal.gnss = &gnss_adapter_;
    hal.dr = &dr_adapter_;
    hal.battery = &battery_adapter_;
    hal.haptic = haptic_.get();
    hal.alerts = (cfg_.role == Role::Hub) ? alert_sink_.get() : nullptr;
    hal.trace = trace_sink_.get();

    node_ = std::make_unique<Node>(cfg_, hal);
  }

  NodeConfig cfg_;
  RadioTxCallback tx_callback_;
  TraceCallback trace_callback_;
  AlertCallback alert_callback_;

  bool online_ = true;
  uint32_t sim_time_ms_ = 0;
  uint32_t rng_val_ = 42;

  VirtualQueue<ButtonEvent, 16> button_queue_;
  VirtualQueue<RadioRxEvent, 8> radio_rx_queue_;

  esp32::Neo6mGnss gnss_adapter_;
  esp32::Mpu6050DeadReckoning dr_adapter_;
  esp32::BatteryMonitor battery_adapter_;
  esp32::HapticLedDriver haptics_{13, 14, 15};

  std::unique_ptr<IClock> clock_;
  std::unique_ptr<IRandom> rng_;
  std::unique_ptr<IRadio> radio_;
  std::unique_ptr<IHaptic> haptic_;
  std::unique_ptr<IAlertSink> alert_sink_;
  std::unique_ptr<ITraceSink> trace_sink_;
  std::unique_ptr<Node> node_;
};

}  // namespace fitl
}  // namespace setu
