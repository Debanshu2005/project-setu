// Project Setu - Host Hardware Mock Interfaces for Firmware Validation
#pragma once

#include <cstdint>
#include <vector>
#include "setu/hal.hpp"
#include "setu/packet.hpp"

namespace setu {
namespace test {

class MockClock : public IClock {
 public:
  uint32_t t_ms = 1000;
  uint32_t u_s = 1700000000u;

  uint32_t now_ms() const override { return t_ms; }
  uint32_t unix_s() const override { return u_s + (t_ms / 1000u); }
  void advance_ms(uint32_t delta) { t_ms += delta; }
  void discipline_unix_time(uint32_t gnss_epoch_s) {
    if (gnss_epoch_s > 1600000000u) {
      u_s = gnss_epoch_s - (t_ms / 1000u);
    }
  }
};

class MockRandom : public IRandom {
 public:
  uint32_t next_val = 0;
  uint32_t uniform(uint32_t max_exclusive) override {
    if (max_exclusive <= 1) return 0;
    return next_val % max_exclusive;
  }
};

class MockRadio : public IRadio {
 public:
  bool is_busy = false;
  std::vector<Packet> transmitted;

  bool send(const uint8_t* data, size_t len) override {
    if (is_busy) return false;
    Packet p;
    if (parse(data, len, p) == ParseResult::Ok) {
      transmitted.push_back(p);
      return true;
    }
    return false;
  }

  bool channel_busy() override { return is_busy; }
};

class MockGnss : public IGnss {
 public:
  bool has_fix = true;
  int32_t lat = 22572600;
  int32_t lon = 88433800;

  bool get_fix(int32_t& lat_e6, int32_t& lon_e6) override {
    if (!has_fix) return false;
    lat_e6 = lat;
    lon_e6 = lon;
    return true;
  }
};

class MockDeadReckoning : public IDeadReckoning {
 public:
  bool has_dr = true;
  int32_t est_lat = 22572650;
  int32_t est_lon = 88433850;

  bool estimate(int32_t& lat_e6, int32_t& lon_e6) override {
    if (!has_dr) return false;
    lat_e6 = est_lat;
    lon_e6 = est_lon;
    return true;
  }
};

class MockBattery : public IBattery {
 public:
  uint8_t batt_pct = 95;
  uint8_t percent() override { return batt_pct; }
};

class MockHaptic : public IHaptic {
 public:
  std::vector<HapticPattern> played;
  void play(HapticPattern p) override { played.push_back(p); }
};

}  // namespace test
}  // namespace setu
