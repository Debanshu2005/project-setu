#include "setu/duty_cycle.hpp"

#include <cmath>

namespace setu {

uint32_t lora_airtime_ms(size_t payload_bytes, uint8_t sf, uint32_t bw_hz,
                         uint8_t preamble_symbols) {
  const double t_sym_ms = static_cast<double>(1u << sf) * 1000.0 / bw_hz;
  const int de = (sf >= 11 && bw_hz <= 125000) ? 1 : 0;
  const int cr = 1;  // 4/5
  const double num = 8.0 * payload_bytes - 4.0 * sf + 28.0 + 16.0;  // CRC on, explicit header
  const double den = 4.0 * (sf - 2 * de);
  double n_payload = std::ceil(num / den) * (cr + 4);
  if (n_payload < 0) n_payload = 0;
  const double t_preamble = (preamble_symbols + 4.25) * t_sym_ms;
  return static_cast<uint32_t>(std::ceil(t_preamble + (8.0 + n_payload) * t_sym_ms));
}

double lora_sensitivity_dbm(uint8_t sf) {
  switch (sf) {
    case 7: return -123.0;
    case 8: return -126.0;
    case 9: return -129.0;
    case 10: return -132.0;
    case 11: return -134.5;
    default: return -137.0;
  }
}

uint32_t DutyCycle::used_ms(uint32_t now) const {
  uint32_t total = 0;
  for (size_t i = 0; i < n_; i++) {
    const Rec& r = rec_[(head_ + kCap - 1 - i) % kCap];
    if (now - r.t < window_ms_) total += r.air;
  }
  return total;
}

bool DutyCycle::can_send(uint32_t now, uint32_t air) const {
  // History full and its oldest entry still inside the window: we can no longer
  // account exactly, so fail safe rather than silently forgetting airtime.
  if (n_ == kCap && now - rec_[head_].t < window_ms_) return false;
  return used_ms(now) + air <= budget_ms();
}

void DutyCycle::record(uint32_t now, uint32_t air) {
  rec_[head_] = {now, air};
  head_ = (head_ + 1) % kCap;
  if (n_ < kCap) n_++;
}

}  // namespace setu
