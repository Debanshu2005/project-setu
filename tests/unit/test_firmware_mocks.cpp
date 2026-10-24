// Project Setu - Firmware Driver Adapters & Wire Compatibility Unit Tests
#include <cstring>
#include "esp32_adapters.hpp"
#include "host_mocks.hpp"
#include "setu/node.hpp"
#include "testlib.hpp"

using namespace setu;
using namespace setu::esp32;
using namespace setu::test;

TEST(wire_test_vectors_exact_binary_layout) {
  // Canonical 25-byte test vector:
  // node_id = 0x0102, seq = 0x0304, target = 0xFFFF, ref_seq = 0x0000,
  // hazard = Medical (1), flags = GPS (1), lat = 22572600 (0x01586E38),
  // lon = 88433800 (0x05456488), ts = 1700000000 (0x6553A500), battery = 92 (0x5C),
  // hop = 2, contact = 1.
  Packet p;
  p.node_id = 0x0102;
  p.seq = 0x0304;
  p.target = kNoTarget;
  p.ref_seq = 0;
  p.hazard = Hazard::Medical;
  p.flags = kFlagGps;
  p.lat_e6 = 22572600;
  p.lon_e6 = 88433800;
  p.ts = 1700000000u;
  p.battery = 92;
  p.hop = 2;
  p.contact = 1;

  uint8_t wire[kPacketSize];
  size_t written = serialize(p, wire, sizeof wire);
  CHECK_EQ(written, kPacketSize);

  // Validate byte-by-byte little endian offsets
  CHECK_EQ(wire[0], 0x02); // node_id low
  CHECK_EQ(wire[1], 0x01); // node_id high
  CHECK_EQ(wire[2], 0x04); // seq low
  CHECK_EQ(wire[3], 0x03); // seq high
  CHECK_EQ(wire[4], 0xFF); // target low
  CHECK_EQ(wire[5], 0xFF); // target high
  CHECK_EQ(wire[6], 0x00); // ref_seq low
  CHECK_EQ(wire[7], 0x00); // ref_seq high
  CHECK_EQ(wire[8], 0x01); // hazard = Medical
  CHECK_EQ(wire[9], 0x01); // flags = kFlagGps
  CHECK_EQ(wire[22], 92);  // battery
  CHECK_EQ(wire[23], 2);   // hop
  CHECK_EQ(wire[24], 1);   // contact

  // Decode back
  Packet parsed;
  CHECK(parse(wire, sizeof wire, parsed) == ParseResult::Ok);
  CHECK_EQ(parsed.node_id, 0x0102);
  CHECK_EQ(parsed.seq, 0x0304);
  CHECK(parsed.hazard == Hazard::Medical);
  CHECK_EQ(parsed.lat_e6, 22572600);
  CHECK_EQ(parsed.lon_e6, 88433800);
  CHECK_EQ(parsed.battery, 92);
}

TEST(esp32_adapters_discipline_clock) {
  Esp32Clock clk;
  uint32_t t1 = clk.now_ms();
  CHECK(t1 >= 0);

  // Discipline with GNSS epoch
  clk.discipline_unix_time(1705000000u);
  CHECK(clk.unix_s() >= 1705000000u);
}

TEST(esp32_adapters_location_fallback_pipeline) {
  MockClock clk;
  MockRandom rng;
  MockRadio radio;
  Neo6mGnss gnss;
  Mpu6050DeadReckoning dr;
  BatteryMonitor batt;
  MockHaptic haptic;

  Hal hal;
  hal.clock = &clk;
  hal.rng = &rng;
  hal.radio = &radio;
  hal.gnss = &gnss;
  hal.dr = &dr;
  hal.battery = &batt;
  hal.haptic = &haptic;

  NodeConfig cfg;
  cfg.node_id = 9;
  Node node(cfg, hal);

  // 1. Initial: no GNSS, no DR -> Unknown location
  node.on_button_edge(true);
  clk.advance_ms(150);
  node.on_button_edge(false);
  for (int i = 0; i < 700; i++) { clk.advance_ms(1); node.tick(); }

  CHECK_EQ(radio.transmitted.size(), 1u);
  CHECK_EQ(radio.transmitted[0].flags & (kFlagGps | kFlagDr), 0); // No GPS, no DR

  // 2. Enable DR estimate
  dr.anchor_last_gnss(22572600, 88433800);
  radio.transmitted.clear();
  clk.advance_ms(2000);
  node.on_button_edge(true);
  clk.advance_ms(150);
  node.on_button_edge(false);
  for (int i = 0; i < 700; i++) { clk.advance_ms(1); node.tick(); }

  CHECK_EQ(radio.transmitted.size(), 1u);
  CHECK(radio.transmitted[0].flags & kFlagDr); // Dead reckoning active
  CHECK_EQ(radio.transmitted[0].lat_e6, 22572600);

  // 3. Acquire 3D GNSS satellite fix
  gnss.update_fix_data(true, 22572999, 88433999);
  radio.transmitted.clear();
  clk.advance_ms(2000);
  node.on_button_edge(true);
  clk.advance_ms(150);
  node.on_button_edge(false);
  for (int i = 0; i < 700; i++) { clk.advance_ms(1); node.tick(); }

  CHECK_EQ(radio.transmitted.size(), 1u);
  CHECK(radio.transmitted[0].flags & kFlagGps); // GNSS takes priority over DR
  CHECK_EQ(radio.transmitted[0].lat_e6, 22572999);
}
