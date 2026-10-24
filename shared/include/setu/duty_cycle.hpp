// LoRa time-on-air and a rolling duty-cycle budget.
#pragma once
#include <cstddef>
#include <cstdint>

namespace setu {

// Semtech AN1200.13 time-on-air, explicit header, CRC on, CR 4/5.
uint32_t lora_airtime_ms(size_t payload_bytes, uint8_t sf = 7, uint32_t bw_hz = 125000,
                         uint8_t preamble_symbols = 8);

// Typical SX126x sensitivity (dBm) at 125 kHz for a spreading factor.
double lora_sensitivity_dbm(uint8_t sf);

class DutyCycle {
 public:
  // limit_permille = 10 -> 1 % of the window.
  explicit DutyCycle(uint32_t window_ms = 3600000UL, uint32_t limit_permille = 10)
      : window_ms_(window_ms), limit_permille_(limit_permille) {}

  bool can_send(uint32_t now_ms, uint32_t airtime_ms) const;
  void record(uint32_t now_ms, uint32_t airtime_ms);
  uint32_t used_ms(uint32_t now_ms) const;
  uint32_t budget_ms() const {
    return static_cast<uint32_t>(static_cast<uint64_t>(window_ms_) * limit_permille_ / 1000);
  }

 private:
  // Must exceed budget / shortest airtime (1 % of 1 h at SF7 is ~580 packets).
  static constexpr size_t kCap = 1024;
  struct Rec {
    uint32_t t = 0;
    uint32_t air = 0;
  };
  uint32_t window_ms_;
  uint32_t limit_permille_;
  Rec rec_[kCap];
  size_t head_ = 0;
  size_t n_ = 0;
};

}  // namespace setu
