#ifndef _USE_MATH_DEFINES
#define _USE_MATH_DEFINES
#endif
#include <cmath>
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#include "world.hpp"

#include <algorithm>
#include <limits>
#include <stdexcept>

#include "setu/duty_cycle.hpp"
#include "firmware_task_node.hpp"

namespace sim {
namespace {
constexpr double kOriginLat = 22.5726, kOriginLon = 88.4338;
constexpr double kMPerDegLat = 111320.0;
constexpr double kNegInf = -std::numeric_limits<double>::infinity();

void xy_to_e6(double x, double y, int32_t& lat, int32_t& lon) {
  lat = static_cast<int32_t>(std::lround((kOriginLat + y / kMPerDegLat) * 1e6));
  lon = static_cast<int32_t>(std::lround(
      (kOriginLon + x / (kMPerDegLat * std::cos(kOriginLat * M_PI / 180.0))) * 1e6));
}
}  // namespace

// ------------------------------------------------------------------ per-node virtual hardware

struct World::SimNode {
  World& w;
  uint16_t id;
  double x, y;
  bool online = true;
  bool gnss_on = true, dr_on = true;
  uint32_t gnss_lost_at = 0;
  uint8_t battery = 100;
  std::mt19937 rng;
  std::normal_distribution<double> gauss{0.0, 1.0};

  // Virtual FreeRTOS Queues (matching app_main.cpp)
  setu::fitl::VirtualQueue<setu::fitl::ButtonEvent, 16> button_queue;
  setu::fitl::VirtualQueue<setu::fitl::RadioRxEvent, 8> radio_queue;

  void simulate_button_isr(uint32_t at_ms, bool pressed) {
    button_queue.send_from_isr({at_ms, pressed});
  }

  void simulate_radio_isr(const uint8_t* data, size_t len, int16_t rssi, int8_t snr) {
    setu::fitl::RadioRxEvent evt;
    if (len > setu::kPacketSize) len = setu::kPacketSize;
    std::memcpy(evt.buffer, data, len);
    evt.length = len;
    evt.rssi = rssi;
    evt.snr = snr;
    radio_queue.send_from_isr(evt);
  }

  void drain_queues_and_tick() {
    // 1. Radio RX task: drain radio queue and deliver to firmware core
    setu::fitl::RadioRxEvent rx;
    while (radio_queue.receive(rx)) {
      if (rx.length == setu::kPacketSize) {
        node->on_radio_rx(rx.buffer, rx.length);
      }
    }

    // 2. Core protocol task: drain button events from GPIO ISR queue
    setu::fitl::ButtonEvent btn;
    while (button_queue.receive(btn)) {
      node->on_button_edge(btn.is_pressed);
    }

    // 3. Advance authoritative tick
    node->tick();
  }

  struct Clock : setu::IClock {
    SimNode& n;
    explicit Clock(SimNode& s) : n(s) {}
    uint32_t now_ms() const override { return n.w.now_; }
    uint32_t unix_s() const override { return 1700000000u + n.w.now_ / 1000; }
  } clock{*this};
  struct Rand : setu::IRandom {
    SimNode& n;
    explicit Rand(SimNode& s) : n(s) {}
    uint32_t uniform(uint32_t m) override { return m ? static_cast<uint32_t>(n.rng() % m) : 0; }
  } rand{*this};
  struct Radio : setu::IRadio {
    SimNode& n;
    explicit Radio(SimNode& s) : n(s) {}
    bool send(const uint8_t* d, size_t len) override { return n.w.start_tx(n.id, d, len); }
    bool channel_busy() override { return n.w.channel_busy_for(n.id); }
  } radio{*this};
  struct Gnss : setu::IGnss {
    SimNode& n;
    explicit Gnss(SimNode& s) : n(s) {}
    bool get_fix(int32_t& la, int32_t& lo) override {
      if (!n.gnss_on) return false;
      xy_to_e6(n.x + 3 * n.gauss(n.rng), n.y + 3 * n.gauss(n.rng), la, lo);  // ~3 m noise
      return true;
    }
  } gnss{*this};
  struct Dr : setu::IDeadReckoning {
    SimNode& n;
    explicit Dr(SimNode& s) : n(s) {}
    bool estimate(int32_t& la, int32_t& lo) override {
      if (!n.dr_on) return false;
      // Error grows like a random walk since the last fix: 0.8 m * sqrt(seconds).
      const double secs = std::max(1.0, (n.w.now_ - n.gnss_lost_at) / 1000.0 + 60.0);
      const double s = 0.8 * std::sqrt(secs);
      xy_to_e6(n.x + s * n.gauss(n.rng), n.y + s * n.gauss(n.rng), la, lo);
      return true;
    }
  } dr{*this};
  struct Batt : setu::IBattery {
    SimNode& n;
    explicit Batt(SimNode& s) : n(s) {}
    uint8_t percent() override { return n.battery; }
  } batt{*this};
  struct Haptic : setu::IHaptic {
    SimNode& n;
    explicit Haptic(SimNode& s) : n(s) {}
    void play(setu::HapticPattern p) override {
      if (p == setu::HapticPattern::AckReceived) n.w.acks_.push_back({n.id, n.w.now_});
      if (n.w.trace_) {
        char b[48];
        std::snprintf(b, sizeof b, ",\"pattern\":%d", static_cast<int>(p));
        n.w.trace_event("haptic", n.id, b);
      }
    }
  } haptic{*this};
  struct Sink : setu::IAlertSink {
    SimNode& n;
    explicit Sink(SimNode& s) : n(s) {}
    void on_alert(const setu::Packet& p, uint32_t t) override {
      n.w.alerts_.push_back({p.node_id, p.hazard, p.contact, p.hop, p.flags, p.battery, t});
      if (n.w.trace_) {
        char b[160];
        std::snprintf(b, sizeof b,
                      ",\"origin\":%u,\"hazard\":%d,\"hops\":%u,\"seq\":%u,\"lat_e6\":%ld,\"lon_e6\":%ld,\"battery\":%u,\"flags\":%u,\"contact\":%u",
                      p.node_id, static_cast<int>(p.hazard), p.hop, p.seq, static_cast<long>(p.lat_e6),
                      static_cast<long>(p.lon_e6), p.battery, p.flags, p.contact);
        n.w.trace_event("alert", n.id, b);
      }
    }
  } sink{*this};
  struct Trace : setu::ITraceSink {
    SimNode& n;
    explicit Trace(SimNode& s) : n(s) {}
    void on_node_event(uint16_t node_id, const char* ev, const char* extra) override {
      n.w.trace_event(ev, node_id, extra);
    }
  } trace_sink{*this};

  std::unique_ptr<setu::Node> node;

  SimNode(World& world, const setu::NodeConfig& cfg, double px, double py)
      : w(world), id(cfg.node_id), x(px), y(py), rng(world.seed_ * 2654435761u + cfg.node_id) {
    setu::Hal h;
    h.clock = &clock;
    h.rng = &rand;
    h.radio = &radio;
    h.gnss = &gnss;
    h.dr = &dr;
    h.battery = &batt;
    h.haptic = &haptic;
    h.alerts = cfg.role == setu::Role::Hub ? &sink : nullptr;
    h.trace = &trace_sink;
    node = std::make_unique<setu::Node>(cfg, h);
  }
};

// ------------------------------------------------------------------ world

World::World(const ChannelParams& ch, uint32_t seed)
    : ch_(ch), seed_(seed), sens_(setu::lora_sensitivity_dbm(ch.sf)), rng_(seed) {}
World::~World() = default;

uint16_t World::add_node(const setu::NodeConfig& cfg, double x, double y) {
  setu::NodeConfig c = cfg;
  c.sf = ch_.sf;  // one radio configuration for the whole network: node and channel must agree
  c.bw_hz = ch_.bw_hz;
  nodes_[c.node_id] = std::make_unique<SimNode>(*this, c, x, y);
  return c.node_id;
}

setu::Node& World::node(uint16_t id) { return *nodes_.at(id)->node; }

std::vector<uint16_t> World::node_ids() const {
  std::vector<uint16_t> v;
  for (auto& kv : nodes_) v.push_back(kv.first);
  return v;
}

void World::set_trace(std::ostream* os) {
  trace_ = os;
  if (trace_) dump_topology_trace();
}

void World::dump_topology_trace() {
  if (!trace_) return;
  *trace_ << "{\"t\":0,\"ev\":\"meta\",\"sf\":" << static_cast<int>(ch_.sf)
          << ",\"bw_hz\":" << ch_.bw_hz
          << ",\"tx_dbm\":" << ch_.tx_dbm
          << ",\"sens\":" << sens_
          << ",\"path_exp\":" << ch_.path_exp
          << ",\"seed\":" << seed_ << "}\n";
  for (const auto& kv : nodes_) {
    const auto& n = *kv.second;
    const char* role_str = (n.node->config().role == setu::Role::Hub) ? "hub"
                         : (n.node->config().role == setu::Role::Relay) ? "relay"
                         : "survivor";
    int32_t la = 0, lo = 0;
    xy_to_e6(n.x, n.y, la, lo);
    *trace_ << "{\"t\":0,\"ev\":\"node_init\",\"id\":" << n.id
            << ",\"role\":\"" << role_str << "\""
            << ",\"x\":" << n.x << ",\"y\":" << n.y
            << ",\"lat_e6\":" << la << ",\"lon_e6\":" << lo
            << ",\"battery\":" << static_cast<int>(n.battery)
            << ",\"online\":" << (n.online ? "true" : "false") << "}\n";
  }
  for (auto it1 = nodes_.begin(); it1 != nodes_.end(); ++it1) {
    auto it2 = it1;
    ++it2;
    for (; it2 != nodes_.end(); ++it2) {
      double r = mean_rssi(it1->first, it2->first);
      if (r >= sens_) {
        double d = std::hypot(it1->second->x - it2->second->x, it1->second->y - it2->second->y);
        *trace_ << "{\"t\":0,\"ev\":\"link_init\",\"a\":" << it1->first
                << ",\"b\":" << it2->first
                << ",\"rssi\":" << r
                << ",\"dist\":" << d << "}\n";
      }
    }
  }
}

void World::set_online(uint16_t id, bool on) {
  nodes_.at(id)->online = on;
  trace_event(on ? "node_revive" : "node_kill", id);
}
void World::set_gnss(uint16_t id, bool on) {
  auto& n = *nodes_.at(id);
  if (n.gnss_on && !on) n.gnss_lost_at = now_;
  n.gnss_on = on;
  trace_event(on ? "gps_on" : "gps_off", id);
}
void World::set_dead_reckoning(uint16_t id, bool on) {
  nodes_.at(id)->dr_on = on;
  trace_event(on ? "dr_on" : "dr_off", id);
}
void World::set_battery(uint16_t id, uint8_t pct) { nodes_.at(id)->battery = pct; }
void World::block_link(uint16_t a, uint16_t b, bool blocked) {
  auto k = std::minmax(a, b);
  if (blocked) blocked_.insert({k.first, k.second});
  else blocked_.erase({k.first, k.second});
  char buf[48];
  std::snprintf(buf, sizeof buf, ",\"to\":%u", b);
  trace_event(blocked ? "link_block" : "link_unblock", a, buf);
}
void World::schedule(uint32_t at, std::function<void()> fn) { actions_.emplace(at, std::move(fn)); }

void World::firmware_button_isr(uint16_t id, bool pressed) {
  auto it = nodes_.find(id);
  if (it == nodes_.end() || !it->second->online) return;
  it->second->simulate_button_isr(now_, pressed);
  char b[48];
  std::snprintf(b, sizeof b, ",\"edge\":%s,\"queue_depth\":%zu", pressed ? "1" : "0", it->second->button_queue.size());
  trace_event("gpio_btn_isr", id, b);
}

void World::firmware_radio_isr(uint16_t receiver_id, const uint8_t* data, size_t len, int16_t rssi, int8_t snr) {
  auto it = nodes_.find(receiver_id);
  if (it == nodes_.end() || !it->second->online) return;
  it->second->simulate_radio_isr(data, len, rssi, snr);
  char b[48];
  std::snprintf(b, sizeof b, ",\"queue_depth\":%zu", it->second->radio_queue.size());
  trace_event("radio_dio1_isr", receiver_id, b);
}

void World::button_press(uint16_t id, uint32_t at, uint32_t hold) {
  schedule(at, [this, id] {
    if (nodes_.at(id)->online) {
      trace_event("button_down", id);
      firmware_button_isr(id, true);
    }
  });
  schedule(at + hold, [this, id, hold] {
    if (nodes_.at(id)->online) {
      char b[48];
      std::snprintf(b, sizeof b, ",\"hold_ms\":%u", hold);
      trace_event("button_up", id, b);
      firmware_button_isr(id, false);
    }
  });
}
void World::wake_word(uint16_t id, uint32_t at) {
  schedule(at, [this, id] {
    if (nodes_.at(id)->online) {
      trace_event("wake_word", id);
      node(id).on_wake_word();
    }
  });
}
void World::voice_command(uint16_t id, uint32_t at, uint8_t contact, setu::Hazard hz) {
  schedule(at, [this, id, contact, hz] {
    if (nodes_.at(id)->online) {
      char b[64];
      std::snprintf(b, sizeof b, ",\"hazard\":%d,\"contact\":%u", static_cast<int>(hz), contact);
      trace_event("voice_command", id, b);
      node(id).on_voice_command(contact, hz);
    }
  });
}

// Mean received power, including the fixed per-link shadowing term.
double World::mean_rssi(uint16_t a, uint16_t b) const {
  if (a == b) return kNegInf;
  auto k = std::minmax(a, b);
  if (blocked_.count({k.first, k.second})) return kNegInf;
  const auto& na = *nodes_.at(a);
  const auto& nb = *nodes_.at(b);
  const double d = std::max(1.0, std::hypot(na.x - nb.x, na.y - nb.y));
  std::mt19937 lr(seed_ ^ (k.first * 65537u + k.second * 2246822519u));
  std::normal_distribution<double> g(0.0, ch_.shadow_sigma_db);
  const double pl = ch_.ref_loss_db + 10.0 * ch_.path_exp * std::log10(d) + ch_.extra_loss_db + g(lr);
  return ch_.tx_dbm - pl;
}

bool World::planned_connected() const {
  uint16_t hub = 0;
  for (auto& kv : nodes_)
    if (kv.second->node->config().role == setu::Role::Hub) hub = kv.first;
  std::set<uint16_t> seen{hub};
  std::vector<uint16_t> todo{hub};
  while (!todo.empty()) {
    uint16_t u = todo.back();
    todo.pop_back();
    for (auto& kv : nodes_)
      if (!seen.count(kv.first) && mean_rssi(u, kv.first) >= sens_ + ch_.connect_margin_db) {
        seen.insert(kv.first);
        todo.push_back(kv.first);
      }
  }
  return seen.size() == nodes_.size();
}

double World::position_error_m(uint16_t id, int32_t lat_e6, int32_t lon_e6) const {
  const auto& n = *nodes_.at(id);
  int32_t la, lo;
  xy_to_e6(n.x, n.y, la, lo);
  const double dy = (lat_e6 - la) * 1e-6 * kMPerDegLat;
  const double dx = (lon_e6 - lo) * 1e-6 * kMPerDegLat * std::cos(kOriginLat * M_PI / 180.0);
  return std::hypot(dx, dy);
}

int64_t World::first_ack_ms(uint16_t id, uint32_t t0) const {
  for (auto& a : acks_)
    if (a.first == id && a.second >= t0) return a.second;
  return -1;
}

void World::trace_event(const char* ev, uint16_t node, const char* extra) {
  if (!trace_) return;
  *trace_ << "{\"t\":" << now_ << ",\"ev\":\"" << ev << "\",\"node\":" << node << extra << "}\n";
}

// ------------------------------------------------------------------ radio

bool World::start_tx(uint16_t from, const uint8_t* d, size_t n) {
  for (auto& t : txs_)
    if (t.from == from && now_ < t.end) return false;  // already transmitting
  const uint32_t air = setu::lora_airtime_ms(n, ch_.sf, ch_.bw_hz);
  txs_.push_back({from, now_, now_ + air, std::vector<uint8_t>(d, d + n)});
  counters_.tx++;
  if (trace_) {
    setu::Packet p;
    setu::parse(d, n, p);
    char b[256];
    std::snprintf(b, sizeof b,
                  ",\"origin\":%u,\"seq\":%u,\"ack\":%d,\"target\":%u,\"ref_seq\":%u,\"hazard\":%d,"
                  "\"flags\":%u,\"lat_e6\":%ld,\"lon_e6\":%ld,\"battery\":%u,\"hop\":%u,\"contact\":%u,\"air\":%u",
                  p.node_id, p.seq, p.is_ack() ? 1 : 0, p.target, p.ref_seq, static_cast<int>(p.hazard),
                  p.flags, static_cast<long>(p.lat_e6), static_cast<long>(p.lon_e6), p.battery, p.hop, p.contact, air);
    trace_event("tx", from, b);
  }
  return true;
}

bool World::channel_busy_for(uint16_t id) const {
  for (auto& t : txs_)
    if (t.from != id && now_ >= t.start && now_ < t.end && mean_rssi(t.from, id) >= sens_) return true;
  return false;
}

void World::finish_tx(const Tx& tx) {
  std::normal_distribution<double> fade(0.0, ch_.fading_sigma_db);
  std::uniform_real_distribution<double> u01(0.0, 1.0);
  for (auto& kv : nodes_) {
    const uint16_t r = kv.first;
    if (r == tx.from || !kv.second->online) continue;
    const double mean = mean_rssi(tx.from, r);
    if (mean < sens_ - 6.0) continue;  // far outside range: not worth tracing
    const double rssi = mean + fade(rng_);
    char b[96];
    if (rssi < sens_) {
      counters_.weak++;
      std::snprintf(b, sizeof b, ",\"from\":%u,\"why\":\"weak\"", tx.from);
      trace_event("drop", r, b);
      continue;
    }
    bool dropped = false;
    const char* why = "";
    for (auto& o : txs_) {
      if ((o.from == tx.from && o.start == tx.start) || !(o.start < tx.end && o.end > tx.start))
        continue;  // skip the packet itself (tx is a copy) and non-overlapping ones
      if (o.from == r) {  // receiver was itself transmitting
        dropped = true;
        why = "halfduplex";
        counters_.halfduplex++;
        break;
      }
      const double ro = mean_rssi(o.from, r);
      if (ro >= sens_ && rssi - ro < ch_.capture_db) {
        dropped = true;
        why = "collision";
        counters_.collisions++;
        break;
      }
    }
    if (!dropped && ch_.random_loss > 0 && u01(rng_) < ch_.random_loss) {
      dropped = true;
      why = "loss";
      counters_.lost++;
    }
    if (dropped) {
      std::snprintf(b, sizeof b, ",\"from\":%u,\"why\":\"%s\"", tx.from, why);
      trace_event("drop", r, b);
      continue;
    }
    counters_.delivered++;
    std::snprintf(b, sizeof b, ",\"from\":%u,\"rssi\":%.1f", tx.from, rssi);
    trace_event("rx", r, b);
    firmware_radio_isr(r, tx.data.data(), tx.data.size(),
                       static_cast<int16_t>(std::lround(rssi)),
                       static_cast<int8_t>(std::clamp(static_cast<int>(rssi - sens_), -20, 20)));
  }
}

void World::run_until(uint32_t t_end) {
  for (; now_ < t_end; now_++) {
    // 1. scheduled user actions / faults
    for (auto it = actions_.begin(); it != actions_.end() && it->first <= now_;) {
      auto fn = std::move(it->second);
      it = actions_.erase(it);
      fn();
    }
    // 2. every online device drains virtual FreeRTOS queues and runs real firmware tick
    for (auto& kv : nodes_)
      if (kv.second->online) kv.second->drain_queues_and_tick();
    // 3. transmissions that end now are delivered
    std::vector<Tx> done;
    for (auto& t : txs_)
      if (t.end == now_ + 1) done.push_back(t);  // ends after this ms
    for (auto& t : done) finish_tx(t);
    // forget transmissions that can no longer overlap anything
    txs_.erase(std::remove_if(txs_.begin(), txs_.end(),
                              [&](const Tx& t) { return t.end + 6000 < now_; }),
               txs_.end());
  }
}

void World::step(uint32_t ms) {
  run_until(now_ + ms);
}

void World::reposition_node(uint16_t id, double px, double py) {
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return;
  it->second->x = px;
  it->second->y = py;
  int32_t la = 0, lo = 0;
  xy_to_e6(px, py, la, lo);
  if (trace_) {
    char b[128];
    std::snprintf(b, sizeof b, ",\"x\":%.2f,\"y\":%.2f,\"lat_e6\":%ld,\"lon_e6\":%ld",
                  px, py, static_cast<long>(la), static_cast<long>(lo));
    trace_event("reposition", id, b);
    for (const auto& kv : nodes_) {
      if (kv.first == id) continue;
      double r = mean_rssi(id, kv.first);
      double d = std::hypot(px - kv.second->x, py - kv.second->y);
      *trace_ << "{\"t\":" << now_ << ",\"ev\":\"link_update\",\"a\":" << id
              << ",\"b\":" << kv.first << ",\"rssi\":" << r << ",\"dist\":" << d
              << ",\"in_range\":" << (r >= sens_ ? "true" : "false") << "}\n";
    }
  }
}

void World::trigger_all_survivors(setu::Hazard hz, uint32_t delay_spread_ms, const std::string& kind) {
  std::vector<uint16_t> survivors;
  for (const auto& kv : nodes_) {
    if (kv.second->node->config().role == setu::Role::Survivor && kv.second->online) {
      survivors.push_back(kv.first);
    }
  }
  for (size_t i = 0; i < survivors.size(); ++i) {
    uint16_t id = survivors[i];
    uint32_t delay = 0;
    if (delay_spread_ms > 0 && survivors.size() > 1) {
      delay = nodes_.at(id)->rng() % (delay_spread_ms + 1);
    }
    uint32_t t = now_ + delay;
    if (kind == "double" || hz == setu::Hazard::Medical) {
      button_press(id, t, 120);
      button_press(id, t + 300, 120);
    } else if (kind == "long" || hz == setu::Hazard::Trapped) {
      button_press(id, t, 1700);
    } else if (kind == "voice-medical") {
      wake_word(id, t);
      voice_command(id, t + 1500, 1, setu::Hazard::Medical);
    } else if (kind == "voice-trapped") {
      wake_word(id, t);
      voice_command(id, t + 1500, 1, setu::Hazard::Trapped);
    } else {
      button_press(id, t, 150);
    }
  }
}

SimNodeInfo World::get_node_info(uint16_t id) const {
  SimNodeInfo info;
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return info;
  const auto& n = *it->second;
  info.id = id;
  info.role = n.node->config().role;
  info.x = n.x;
  info.y = n.y;
  xy_to_e6(n.x, n.y, info.lat_e6, info.lon_e6);
  info.battery = n.battery;
  info.online = n.online;
  info.gnss_on = n.gnss_on;
  info.dr_on = n.dr_on;
  info.active = n.node->sos_active();
  info.acked = n.node->sos_acked();
  info.gave_up = n.node->sos_gave_up();
  info.seq = n.node->seq();
  info.duty_used_ms = n.node->duty_used_ms();
  info.stats = n.node->stats();
  info.button_queue_depth = n.button_queue.size();
  info.radio_queue_depth = n.radio_queue.size();
  info.button_queue_overflows = n.button_queue.overflow_count();
  info.radio_queue_overflows = n.radio_queue.overflow_count();
  return info;
}

std::vector<SimNodeInfo> World::get_all_nodes_info() const {
  std::vector<SimNodeInfo> res;
  res.reserve(nodes_.size());
  for (const auto& kv : nodes_) {
    res.push_back(get_node_info(kv.first));
  }
  return res;
}

// ------------------------------------------------------------------ demo topology

std::unique_ptr<World> make_demo_world(int survivors, int relays, double zone, const ChannelParams& ch,
                                       uint32_t seed, const setu::NodeConfig& base) {
  for (uint32_t s = seed; s < seed + 500; s++) {
    auto w = std::make_unique<World>(ch, s);
    std::mt19937 r(s);
    std::uniform_real_distribution<double> jitter(-60, 60), pos(100, zone);
    setu::NodeConfig c = base;
    c.node_id = 0;
    c.role = setu::Role::Hub;
    w->add_node(c, 60, 60);
    const int cols = 3, rows = std::max(1, (relays + cols - 1) / cols);
    for (int i = 0; i < relays; i++) {
      c.node_id = static_cast<uint16_t>(100 + i);
      c.role = setu::Role::Relay;
      w->add_node(c, (i % cols + 1) * zone / (cols + 1) + jitter(r),
                  (i / cols + 1) * zone / (rows + 1) + jitter(r));
    }
    for (int i = 0; i < survivors; i++) {
      c.node_id = static_cast<uint16_t>(i + 1);
      c.role = setu::Role::Survivor;
      w->add_node(c, pos(r), pos(r));
    }
    if (w->planned_connected()) return w;
  }
  throw std::runtime_error("could not generate a connected demo topology");
}

}  // namespace sim
