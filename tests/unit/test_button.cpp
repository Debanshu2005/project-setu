#include "setu/button.hpp"
#include "testlib.hpp"

using namespace setu;

// Drives the classifier on a 1 ms timeline and collects events.
struct Rig {
  ButtonClassifier b;
  uint32_t t = 0;
  ButtonEvent last = ButtonEvent::None;
  int events = 0;
  void run(uint32_t ms) {
    for (uint32_t i = 0; i < ms; i++, t++) {
      ButtonEvent e = b.tick(t);
      if (e != ButtonEvent::None) {
        last = e;
        events++;
      }
    }
  }
  void press() { b.on_edge(true, t); }
  void release() { b.on_edge(false, t); }
};

TEST(button_short_press) {
  Rig r;
  r.run(100);
  r.press();
  r.run(200);
  r.release();
  r.run(300);
  CHECK_EQ(r.events, 0);  // still waiting out the double-press gap
  r.run(400);
  CHECK_EQ(r.events, 1);
  CHECK(r.last == ButtonEvent::Short);
}

TEST(button_double_press) {
  Rig r;
  r.press();
  r.run(150);
  r.release();
  r.run(250);  // within 600 ms gap
  r.press();
  r.run(150);
  r.release();
  r.run(1000);
  CHECK_EQ(r.events, 1);
  CHECK(r.last == ButtonEvent::Double);
}

TEST(button_long_press_fires_while_held) {
  Rig r;
  r.press();
  r.run(1400);
  CHECK_EQ(r.events, 0);
  r.run(200);  // 1600 ms held
  CHECK_EQ(r.events, 1);
  CHECK(r.last == ButtonEvent::Long);
  r.release();
  r.run(2000);
  CHECK_EQ(r.events, 1);  // release does not generate a second event
}

TEST(button_in_between_hold_is_rejected_not_guessed) {
  Rig r;
  r.press();
  r.run(900);
  r.release();
  r.run(1000);
  CHECK_EQ(r.events, 1);
  CHECK(r.last == ButtonEvent::Invalid);
}

TEST(button_bounce_is_ignored) {
  Rig r;
  r.press();
  r.run(5);
  r.release();  // bounce inside debounce window
  r.run(5);
  r.press();
  r.run(150);
  r.release();
  r.run(1000);
  CHECK_EQ(r.events, 1);
  CHECK(r.last == ButtonEvent::Short);
}

TEST(button_two_slow_presses_are_two_shorts) {
  Rig r;
  r.press();
  r.run(100);
  r.release();
  r.run(800);  // gap exceeded: first is a Short
  CHECK_EQ(r.events, 1);
  r.press();
  r.run(100);
  r.release();
  r.run(800);
  CHECK_EQ(r.events, 2);
  CHECK(r.last == ButtonEvent::Short);
}
