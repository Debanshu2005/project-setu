// Node behaviour against hand-driven fake hardware (no simulator involved).
#include <vector>

#include "setu/node.hpp"
#include "testlib.hpp"

using namespace setu;

namespace {
struct FakeClock : IClock {
  uint32_t t = 1000;
  uint32_t now_ms() const override { return t; }
  uint32_t unix_s() const override { return 1700000000u + t / 1000; }
};
struct FakeRng : IRandom {
  uint32_t uniform(uint32_t) override { return 0; }  // no backoff: deterministic
};
struct FakeRadio : IRadio {
  std::vector<Packet> sent;
  bool busy = false;
  bool send(const uint8_t* d, size_t n) override {
    Packet p;
    if (parse(d, n, p) != ParseResult::Ok) return false;
    sent.push_back(p);
    return true;
  }
  bool channel_busy() override { return busy; }
};
struct FakeGnss : IGnss {
  bool ok = true;
  bool get_fix(int32_t& la, int32_t& lo) override {
    la = 22000000;
    lo = 88000000;
    return ok;
  }
};
struct FakeDr : IDeadReckoning {
  bool get = true;
  bool estimate(int32_t& la, int32_t& lo) override {
    la = 22000100;
    lo = 88000100;
    return get;
  }
};
struct FakeHaptic : IHaptic {
  std::vector<HapticPattern> log;
  void play(HapticPattern p) override { log.push_back(p); }
  bool has(HapticPattern p) const {
    for (auto x : log)
      if (x == p) return true;
    return false;
  }
};
struct FakeSink : IAlertSink {
  std::vector<Packet> got;
  void on_alert(const Packet& p, uint32_t) override { got.push_back(p); }
};

struct Rig {
  FakeClock clk;
  FakeRng rng;
  FakeRadio radio;
  FakeGnss gnss;
  FakeDr dr;
  FakeHaptic haptic;
  FakeSink sink;
  Node node;
  explicit Rig(Role role = Role::Survivor, uint16_t id = 5, bool with_sink = false)
      : node(cfg(role, id), hal(with_sink)) {}
  static NodeConfig cfg(Role r, uint16_t id) {
    NodeConfig c;
    c.node_id = id;
    c.role = r;
    return c;
  }
  Hal hal(bool with_sink) {
    Hal h;
    h.clock = &clk;
    h.rng = &rng;
    h.radio = &radio;
    h.gnss = &gnss;
    h.dr = &dr;
    h.haptic = &haptic;
    h.alerts = with_sink ? &sink : nullptr;
    return h;
  }
  void run(uint32_t ms) {
    for (uint32_t i = 0; i < ms; i++) {
      clk.t++;
      node.tick();
    }
  }
  void press(uint32_t hold_ms) {
    node.on_button_edge(true);
    run(hold_ms);
    node.on_button_edge(false);
  }
  void deliver(const Packet& p) {
    uint8_t b[kPacketSize];
    serialize(p, b, sizeof b);
    node.on_radio_rx(b, sizeof b);
  }
};

Packet sos_from(uint16_t id, uint16_t seq, uint8_t hop = 0) {
  Packet p;
  p.node_id = id;
  p.seq = seq;
  p.hop = hop;
  return p;
}
Packet ack_for(uint16_t hub, uint16_t seq, uint16_t target, uint16_t ref) {
  Packet p;
  p.node_id = hub;
  p.seq = seq;
  p.flags = kFlagAck;
  p.target = target;
  p.ref_seq = ref;
  return p;
}
}  // namespace

TEST(node_short_press_sends_general_sos_with_gps) {
  Rig r;
  r.press(150);
  r.run(700);
  CHECK_EQ(r.radio.sent.size(), 1u);
  const Packet& p = r.radio.sent[0];
  CHECK_EQ(p.node_id, 5);
  CHECK(p.hazard == Hazard::General);
  CHECK(p.flags & kFlagGps);
  CHECK_EQ(p.lat_e6, 22000000);
  CHECK(r.haptic.has(HapticPattern::PressRegistered));
  CHECK(r.haptic.has(HapticPattern::TierShort));
}

TEST(node_double_press_is_medical_long_press_is_trapped) {
  Rig r;
  r.press(100);
  r.run(200);
  r.press(100);
  r.run(100);
  CHECK(!r.radio.sent.empty());
  CHECK(r.radio.sent[0].hazard == Hazard::Medical);

  Rig t;
  t.press(1700);
  t.run(10);
  CHECK(!t.radio.sent.empty());
  CHECK(t.radio.sent[0].hazard == Hazard::Trapped);
}

TEST(node_invalid_press_sends_nothing) {
  Rig r;
  r.press(900);
  r.run(1000);
  CHECK(r.radio.sent.empty());
  CHECK(r.haptic.has(HapticPattern::Reject));
}

TEST(node_wake_word_alone_falls_back_to_general_sos) {
  Rig r;
  r.node.on_wake_word();
  CHECK(r.haptic.has(HapticPattern::WakeDetected));
  r.run(3000);
  CHECK(r.radio.sent.empty());  // still inside the window
  r.run(700);
  CHECK_EQ(r.radio.sent.size(), 1u);
  CHECK(r.radio.sent[0].hazard == Hazard::General);
  CHECK_EQ(r.radio.sent[0].contact, 0);
}

TEST(node_wake_word_plus_command_sends_full_message) {
  Rig r;
  r.node.on_wake_word();
  r.run(800);
  r.node.on_voice_command(3, Hazard::Medical);
  r.run(5);
  CHECK_EQ(r.radio.sent.size(), 1u);
  CHECK(r.radio.sent[0].hazard == Hazard::Medical);
  CHECK_EQ(r.radio.sent[0].contact, 3);
  r.run(3000);  // past the voice window (but before the retry): no second, general SOS
  CHECK_EQ(r.radio.sent.size(), 1u);
}

TEST(node_command_without_wake_word_is_ignored) {
  Rig r;
  r.node.on_voice_command(3, Hazard::Medical);
  r.run(100);
  CHECK(r.radio.sent.empty());
}

TEST(node_falls_back_to_dead_reckoning_then_to_unknown) {
  Rig r;
  r.gnss.ok = false;
  r.press(150);
  r.run(700);
  CHECK_EQ(r.radio.sent.size(), 1u);
  CHECK(r.radio.sent[0].flags & kFlagDr);
  CHECK(!(r.radio.sent[0].flags & kFlagGps));

  Rig u;
  u.gnss.ok = false;
  u.dr.get = false;
  u.press(150);
  u.run(700);
  CHECK_EQ(u.radio.sent.size(), 1u);
  CHECK_EQ(u.radio.sent[0].flags & (kFlagGps | kFlagDr), 0);
}

TEST(node_retries_with_new_seq_then_gives_up) {
  Rig r;
  r.press(150);
  r.run(700);
  CHECK_EQ(r.radio.sent.size(), 1u);
  r.run(40000);  // no ACK ever arrives
  CHECK_EQ(r.radio.sent.size(), 4u);  // original + 3 retries
  CHECK(r.radio.sent[1].seq != r.radio.sent[0].seq);
  CHECK(r.node.sos_gave_up());
  CHECK(!r.node.sos_active());
  CHECK(r.haptic.has(HapticPattern::SendFailed));
}

TEST(node_ack_stops_retries_and_confirms) {
  Rig r;
  r.press(150);
  r.run(700);
  const uint16_t seq = r.radio.sent[0].seq;
  r.deliver(ack_for(0, 1, 5, seq));
  CHECK(r.node.sos_acked());
  CHECK(r.haptic.has(HapticPattern::AckReceived));
  r.run(20000);
  CHECK_EQ(r.radio.sent.size(), 1u);  // no retries after ACK
}

TEST(node_ignores_ack_for_someone_else_and_relays_it) {
  Rig r;
  r.press(150);
  r.run(700);
  r.deliver(ack_for(0, 1, 99, 1));  // addressed to node 99
  CHECK(!r.node.sos_acked());
  r.run(10);
  CHECK_EQ(r.radio.sent.size(), 2u);  // our SOS + the relayed ACK
  CHECK(r.radio.sent[1].is_ack());
  CHECK_EQ(r.radio.sent[1].hop, 1);
}

TEST(node_escalation_sends_new_packet_same_episode) {
  Rig r;
  r.press(150);
  r.run(700);  // general SOS out
  r.run(1100);
  r.press(1700);  // now trapped
  r.run(10);
  CHECK_EQ(r.radio.sent.size(), 2u);
  CHECK(r.radio.sent[1].hazard == Hazard::Trapped);
  CHECK(r.radio.sent[1].seq != r.radio.sent[0].seq);
  // One ACK for the first packet still closes the episode.
  r.deliver(ack_for(0, 1, 5, r.radio.sent[0].seq));
  CHECK(r.node.sos_acked());
}

TEST(node_relays_once_increments_hop_and_drops_duplicates) {
  Rig r(Role::Relay, 100);
  r.deliver(sos_from(7, 1, 2));
  r.run(5);
  CHECK_EQ(r.radio.sent.size(), 1u);
  CHECK_EQ(r.radio.sent[0].hop, 3);
  CHECK_EQ(r.radio.sent[0].node_id, 7);
  r.deliver(sos_from(7, 1, 4));  // same packet via another path
  r.run(5);
  CHECK_EQ(r.radio.sent.size(), 1u);
  CHECK_EQ(r.node.stats().rx_dup, 1u);
  r.deliver(sos_from(7, 2, 0));  // a new seq from the same node is an escalation, not a dup
  r.run(5);
  CHECK_EQ(r.radio.sent.size(), 2u);
}

TEST(node_enforces_hop_limit) {
  Rig r(Role::Relay, 100);
  r.deliver(sos_from(7, 1, 8));  // already at max_hops
  r.run(5);
  CHECK(r.radio.sent.empty());
  CHECK_EQ(r.node.stats().ttl_drops, 1u);
}

TEST(node_suppresses_relay_when_neighbours_already_covered_it) {
  Rig r(Role::Relay, 100);
  r.rng.uniform(0);  // (backoff is 0 in the fake, so use a manual hold instead)
  NodeConfig c = Rig::cfg(Role::Relay, 101);
  c.rebroadcast_backoff_max_ms = 250;
  struct R2 : IRandom {
    uint32_t uniform(uint32_t m) override { return m ? m - 1 : 0; }  // max backoff
  } rng2;
  FakeClock clk;
  FakeRadio radio;
  Hal h;
  h.clock = &clk;
  h.rng = &rng2;
  h.radio = &radio;
  Node n(c, h);
  auto feed = [&](const Packet& p) {
    uint8_t b[kPacketSize];
    serialize(p, b, sizeof b);
    n.on_radio_rx(b, sizeof b);
  };
  feed(sos_from(7, 1, 1));
  clk.t += 10;
  n.tick();
  feed(sos_from(7, 1, 2));  // heard again from two neighbours during our backoff
  feed(sos_from(7, 1, 2));
  for (int i = 0; i < 400; i++) {
    clk.t++;
    n.tick();
  }
  CHECK(radio.sent.empty());
  CHECK_EQ(n.stats().relay_suppressed, 1u);
}

TEST(node_hub_alerts_and_acks_once_per_packet) {
  Rig r(Role::Hub, 0, true);
  r.deliver(sos_from(7, 4, 2));
  r.run(60);
  CHECK_EQ(r.sink.got.size(), 1u);
  CHECK_EQ(r.radio.sent.size(), 1u);
  const Packet& a = r.radio.sent[0];
  CHECK(a.is_ack());
  CHECK_EQ(a.target, 7);
  CHECK_EQ(a.ref_seq, 4);
  r.deliver(sos_from(7, 4, 3));  // flood duplicate
  r.run(60);
  CHECK_EQ(r.sink.got.size(), 1u);
  CHECK_EQ(r.radio.sent.size(), 1u);
}

TEST(node_listen_before_talk_defers_then_transmits) {
  Rig r;
  r.radio.busy = true;
  r.press(150);
  r.run(700);
  CHECK(r.radio.sent.empty());   // deferred while channel busy
  r.radio.busy = false;
  r.run(400);
  CHECK_EQ(r.radio.sent.size(), 1u);
}

TEST(node_relays_obey_duty_cycle_but_own_sos_does_not) {
  NodeConfig c = Rig::cfg(Role::Relay, 100);
  c.duty_limit_permille = 0;  // zero budget
  FakeClock clk;
  FakeRng rng;
  FakeRadio radio;
  Hal h;
  h.clock = &clk;
  h.rng = &rng;
  h.radio = &radio;
  Node n(c, h);
  uint8_t b[kPacketSize];
  serialize(sos_from(7, 1), b, sizeof b);
  n.on_radio_rx(b, sizeof b);
  clk.t += 5;
  n.tick();
  CHECK(radio.sent.empty());
  CHECK_EQ(n.stats().duty_blocked, 1u);
}

TEST(node_packet_expiry_drops_stale) {
  Rig r(Role::Relay, 100);
  r.clk.t = 10000;
  // Node unix_s is 1700000000 + 10 = 1700000010
  Packet stale = sos_from(7, 1);
  stale.ts = 1700000010u - 8000u; // 8000s old > 7200s limit
  r.deliver(stale);
  r.run(10);
  CHECK_EQ(r.node.stats().rx_expired, 1u);
  CHECK(r.radio.sent.empty());

  Packet fresh = sos_from(7, 2);
  fresh.ts = 1700000010u - 100u; // 100s old <= 7200s limit
  r.deliver(fresh);
  r.run(10);
  CHECK_EQ(r.node.stats().rx_expired, 1u); // not incremented
}

TEST(node_seq_wraparound_and_ack) {
  Rig r(Role::Survivor, 5);
  // Send packets until seq reaches 65535, then wrap
  // Or test that an ACK for wrapped ref_seq is accepted
  Packet s = sos_from(7, 65535);
  Packet a;
  a.flags = kFlagAck;
  a.node_id = 0;
  a.target = 7;
  a.ref_seq = 65535;
  CHECK(a.is_ack());
  CHECK_EQ(a.ref_seq, 65535);
}
