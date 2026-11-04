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
#include <iostream>

#include "setu/duty_cycle.hpp"
#include "firmware_task_node.hpp"

namespace sim {
namespace {
constexpr double kNegInf = -std::numeric_limits<double>::infinity();

inline uint64_t hash64(uint64_t a, uint64_t b, uint64_t c, uint64_t d) {
  uint64_t x = a ^ (b * 0xBF58476D1CE4E5B9ULL);
  x ^= (c * 0x94D049BB133111EBULL);
  x ^= (d * 0x45D9F3B3335A3619ULL);
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
  x = x ^ (x >> 31);
  return x;
}

inline double hash_gaussian(uint32_t seed, uint32_t tx_id, uint16_t rx_id, uint32_t salt, double sigma) {
  if (sigma <= 0.0) return 0.0;
  uint64_t h1 = hash64(seed, tx_id, rx_id, salt);
  uint64_t h2 = hash64(seed, tx_id, rx_id, salt ^ 0x5555555555555555ULL);
  double u1 = std::max(1e-12, (h1 & 0xFFFFFFFFFFFFULL) / static_cast<double>(0x1000000000000ULL));
  double u2 = (h2 & 0xFFFFFFFFFFFFULL) / static_cast<double>(0x1000000000000ULL);
  double z = std::sqrt(-2.0 * std::log(u1)) * std::cos(2.0 * M_PI * u2);
  return z * sigma;
}

inline double hash_uniform(uint32_t seed, uint32_t tx_id, uint16_t rx_id, uint32_t salt) {
  uint64_t h = hash64(seed, tx_id, rx_id, salt);
  return (h & 0xFFFFFFFFFFFFULL) / static_cast<double>(0x1000000000000ULL);
}
}  // namespace

void xy_to_e6(double x, double y, int32_t& lat, int32_t& lon) {
  lat = static_cast<int32_t>(std::lround((kOriginLat + y / kMPerDegLat) * 1e6));
  lon = static_cast<int32_t>(std::lround(
      (kOriginLon + x / (kMPerDegLat * std::cos(kOriginLat * M_PI / 180.0))) * 1e6));
}

void e6_to_xy(int32_t lat, int32_t lon, double& x, double& y) {
  y = (lat * 1e-6 - kOriginLat) * kMPerDegLat;
  x = (lon * 1e-6 - kOriginLon) * (kMPerDegLat * std::cos(kOriginLat * M_PI / 180.0));
}

// ------------------------------------------------------------------ per-node virtual hardware

struct World::SimNode {
  World& w;
  uint16_t id;
  double x, y;
  bool online = true;
  bool gnss_on = true, dr_on = true;
  uint32_t gnss_lost_at = 0;
  double heading_rad = -1.0;
  uint8_t battery = 100;
  uint8_t initial_battery = 100;
  double battery_fraction = 100.0;
  double energy_consumed_mah = 0.0;
  FallDetector fall_detector;
  bool fall_sos_triggered = false;
  std::mt19937 rng;
  std::normal_distribution<double> gauss{0.0, 1.0};
  setu::Xoshiro256PlusPlus prng;

  void consume_energy(double pct, const char* reason) {
    if (!online || battery == 0) return;
    battery_fraction = std::max(0.0, battery_fraction - pct);
    uint8_t new_batt = static_cast<uint8_t>(std::clamp(std::round(battery_fraction), 0.0, 100.0));
    energy_consumed_mah += (pct / 100.0) * w.ch_.battery_capacity_mah;
    if (new_batt != battery) {
      battery = new_batt;
      char b[96];
      std::snprintf(b, sizeof b, ",\"battery\":%u,\"why\":\"%s\",\"mah\":%.3f",
                    static_cast<unsigned int>(battery), reason, energy_consumed_mah);
      w.trace_event("battery", id, b);
      if (battery == 0) {
        online = false;
        w.trace_event("battery_depleted", id, ",\"why\":\"battery_exhausted\"");
      }
    }
  }

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

  Mpu6050SensorModel imu_sensor;
  GnssSensorModel gnss_sensor;
  PositionMetricsTracker pos_tracker;
  BatteryEnergyModel energy_model;

  void consume_energy_ma(double current_ma, double duration_ms, const char* reason) {
    if (!online || battery == 0 || duration_ms <= 0.0) return;
    double hours = duration_ms / 3600000.0;
    double mah = current_ma * hours;
    energy_consumed_mah += mah;
    energy_model.consume_energy(current_ma, duration_ms);
    uint8_t new_batt = energy_model.percent();
    battery_fraction = static_cast<double>(new_batt);
    if (new_batt != battery) {
      battery = new_batt;
      char b[96];
      std::snprintf(b, sizeof b, ",\"battery\":%u,\"why\":\"%s\",\"mah\":%.3f",
                    static_cast<unsigned int>(battery), reason, energy_consumed_mah);
      w.trace_event("battery", id, b);
      if (battery == 0) {
        online = false;
        w.trace_event("battery_depleted", id, ",\"why\":\"battery_exhausted\"");
      }
    }
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
    uint32_t uniform(uint32_t m) override {
      if (!m) return 0;
      if (n.w.ch_.profile == RealismProfile::Baseline) {
        return static_cast<uint32_t>(n.rng() % m);
      }
      return static_cast<uint32_t>(n.prng.next_u64() % m);
    }
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
      int32_t gt_la = 0, gt_lo = 0;
      xy_to_e6(n.x, n.y, gt_la, gt_lo);
      bool ok = n.gnss_sensor.update(n.w.now_, n.x, n.y, gt_la, gt_lo, la, lo);
      if (ok) {
        n.pos_tracker.record_sample(n.x, n.y, gt_la, gt_lo, la, lo, false, true);
      }
      return ok;
    }
  } gnss{*this};
  struct Dr : setu::IDeadReckoning {
    SimNode& n;
    explicit Dr(SimNode& s) : n(s) {}
    bool estimate(int32_t& la, int32_t& lo) override {
      if (!n.dr_on) return false;
      int32_t gt_la = 0, gt_lo = 0;
      xy_to_e6(n.x, n.y, gt_la, gt_lo);
      if (n.w.ch_.profile == RealismProfile::Baseline) {
        // Produce physical 3-axis IMU sample and integrate dead-reckoning
        n.imu_sensor.update(n.w.now_);
        // Error grows like a random walk since the last fix: 0.8 m * sqrt(seconds).
        const double secs = std::max(1.0, (n.w.now_ - n.gnss_lost_at) / 1000.0 + 60.0);
        const double s = 0.8 * std::sqrt(secs);
        xy_to_e6(n.x + s * n.gauss(n.rng), n.y + s * n.gauss(n.rng), la, lo);
        n.pos_tracker.record_sample(n.x, n.y, gt_la, gt_lo, la, lo, true, false);
        return true;
      }
      // Field profile: Physical step-and-heading pedestrian dead reckoning
      ImuSample s = n.imu_sensor.update(n.w.now_);
      const double secs = std::max(1.0, (n.w.now_ - n.gnss_lost_at) / 1000.0 + 60.0);
      double heading_err = 0.005 * std::sqrt(secs) * n.prng.gaussian(0.0, 1.0);
      double dr_heading = s.heading_rad + heading_err;
      double bias_drift = 0.8 * std::sqrt(secs);
      double dr_x = n.x + bias_drift * std::cos(dr_heading);
      double dr_y = n.y + bias_drift * std::sin(dr_heading);
      xy_to_e6(dr_x, dr_y, la, lo);
      n.pos_tracker.record_sample(n.x, n.y, gt_la, gt_lo, la, lo, true, false);
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
      if (n.w.ch_.profile == RealismProfile::Field) {
        n.consume_energy_ma(BatteryEnergyModel::kCurrentHapticMa, 200.0, "haptic");
      }
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
      uint32_t latency = 0;
      auto it = n.w.orig_time_.find({p.node_id, p.seq});
      if (it != n.w.orig_time_.end()) {
        latency = (t >= it->second) ? (t - it->second) : 0;
      }
      n.w.alerts_.push_back({p.node_id, p.hazard, p.contact, p.hop, p.flags, p.battery, t, latency});
      if (n.w.trace_) {
        char b[192];
        std::snprintf(b, sizeof b,
                      ",\"origin\":%u,\"hazard\":%d,\"hops\":%u,\"seq\":%u,\"lat_e6\":%ld,\"lon_e6\":%ld,\"battery\":%u,\"flags\":%u,\"contact\":%u,\"latency_ms\":%u",
                      p.node_id, static_cast<int>(p.hazard), p.hop, p.seq, static_cast<long>(p.lat_e6),
                      static_cast<long>(p.lon_e6), p.battery, p.flags, p.contact, latency);
        n.w.trace_event("alert", n.id, b);
      }
    }
  } sink{*this};
  struct Trace : setu::ITraceSink {
    SimNode& n;
    explicit Trace(SimNode& s) : n(s) {}
    void on_node_event(uint16_t node_id, const char* ev, const char* extra) override {
      if (std::strcmp(ev, "originate") == 0 && extra) {
        const char* p = std::strstr(extra, "\"seq\":");
        if (p) {
          uint16_t sq = static_cast<uint16_t>(std::atoi(p + 6));
          n.w.orig_time_[{node_id, sq}] = n.w.now_;
        }
      }
      n.w.trace_event(ev, node_id, extra);
    }
  } trace_sink{*this};

  std::unique_ptr<setu::Node> node;

  SimNode(World& world, const setu::NodeConfig& cfg, double px, double py, uint8_t init_batt = 100)
      : w(world), id(cfg.node_id), x(px), y(py),
        battery(std::min<uint8_t>(100, init_batt)),
        initial_battery(std::min<uint8_t>(100, init_batt)),
        battery_fraction(std::min<uint8_t>(100, init_batt)),
        rng(world.seed_ * 2654435761u + cfg.node_id),
        prng(world.seed_ * 2654435761u + cfg.node_id),
        imu_sensor(world.seed_ * 10007u + cfg.node_id, world.ch_.profile == RealismProfile::Baseline),
        gnss_sensor(world.seed_ * 10009u + cfg.node_id, world.ch_.profile == RealismProfile::Baseline),
        energy_model(world.ch_.battery_capacity_mah, init_batt) {
    if (battery == 0) online = false;
    int32_t init_la = 0, init_lo = 0;
    xy_to_e6(px, py, init_la, init_lo);
    pos_tracker.update_ground_truth(px, py, init_la, init_lo);
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
    : ch_(ch), seed_(seed), sens_(setu::lora_sensitivity_dbm(ch.sf)), rng_(seed), prng_(seed) {
  if (ch_.profile == RealismProfile::Baseline) {
    // Baseline is legacy profile (pinned to 300 mAh capacity and legacy percentage model)
  } else {
    // All non-baseline profiles default to 1000 mAh LiPo
    if (ch_.battery_capacity_mah == 300.0) {
      ch_.battery_capacity_mah = 1000.0;
    }
    if (ch_.profile == RealismProfile::Idealized) {
      ch_.path_exp = 2.0;
      ch_.shadow_sigma_db = 0.0;
      ch_.fading_sigma_db = 0.0;
      ch_.extra_loss_db = 0.0;
      ch_.random_loss = 0.0;
    }
  }
}
World::~World() = default;

uint16_t World::add_node(const setu::NodeConfig& cfg, double x, double y, uint8_t initial_battery) {
  setu::NodeConfig c = cfg;
  c.sf = ch_.sf;  // one radio configuration for the whole network: node and channel must agree
  c.bw_hz = ch_.bw_hz;
  nodes_[c.node_id] = std::make_unique<SimNode>(*this, c, x, y, initial_battery);
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
        if (ch_.profile == RealismProfile::Baseline) {
          *trace_ << "{\"t\":0,\"ev\":\"link_init\",\"a\":" << it1->first
                  << ",\"b\":" << it2->first
                  << ",\"rssi\":" << r
                  << ",\"dist\":" << d << "}\n";
        } else {
          LossBudget lb = get_loss_budget(it1->first, it2->first);
          *trace_ << "{\"t\":0,\"ev\":\"link_init\",\"a\":" << it1->first
                  << ",\"b\":" << it2->first
                  << ",\"rssi\":" << r
                  << ",\"dist\":" << d
                  << ",\"path_loss\":" << lb.path_loss_db
                  << ",\"shadow\":" << lb.shadow_loss_db
                  << ",\"link_margin\":" << lb.link_margin_db
                  << ",\"obstacle\":\"" << lb.obstacle_loss << "\""
                  << ",\"body\":\"" << lb.body_loss << "\"}\n";
        }
      }
    }
  }
}

void World::add_obstacle(const Obstacle& obs) {
  obstacles_.push_back(obs);
  if (trace_ && ch_.profile != RealismProfile::Baseline) {
    char b[140];
    std::snprintf(b, sizeof b, ",\"id\":%u,\"material\":\"%s\",\"loss_db\":%.1f,\"p1\":[%.1f,%.1f],\"p2\":[%.1f,%.1f]",
                  obs.id, material_name(obs.material), obs.attenuation_db,
                  obs.x1, obs.y1, obs.x2, obs.y2);
    trace_event("obstacle_init", 0, b);
  }
}

void World::clear_obstacles() {
  obstacles_.clear();
}

void World::set_fluid_drift(double vx, double vy) {
  ch_.fluid_drift.vx_mps = vx;
  ch_.fluid_drift.vy_mps = vy;
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
void World::set_battery(uint16_t id, uint8_t pct) {
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return;
  auto& n = *it->second;
  pct = std::min<uint8_t>(100, pct);
  n.battery = pct;
  n.initial_battery = pct;
  n.battery_fraction = pct;
  n.energy_model.set_percent(pct);
  n.energy_consumed_mah = ((100.0 - pct) / 100.0) * ch_.battery_capacity_mah;
  if (pct > 0 && !n.online && n.battery == 0) {
    n.online = true;
    trace_event("node_revive", id, ",\"why\":\"battery_recharged\"");
  }
  char b[64];
  std::snprintf(b, sizeof b, ",\"battery\":%u,\"why\":\"manual_set\"", static_cast<unsigned int>(pct));
  trace_event("battery", id, b);
  if (pct == 0 && n.online) {
    n.online = false;
    trace_event("battery_depleted", id, ",\"why\":\"battery_exhausted\"");
  }
}

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
void World::wake_word(uint16_t id, uint32_t at, double voice_spl_1m) {
  schedule(at, [this, id, voice_spl_1m] {
    if (nodes_.at(id)->online && nodes_.at(id)->battery > 0) {
      if (ch_.profile == RealismProfile::Baseline) {
        char b[64];
        std::snprintf(b, sizeof b, ",\"phrase\":\"Setu\",\"window_ms\":3500");
        trace_event("wake_word", id, b);
        node(id).on_wake_word();
      } else {
        double snr_db = 20.0;
        bool detected = acoustic_model_.evaluate_trigger(voice_spl_1m, ch_.ambient_noise_spl, &snr_db);
        char b[128];
        std::snprintf(b, sizeof b, ",\"phrase\":\"Setu\",\"window_ms\":3500,\"snr_db\":%.1f,\"detected\":%s",
                      snr_db, detected ? "true" : "false");
        trace_event("wake_word", id, b);
        if (detected) {
          node(id).on_wake_word();
        }
      }
    }
  });
}
void World::voice_command(uint16_t id, uint32_t at, uint8_t contact, setu::Hazard hz, double voice_spl_1m) {
  schedule(at, [this, id, contact, hz, voice_spl_1m] {
    if (nodes_.at(id)->online && nodes_.at(id)->battery > 0) {
      const char* hz_name = (hz == setu::Hazard::Medical) ? "medical" :
                            (hz == setu::Hazard::Trapped) ? "trapped" : "general";
      if (ch_.profile == RealismProfile::Baseline) {
        char b[96];
        std::snprintf(b, sizeof b, ",\"hazard\":%d,\"hazard_name\":\"%s\",\"contact\":%u,\"recognized\":true",
                      static_cast<int>(hz), hz_name, contact);
        trace_event("voice_command", id, b);
        node(id).on_voice_command(contact, hz);
      } else {
        double snr_db = 20.0;
        bool recognized = acoustic_model_.evaluate_trigger(voice_spl_1m, ch_.ambient_noise_spl, &snr_db);
        char b[140];
        std::snprintf(b, sizeof b, ",\"hazard\":%d,\"hazard_name\":\"%s\",\"contact\":%u,\"recognized\":%s,\"snr_db\":%.1f",
                      static_cast<int>(hz), hz_name, contact, recognized ? "true" : "false", snr_db);
        trace_event("voice_command", id, b);
        if (recognized) {
          node(id).on_voice_command(contact, hz);
        }
      }
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
  double shadow = 0.0;
  if (ch_.shadow_sigma_db > 0.0) {
    if (ch_.profile == RealismProfile::Baseline) {
      std::mt19937 lr(seed_ ^ (k.first * 65537u + k.second * 2246822519u));
      shadow = std::normal_distribution<double>(0.0, ch_.shadow_sigma_db)(lr);
    } else {
      shadow = setu::HashRandom::link_gaussian(seed_, k.first, k.second, 0.0, ch_.shadow_sigma_db);
    }
  }
  double pl = ch_.ref_loss_db + 10.0 * ch_.path_exp * std::log10(d) + ch_.extra_loss_db + shadow;

  if (ch_.profile == RealismProfile::Field) {
    if (ch_.enable_obstacles && !obstacles_.empty()) {
      pl += calculate_obstacle_attenuation(na.x, na.y, nb.x, nb.y, obstacles_);
    }
    if (ch_.enable_body_shadowing) {
      pl += calculate_body_shadowing_db(na.x, na.y, nb.x, nb.y, na.heading_rad);
      pl += calculate_body_shadowing_db(nb.x, nb.y, na.x, na.y, nb.heading_rad);
    }
  }
  return ch_.tx_dbm - pl;
}

LossBudget World::get_loss_budget(uint16_t a, uint16_t b) const {
  LossBudget lb;
  lb.tx_power_dbm = ch_.tx_dbm;
  lb.ref_loss_db = ch_.ref_loss_db;
  lb.extra_loss_db = ch_.extra_loss_db;
  lb.sensitivity_dbm = sens_;

  if (a == b || !nodes_.count(a) || !nodes_.count(b)) {
    lb.rx_power_dbm = kNegInf;
    lb.link_margin_db = kNegInf;
    lb.viable = false;
    lb.obstacle_loss = "not modeled yet";
    lb.body_loss = "not modeled yet";
    return lb;
  }

  auto k = std::minmax(a, b);
  if (blocked_.count({k.first, k.second})) {
    lb.rx_power_dbm = kNegInf;
    lb.link_margin_db = kNegInf;
    lb.viable = false;
    lb.obstacle_loss = "blocked link";
    lb.body_loss = "blocked link";
    return lb;
  }

  const auto& na = *nodes_.at(a);
  const auto& nb = *nodes_.at(b);
  const double d = std::max(1.0, std::hypot(na.x - nb.x, na.y - nb.y));
  lb.path_loss_db = 10.0 * ch_.path_exp * std::log10(d);

  if (ch_.shadow_sigma_db > 0.0) {
    if (ch_.profile == RealismProfile::Baseline) {
      std::mt19937 lr(seed_ ^ (k.first * 65537u + k.second * 2246822519u));
      lb.shadow_loss_db = std::normal_distribution<double>(0.0, ch_.shadow_sigma_db)(lr);
    } else {
      lb.shadow_loss_db = setu::HashRandom::link_gaussian(seed_, k.first, k.second, 0.0, ch_.shadow_sigma_db);
    }
  } else {
    lb.shadow_loss_db = 0.0;
  }
  lb.fading_loss_db = 0.0;

  double obs_loss = 0.0;
  int obs_count = 0;
  double body_loss = 0.0;

  if (ch_.profile == RealismProfile::Baseline) {
    lb.obstacle_loss = "not modeled yet";
    lb.body_loss = "not modeled yet";
  } else {
    if (!obstacles_.empty()) {
      obs_loss = calculate_obstacle_attenuation(na.x, na.y, nb.x, nb.y, obstacles_, &obs_count);
      char ob[64];
      std::snprintf(ob, sizeof ob, "%.1f dB (%dx intersected)", obs_loss, obs_count);
      lb.obstacle_loss = ob;
    } else {
      lb.obstacle_loss = "0.0 dB (line of sight)";
    }

    if (na.heading_rad >= 0.0 || nb.heading_rad >= 0.0) {
      body_loss = calculate_body_shadowing_db(na.x, na.y, nb.x, nb.y, na.heading_rad) +
                  calculate_body_shadowing_db(nb.x, nb.y, na.x, na.y, nb.heading_rad);
      char bb[64];
      std::snprintf(bb, sizeof bb, "%.1f dB", body_loss);
      lb.body_loss = bb;
    } else {
      lb.body_loss = "0.0 dB (unshadowed)";
    }
  }

  const double total_pl = lb.ref_loss_db + lb.path_loss_db + lb.shadow_loss_db + lb.extra_loss_db + obs_loss + body_loss;
  lb.rx_power_dbm = lb.tx_power_dbm - total_pl;
  lb.link_margin_db = lb.rx_power_dbm - lb.sensitivity_dbm;
  lb.viable = (lb.link_margin_db >= 0.0);
  return lb;
}

PlannedConnectivityReport World::planned_connectivity_report() const {
  PlannedConnectivityReport rep;
  rep.total_nodes = nodes_.size();
  if (nodes_.empty()) {
    rep.connected = true;
    return rep;
  }

  uint16_t hub = 0;
  bool hub_found = false;
  for (const auto& kv : nodes_) {
    if (kv.second->node->config().role == setu::Role::Hub) {
      hub = kv.first;
      hub_found = true;
      break;
    }
  }

  const double max_loss = ch_.tx_dbm - sens_ - ch_.connect_margin_db - ch_.ref_loss_db - ch_.extra_loss_db;
  if (max_loss > 0.0 && ch_.path_exp > 0.0) {
    rep.max_viable_range_m = std::pow(10.0, max_loss / (10.0 * ch_.path_exp));
  } else {
    rep.max_viable_range_m = 1.0;
  }

  if (!hub_found) {
    rep.connected = false;
    rep.connected_to_hub = 0;
    rep.disconnected_count = nodes_.size();
    rep.component_count = 0;
    return rep;
  }

  std::set<uint16_t> hub_reachable{hub};
  std::vector<uint16_t> todo{hub};
  while (!todo.empty()) {
    uint16_t u = todo.back();
    todo.pop_back();
    for (const auto& kv : nodes_) {
      if (!hub_reachable.count(kv.first) && mean_rssi(u, kv.first) >= sens_ + ch_.connect_margin_db) {
        hub_reachable.insert(kv.first);
        todo.push_back(kv.first);
      }
    }
  }

  rep.connected_to_hub = hub_reachable.size();
  rep.disconnected_count = nodes_.size() - hub_reachable.size();
  rep.connected = (hub_reachable.size() == nodes_.size());

  std::set<uint16_t> all_visited;
  size_t components = 0;
  for (const auto& kv : nodes_) {
    if (!all_visited.count(kv.first)) {
      components++;
      std::vector<uint16_t> comp_todo{kv.first};
      all_visited.insert(kv.first);
      while (!comp_todo.empty()) {
        uint16_t curr = comp_todo.back();
        comp_todo.pop_back();
        for (const auto& other : nodes_) {
          if (!all_visited.count(other.first) && mean_rssi(curr, other.first) >= sens_ + ch_.connect_margin_db) {
            all_visited.insert(other.first);
            comp_todo.push_back(other.first);
          }
        }
      }
    }
  }
  rep.component_count = components;
  return rep;
}

bool World::planned_connected() const {
  return planned_connectivity_report().connected;
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
  auto node_it = nodes_.find(from);
  if (node_it == nodes_.end() || !node_it->second->online || node_it->second->battery == 0) {
    return false;
  }
  for (auto& t : txs_)
    if (t.from == from && now_ < t.end) return false;  // already transmitting
  const uint32_t air = setu::lora_airtime_ms(n, ch_.sf, ch_.bw_hz);
  uint32_t tx_id = ++next_tx_id_;
  txs_.push_back({tx_id, from, now_, now_ + air, std::vector<uint8_t>(d, d + n)});
  counters_.tx++;
  if (ch_.profile == RealismProfile::Field) {
    double tx_ma = (ch_.tx_dbm >= 20.0) ? BatteryEnergyModel::kCurrentRadioTx22Ma : BatteryEnergyModel::kCurrentRadioTx14Ma;
    // Standby idle already continuously charges 4.6 mA continuous LoRa RX.
    // Transmit draws the net incremental current during airtime to avoid double counting.
    double incremental_tx_ma = std::max(0.0, tx_ma - BatteryEnergyModel::kCurrentRadioRxMa);
    node_it->second->consume_energy_ma(incremental_tx_ma, air, "tx");
  } else {
    node_it->second->consume_energy(ch_.tx_energy_pct, "tx");
  }
  if (trace_) {
    setu::Packet p;
    setu::parse(d, n, p);
    char b[320];
    std::snprintf(b, sizeof b,
                  ",\"origin\":%u,\"seq\":%u,\"ack\":%d,\"target\":%u,\"ref_seq\":%u,\"hazard\":%d,"
                  "\"flags\":%u,\"lat_e6\":%ld,\"lon_e6\":%ld,\"battery\":%u,\"hop\":%u,\"contact\":%u,\"air\":%u"
                  ",\"energy_mah\":%.3f",
                  p.node_id, p.seq, p.is_ack() ? 1 : 0, p.target, p.ref_seq, static_cast<int>(p.hazard),
                  p.flags, static_cast<long>(p.lat_e6), static_cast<long>(p.lon_e6),
                  node_it->second->battery, p.hop, p.contact, air,
                  node_it->second->energy_consumed_mah);
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
  std::uniform_real_distribution<double> u01(0.0, 1.0);
  const double noise_floor = -174.0 + 10.0 * std::log10(static_cast<double>(ch_.bw_hz)) + 6.0;
  for (auto& kv : nodes_) {
    const uint16_t r = kv.first;
    if (r == tx.from || !kv.second->online || kv.second->battery == 0) continue;
    const double mean = mean_rssi(tx.from, r);
    if (mean < sens_ - 6.0) continue;  // far outside range: not worth tracing
    double fade = 0.0;
    if (ch_.fading_sigma_db > 0.0) {
      if (ch_.profile == RealismProfile::Baseline) {
        fade = std::normal_distribution<double>(0.0, ch_.fading_sigma_db)(rng_);
      } else {
        fade = setu::HashRandom::tx_gaussian(seed_, tx.tx_id, r, 0.0, ch_.fading_sigma_db);
      }
    }
    const double rssi = mean + fade;
    char b[128];
    if (rssi < sens_) {
      counters_.weak++;
      std::snprintf(b, sizeof b, ",\"from\":%u,\"rssi\":%.1f,\"why\":\"weak\"", tx.from, rssi);
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
    }
    if (!dropped) {
      // Cumulative co-channel interference power sum (SINR model)
      double total_interf_mw = 0.0;
      for (auto& o : txs_) {
        if ((o.from == tx.from && o.start == tx.start) || !(o.start < tx.end && o.end > tx.start))
          continue;
        if (o.from == r) continue;
        const double ro = mean_rssi(o.from, r);
        if (ro >= sens_ - 10.0) {
          total_interf_mw += std::pow(10.0, ro / 10.0);
        }
      }
      if (total_interf_mw > 0.0) {
        const double total_interf_dbm = 10.0 * std::log10(total_interf_mw);
        double cap_threshold = ch_.capture_db;
        if (ch_.profile == RealismProfile::Field) {
          cap_threshold = capture_threshold_db(ch_.sf);
        }
        if (total_interf_dbm >= sens_ && (rssi - total_interf_dbm) < cap_threshold) {
          dropped = true;
          why = "collision";
          counters_.collisions++;
        }
      }
    }
    bool lost = false;
    if (!dropped && ch_.random_loss > 0.0) {
      if (ch_.profile == RealismProfile::Baseline) {
        lost = (u01(rng_) < ch_.random_loss);
      } else {
        lost = (setu::HashRandom::tx_uniform(seed_, tx.tx_id, r) < ch_.random_loss);
      }
    }
    if (lost) {
      dropped = true;
      why = "loss";
      counters_.lost++;
    }
    if (dropped) {
      std::snprintf(b, sizeof b, ",\"from\":%u,\"rssi\":%.1f,\"why\":\"%s\"", tx.from, rssi, why);
      trace_event("drop", r, b);
      continue;
    }
    counters_.delivered++;
    if (ch_.profile != RealismProfile::Field) {
      kv.second->consume_energy(ch_.rx_energy_pct, "rx");
    }
    const double snr = std::clamp(rssi - noise_floor, -20.0, 15.0);
    std::snprintf(b, sizeof b, ",\"from\":%u,\"rssi\":%.1f,\"snr\":%.1f,\"battery\":%u,\"energy_mah\":%.3f",
                  tx.from, rssi, snr, kv.second->battery, kv.second->energy_consumed_mah);
    trace_event("rx", r, b);
    firmware_radio_isr(r, tx.data.data(), tx.data.size(),
                       static_cast<int16_t>(std::lround(rssi)),
                       static_cast<int8_t>(std::lround(snr)));
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
    // Idle energy consumption every 1000ms
    if (now_ > 0 && now_ % 1000 == 0) {
      for (auto& kv : nodes_) {
        if (kv.second->online && kv.second->battery > 0) {
          if (ch_.profile == RealismProfile::Field) {
            double idle_ma = BatteryEnergyModel::kCurrentStandbyMa +
                             BatteryEnergyModel::kCurrentRadioRxMa +
                             BatteryEnergyModel::kCurrentImuMa;
            if (ch_.gnss_continuous && kv.second->gnss_on) {
              idle_ma += BatteryEnergyModel::kCurrentGnssMa;
            }
            if (ch_.wake_word_always_on) {
              idle_ma += BatteryEnergyModel::kCurrentVoiceDspMa;
            }
            kv.second->consume_energy_ma(idle_ma, 1000.0, "idle");
          } else if (ch_.idle_energy_pct_per_s > 0) {
            kv.second->consume_energy(ch_.idle_energy_pct_per_s, "idle");
          }
        }
      }
    }
    // Fluid flow environmental drift (active in Field profile when fluid drift velocity is non-zero)
    if (now_ > 0 && now_ % 1000 == 0 && ch_.profile == RealismProfile::Field &&
        (ch_.fluid_drift.vx_mps != 0.0 || ch_.fluid_drift.vy_mps != 0.0)) {
      for (auto& kv : nodes_) {
        if (kv.second->online && kv.second->node->config().role == setu::Role::Survivor) {
          kv.second->x += ch_.fluid_drift.vx_mps * 1.0;
          kv.second->y += ch_.fluid_drift.vy_mps * 1.0;
        }
      }
    }
    // 2. every online device drains virtual FreeRTOS queues and runs real firmware tick
    for (auto& kv : nodes_) {
      if (kv.second->online && kv.second->battery > 0) {
        if (ch_.profile == RealismProfile::Field && ch_.enable_fall_detection &&
            !kv.second->fall_sos_triggered &&
            kv.second->imu_sensor.profile() == MotionProfile::FallImpact &&
            kv.second->node->config().role == setu::Role::Survivor) {
          ImuSample s = kv.second->imu_sensor.update(now_);
          double total_g = std::sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az) / Mpu6050SensorModel::kGravity;
          kv.second->fall_detector.update(now_, total_g);
          if (kv.second->fall_detector.is_fall_confirmed()) {
            kv.second->fall_sos_triggered = true;
            char fb[64];
            std::snprintf(fb, sizeof fb, ",\"hazard\":2,\"action\":\"auto_trapped_sos\"");
            trace_event("fall_impact_detected", kv.second->id, fb);
            button_press(kv.second->id, now_, 1700);
          }
        }
        kv.second->drain_queues_and_tick();
      }
    }
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
  it->second->pos_tracker.update_ground_truth(px, py, la, lo);
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

void World::reset_estimator(uint16_t id) {
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return;
  int32_t la = 0, lo = 0;
  xy_to_e6(it->second->x, it->second->y, la, lo);
  it->second->pos_tracker.reset_estimator(it->second->x, it->second->y, la, lo);
  if (trace_) {
    char b[128];
    std::snprintf(b, sizeof b, ",\"x\":%.2f,\"y\":%.2f,\"lat_e6\":%ld,\"lon_e6\":%ld",
                  it->second->x, it->second->y, static_cast<long>(la), static_cast<long>(lo));
    trace_event("estimator_reset", id, b);
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
      voice_command(id, t + 200, 1, setu::Hazard::Medical);
    } else if (kind == "voice-trapped") {
      wake_word(id, t);
      voice_command(id, t + 200, 1, setu::Hazard::Trapped);
    } else {
      button_press(id, t, 150);
    }
  }
}

void World::set_motion_profile(uint16_t id, MotionProfile p) {
  auto it = nodes_.find(id);
  if (it != nodes_.end()) {
    it->second->imu_sensor.set_profile(p);
    char b[64];
    std::snprintf(b, sizeof b, ",\"profile\":\"%s\"", motion_profile_str(p));
    trace_event("motion_profile", id, b);
  }
}

void World::schedule_gnss_outage(uint16_t id, uint32_t start_ms, uint32_t duration_ms) {
  auto it = nodes_.find(id);
  if (it != nodes_.end()) {
    it->second->gnss_sensor.schedule_outage(start_ms, duration_ms);
    schedule(start_ms, [this, id] { set_gnss(id, false); });
    schedule(start_ms + duration_ms, [this, id] { set_gnss(id, true); });
  }
}

void World::set_node_heading(uint16_t id, double heading_rad) {
  auto it = nodes_.find(id);
  if (it != nodes_.end()) {
    it->second->heading_rad = heading_rad;
    it->second->imu_sensor.set_heading_rad(heading_rad);
  }
}

const PositionMetricsTracker* World::get_position_metrics(uint16_t id) const {
  auto it = nodes_.find(id);
  if (it == nodes_.end()) return nullptr;
  return &it->second->pos_tracker;
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
  info.ground_truth_x = n.x;
  info.ground_truth_y = n.y;
  info.ground_truth_lat_e6 = info.lat_e6;
  info.ground_truth_lon_e6 = info.lon_e6;
  info.has_estimate = n.pos_tracker.has_estimate();
  info.has_samples = n.pos_tracker.has_samples();
  if (info.has_estimate) {
    info.estimated_lat_e6 = n.pos_tracker.last_est_lat_e6();
    info.estimated_lon_e6 = n.pos_tracker.last_est_lon_e6();
    info.pos_error_m = n.pos_tracker.current_error_m();
  } else {
    info.estimated_lat_e6 = 0;
    info.estimated_lon_e6 = 0;
    info.pos_error_m = -1.0;
  }
  info.pos_mae_m = n.pos_tracker.has_samples() ? n.pos_tracker.mae_m() : -1.0;
  info.pos_rmse_m = n.pos_tracker.has_samples() ? n.pos_tracker.rmse_m() : -1.0;
  info.pos_max_error_m = n.pos_tracker.has_samples() ? n.pos_tracker.max_error_m() : -1.0;
  info.motion_profile = motion_profile_str(n.imu_sensor.profile());
  info.gnss_status = gnss_status_str(n.gnss_sensor.status());
  info.battery = n.battery;
  info.initial_battery = n.initial_battery;
  info.energy_consumed_mah = n.energy_consumed_mah;
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
  info.incident_id = n.node->incident_id();
  info.profile = realism_profile_str(ch_.profile);
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
                                       uint32_t seed, const setu::NodeConfig& base,
                                       const std::map<uint16_t, uint8_t>& initial_batteries,
                                       bool allow_disconnected) {
  PlannedConnectivityReport best_report;
  size_t best_connected_count = 0;
  std::unique_ptr<World> best_world = nullptr;

  const int cols = (relays == 5) ? 3 : std::max(1, static_cast<int>(std::round(std::sqrt(relays))));
  const int rows = std::max(1, (relays + cols - 1) / cols);

  const double sens = setu::lora_sensitivity_dbm(ch.sf);
  const double max_loss = ch.tx_dbm - sens - ch.connect_margin_db - ch.ref_loss_db - ch.extra_loss_db;
  const double d_viable = (max_loss > 0.0 && ch.path_exp > 0.0) ? std::pow(10.0, max_loss / (10.0 * ch.path_exp)) : 10.0;

  for (uint32_t s = seed; s < seed + 500; s++) {
    auto w = std::make_unique<World>(ch, s);
    setu::NodeConfig c = base;
    c.priority_ignores_duty = ch.priority_bypass_duty;

    if (ch.profile != RealismProfile::Baseline) {
      // Portable deterministic topology generation for Field and Idealized profiles
      setu::Xoshiro256PlusPlus pr(s);

      if (s < seed + 25) {
        c.node_id = 0;
        c.role = setu::Role::Hub;
        uint8_t hub_batt = initial_batteries.count(0) ? initial_batteries.at(0) : 100;
        w->add_node(c, 60, 60, hub_batt);
        for (int i = 0; i < relays; i++) {
          c.node_id = static_cast<uint16_t>(100 + i);
          c.role = setu::Role::Relay;
          uint8_t r_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;
          const double jy = pr.uniform(-60.0, 60.0);
          const double jx = pr.uniform(-60.0, 60.0);
          w->add_node(c, (i % cols + 1) * zone / (cols + 1) + jx,
                      (i / cols + 1) * zone / (rows + 1) + jy, r_batt);
        }
        for (int i = 0; i < survivors; i++) {
          c.node_id = static_cast<uint16_t>(i + 1);
          c.role = setu::Role::Survivor;
          uint8_t s_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;
          const double py = pr.uniform(100.0, zone);
          const double px = pr.uniform(100.0, zone);
          w->add_node(c, px, py, s_batt);
        }
      } else {
        const double hub_x = std::min(60.0, zone * 0.1);
        const double hub_y = std::min(60.0, zone * 0.1);
        c.node_id = 0;
        c.role = setu::Role::Hub;
        uint8_t hub_batt = initial_batteries.count(0) ? initial_batteries.at(0) : 100;
        w->add_node(c, hub_x, hub_y, hub_batt);

        std::vector<uint16_t> backbone = {0};
        const double d_step = std::max(15.0, std::min(d_viable * 0.80, zone * 0.5));
        const double d_min_step = std::max(10.0, d_step * 0.40);

        for (int i = 0; i < relays; i++) {
          c.node_id = static_cast<uint16_t>(100 + i);
          c.role = setu::Role::Relay;
          uint8_t r_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;

          bool placed = false;
          for (int k = 0; k < 30; k++) {
            size_t parent_idx = 0;
            if (backbone.size() > 1 && (pr.next_u64() % 100 < 70)) {
              parent_idx = backbone.size() - 1 - (pr.next_u64() % std::min<size_t>(3, backbone.size()));
            } else {
              parent_idx = pr.next_u64() % backbone.size();
            }
            uint16_t parent_id = backbone[parent_idx];
            auto p_info = w->get_node_info(parent_id);

            double base_angle = std::atan2(zone * 0.75 - p_info.y, zone * 0.75 - p_info.x);
            double angle = base_angle + pr.uniform(-M_PI * 0.35, M_PI * 0.35);
            double dist = pr.uniform(d_min_step, d_step);

            double cx = std::clamp(p_info.x + dist * std::cos(angle), 30.0, zone - 30.0);
            double cy = std::clamp(p_info.y + dist * std::sin(angle), 30.0, zone - 30.0);

            if (k == 0) {
              w->add_node(c, cx, cy, r_batt);
            } else {
              w->reposition_node(c.node_id, cx, cy);
            }

            if (w->mean_rssi(parent_id, c.node_id) >= sens + ch.connect_margin_db) {
              placed = true;
              backbone.push_back(c.node_id);
              break;
            }
          }
          if (!placed) {
            uint16_t parent_id = backbone.back();
            auto p_info = w->get_node_info(parent_id);
            double close_dist = std::min(25.0, d_step * 0.3);
            double cx = std::clamp(p_info.x + close_dist, 30.0, zone - 30.0);
            double cy = std::clamp(p_info.y + close_dist, 30.0, zone - 30.0);
            w->reposition_node(c.node_id, cx, cy);
            backbone.push_back(c.node_id);
          }
        }

        if (relays == 0) {
          for (int i = 0; i < survivors; i++) {
            c.node_id = static_cast<uint16_t>(i + 1);
            c.role = setu::Role::Survivor;
            uint8_t s_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;
            const double py = pr.uniform(100.0, zone);
            const double px = pr.uniform(100.0, zone);
            w->add_node(c, px, py, s_batt);
          }
        } else {
          for (int i = 0; i < survivors; i++) {
            c.node_id = static_cast<uint16_t>(i + 1);
            c.role = setu::Role::Survivor;
            uint8_t s_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;

            bool placed = false;
            for (int k = 0; k < 30; k++) {
              uint16_t host_id = backbone[pr.next_u64() % backbone.size()];
              auto h_info = w->get_node_info(host_id);

              double angle = pr.uniform(0.0, 2.0 * M_PI);
              double dist = pr.uniform(std::min(15.0, d_step * 0.2), d_step);

              double cx = std::clamp(h_info.x + dist * std::cos(angle), 30.0, zone - 30.0);
              double cy = std::clamp(h_info.y + dist * std::sin(angle), 30.0, zone - 30.0);

              if (k == 0) {
                w->add_node(c, cx, cy, s_batt);
              } else {
                w->reposition_node(c.node_id, cx, cy);
              }

              if (w->mean_rssi(host_id, c.node_id) >= sens + ch.connect_margin_db) {
                placed = true;
                break;
              }
            }
            if (!placed) {
              uint16_t host_id = backbone[pr.next_u64() % backbone.size()];
              auto h_info = w->get_node_info(host_id);
              double close_dist = std::min(20.0, d_step * 0.3);
              double cx = std::clamp(h_info.x + close_dist, 30.0, zone - 30.0);
              double cy = std::clamp(h_info.y + close_dist, 30.0, zone - 30.0);
              w->reposition_node(c.node_id, cx, cy);
            }
          }
        }
      }
    } else {
      // Legacy baseline placement using std::mt19937
      std::mt19937 r(s);

      if (s < seed + 25) {
        std::uniform_real_distribution<double> jitter(-60, 60), pos(100, zone);
        c.node_id = 0;
        c.role = setu::Role::Hub;
        uint8_t hub_batt = initial_batteries.count(0) ? initial_batteries.at(0) : 100;
        w->add_node(c, 60, 60, hub_batt);
        for (int i = 0; i < relays; i++) {
          c.node_id = static_cast<uint16_t>(100 + i);
          c.role = setu::Role::Relay;
          uint8_t r_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;
          const double jy = jitter(r);
          const double jx = jitter(r);
          w->add_node(c, (i % cols + 1) * zone / (cols + 1) + jx,
                      (i / cols + 1) * zone / (rows + 1) + jy, r_batt);
        }
        for (int i = 0; i < survivors; i++) {
          c.node_id = static_cast<uint16_t>(i + 1);
          c.role = setu::Role::Survivor;
          uint8_t s_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;
          const double py = pos(r);
          const double px = pos(r);
          w->add_node(c, px, py, s_batt);
        }
      } else {
        const double hub_x = std::min(60.0, zone * 0.1);
        const double hub_y = std::min(60.0, zone * 0.1);
        c.node_id = 0;
        c.role = setu::Role::Hub;
        uint8_t hub_batt = initial_batteries.count(0) ? initial_batteries.at(0) : 100;
        w->add_node(c, hub_x, hub_y, hub_batt);

        std::vector<uint16_t> backbone = {0};
        const double d_step = std::max(15.0, std::min(d_viable * 0.80, zone * 0.5));
        const double d_min_step = std::max(10.0, d_step * 0.40);

        for (int i = 0; i < relays; i++) {
          c.node_id = static_cast<uint16_t>(100 + i);
          c.role = setu::Role::Relay;
          uint8_t r_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;

          bool placed = false;
          for (int k = 0; k < 30; k++) {
            size_t parent_idx = 0;
            if (backbone.size() > 1 && (r() % 100 < 70)) {
              parent_idx = backbone.size() - 1 - (r() % std::min<size_t>(3, backbone.size()));
            } else {
              parent_idx = r() % backbone.size();
            }
            uint16_t parent_id = backbone[parent_idx];
            auto p_info = w->get_node_info(parent_id);

            double base_angle = std::atan2(zone * 0.75 - p_info.y, zone * 0.75 - p_info.x);
            std::uniform_real_distribution<double> angle_jitter(-M_PI * 0.35, M_PI * 0.35);
            double angle = base_angle + angle_jitter(r);

            std::uniform_real_distribution<double> dist_distr(d_min_step, d_step);
            double dist = dist_distr(r);

            double cx = std::clamp(p_info.x + dist * std::cos(angle), 30.0, zone - 30.0);
            double cy = std::clamp(p_info.y + dist * std::sin(angle), 30.0, zone - 30.0);

            if (k == 0) {
              w->add_node(c, cx, cy, r_batt);
            } else {
              w->reposition_node(c.node_id, cx, cy);
            }

            if (w->mean_rssi(parent_id, c.node_id) >= sens + ch.connect_margin_db) {
              placed = true;
              backbone.push_back(c.node_id);
              break;
            }
          }
          if (!placed) {
            uint16_t parent_id = backbone.back();
            auto p_info = w->get_node_info(parent_id);
            double close_dist = std::min(25.0, d_step * 0.3);
            double cx = std::clamp(p_info.x + close_dist, 30.0, zone - 30.0);
            double cy = std::clamp(p_info.y + close_dist, 30.0, zone - 30.0);
            w->reposition_node(c.node_id, cx, cy);
            backbone.push_back(c.node_id);
          }
        }

        if (relays == 0) {
          std::uniform_real_distribution<double> pos(100, zone);
          for (int i = 0; i < survivors; i++) {
            c.node_id = static_cast<uint16_t>(i + 1);
            c.role = setu::Role::Survivor;
            uint8_t s_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;
            const double py = pos(r);
            const double px = pos(r);
            w->add_node(c, px, py, s_batt);
          }
        } else {
          for (int i = 0; i < survivors; i++) {
            c.node_id = static_cast<uint16_t>(i + 1);
            c.role = setu::Role::Survivor;
            uint8_t s_batt = initial_batteries.count(c.node_id) ? initial_batteries.at(c.node_id) : 100;

            bool placed = false;
            for (int k = 0; k < 30; k++) {
              uint16_t host_id = backbone[r() % backbone.size()];
              auto h_info = w->get_node_info(host_id);

              std::uniform_real_distribution<double> angle_distr(0.0, 2.0 * M_PI);
              std::uniform_real_distribution<double> dist_distr(std::min(15.0, d_step * 0.2), d_step);

              double angle = angle_distr(r);
              double dist = dist_distr(r);

              double cx = std::clamp(h_info.x + dist * std::cos(angle), 30.0, zone - 30.0);
              double cy = std::clamp(h_info.y + dist * std::sin(angle), 30.0, zone - 30.0);

              if (k == 0) {
                w->add_node(c, cx, cy, s_batt);
              } else {
                w->reposition_node(c.node_id, cx, cy);
              }

              if (w->mean_rssi(host_id, c.node_id) >= sens + ch.connect_margin_db) {
                placed = true;
                break;
              }
            }
            if (!placed) {
              uint16_t host_id = backbone[r() % backbone.size()];
              auto h_info = w->get_node_info(host_id);
              double close_dist = std::min(20.0, d_step * 0.3);
              double cx = std::clamp(h_info.x + close_dist, 30.0, zone - 30.0);
              double cy = std::clamp(h_info.y + close_dist, 30.0, zone - 30.0);
              w->reposition_node(c.node_id, cx, cy);
            }
          }
        }
      }
    }

    auto report = w->planned_connectivity_report();
    if (report.connected) return w;

    if (report.connected_to_hub > best_connected_count || best_world == nullptr) {
      best_connected_count = report.connected_to_hub;
      best_report = report;
      if (allow_disconnected) {
        best_world = std::move(w);
      }
    }
  }

  if (allow_disconnected && best_world != nullptr) {
    std::cerr << "setu_sim: [WARN] running with disconnected topology (reachability "
              << best_connected_count << "/" << best_report.total_nodes
              << " nodes connected to Hub, path_exp=" << ch.path_exp << ")\n";
    return best_world;
  }

  char buf[512];
  std::snprintf(
      buf, sizeof(buf),
      "could not generate a connected demo topology after 500 attempts: "
      "path_exp=%.2f, seed=%u, survivors=%d, relays=%d, zone=%.0fm. "
      "Max viable radio range is ~%.1fm (TX %.1f dBm, sens %.1f dBm, margin %.1f dB), "
      "leaving %zu/%zu nodes disconnected from Hub (%zu components). "
      "Placement constraints infeasible for fully connected topology; reduce zone size, "
      "increase relay density, lower path loss exponent, or enable --allow-disconnected.",
      ch.path_exp, seed, survivors, relays, zone,
      best_report.max_viable_range_m, ch.tx_dbm, setu::lora_sensitivity_dbm(ch.sf), ch.connect_margin_db,
      best_report.disconnected_count, best_report.total_nodes,
      best_report.component_count);
  throw std::runtime_error(buf);
}

}  // namespace sim
