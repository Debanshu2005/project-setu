// Project Setu: WebAssembly Simulation Bindings
// Exposes authoritative C++ world and protocol simulation directly to browser and Node.js environments.

#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include <map>
#include <cmath>
#include <algorithm>

#include "world.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#endif

namespace setu_wasm {

namespace {

inline int64_t parse_json_int(const std::string& line, const std::string& key, int64_t def_val = 0) {
  std::string needle = "\"" + key + "\":";
  auto p = line.find(needle);
  if (p == std::string::npos) return def_val;
  p += needle.size();
  while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) p++;
  try {
    return std::stoll(line.substr(p));
  } catch (...) {
    return def_val;
  }
}

inline double parse_json_double(const std::string& line, const std::string& key, double def_val = 0.0) {
  std::string needle = "\"" + key + "\":";
  auto p = line.find(needle);
  if (p == std::string::npos) return def_val;
  p += needle.size();
  while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) p++;
  try {
    return std::stod(line.substr(p));
  } catch (...) {
    return def_val;
  }
}

inline std::string parse_json_str(const std::string& line, const std::string& key, const std::string& def_val = "") {
  std::string needle = "\"" + key + "\":\"";
  auto p = line.find(needle);
  if (p == std::string::npos) return def_val;
  p += needle.size();
  auto end = line.find('"', p);
  if (end == std::string::npos) return def_val;
  return line.substr(p, end - p);
}

inline bool parse_json_bool(const std::string& line, const std::string& key, bool def_val = false) {
  std::string needle = "\"" + key + "\":";
  auto p = line.find(needle);
  if (p == std::string::npos) return def_val;
  p += needle.size();
  while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) p++;
  if (line.compare(p, 4, "true") == 0) return true;
  if (line.compare(p, 5, "false") == 0) return false;
  return def_val;
}

}  // namespace

class WasmSimSession {
 public:
  WasmSimSession() = default;

  bool init(int survivors, int relays, double zone, uint32_t seed, const std::string& profile_name) {
    return init_with_params(survivors, relays, zone, seed, profile_name, 7, 3.5, 0.0, true);
  }

  bool init_with_params(int survivors, int relays, double zone, uint32_t seed,
                        const std::string& profile_name, int sf, double path_exp,
                        double loss, bool allow_disconnected) {
    sim::ChannelParams ch;
    ch.profile = sim::parse_realism_profile(profile_name);
    if (ch.profile != sim::RealismProfile::Baseline) {
      ch.battery_capacity_mah = 1000.0;
    }
    ch.sf = static_cast<uint8_t>(sf);
    ch.path_exp = path_exp;
    ch.random_loss = loss;

    trace_stream_.str("");
    trace_stream_.clear();
    configured_duration_ = 30000;

    try {
      world_ = sim::make_demo_world(survivors, relays, zone, ch, seed, setu::NodeConfig(), {}, allow_disconnected);
      world_->set_trace(&trace_stream_);
      seed_ = seed;
      return true;
    } catch (...) {
      return false;
    }
  }

  void add_trigger(uint16_t id, const std::string& kind, uint32_t t) {
    if (!world_) return;
    if (kind == "short") world_->button_press(id, t, 150);
    else if (kind == "double") {
      world_->button_press(id, t, 120);
      world_->button_press(id, t + 300, 120);
    } else if (kind == "long") world_->button_press(id, t, 1700);
    else if (kind == "voice") world_->wake_word(id, t);
    else if (kind == "voice-medical" || kind == "voice_medical") {
      world_->wake_word(id, t);
      world_->voice_command(id, t + 1500, 1, setu::Hazard::Medical);
    } else if (kind == "voice-trapped" || kind == "voice_trapped") {
      world_->wake_word(id, t);
      world_->voice_command(id, t + 1500, 1, setu::Hazard::Trapped);
    } else if (kind == "fall") {
      if (t == 0) world_->set_motion_profile(id, sim::MotionProfile::FallImpact);
      else {
        sim::World* wp = world_.get();
        world_->schedule(t, [wp, id] { wp->set_motion_profile(id, sim::MotionProfile::FallImpact); });
      }
    }
  }

  void add_fault(const std::string& kind, const std::string& target, uint32_t t, const std::string& arg) {
    if (!world_) return;
    sim::World* wp = world_.get();
    if (kind == "kill") {
      auto id = static_cast<uint16_t>(std::stoi(target));
      if (t == 0) wp->set_online(id, false);
      else world_->schedule(t, [wp, id] { wp->set_online(id, false); });
    } else if (kind == "revive") {
      auto id = static_cast<uint16_t>(std::stoi(target));
      if (t == 0) wp->set_online(id, true);
      else world_->schedule(t, [wp, id] { wp->set_online(id, true); });
    } else if (kind == "gps-off" || kind == "gps_off") {
      auto id = static_cast<uint16_t>(std::stoi(target));
      if (t == 0) wp->set_gnss(id, false);
      else world_->schedule(t, [wp, id] { wp->set_gnss(id, false); });
    } else if (kind == "no-dr" || kind == "no_dr") {
      auto id = static_cast<uint16_t>(std::stoi(target));
      if (t == 0) wp->set_dead_reckoning(id, false);
      else world_->schedule(t, [wp, id] { wp->set_dead_reckoning(id, false); });
    } else if (kind == "battery") {
      auto id = static_cast<uint16_t>(std::stoi(target));
      auto batt = static_cast<uint8_t>(std::stoi(arg));
      if (t == 0) wp->set_battery(id, batt);
      else world_->schedule(t, [wp, id, batt] { wp->set_battery(id, batt); });
    } else if (kind == "motion") {
      auto id = static_cast<uint16_t>(std::stoi(target));
      sim::MotionProfile p = sim::MotionProfile::Stationary;
      if (arg == "moving") p = sim::MotionProfile::Moving;
      else if (arg == "walking") p = sim::MotionProfile::Walking;
      else if (arg == "running") p = sim::MotionProfile::Running;
      else if (arg == "sudden_movement") p = sim::MotionProfile::SuddenMovement;
      else if (arg == "fall_impact") p = sim::MotionProfile::FallImpact;
      else if (arg == "irregular") p = sim::MotionProfile::Irregular;
      else if (arg == "crawling") p = sim::MotionProfile::Crawling;
      if (t == 0) wp->set_motion_profile(id, p);
      else world_->schedule(t, [wp, id, p] { wp->set_motion_profile(id, p); });
    } else if (kind == "block") {
      auto d = target.find('-');
      if (d != std::string::npos) {
        auto x = static_cast<uint16_t>(std::stoi(target.substr(0, d)));
        auto y = static_cast<uint16_t>(std::stoi(target.substr(d + 1)));
        if (t == 0) wp->block_link(x, y);
        else world_->schedule(t, [wp, x, y] { wp->block_link(x, y); });
      }
    }
  }

  void add_obstacle(uint16_t id, const std::string& material_str,
                    double x1, double y1, double x2, double y2, double custom_atten) {
    if (!world_) return;
    sim::Obstacle obs;
    obs.id = id;
    obs.label = "obs_" + std::to_string(id);
    obs.material = sim::parse_material(material_str);
    obs.x1 = x1;
    obs.y1 = y1;
    obs.x2 = x2;
    obs.y2 = y2;
    obs.thickness_m = 0.2;
    obs.attenuation_db = (custom_atten >= 0.0) ? custom_atten : sim::material_default_attenuation_db(obs.material, obs.thickness_m);
    world_->add_obstacle(obs);
  }

  void set_duration(uint32_t d) {
    configured_duration_ = d;
  }

  void step(uint32_t ms) {
    if (world_) world_->step(ms);
  }

  void run_until(uint32_t t_ms) {
    if (world_ && t_ms > world_->now()) world_->run_until(t_ms);
  }

  void run_all() {
    if (world_ && configured_duration_ > world_->now()) {
      world_->run_until(configured_duration_);
    }
  }

  uint32_t now() const {
    return world_ ? world_->now() : 0;
  }

  bool trigger_button(uint16_t id, const std::string& kind) {
    if (!world_) return false;
    uint32_t t = world_->now();
    if (kind == "short") world_->button_press(id, t, 150);
    else if (kind == "double") {
      world_->button_press(id, t, 120);
      world_->button_press(id, t + 300, 120);
    } else if (kind == "long") world_->button_press(id, t, 1700);
    else return false;
    return true;
  }

  bool trigger_voice(uint16_t id, const std::string& kind) {
    if (!world_) return false;
    uint32_t t = world_->now();
    world_->wake_word(id, t);
    if (kind == "voice-medical" || kind == "voice") {
      world_->voice_command(id, t + 1500, 1, setu::Hazard::Medical);
    } else if (kind == "voice-trapped") {
      world_->voice_command(id, t + 1500, 1, setu::Hazard::Trapped);
    }
    return true;
  }

  bool trigger_fall(uint16_t id) {
    if (!world_) return false;
    world_->set_motion_profile(id, sim::MotionProfile::FallImpact);
    return true;
  }

  std::string get_loss_budget_json(uint16_t from, uint16_t to) const {
    if (!world_) return "{\"ok\":false,\"error\":\"no world\"}";
    sim::LossBudget lb = world_->get_loss_budget(from, to);
    std::ostringstream ss;
    ss << "{\"ok\":true,\"from\":" << from << ",\"to\":" << to
       << ",\"tx_power_dbm\":" << lb.tx_power_dbm
       << ",\"ref_loss_db\":" << lb.ref_loss_db
       << ",\"path_loss_db\":" << lb.path_loss_db
       << ",\"shadow_loss_db\":" << lb.shadow_loss_db
       << ",\"extra_loss_db\":" << lb.extra_loss_db
       << ",\"fading_loss_db\":" << lb.fading_loss_db
       << ",\"obstacle_loss\":\"" << lb.obstacle_loss << "\""
       << ",\"body_loss\":\"" << lb.body_loss << "\""
       << ",\"rx_power_dbm\":" << lb.rx_power_dbm
       << ",\"sensitivity_dbm\":" << lb.sensitivity_dbm
       << ",\"link_margin_db\":" << lb.link_margin_db
       << ",\"viable\":" << (lb.viable ? "true" : "false") << "}";
    return ss.str();
  }

  std::string get_trace_log() {
    std::string s = trace_stream_.str();
    trace_stream_.str("");
    trace_stream_.clear();
    return s;
  }

  std::string get_summary_json() const {
    if (!world_) return "{\"ok\":false,\"error\":\"no world\"}";
    const auto& c = world_->counters();
    const auto& ch = world_->channel_params();
    std::ostringstream ss;
    ss << "{\"ok\":true,\"profile\":\"" << sim::realism_profile_str(ch.profile) << "\""
       << ",\"profile_label\":\"" << sim::realism_profile_label(ch.profile) << "\""
       << ",\"capacity_mah\":" << ch.battery_capacity_mah
       << ",\"now_ms\":" << world_->now()
       << ",\"totals\":{\"tx\":" << c.tx << ",\"delivered\":" << c.delivered
       << ",\"collisions\":" << c.collisions << ",\"weak\":" << c.weak
       << ",\"lost\":" << c.lost << "}}";
    return ss.str();
  }

  std::string get_state_json() const {
    if (!world_) return "{\"ok\":false,\"error\":\"no world\"}";
    auto infos = world_->get_all_nodes_info();
    std::ostringstream ss;
    ss << "{\"ok\":true,\"cmd\":\"get_state\",\"t\":" << world_->now() << ",\"nodes\":[";
    for (size_t i = 0; i < infos.size(); ++i) {
      const auto& inf = infos[i];
      const char* role_str = (inf.role == setu::Role::Hub) ? "hub"
                           : (inf.role == setu::Role::Relay) ? "relay" : "survivor";
      ss << "{\"id\":" << inf.id << ",\"role\":\"" << role_str << "\""
         << ",\"x\":" << inf.x << ",\"y\":" << inf.y
         << ",\"lat_e6\":" << inf.lat_e6 << ",\"lon_e6\":" << inf.lon_e6
         << ",\"gt_lat_e6\":" << inf.ground_truth_lat_e6 << ",\"gt_lon_e6\":" << inf.ground_truth_lon_e6
         << ",\"has_estimate\":" << (inf.has_estimate ? "true" : "false");
      if (inf.has_estimate) {
        ss << ",\"est_lat_e6\":" << inf.estimated_lat_e6 << ",\"est_lon_e6\":" << inf.estimated_lon_e6
           << ",\"pos_error_m\":" << inf.pos_error_m;
      } else {
        ss << ",\"est_lat_e6\":null,\"est_lon_e6\":null,\"pos_error_m\":null";
      }
      if (inf.has_samples) {
        ss << ",\"pos_mae_m\":" << inf.pos_mae_m
           << ",\"pos_rmse_m\":" << inf.pos_rmse_m
           << ",\"pos_max_err_m\":" << inf.pos_max_error_m;
      } else {
        ss << ",\"pos_mae_m\":null,\"pos_rmse_m\":null,\"pos_max_err_m\":null";
      }
      ss << ",\"motion_profile\":\"" << inf.motion_profile << "\""
         << ",\"gnss_status\":\"" << inf.gnss_status << "\""
         << ",\"battery\":" << static_cast<int>(inf.battery)
         << ",\"initial_battery\":" << static_cast<int>(inf.initial_battery)
         << ",\"energy_consumed_mah\":" << inf.energy_consumed_mah
         << ",\"online\":" << (inf.online ? "true" : "false")
         << ",\"gnss\":" << (inf.gnss_on ? "true" : "false")
         << ",\"dr\":" << (inf.dr_on ? "true" : "false")
         << ",\"active\":" << (inf.active ? "true" : "false")
         << ",\"acked\":" << (inf.acked ? "true" : "false")
         << ",\"gave_up\":" << (inf.gave_up ? "true" : "false")
         << ",\"seq\":" << inf.seq
         << ",\"duty_used_ms\":" << inf.duty_used_ms
         << ",\"tx_sos\":" << inf.stats.tx_sos
         << ",\"tx_relay\":" << inf.stats.tx_relay
         << ",\"tx_ack\":" << inf.stats.tx_ack
         << ",\"rx_total\":" << inf.stats.rx_total << "}"
         << (i + 1 < infos.size() ? "," : "");
    }
    ss << "]}";
    return ss.str();
  }

 private:
  std::unique_ptr<sim::World> world_;
  std::ostringstream trace_stream_;
  uint32_t seed_ = 0;
  uint32_t configured_duration_ = 30000;
};

}  // namespace setu_wasm

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_BINDINGS(setu_wasm_module) {
  emscripten::class_<setu_wasm::WasmSimSession>("WasmSimSession")
      .constructor<>()
      .function("init", &setu_wasm::WasmSimSession::init)
      .function("init_with_params", &setu_wasm::WasmSimSession::init_with_params)
      .function("add_trigger", &setu_wasm::WasmSimSession::add_trigger)
      .function("add_fault", &setu_wasm::WasmSimSession::add_fault)
      .function("add_obstacle", &setu_wasm::WasmSimSession::add_obstacle)
      .function("set_duration", &setu_wasm::WasmSimSession::set_duration)
      .function("step", &setu_wasm::WasmSimSession::step)
      .function("run_until", &setu_wasm::WasmSimSession::run_until)
      .function("run_all", &setu_wasm::WasmSimSession::run_all)
      .function("now", &setu_wasm::WasmSimSession::now)
      .function("trigger_button", &setu_wasm::WasmSimSession::trigger_button)
      .function("trigger_voice", &setu_wasm::WasmSimSession::trigger_voice)
      .function("trigger_fall", &setu_wasm::WasmSimSession::trigger_fall)
      .function("get_loss_budget_json", &setu_wasm::WasmSimSession::get_loss_budget_json)
      .function("get_trace_log", &setu_wasm::WasmSimSession::get_trace_log)
      .function("get_summary_json", &setu_wasm::WasmSimSession::get_summary_json)
      .function("get_state_json", &setu_wasm::WasmSimSession::get_state_json);
}
#endif
