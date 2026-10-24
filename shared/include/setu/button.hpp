// Panic-button classifier: raw debounced edges in, short/double/long events out.
// Pure logic, no GPIO. The firmware feeds it edges; tests feed it synthetic ones.
#pragma once
#include <cstdint>

namespace setu {

enum class ButtonEvent : uint8_t {
  None,
  Short,    // released <500 ms, no second press within the gap
  Double,   // two short presses, second begins within the gap
  Long,     // held >= long_min_ms (fires while still held)
  Invalid,  // held between short_max and long_min: rejected, not guessed at
};

struct ButtonConfig {
  uint32_t debounce_ms = 30;
  uint32_t short_max_ms = 500;
  uint32_t double_gap_ms = 600;
  uint32_t long_min_ms = 1500;
};

class ButtonClassifier {
 public:
  explicit ButtonClassifier(const ButtonConfig& cfg = ButtonConfig()) : cfg_(cfg) {}

  // Raw GPIO edge. Returns true if accepted (not a bounce).
  bool on_edge(bool pressed, uint32_t now_ms);
  // Call regularly. Returns each event once.
  ButtonEvent tick(uint32_t now_ms);

 private:
  enum class State : uint8_t { Idle, Down, WaitSecond, Down2, LongFired };
  ButtonConfig cfg_;
  State state_ = State::Idle;
  bool level_ = false;
  bool have_edge_ = false;
  uint32_t last_edge_ = 0;
  uint32_t t_down_ = 0;
  uint32_t t_up_ = 0;
  ButtonEvent pending_ = ButtonEvent::None;
};

}  // namespace setu
