#include "setu/dedup.hpp"
#include "setu/duty_cycle.hpp"
#include "testlib.hpp"

using namespace setu;

TEST(dedup_counts_sightings) {
  DedupCache d;
  PacketKey k{1, 10, false};
  CHECK_EQ(d.count(k), 0);
  CHECK_EQ(d.observe(k), 1);
  CHECK_EQ(d.observe(k), 2);
  CHECK_EQ(d.count(k), 2);
  CHECK_EQ(d.observe({1, 11, false}), 1);   // different seq
  CHECK_EQ(d.observe({1, 10, true}), 1);    // ACK with same ids is distinct
}

TEST(dedup_evicts_oldest) {
  DedupCache d;
  for (uint16_t i = 0; i < DedupCache::kCapacity + 1; i++) d.observe({1, i, false});
  CHECK_EQ(d.count({1, 0, false}), 0);  // oldest gone
  CHECK_EQ(d.count({1, 1, false}), 1);
}

TEST(airtime_matches_semtech_calculator) {
  // 25-byte payload, SF7/125 kHz/CR4:5, 8-symbol preamble, CRC on: ~62 ms.
  CHECK_EQ(lora_airtime_ms(25, 7, 125000), 62u);
  CHECK(lora_airtime_ms(25, 10, 125000) > 400);
  CHECK(lora_airtime_ms(25, 12, 125000) > lora_airtime_ms(25, 10, 125000));
}

TEST(lora_sensitivity_table_matches_sx1262) {
  CHECK_EQ(static_cast<int>(lora_sensitivity_dbm(7) * 10), -1230);
  CHECK_EQ(static_cast<int>(lora_sensitivity_dbm(8) * 10), -1260);
  CHECK_EQ(static_cast<int>(lora_sensitivity_dbm(9) * 10), -1290);
  CHECK_EQ(static_cast<int>(lora_sensitivity_dbm(10) * 10), -1320);
  CHECK_EQ(static_cast<int>(lora_sensitivity_dbm(11) * 10), -1345);
  CHECK_EQ(static_cast<int>(lora_sensitivity_dbm(12) * 10), -1370);
}

TEST(duty_cycle_budget) {
  DutyCycle d;  // 1 % of 1 h = 36 000 ms
  CHECK_EQ(d.budget_ms(), 36000u);
  uint32_t t = 0;
  int sent = 0;
  while (d.can_send(t, 62)) {
    d.record(t, 62);
    t += 100;
    sent++;
  }
  CHECK_EQ(sent, 580);  // 36000 / 62
  CHECK(!d.can_send(t, 62));
  // An hour later the budget is free again.
  CHECK(d.can_send(t + 3600000UL, 62));
}
#include <cmath>
#include "world.hpp"

TEST(make_demo_world_topology_is_cross_compiler_deterministic) {
  sim::ChannelParams ch;
  auto w = sim::make_demo_world(20, 5, 1200, ch, 7);
  CHECK(w != nullptr);
  auto n0 = w->get_node_info(0);
  CHECK_EQ(static_cast<int>(n0.x), 60);
  CHECK_EQ(static_cast<int>(n0.y), 60);
  // Verify that Survivor 7 position is exactly deterministic across all compilers
  auto n7 = w->get_node_info(7);
  CHECK_EQ(static_cast<int>(std::round(n7.x * 10)), 9415);
  CHECK_EQ(static_cast<int>(std::round(n7.y * 10)), 8035);
  auto r100 = w->get_node_info(100);
  CHECK_EQ(static_cast<int>(std::round(r100.x * 10)), 2999);
  CHECK_EQ(static_cast<int>(std::round(r100.y * 10)), 3837);
}

TEST(zero_sigma_channel_precondition_safety) {
  sim::ChannelParams ch;
  ch.shadow_sigma_db = 0.0;
  ch.fading_sigma_db = 0.0;
  sim::World w(ch, 42);
  setu::NodeConfig c;
  c.node_id = 0;
  w.add_node(c, 0, 0);
  c.node_id = 1;
  w.add_node(c, 100, 0);
  double r = w.mean_rssi(0, 1);
  CHECK(r > -150.0 && r < 0.0);
}
