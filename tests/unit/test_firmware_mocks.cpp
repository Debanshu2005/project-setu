// Project Setu - Firmware Driver Adapters & Wire Compatibility Unit Tests
#include <cstring>
#include <string>
#include <vector>
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

TEST(sx1262_driver_init_failure_and_payload_bounds) {
  Sx1262Radio radio(5, 4, 3, 2);
  CHECK(!radio.is_ready());

  // Successful initialization
  CHECK(radio.init(868000000, 7, 125000, 14));
  CHECK(radio.is_ready());
  CHECK(radio.state() == Sx1262Radio::RadioState::Receiving);

  // Send validation: null data rejected
  CHECK(!radio.send(nullptr, 25));

  // Send validation: zero length rejected
  uint8_t payload[kPacketSize] = {0};
  CHECK(!radio.send(payload, 0));

  // Send validation: oversized length (> 25) rejected
  CHECK(!radio.send(payload, kPacketSize + 1));

  // Valid send
  CHECK(radio.send(payload, kPacketSize));
  CHECK_EQ(radio.tx_count(), 1u);

  // Injected send failure
  radio.set_mock_force_send_failure(true);
  CHECK(!radio.send(payload, kPacketSize));
  CHECK_EQ(radio.tx_count(), 1u);

  // Injected init failure
  radio.set_mock_force_init_failure(true);
  CHECK(!radio.init());
  CHECK(!radio.is_ready());
}

TEST(sx1262_driver_rx_fifo_packet_decoding) {
  Sx1262Radio radio;
  radio.init();

  uint8_t dummy_pkt[kPacketSize];
  std::memset(dummy_pkt, 0xAB, sizeof(dummy_pkt));
  radio.inject_mock_rx_packet(dummy_pkt, sizeof(dummy_pkt), -88, 9);

  uint8_t rx_buf[64] = {0};
  size_t rx_len = 0;
  int16_t rssi = 0;
  int8_t snr = 0;

  CHECK(radio.read_rx_packet(rx_buf, sizeof(rx_buf), rx_len, rssi, snr));
  CHECK_EQ(rx_len, kPacketSize);
  CHECK_EQ(rx_buf[0], 0xAB);
  CHECK_EQ(rssi, -88);
  CHECK_EQ(snr, 9);
  CHECK_EQ(radio.rx_count(), 1u);

  // Queue now empty
  CHECK(!radio.read_rx_packet(rx_buf, sizeof(rx_buf), rx_len, rssi, snr));
}

TEST(neo6m_gnss_strict_checksum_and_stale_fix_expiration) {
  Neo6mGnss gnss;
  gnss.set_mock_system_ms(1000);

  // Valid NMEA $GPRMC with correct XOR checksum (0x6A)
  const char* valid_nmea = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A";
  CHECK(gnss.feed_nmea(valid_nmea));
  CHECK(gnss.has_valid_fix());

  int32_t lat = 0, lon = 0;
  CHECK(gnss.get_fix(lat, lon));
  CHECK(lat > 0);
  CHECK(lon > 0);

  // Corrupted checksum should be rejected
  const char* corrupted_nmea = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*99";
  CHECK(!gnss.feed_nmea(corrupted_nmea));
  CHECK_EQ(gnss.checksum_errors(), 1u);

  // Stale fix timeout: advance time past 10,000 ms
  gnss.set_mock_system_ms(1000 + Neo6mGnss::kStaleTimeoutMs + 500);
  CHECK(!gnss.get_fix(lat, lon)); // Auto-expired!
}

TEST(neo6m_gnss_rmc_epoch_clock_discipline) {
  Neo6mGnss gnss;
  Esp32Clock clk;

  // Real NMEA sentence with date 15-May-2024: 150524, checksum 0x73
  gnss.set_mock_system_ms(5000);
  CHECK(gnss.feed_nmea("$GPRMC,120000,A,2230.0000,N,08820.0000,E,0.0,0.0,150524,0.0,E*73", &clk));
  // Disciplined clock should now have disciplined epoch
  CHECK(clk.is_disciplined());
  CHECK(clk.unix_s() > 1700000000u);
}

TEST(mpu6050_dr_confidence_decay_and_bounds) {
  Mpu6050DeadReckoning dr;
  dr.set_mock_system_ms(1000);

  // 1. Without GNSS anchor, estimate is not available
  int32_t lat = 0, lon = 0;
  CHECK(!dr.estimate(lat, lon));

  // 2. Anchor GNSS fix
  dr.anchor_last_gnss(22500000, 88400000);
  CHECK(dr.estimate(lat, lon));
  CHECK_EQ(lat, 22500000);

  // 3. Step displacements
  dr.update_step(0.75f, 0.0f); // 0.75m North
  CHECK_EQ(dr.steps(), 1u);
  CHECK(dr.estimate(lat, lon));
  CHECK(lat > 22500000); // Displaced North

  // 4. Confidence decay: after 5 minutes (300,000ms), estimate expires
  dr.set_mock_system_ms(1000 + Mpu6050DeadReckoning::kMaxDrAgeMs + 100);
  CHECK(!dr.estimate(lat, lon)); // Expired!
}

TEST(battery_monitor_lipo_curve_and_critical_threshold) {
  BatteryMonitor batt;
  batt.update_adc_voltage(4200);
  CHECK_EQ(batt.percent(), 100);
  CHECK(!batt.is_critical());

  batt.update_adc_voltage(3800);
  CHECK_EQ(batt.percent(), 50);

  batt.update_adc_voltage(3300);
  CHECK_EQ(batt.percent(), 0);
  CHECK(batt.is_critical());
}

TEST(node_persistent_seq_across_reboots) {
  MockClock clk;
  MockRandom rng;
  MockRadio radio;
  Hal hal{&clk, &rng, &radio, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};

  // Node boot 1 with initial_seq = 200 (from NVS)
  NodeConfig cfg1;
  cfg1.node_id = 15;
  cfg1.initial_seq = 200;
  Node node1(cfg1, hal);
  CHECK_EQ(node1.seq(), 200);

  // Trigger SOS -> advances sequence to 201
  node1.on_button_edge(true);
  clk.advance_ms(150);
  node1.on_button_edge(false);
  for (int i = 0; i < 700; i++) { clk.advance_ms(1); node1.tick(); }

  CHECK_EQ(node1.seq(), 201);
  CHECK_EQ(radio.transmitted.size(), 1u);
  CHECK_EQ(radio.transmitted[0].seq, 201);
}

TEST(node_unsynchronized_clock_never_drops_emergency_sos) {
  MockClock clk;
  MockRandom rng;
  MockRadio radio;
  Hal hal{&clk, &rng, &radio, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};

  NodeConfig relay_cfg;
  relay_cfg.node_id = 99;
  relay_cfg.role = Role::Relay;
  relay_cfg.max_packet_age_s = 60; // 60-second expiry window
  Node relay(relay_cfg, hal);

  // Local clock is disciplined
  clk.discipline_unix_time(1705000000u);

  // Incoming survivor SOS from node with un-synchronized clock (ts = 0)
  Packet p;
  p.node_id = 4;
  p.seq = 10;
  p.hazard = Hazard::General;
  p.flags = 0; // No GPS flag (unsynchronized)
  p.ts = 0;    // Unsynchronized / unknown time
  p.battery = 90;

  uint8_t wire[kPacketSize];
  serialize(p, wire, sizeof(wire));

  // Relay receives packet
  relay.on_radio_rx(wire, sizeof(wire));

  // The emergency SOS with ts = 0 MUST NOT be dropped as expired!
  CHECK_EQ(relay.stats().rx_expired, 0u);
  CHECK_EQ(relay.stats().rx_total, 1u);
}

TEST(sx1262_selective_irq_clearing_and_combined_flags) {
  Sx1262Radio radio;
  radio.init();

  // Prepare a received packet payload
  uint8_t dummy_pkt[kPacketSize];
  std::memset(dummy_pkt, 0xEE, sizeof(dummy_pkt));
  radio.inject_mock_rx_packet(dummy_pkt, sizeof(dummy_pkt), -75, 10);

  // Inject multiple concurrent IRQ flags:
  // TxDone (0x0001), RxDone (0x0002), Preamble (0x0004), and an unhandled bit (0x8000)
  radio.inject_mock_irq(Sx1262Radio::IRQ_TX_DONE | Sx1262Radio::IRQ_PREAMBLE_DETECTED | 0x8000);

  uint8_t rx_buf[64] = {0};
  Sx1262Radio::IrqResult res;
  bool handled = radio.process_irqs(res, rx_buf, sizeof(rx_buf));
  CHECK(handled);
  CHECK(res.tx_done);
  CHECK(res.rx_done);
  CHECK_EQ(res.rx_len, kPacketSize);
  CHECK_EQ(rx_buf[0], 0xEE);
  CHECK_EQ(res.rx_rssi, -75);
  CHECK_EQ(res.rx_snr, 10);

  // Verify raw_irqs captured all active flags
  CHECK((res.raw_irqs & Sx1262Radio::IRQ_TX_DONE) != 0);
  CHECK((res.raw_irqs & Sx1262Radio::IRQ_RX_DONE) != 0);
  CHECK((res.raw_irqs & 0x8000) != 0);

  // Selective clearing check: TX_DONE, RX_DONE, and PREAMBLE were cleared,
  // but unhandled 0x8000 remains pending and was NOT cleared!
  CHECK_EQ(radio.mock_pending_irqs(), 0x8000);

  // Cleanly clear remaining flag via explicit clear_irq_status
  radio.clear_irq_status(0x8000);
  CHECK_EQ(radio.mock_pending_irqs(), 0);
}

TEST(sx1262_rx_crc_error_and_timeout_recovery) {
  Sx1262Radio radio;
  radio.init();

  // 1. Simulate RxDone with CRC Error
  radio.inject_mock_irq(Sx1262Radio::IRQ_RX_DONE | Sx1262Radio::IRQ_CRC_ERR);
  Sx1262Radio::IrqResult res;
  uint8_t rx_buf[64] = {0};
  bool handled = radio.process_irqs(res, rx_buf, sizeof(rx_buf));
  CHECK(handled);
  CHECK(res.crc_error);
  CHECK(!res.rx_done);
  CHECK_EQ(radio.crc_errors(), 1u);
  CHECK_EQ(radio.mock_pending_irqs(), 0);

  // 2. Simulate Transmission Timeout
  radio.inject_mock_irq(Sx1262Radio::IRQ_TIMEOUT);
  res = {};
  handled = radio.process_irqs(res, rx_buf, sizeof(rx_buf));
  CHECK(handled);
  CHECK(res.timeout);
  CHECK(!res.tx_done);
  CHECK_EQ(radio.mock_pending_irqs(), 0);
  CHECK(radio.state() == Sx1262Radio::RadioState::Receiving);
}

TEST(nmea_framer_streaming_partial_multiple_and_overflow) {
  NmeaFramer framer;
  std::vector<std::string> sentences;
  auto cb = [&](const char* s) { sentences.emplace_back(s); };

  // 1. Chunked delivery of a single sentence across multiple pushes
  const char* chunk1 = "$GPRMC,123519,A,4807.038";
  const char* chunk2 = ",N,01131.000,E,022.4,084.4,230394,003.1,W*6A\r\n";
  framer.push_bytes(chunk1, std::strlen(chunk1), cb);
  CHECK(sentences.empty());
  framer.push_bytes(chunk2, std::strlen(chunk2), cb);
  CHECK_EQ(sentences.size(), 1u);
  CHECK(sentences[0] == "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A");

  // 2. Garbage prefix before valid sentence start ($)
  sentences.clear();
  const char* noisy = "\xFF\xFE\xDDGARBAGE_BYTES_#@!$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47\n";
  framer.push_bytes(noisy, std::strlen(noisy), cb);
  CHECK_EQ(sentences.size(), 1u);
  CHECK(sentences[0] == "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47");
  CHECK(framer.dropped_bytes() > 0);

  // 3. Multiple back-to-back sentences in a single stream push
  sentences.clear();
  const char* multi = "$GPRMC,1*2A\r\n$GPGGA,2*3B\r\n";
  framer.push_bytes(multi, std::strlen(multi), cb);
  CHECK_EQ(sentences.size(), 2u);
  CHECK(sentences[0] == "$GPRMC,1*2A");
  CHECK(sentences[1] == "$GPGGA,2*3B");

  // 4. Overflow protection (> 128 bytes without line ending)
  sentences.clear();
  std::string oversized = "$" + std::string(150, 'X') + "\r\n";
  framer.push_bytes(oversized.data(), oversized.size(), cb);
  CHECK(sentences.empty()); // Oversized sentence must be discarded

  // 5. Clean recovery after overflow: next valid sentence parses successfully
  const char* recovery = "$GPRMC,OK*00\r\n";
  framer.push_bytes(recovery, std::strlen(recovery), cb);
  CHECK_EQ(sentences.size(), 1u);
  CHECK(sentences[0] == "$GPRMC,OK*00");
}

TEST(mpu6050_step_detector_cadence_and_gnss_anchoring_policy) {
  Mpu6050DeadReckoning dr;

  // 1. Initial fix: accepted unconditionally to seed un-anchored estimator
  dr.set_mock_system_ms(1000);
  CHECK(dr.anchor_gnss_filtered(22500000, 88400000, 3));

  // 2. Step detection cadence test
  // Initial peak at t = 1000ms
  dr.sample(0, 0, 10500, 0, 0, 0, 20); // ~12.57 m/s^2 > 11.8f
  CHECK_EQ(dr.steps(), 0u);

  // Trough at t = 1350ms (cadence = 1350ms, valid first step)
  dr.set_mock_system_ms(1350);
  dr.sample(0, 0, 6500, 0, 0, 0, 20); // ~7.78 m/s^2 < 8.6f
  CHECK_EQ(dr.steps(), 1u);

  // Second step attempted too quickly:
  // Peak at t = 1400ms, trough at t = 1450ms (cadence = 100ms < 250ms -> rejected)
  dr.set_mock_system_ms(1400);
  dr.sample(0, 0, 10500, 0, 0, 0, 20);
  dr.set_mock_system_ms(1450);
  dr.sample(0, 0, 6500, 0, 0, 0, 20);
  CHECK_EQ(dr.steps(), 1u); // Rejected, count remains 1

  // Third step with valid cadence:
  // Peak at t = 1750ms, trough at t = 1900ms (cadence = 1900 - 1350 = 550ms -> accepted)
  dr.set_mock_system_ms(1750);
  dr.sample(0, 0, 10500, 0, 0, 0, 20);
  dr.set_mock_system_ms(1900);
  dr.sample(0, 0, 6500, 0, 0, 0, 20);
  CHECK_EQ(dr.steps(), 2u);

  // 3. GNSS Anchoring Policy test
  // Subsequent fix with low satellite count (< 5): rejected
  CHECK(!dr.anchor_gnss_filtered(22500010, 88400010, 4));

  // Subsequent fix with 8 satellites, but only 5 seconds elapsed and < 15m displacement: rejected
  dr.set_mock_system_ms(6000); // 5000ms after anchor at 1000ms
  CHECK(!dr.anchor_gnss_filtered(22500010, 88400010, 8));

  // Subsequent fix after 30+ seconds (dt = 35000 - 1000 = 34s >= 30s): accepted
  dr.set_mock_system_ms(35000);
  CHECK(dr.anchor_gnss_filtered(22500010, 88400010, 8));

  // Subsequent fix with large displacement (> 15m) within 2 seconds: accepted
  dr.set_mock_system_ms(37000);
  CHECK(dr.anchor_gnss_filtered(22501000, 88401000, 8)); // ~110m away
}

TEST(single_owner_protocol_queue_saturation_and_ack) {
  MockClock clk;
  MockRandom rng;
  MockRadio radio;
  Hal hal{&clk, &rng, &radio, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};

  NodeConfig cfg;
  cfg.node_id = 42;
  Node node(cfg, hal);

  // Model bounded FreeRTOS queue (capacity = 16)
  struct RxQueueItem {
    uint8_t buf[kPacketSize];
    size_t len;
  };
  constexpr size_t kQueueCap = 16;
  std::vector<RxQueueItem> rx_queue;
  uint32_t rx_drops = 0;

  // Create an ACK packet targeted to node 42
  Packet ack_pkt;
  ack_pkt.node_id = 99;
  ack_pkt.seq = 500;
  ack_pkt.target = 42;
  ack_pkt.ref_seq = 1;
  ack_pkt.hazard = Hazard::General;
  ack_pkt.flags = kFlagAck;
  uint8_t wire[kPacketSize];
  serialize(ack_pkt, wire, sizeof(wire));

  // Push 16 packets into bounded queue -> all succeed
  for (size_t i = 0; i < kQueueCap; ++i) {
    if (rx_queue.size() < kQueueCap) {
      RxQueueItem item;
      std::memcpy(item.buf, wire, sizeof(wire));
      item.len = sizeof(wire);
      rx_queue.push_back(item);
    } else {
      rx_drops++;
    }
  }
  CHECK_EQ(rx_queue.size(), kQueueCap);
  CHECK_EQ(rx_drops, 0u);

  // 17th packet -> drops cleanly without queue corruption
  if (rx_queue.size() < kQueueCap) {
    RxQueueItem item;
    std::memcpy(item.buf, wire, sizeof(wire));
    item.len = sizeof(wire);
    rx_queue.push_back(item);
  } else {
    rx_drops++;
  }
  CHECK_EQ(rx_queue.size(), kQueueCap);
  CHECK_EQ(rx_drops, 1u);

  // Single-owner protocol task drains queue sequentially
  for (const auto& item : rx_queue) {
    node.on_radio_rx(item.buf, item.len);
  }
  rx_queue.clear();

  // Verify protocol processed packets without error
  CHECK_EQ(node.stats().rx_total, 16u);
}

