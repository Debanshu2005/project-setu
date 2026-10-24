#include "setu/button.hpp"

namespace setu {

bool ButtonClassifier::on_edge(bool pressed, uint32_t now) {
  if (pressed == level_) return false;                             // not a change
  if (have_edge_ && now - last_edge_ < cfg_.debounce_ms) return false;  // bounce
  have_edge_ = true;
  last_edge_ = now;
  level_ = pressed;

  if (pressed) {
    switch (state_) {
      case State::Idle:
        state_ = State::Down;
        t_down_ = now;
        break;
      case State::WaitSecond:
        if (now - t_up_ <= cfg_.double_gap_ms) {
          state_ = State::Down2;
        } else {  // gap expired before tick() noticed: report the first press
          pending_ = ButtonEvent::Short;
          state_ = State::Down;
        }
        t_down_ = now;
        break;
      default:
        break;
    }
    return true;
  }

  const uint32_t held = now - t_down_;
  switch (state_) {
    case State::Down:
      if (held < cfg_.short_max_ms) {
        state_ = State::WaitSecond;
        t_up_ = now;
      } else {
        pending_ = held >= cfg_.long_min_ms ? ButtonEvent::None : ButtonEvent::Invalid;
        state_ = State::Idle;
      }
      break;
    case State::Down2:
      pending_ = held < cfg_.short_max_ms ? ButtonEvent::Double : ButtonEvent::Invalid;
      state_ = State::Idle;
      break;
    case State::LongFired:
      state_ = State::Idle;
      break;
    default:
      state_ = State::Idle;
      break;
  }
  return true;
}

ButtonEvent ButtonClassifier::tick(uint32_t now) {
  if (pending_ != ButtonEvent::None) {
    ButtonEvent e = pending_;
    pending_ = ButtonEvent::None;
    return e;
  }
  switch (state_) {
    case State::Down:
    case State::Down2:
      if (now - t_down_ >= cfg_.long_min_ms) {
        state_ = State::LongFired;
        return ButtonEvent::Long;
      }
      break;
    case State::WaitSecond:
      if (now - t_up_ >= cfg_.double_gap_ms) {
        state_ = State::Idle;
        return ButtonEvent::Short;
      }
      break;
    default:
      break;
  }
  return ButtonEvent::None;
}

}  // namespace setu
