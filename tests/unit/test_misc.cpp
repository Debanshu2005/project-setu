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
  ch.profile = sim::RealismProfile::Field;
  auto w = sim::make_demo_world(20, 5, 1200, ch, 7);
  CHECK(w != nullptr);
  auto n0 = w->get_node_info(0);
  CHECK_EQ(static_cast<int>(n0.x), 60);
  CHECK_EQ(static_cast<int>(n0.y), 60);
  // Verify that Survivor 7 position is exactly deterministic across all compilers in Field profile
  auto n7 = w->get_node_info(7);
  CHECK_EQ(static_cast<int>(std::round(n7.x * 10)), 6840);
  CHECK_EQ(static_cast<int>(std::round(n7.y * 10)), 9718);
  auto r100 = w->get_node_info(100);
  CHECK_EQ(static_cast<int>(std::round(r100.x * 10)), 2607);
  CHECK_EQ(static_cast<int>(std::round(r100.y * 10)), 3466);
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

TEST(path_loss_exponent_scales_attenuation_and_link_viability) {
  sim::ChannelParams ch30;
  ch30.path_exp = 3.0;
  ch30.shadow_sigma_db = 0.0;
  ch30.fading_sigma_db = 0.0;

  sim::ChannelParams ch40;
  ch40.path_exp = 4.0;
  ch40.shadow_sigma_db = 0.0;
  ch40.fading_sigma_db = 0.0;

  sim::World w30(ch30, 100);
  setu::NodeConfig c;
  c.node_id = 0;
  w30.add_node(c, 0, 0);
  c.node_id = 1;
  w30.add_node(c, 200, 0); // 200m distance

  sim::World w40(ch40, 100);
  c.node_id = 0;
  w40.add_node(c, 0, 0);
  c.node_id = 1;
  w40.add_node(c, 200, 0); // 200m distance

  double rssi30 = w30.mean_rssi(0, 1);
  double rssi40 = w40.mean_rssi(0, 1);

  // Theoretical path loss difference at 200m: 10 * (4.0 - 3.0) * log10(200) = 10 * 2.301 = 23.01 dB
  CHECK(rssi30 > rssi40);
  CHECK(std::abs((rssi30 - rssi40) - 23.01) < 0.1);

  // At SF7 (sensitivity -123 dBm), 200m is viable under n=3.0 but non-viable under n=4.0
  CHECK(rssi30 >= -123.0);
  CHECK(rssi40 < -123.0);
}

TEST(make_demo_world_path_loss_3_0_and_3_5_feasible) {
  sim::ChannelParams ch30;
  ch30.path_exp = 3.0;
  auto w30 = sim::make_demo_world(20, 5, 1200, ch30, 42);
  CHECK(w30 != nullptr);
  CHECK(w30->planned_connected());

  sim::ChannelParams ch35;
  ch35.path_exp = 3.5;
  auto w35 = sim::make_demo_world(20, 5, 1200, ch35, 42);
  CHECK(w35 != nullptr);
  CHECK(w35->planned_connected());
}

TEST(make_demo_world_path_loss_4_0_deliberate_topology_succeeds) {
  sim::ChannelParams ch40;
  ch40.path_exp = 4.0;
  // In 1200m zone with path_exp=4.0 and 5 relays, deliberate progressive placement
  // establishes a verified multi-hop backbone connecting all 26 nodes to the Hub.
  auto w40 = sim::make_demo_world(20, 5, 1200, ch40, 42);
  CHECK(w40 != nullptr);
  CHECK(w40->planned_connected());
  auto rep = w40->planned_connectivity_report();
  CHECK_EQ(rep.connected_to_hub, 26u);
  CHECK_EQ(rep.disconnected_count, 0u);
  CHECK_EQ(rep.component_count, 1u);
}

TEST(make_demo_world_path_loss_4_0_infeasible_produces_actionable_diagnostic) {
  sim::ChannelParams ch40;
  ch40.path_exp = 4.0;

  bool caught = false;
  try {
    // 1200m zone with 0 relays is physically infeasible at n=4.0 (radio range ~156.7m)
    sim::make_demo_world(20, 0, 1200, ch40, 42);
  } catch (const std::runtime_error& e) {
    caught = true;
    std::string msg = e.what();
    // 1. Exact backward-compatible prefix must match
    CHECK(msg.find("could not generate a connected demo topology") != std::string::npos);
    // 2. Actionable diagnostic details must be present
    CHECK(msg.find("after 500 attempts") != std::string::npos);
    CHECK(msg.find("path_exp=4.00") != std::string::npos);
    CHECK(msg.find("seed=42") != std::string::npos);
    CHECK(msg.find("zone=1200m") != std::string::npos);
    CHECK(msg.find("survivors=20, relays=0") != std::string::npos);
    CHECK(msg.find("Max viable radio range is ~156.7m") != std::string::npos);
    CHECK(msg.find("disconnected from Hub") != std::string::npos);
    CHECK(msg.find("--allow-disconnected") != std::string::npos);
  }
  CHECK(caught);
}

TEST(make_demo_world_path_loss_4_0_with_allow_disconnected) {
  sim::ChannelParams ch40;
  ch40.path_exp = 4.0;
  // With allow_disconnected=true on an infeasible network (0 relays in 1200m zone),
  // simulation does not abort; it returns the best topology and reports reachability honestly.
  auto w = sim::make_demo_world(20, 0, 1200, ch40, 42, setu::NodeConfig(), {}, true);
  CHECK(w != nullptr);
  CHECK_EQ(w->node_ids().size(), 21u);
  auto rep = w->planned_connectivity_report();
  CHECK_EQ(rep.total_nodes, 21u);
  CHECK(rep.connected_to_hub > 0u);
  CHECK(rep.disconnected_count > 0u);
  CHECK(!rep.connected);
}


TEST(realism_profiles_configuration) {
  CHECK(sim::parse_realism_profile("baseline") == sim::RealismProfile::Baseline);
  CHECK(sim::parse_realism_profile("idealized") == sim::RealismProfile::Idealized);
  CHECK(sim::parse_realism_profile("field") == sim::RealismProfile::Field);

  sim::ChannelParams ch_ideal;
  ch_ideal.profile = sim::RealismProfile::Idealized;
  sim::World w_ideal(ch_ideal, 42);
  const auto& p_ideal = w_ideal.channel_params();
  CHECK_EQ(static_cast<int>(p_ideal.path_exp * 10), 20);
  CHECK_EQ(static_cast<int>(p_ideal.shadow_sigma_db * 10), 0);
  CHECK_EQ(static_cast<int>(p_ideal.fading_sigma_db * 10), 0);
  CHECK_EQ(static_cast<int>(p_ideal.extra_loss_db * 10), 0);
  CHECK_EQ(static_cast<int>(p_ideal.random_loss * 10), 0);

  sim::ChannelParams ch_field;
  ch_field.profile = sim::RealismProfile::Field;
  sim::World w_field(ch_field, 42);
  const auto& p_field = w_field.channel_params();
  CHECK_EQ(static_cast<int>(p_field.battery_capacity_mah), 1000);
}

TEST(field_energy_model_accounting) {
  sim::ChannelParams ch;
  ch.profile = sim::RealismProfile::Field;
  sim::World w(ch, 42);

  setu::NodeConfig c;
  c.node_id = 0;
  c.role = setu::Role::Hub;
  w.add_node(c, 0, 0);

  c.node_id = 1;
  c.role = setu::Role::Survivor;
  w.add_node(c, 100, 0);

  auto pre1 = w.get_node_info(1);
  CHECK_EQ(pre1.battery, 100);
  CHECK_EQ(static_cast<int>(pre1.energy_consumed_mah), 0);

  w.button_press(1, 100, 150);
  w.run_until(2000);

  auto post1 = w.get_node_info(1);
  CHECK(post1.energy_consumed_mah > 0.0);
  CHECK(post1.incident_id > 0);
  CHECK(post1.profile == "field");
}

TEST(reproducible_hash_randomness_independent_of_receiver_order) {
  sim::ChannelParams ch;
  ch.profile = sim::RealismProfile::Field;
  ch.fading_sigma_db = 2.0;

  sim::World w1(ch, 77);
  setu::NodeConfig c;
  c.node_id = 0; c.role = setu::Role::Hub; w1.add_node(c, 0, 0);
  c.node_id = 1; c.role = setu::Role::Survivor; w1.add_node(c, 100, 0);
  c.node_id = 2; c.role = setu::Role::Survivor; w1.add_node(c, 200, 0);
  w1.button_press(1, 100, 150);
  w1.run_until(1500);

  sim::World w2(ch, 77);
  c.node_id = 0; c.role = setu::Role::Hub; w2.add_node(c, 0, 0);
  c.node_id = 1; c.role = setu::Role::Survivor; w2.add_node(c, 100, 0);
  c.node_id = 2; c.role = setu::Role::Survivor; w2.add_node(c, 200, 0);
  w2.button_press(1, 100, 150);
  w2.run_until(1500);

  CHECK_EQ(w1.counters().tx, w2.counters().tx);
  CHECK_EQ(w1.counters().delivered, w2.counters().delivered);
  CHECK_EQ(w1.counters().weak, w2.counters().weak);
}

TEST(loss_budget_waterfall_calculation) {
  // Baseline profile leaves obstacle and body loss unmodeled
  {
    sim::ChannelParams ch;
    ch.profile = sim::RealismProfile::Baseline;
    sim::World w(ch, 42);

    setu::NodeConfig c;
    c.node_id = 0; c.role = setu::Role::Hub; w.add_node(c, 0, 0);
    c.node_id = 1; c.role = setu::Role::Survivor; w.add_node(c, 250, 0);

    sim::LossBudget lb = w.get_loss_budget(1, 0);
    CHECK_EQ(static_cast<int>(lb.tx_power_dbm), 14);
    CHECK(lb.path_loss_db > 0.0);
    CHECK(lb.rx_power_dbm < lb.tx_power_dbm);
    CHECK(lb.obstacle_loss == "not modeled yet");
    CHECK(lb.body_loss == "not modeled yet");
    CHECK(lb.link_margin_db > -50.0);
  }

  // Field profile reports obstacle and body loss
  {
    sim::ChannelParams ch;
    ch.profile = sim::RealismProfile::Field;
    sim::World w(ch, 42);

    setu::NodeConfig c;
    c.node_id = 0; c.role = setu::Role::Hub; w.add_node(c, 0, 0);
    c.node_id = 1; c.role = setu::Role::Survivor; w.add_node(c, 250, 0);

    sim::LossBudget lb = w.get_loss_budget(1, 0);
    CHECK(lb.obstacle_loss == "0.0 dB (line of sight)");
    CHECK(lb.body_loss == "0.0 dB (unshadowed)");

    // Add concrete obstacle
    sim::Obstacle obs;
    obs.id = 1;
    obs.material = sim::Material::Concrete;
    obs.x1 = 100; obs.y1 = -50; obs.x2 = 100; obs.y2 = 50;
    obs.attenuation_db = 22.0;
    w.add_obstacle(obs);

    // Set heading of node 1 facing away from node 0 (eastward, heading 0 rad, vector to node 0 is west)
    w.set_node_heading(1, 0.0);

    sim::LossBudget lb2 = w.get_loss_budget(1, 0);
    CHECK(lb2.obstacle_loss.find("22.0 dB") != std::string::npos);
    CHECK(lb2.body_loss == "15.0 dB");
  }
}

TEST(obstacle_segment_intersection_and_material_attenuation) {
  // Line segments intersect
  double ix = 0, iy = 0;
  CHECK(sim::segments_intersect(0, 0, 10, 10, 0, 10, 10, 0, &ix, &iy));
  CHECK(std::abs(ix - 5.0) < 1e-4);
  CHECK(std::abs(iy - 5.0) < 1e-4);

  // Parallel non-intersecting
  CHECK(!sim::segments_intersect(0, 0, 10, 0, 0, 5, 10, 5));

  // Non-parallel non-intersecting
  CHECK(!sim::segments_intersect(0, 0, 5, 5, 6, 6, 10, 10));

  // Material attenuation defaults
  CHECK_EQ(static_cast<int>(sim::material_default_attenuation_db(sim::Material::Concrete, 0.2)), 22);
  CHECK_EQ(static_cast<int>(sim::material_default_attenuation_db(sim::Material::Brick, 0.2)), 10);
  CHECK_EQ(static_cast<int>(sim::material_default_attenuation_db(sim::Material::Soil, 1.0)), 15);
  CHECK_EQ(static_cast<int>(sim::material_default_attenuation_db(sim::Material::Water, 1.0)), 50);
  CHECK_EQ(static_cast<int>(sim::material_default_attenuation_db(sim::Material::MetalSheet)), 35);

  // Cumulative obstacle attenuation
  std::vector<sim::Obstacle> obstacles;
  sim::Obstacle o1; o1.id = 1; o1.x1 = 5; o1.y1 = -10; o1.x2 = 5; o1.y2 = 10; o1.attenuation_db = 10.0;
  sim::Obstacle o2; o2.id = 2; o2.x1 = 15; o2.y1 = -10; o2.x2 = 15; o2.y2 = 10; o2.attenuation_db = 22.0;
  obstacles.push_back(o1);
  obstacles.push_back(o2);

  int count = 0;
  double loss = sim::calculate_obstacle_attenuation(0, 0, 20, 0, obstacles, &count);
  CHECK_EQ(count, 2);
  CHECK(std::abs(loss - 32.0) < 1e-4);
}

TEST(body_shadowing_torso_absorption) {
  // Node at (10, 0) talking to Node at (0, 0). Line of sight angle is PI (180 deg).
  // 1. Wearer facing receiver (heading PI): delta = 0 -> 0 dB
  CHECK_EQ(static_cast<int>(sim::calculate_body_shadowing_db(10, 0, 0, 0, M_PI)), 0);

  // 2. Wearer facing directly away (heading 0): delta = PI (180 deg) -> 15 dB
  CHECK_EQ(static_cast<int>(sim::calculate_body_shadowing_db(10, 0, 0, 0, 0.0)), 15);

  // 3. Glancing angle (heading 1.3 rad, wearer facing north-northeast, receiver is west):
  // Angle difference is PI - 1.3 = 1.84 rad (~105 deg), in glancing range (90 to 120 deg) -> 6 dB
  CHECK_EQ(static_cast<int>(sim::calculate_body_shadowing_db(10, 0, 0, 0, 1.3)), 6);

  // 4. Unspecified / negative heading -> 0 dB
  CHECK_EQ(static_cast<int>(sim::calculate_body_shadowing_db(10, 0, 0, 0, -1.0)), 0);
}

TEST(sx1262_capture_threshold_and_sf_isolation) {
  // Capture thresholds per Semtech AN1200.22
  CHECK(std::abs(sim::capture_threshold_db(7) - 6.0) < 1e-4);
  CHECK(std::abs(sim::capture_threshold_db(8) - 7.0) < 1e-4);
  CHECK(std::abs(sim::capture_threshold_db(9) - 8.0) < 1e-4);
  CHECK(std::abs(sim::capture_threshold_db(10) - 9.0) < 1e-4);
  CHECK(std::abs(sim::capture_threshold_db(11) - 10.0) < 1e-4);
  CHECK(std::abs(sim::capture_threshold_db(12) - 10.5) < 1e-4);

  // Multi-SF quasi-orthogonality isolation matrix
  CHECK_EQ(static_cast<int>(sim::inter_sf_isolation_db(7, 7)), 0);
  CHECK_EQ(static_cast<int>(sim::inter_sf_isolation_db(7, 8)), 16);
  CHECK_EQ(static_cast<int>(sim::inter_sf_isolation_db(7, 9)), 18);
  CHECK_EQ(static_cast<int>(sim::inter_sf_isolation_db(7, 10)), 20);
  CHECK_EQ(static_cast<int>(sim::inter_sf_isolation_db(7, 12)), 20);
}

TEST(fluid_flow_kinematic_drift_in_field_profile) {
  sim::ChannelParams ch;
  ch.profile = sim::RealismProfile::Field;
  ch.fluid_drift.vx_mps = 2.0;
  ch.fluid_drift.vy_mps = -1.0;
  sim::World w(ch, 42);

  setu::NodeConfig c;
  c.node_id = 0; c.role = setu::Role::Hub; w.add_node(c, 0, 0);
  c.node_id = 1; c.role = setu::Role::Survivor; w.add_node(c, 100, 100);

  // Run for 5 full seconds (5001 ms ensures t=5000ms tick executes)
  w.run_until(5001);

  auto h_info = w.get_node_info(0);
  auto s_info = w.get_node_info(1);

  // Hub is static infrastructure
  CHECK_EQ(static_cast<int>(h_info.x), 0);
  CHECK_EQ(static_cast<int>(h_info.y), 0);

  // Survivor drifted by 5s * 2m/s = +10m in X, 5s * -1m/s = -5m in Y
  CHECK_EQ(static_cast<int>(std::round(s_info.x)), 110);
  CHECK_EQ(static_cast<int>(std::round(s_info.y)), 95);
}

TEST(obstacle_rf_attenuation_in_world_simulation) {
  // In Field profile, obstacle reduces RSSI
  {
    sim::ChannelParams ch;
    ch.profile = sim::RealismProfile::Field;
    ch.shadow_sigma_db = 0.0;
    sim::World w(ch, 42);

    setu::NodeConfig c;
    c.node_id = 0; c.role = setu::Role::Hub; w.add_node(c, 0, 0);
    c.node_id = 1; c.role = setu::Role::Survivor; w.add_node(c, 200, 0);

    double clear_rssi = w.mean_rssi(1, 0);

    sim::Obstacle obs;
    obs.id = 1;
    obs.material = sim::Material::Concrete;
    obs.x1 = 100; obs.y1 = -50; obs.x2 = 100; obs.y2 = 50;
    obs.attenuation_db = 22.0;
    w.add_obstacle(obs);

    double obstructed_rssi = w.mean_rssi(1, 0);
    CHECK(std::abs((clear_rssi - obstructed_rssi) - 22.0) < 1e-4);
  }

  // In Baseline profile, obstacles do not affect RSSI (backward compatibility)
  {
    sim::ChannelParams ch;
    ch.profile = sim::RealismProfile::Baseline;
    ch.shadow_sigma_db = 0.0;
    sim::World w(ch, 42);

    setu::NodeConfig c;
    c.node_id = 0; c.role = setu::Role::Hub; w.add_node(c, 0, 0);
    c.node_id = 1; c.role = setu::Role::Survivor; w.add_node(c, 200, 0);

    double clear_rssi = w.mean_rssi(1, 0);

    sim::Obstacle obs;
    obs.id = 1;
    obs.material = sim::Material::Concrete;
    obs.x1 = 100; obs.y1 = -50; obs.x2 = 100; obs.y2 = 50;
    obs.attenuation_db = 22.0;
    w.add_obstacle(obs);

    double baseline_rssi = w.mean_rssi(1, 0);
    CHECK(std::abs(clear_rssi - baseline_rssi) < 1e-4);
  }
}

TEST(setu_portable_random_generator) {
  setu::Xoshiro256PlusPlus rng1(12345);
  setu::Xoshiro256PlusPlus rng2(12345);

  for (int i = 0; i < 1000; i++) {
    CHECK_EQ(rng1.next_u64(), rng2.next_u64());
    CHECK(std::abs(rng1.next_u01() - rng2.next_u01()) < 1e-15);
  }

  // Reciprocity of hash link keys
  uint64_t k1 = setu::HashRandom::hash_link_key(42, 10, 20);
  uint64_t k2 = setu::HashRandom::hash_link_key(42, 20, 10);
  CHECK_EQ(k1, k2);

  double g1 = setu::HashRandom::link_gaussian(42, 10, 20, 0.0, 3.0);
  double g2 = setu::HashRandom::link_gaussian(42, 20, 10, 0.0, 3.0);
  CHECK(std::abs(g1 - g2) < 1e-15);
}
