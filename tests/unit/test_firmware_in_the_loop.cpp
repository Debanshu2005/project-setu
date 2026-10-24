// Project Setu - Firmware-in-the-Loop (FITL) Integration & Unit Tests
// Verifies real C++ firmware state machines running through virtual FreeRTOS queues and ISRs.
#include <cstring>
#include <vector>
#include <iostream>

#include "firmware_task_node.hpp"
#include "setu/packet.hpp"
#include "setu/node.hpp"
#include "world.hpp"
#include "testlib.hpp"

using namespace setu;
using namespace setu::fitl;

TEST(fitl_button_isr_and_virtual_queue_drain) {
  std::vector<std::vector<uint8_t>> tx_packets;
  NodeConfig cfg;
  cfg.node_id = 42;
  cfg.role = Role::Survivor;

  FirmwareNode node(cfg, [&](uint16_t id, const uint8_t* data, size_t len) {
    (void)id;
    tx_packets.push_back(std::vector<uint8_t>(data, data + len));
    return true;
  });

  CHECK_EQ(node.button_queue_depth(), 0u);
  CHECK_EQ(node.button_queue_overflows(), 0u);

  // 1. Simulating GPIO ISR button edge press (down)
  bool queued = node.simulate_gpio_button_isr(100, true);
  CHECK(queued);
  CHECK_EQ(node.button_queue_depth(), 1u);

  // 2. Tick core protocol task: FreeRTOS queue should drain into ButtonClassifier
  node.tick_core_task(100);
  CHECK_EQ(node.button_queue_depth(), 0u);
  CHECK(!node.core_node().sos_active());

  // 3. Simulating GPIO ISR button release (up) after 150ms (Short Press)
  node.simulate_gpio_button_isr(250, false);
  node.tick_core_task(250);
  CHECK_EQ(node.button_queue_depth(), 0u);

  // 4. Advance time past the double-click timeout window (~600ms after release at 250ms -> 850ms)
  for (uint32_t t = 300; t <= 1000; t += 50) {
    node.tick_core_task(t);
  }

  // 5. Button classifier should have emitted ShortPress -> SOS triggered!
  CHECK(node.core_node().sos_active());
  CHECK(tx_packets.size() >= 1u);

  // Verify the emitted wire packet is a valid 25-byte Setu packet
  CHECK_EQ(tx_packets[0].size(), kPacketSize);
  Packet parsed;
  CHECK(parse(tx_packets[0].data(), tx_packets[0].size(), parsed) == ParseResult::Ok);
  CHECK_EQ(parsed.node_id, 42);
  CHECK(parsed.hazard == Hazard::General);
  CHECK_EQ(parsed.battery, 100);
}

TEST(fitl_radio_isr_and_virtual_queue_processing) {
  // Receiver node (Hub)
  NodeConfig hub_cfg;
  hub_cfg.node_id = 0;
  hub_cfg.role = Role::Hub;

  std::vector<Packet> received_alerts;
  FirmwareNode hub(hub_cfg, nullptr, nullptr, [&](const Packet& p, uint32_t t) {
    (void)t;
    received_alerts.push_back(p);
  });

  // Construct a simulated 25-byte wire packet from Survivor #7
  Packet p;
  p.node_id = 7;
  p.seq = 101;
  p.target = kNoTarget;
  p.ref_seq = 0;
  p.hazard = Hazard::Medical;
  p.flags = kFlagGps;
  p.lat_e6 = 22572600;
  p.lon_e6 = 88433800;
  p.ts = 1700000000u;
  p.battery = 88;
  p.hop = 0;
  p.contact = 1;

  uint8_t wire[kPacketSize];
  serialize(p, wire, sizeof(wire));

  // 1. Simulating SX1262 DIO1 ISR interrupt: packet received at PHY
  CHECK_EQ(hub.radio_queue_depth(), 0u);
  bool queued = hub.simulate_radio_rx_isr(wire, sizeof(wire), -85, 8);
  CHECK(queued);
  CHECK_EQ(hub.radio_queue_depth(), 1u);

  // 2. Hub core protocol task has not drained radio queue yet
  CHECK_EQ(received_alerts.size(), 0u);

  // 3. Radio task runs: drains radio queue, passes packet to authoritative firmware core
  hub.tick_radio_task();
  CHECK_EQ(hub.radio_queue_depth(), 0u);

  // 4. Verify hub processed alert via real firmware alert sink
  CHECK_EQ(received_alerts.size(), 1u);
  CHECK_EQ(received_alerts[0].node_id, 7);
  CHECK(received_alerts[0].hazard == Hazard::Medical);
  CHECK_EQ(received_alerts[0].battery, 88);
}

TEST(fitl_queue_overflow_bounds_and_counters) {
  NodeConfig cfg;
  cfg.node_id = 10;
  cfg.role = Role::Survivor;

  FirmwareNode node(cfg, nullptr);

  // Button queue capacity is 16
  for (int i = 0; i < 20; i++) {
    node.simulate_gpio_button_isr(100 + i, (i % 2 == 0));
  }
  CHECK_EQ(node.button_queue_depth(), 16u);
  CHECK_EQ(node.button_queue_overflows(), 4u);

  // Radio queue capacity is 8
  uint8_t dummy[kPacketSize] = {0};
  for (int i = 0; i < 12; i++) {
    node.simulate_radio_rx_isr(dummy, sizeof(dummy), -90, 5);
  }
  CHECK_EQ(node.radio_queue_depth(), 8u);
  CHECK_EQ(node.radio_queue_overflows(), 4u);
}

TEST(fitl_offline_node_drops_isr_events) {
  NodeConfig cfg;
  cfg.node_id = 55;
  cfg.role = Role::Survivor;

  FirmwareNode node(cfg, nullptr);
  node.set_online(false);

  bool btn_queued = node.simulate_gpio_button_isr(100, true);
  CHECK(!btn_queued);
  CHECK_EQ(node.button_queue_depth(), 0u);

  uint8_t dummy[kPacketSize] = {0};
  bool radio_queued = node.simulate_radio_rx_isr(dummy, sizeof(dummy), -90, 5);
  CHECK(!radio_queued);
  CHECK_EQ(node.radio_queue_depth(), 0u);
}

TEST(fitl_world_end_to_end_firmware_in_the_loop) {
  // End-to-end multi-node mesh test using sim::World
  // Proves that simulated GPIO button ISR propagates through FreeRTOS queue,
  // real C++ protocol state machine, LoRa channel model, Relay queue/firmware,
  // Hub alert sink, and back via ACK to stop survivor retries.
  sim::ChannelParams ch;
  ch.sf = 7;
  ch.bw_hz = 125000;
  ch.tx_dbm = 14;
  ch.path_exp = 2.5;
  ch.random_loss = 0.0;

  sim::World w(ch, 42);

  NodeConfig c;
  c.sf = 7;
  c.bw_hz = 125000;

  // Hub at (0, 0)
  c.node_id = 0;
  c.role = Role::Hub;
  w.add_node(c, 0, 0);

  // Relay at (300, 0)
  c.node_id = 101;
  c.role = Role::Relay;
  w.add_node(c, 300, 0);

  // Survivor at (600, 0) - Cannot reach Hub directly, must hop through Relay 101
  c.node_id = 1;
  c.role = Role::Survivor;
  w.add_node(c, 600, 0);

  // Block direct link between Survivor 1 and Hub 0 to enforce multi-hop relaying through Node 101
  w.block_link(1, 0, true);

  // 1. Inject physical button press ISR at Survivor #1
  // Down at t=100ms, Up at t=250ms (Short Press)
  w.firmware_button_isr(1, true);
  w.step(150); // advance to t=150
  w.firmware_button_isr(1, false);

  // 2. Run simulation until message hops to Hub and ACK returns
  w.run_until(5000);

  // 3. Inspect Survivor #1 node telemetry
  sim::SimNodeInfo s1 = w.get_node_info(1);
  CHECK(s1.acked); // Real ACK received from Hub!
  CHECK(!s1.active); // SOS episode cleanly concluded upon receiving ACK
  CHECK(s1.stats.tx_sos >= 1u);

  // 4. Inspect Relay #101 telemetry
  sim::SimNodeInfo r101 = w.get_node_info(101);
  CHECK(r101.stats.rx_total >= 1u);
  CHECK(r101.stats.tx_relay >= 1u);

  // 5. Inspect Hub #0 telemetry
  sim::SimNodeInfo hub = w.get_node_info(0);
  CHECK(hub.stats.rx_total >= 1u);
  CHECK(hub.stats.tx_ack >= 1u);
  CHECK_EQ(w.alerts().size(), 1u);
  CHECK_EQ(w.alerts()[0].origin, 1);
  CHECK(w.alerts()[0].hops >= 1); // Hopped through Relay
}
