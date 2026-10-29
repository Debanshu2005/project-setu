// Multi-node scenarios: the real core running over the modelled RF channel.
#include <iostream>
#include "testlib.hpp"
#include "world.hpp"

using namespace sim;
using setu::Hazard;
using setu::NodeConfig;
using setu::Role;

namespace {
// Deterministic channel: no shadowing/fading, so 300 m links work and 600 m links do not.
ChannelParams clean() {
  ChannelParams c;
  c.shadow_sigma_db = 0;
  c.fading_sigma_db = 0;
  return c;
}
void add(World& w, uint16_t id, Role r, double x, double y) {
  NodeConfig c;
  c.node_id = id;
  c.role = r;
  w.add_node(c, x, y);
}
// hub(0,0) -- relay100 --  survivor1(500,0) via two disjoint relays 100 and 101
std::unique_ptr<World> diamond(const ChannelParams& ch = clean(), uint32_t seed = 1) {
  auto w = std::make_unique<World>(ch, seed);
  add(*w, 0, Role::Hub, 0, 0);
  add(*w, 100, Role::Relay, 250, 150);
  add(*w, 101, Role::Relay, 250, -150);
  add(*w, 1, Role::Survivor, 500, 0);
  return w;
}
const AlertRecord* alert_from(World& w, uint16_t id) {
  for (auto& a : w.alerts())
    if (a.origin == id) return &a;
  return nullptr;
}
}  // namespace

TEST(channel_model_sanity) {
  auto w = diamond();
  CHECK(w->mean_rssi(0, 100) >= w->sensitivity() + 3);   // neighbours connect
  CHECK(w->mean_rssi(0, 1) < w->sensitivity());          // hub cannot hear the survivor directly
  CHECK(w->planned_connected());
}

TEST(sos_travels_two_hops_and_ack_returns) {
  auto w = diamond();
  w->button_press(1, 1000, 1700);  // long press -> trapped
  w->run_until(15000);
  const AlertRecord* a = alert_from(*w, 1);
  CHECK(a != nullptr);
  if (a) {
    CHECK(a->hazard == Hazard::Trapped);
    CHECK_EQ(a->hops, 1);  // one relay in between
    CHECK(a->t_ms - 1500 < 1500u);  // trapped fires at 2500 ms; reaches the hub within ~1.5 s
    CHECK(a->flags & setu::kFlagGps);
  }
  CHECK(w->first_ack_ms(1, 1000) > 0);
  CHECK(w->node(1).sos_acked());
}

TEST(each_press_pattern_maps_to_hazard_at_the_hub) {
  auto w = diamond();
  w->button_press(1, 1000, 150);          // short
  w->run_until(12000);
  CHECK(alert_from(*w, 1) && alert_from(*w, 1)->hazard == Hazard::General);

  auto w2 = diamond();
  w2->button_press(1, 1000, 120);
  w2->button_press(1, 1300, 120);         // double
  w2->run_until(12000);
  CHECK(alert_from(*w2, 1) && alert_from(*w2, 1)->hazard == Hazard::Medical);
}

TEST(voice_full_message_and_wake_word_fallback) {
  auto w = diamond();
  w->wake_word(1, 1000);
  w->voice_command(1, 2500, 3, Hazard::Medical);
  w->run_until(12000);
  const AlertRecord* a = alert_from(*w, 1);
  CHECK(a != nullptr);
  if (a) {
    CHECK(a->hazard == Hazard::Medical);
    CHECK_EQ(a->contact, 3);
  }

  auto w2 = diamond();
  w2->wake_word(1, 1000);  // no command: falls back to a general SOS after ~3.5 s
  w2->run_until(12000);
  const AlertRecord* b = alert_from(*w2, 1);
  CHECK(b != nullptr);
  if (b) {
    CHECK(b->hazard == Hazard::General);
    CHECK(b->t_ms > 4400u);
  }
}

TEST(sos_survives_a_dead_relay) {
  auto w = diamond();
  w->schedule(500, [&] { w->set_online(100, false); });
  w->button_press(1, 1000, 150);
  w->run_until(15000);
  CHECK(alert_from(*w, 1) != nullptr);
  CHECK(w->node(1).sos_acked());
}

TEST(sos_survives_a_blocked_link) {
  auto w = diamond();
  w->block_link(1, 100);
  w->block_link(0, 101);  // leaves hub-100 and 101-survivor: only 100<->101 bridges them
  w->button_press(1, 1000, 150);
  w->run_until(20000);
  CHECK(alert_from(*w, 1) != nullptr);
  const AlertRecord* a = alert_from(*w, 1);
  if (a) CHECK_EQ(a->hops, 2);  // survivor -> 101 -> 100 -> hub
}

TEST(no_route_means_retries_then_gives_up) {
  auto w = diamond();
  w->set_online(100, false);
  w->set_online(101, false);
  w->button_press(1, 1000, 150);
  w->run_until(60000);
  CHECK(alert_from(*w, 1) == nullptr);
  CHECK(w->node(1).sos_gave_up());
  CHECK_EQ(w->node(1).stats().retries, 3u);
  CHECK_EQ(w->node(1).stats().tx_sos, 4u);
}

TEST(retries_recover_from_packet_loss) {
  ChannelParams ch = clean();
  ch.random_loss = 0.35;
  auto w = diamond(ch, 3);
  w->button_press(1, 1000, 150);
  w->run_until(60000);
  CHECK(alert_from(*w, 1) != nullptr);
  CHECK(w->counters().lost > 0);
}

TEST(gnss_loss_falls_back_to_dead_reckoning_then_unknown) {
  auto w = diamond();
  w->set_gnss(1, false);
  w->button_press(1, 1000, 150);
  w->run_until(12000);
  const AlertRecord* a = alert_from(*w, 1);
  CHECK(a != nullptr);
  if (a) {
    CHECK(a->flags & setu::kFlagDr);
    CHECK(!(a->flags & setu::kFlagGps));
  }

  auto w2 = diamond();
  w2->set_gnss(1, false);
  w2->set_dead_reckoning(1, false);
  w2->button_press(1, 1000, 150);
  w2->run_until(12000);
  const AlertRecord* b = alert_from(*w2, 1);
  CHECK(b != nullptr);
  if (b) CHECK_EQ(b->flags & (setu::kFlagGps | setu::kFlagDr), 0);
}

TEST(escalation_general_then_trapped_both_reach_hub) {
  auto w = diamond();
  w->button_press(1, 1000, 150);   // general at ~1.75 s
  w->button_press(1, 4000, 1700);  // trapped at ~5.5 s (before any retry)
  w->run_until(20000);
  int general = 0, trapped = 0;
  for (auto& a : w->alerts())
    if (a.origin == 1) (a.hazard == Hazard::Trapped ? trapped : general)++;
  CHECK(general >= 1);
  CHECK(trapped >= 1);
  CHECK(w->node(1).sos_acked());
}

TEST(flood_terminates_without_loops_in_a_big_mesh) {
  ChannelParams ch;  // default: shadowing + fading on
  auto w = make_demo_world(20, 5, 1200, ch, 7);
  w->set_trace(&std::cout);
  const size_t n = w->node_ids().size();
  w->button_press(7, 1000, 1700);
  w->run_until(30000);
  CHECK(alert_from(*w, 7) != nullptr);
  const auto& s7 = w->node(7).stats();
  std::printf("\nDEBUG Node 7: acked=%d retries=%u tx_sos=%u tx_ack=%u tx_relay=%u queue_drops=%u duty_blocked=%u\n",
              w->node(7).sos_acked(), s7.retries, s7.tx_sos, s7.tx_ack, s7.tx_relay, s7.queue_drops, s7.duty_blocked);
  auto n7 = w->get_node_info(7);
  std::printf("Node 7 pos: (%.1f, %.1f). Links from Node 7:\n", n7.x, n7.y);
  for (auto id : w->node_ids()) {
    if (id == 7) continue;
    double r = w->mean_rssi(7, id);
    if (r >= w->sensitivity() - 6.0) {
      auto o = w->get_node_info(id);
      std::printf("  -> Node %u (%s) at (%.1f, %.1f): dist=%.1fm rssi=%.1f dBm\n",
                  id, o.role == Role::Hub ? "Hub" : (o.role == Role::Relay ? "Relay" : "Survivor"),
                  o.x, o.y, std::hypot(n7.x - o.x, n7.y - o.y), r);
    }
  }
  std::printf("Node 7 radio events (received/dropped):\n");
  // Let's check Node 7's dedup cache or queue
  std::printf("Node 7 stats: retries=%u tx_sos=%u\n", s7.retries, s7.tx_sos);
  CHECK(w->node(7).sos_acked());
  uint64_t tx = 0;
  for (auto id : w->node_ids()) {
    const auto& s = w->node(id).stats();
    tx += s.tx_sos + s.tx_ack + s.tx_relay;
    // a node relays each unique packet at most once: SOS flood + ACK flood
    CHECK(s.tx_relay <= 2 * (1 + s.retries) + 2);
  }
  CHECK(tx <= 2 * n * (1 + 3) + 10);
}

TEST(simultaneous_sos_from_many_survivors_all_get_through) {
  ChannelParams ch;
  auto w = make_demo_world(20, 5, 1200, ch, 7);
  for (uint16_t id = 1; id <= 8; id++) w->button_press(id, 1000, 150);  // same instant
  w->run_until(60000);
  int delivered = 0, acked = 0;
  for (uint16_t id = 1; id <= 8; id++) {
    if (alert_from(*w, id)) delivered++;
    if (w->node(id).sos_acked()) acked++;
  }
  CHECK_EQ(delivered, 8);
  CHECK_EQ(acked, 8);
}

TEST(simulation_is_deterministic) {
  auto run = [] {
    ChannelParams ch;
    ch.random_loss = 0.1;
    auto w = make_demo_world(15, 4, 1000, ch, 11);
    w->button_press(3, 1000, 150);
    w->button_press(9, 1200, 1700);
    w->run_until(30000);
    return std::make_pair(w->counters().tx, w->counters().delivered);
  };
  CHECK(run() == run());
}

TEST(multi_interferer_cumulative_collision) {
  ChannelParams ch = clean();
  auto w = std::make_unique<World>(ch, 42);
  add(*w, 0, Role::Hub, 0, 0);
  // S1 at d=23.15m: RSSI ~ -80 dBm
  add(*w, 1, Role::Survivor, 23.15, 0);
  // S2 at d=36.79m: RSSI ~ -87 dBm (7 dB below S1)
  add(*w, 2, Role::Survivor, 36.79, 0);
  // S3 at d=36.79m: RSSI ~ -87 dBm (7 dB below S1)
  add(*w, 3, Role::Survivor, 0, 36.79);

  // Classic hidden-node scenario: survivors cannot hear each other (blocked by rubble),
  // but all three reach the central Hub.
  w->block_link(1, 2);
  w->block_link(1, 3);
  w->block_link(2, 3);

  const double r1 = w->mean_rssi(1, 0);
  const double r2 = w->mean_rssi(2, 0);
  const double r3 = w->mean_rssi(3, 0);
  CHECK(r1 - r2 >= 6.0); // each alone >= 6 dB capture
  CHECK(r1 - r3 >= 6.0);

  // All 3 transmit at t=1000ms simultaneously (short press released at 1150ms, double_gap expires at 1750ms, airtime 62ms finishes at 1812ms)
  w->button_press(1, 1000, 150);
  w->button_press(2, 1000, 150);
  w->button_press(3, 1000, 150);

  // Run past initial transmission window (1850ms)
  w->run_until(1850);

  // Survivor 1 must have collided due to cumulative interference P_int = P2 + P3 (-84 dBm, SIR = 4 dB < 6 dB)
  CHECK_EQ(w->alerts().size(), 0u);
  CHECK(w->counters().collisions >= 1);
}
