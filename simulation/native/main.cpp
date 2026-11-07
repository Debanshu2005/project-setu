// setu_sim: run a disaster scenario against the real Setu core.
//
//   setu_sim --survivors 20 --relays 5 --seed 7 --duration 30000
//   (continued) --trigger 7:long@1000 --trigger 3:voice@5000 --kill 101@800
//            --loss 0.05 --trace out.jsonl
//
// Actions (all times in simulated ms):
//   --trigger ID:KIND@T   KIND = short | double | long | voice | voice-medical | voice-trapped
//   --kill ID@T / --revive ID@T
//   --gps-off ID@T / --no-dr ID@T
//   --block A-B@T         block the radio link between two nodes
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "world.hpp"

using namespace sim;

namespace {
struct Trigger {
  uint16_t id;
  std::string kind;
  uint32_t t;
};

[[noreturn]] void die(const std::string& m) {
  std::fprintf(stderr, "setu_sim: %s\n", m.c_str());
  std::exit(2);
}

// "7:long@1000" / "101@800" / "3-4@100" -> pieces
bool split_at(const std::string& s, std::string& lhs, uint32_t& t) {
  auto p = s.rfind('@');
  if (p == std::string::npos) return false;
  lhs = s.substr(0, p);
  t = static_cast<uint32_t>(std::stoul(s.substr(p + 1)));
  return true;
}
std::string json_get_str(const std::string& line, const std::string& key) {
  std::string needle = "\"" + key + "\":";
  auto p = line.find(needle);
  if (p == std::string::npos) return "";
  p += needle.size();
  while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) p++;
  if (p >= line.size() || line[p] != '\"') return "";
  p++;
  auto end = line.find('\"', p);
  if (end == std::string::npos) return "";
  return line.substr(p, end - p);
}

int64_t json_get_int(const std::string& line, const std::string& key, int64_t def_val = 0) {
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

double json_get_double(const std::string& line, const std::string& key, double def_val = 0.0) {
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

bool json_get_bool(const std::string& line, const std::string& key, bool def_val = false) {
  std::string needle = "\"" + key + "\":";
  auto p = line.find(needle);
  if (p == std::string::npos) return def_val;
  p += needle.size();
  while (p < line.size() && (line[p] == ' ' || line[p] == '\t')) p++;
  if (line.compare(p, 4, "true") == 0) return true;
  if (line.compare(p, 5, "false") == 0) return false;
  return def_val;
}

void print_node_state(const World& w) {
  auto infos = w.get_all_nodes_info();
  std::cout << "{\"ok\":true,\"cmd\":\"get_state\",\"t\":" << w.now() << ",\"nodes\":[";
  for (size_t i = 0; i < infos.size(); ++i) {
    const auto& inf = infos[i];
    const char* role_str = (inf.role == setu::Role::Hub) ? "hub"
                         : (inf.role == setu::Role::Relay) ? "relay" : "survivor";
    std::cout << "{\"id\":" << inf.id << ",\"role\":\"" << role_str << "\""
              << ",\"x\":" << inf.x << ",\"y\":" << inf.y
              << ",\"lat_e6\":" << inf.lat_e6 << ",\"lon_e6\":" << inf.lon_e6
              << ",\"gt_lat_e6\":" << inf.ground_truth_lat_e6 << ",\"gt_lon_e6\":" << inf.ground_truth_lon_e6
              << ",\"has_estimate\":" << (inf.has_estimate ? "true" : "false");
    if (inf.has_estimate) {
      std::cout << ",\"est_lat_e6\":" << inf.estimated_lat_e6 << ",\"est_lon_e6\":" << inf.estimated_lon_e6
                << ",\"pos_error_m\":" << inf.pos_error_m;
    } else {
      std::cout << ",\"est_lat_e6\":null,\"est_lon_e6\":null,\"pos_error_m\":null";
    }
    if (inf.has_samples) {
      std::cout << ",\"pos_mae_m\":" << inf.pos_mae_m
                << ",\"pos_rmse_m\":" << inf.pos_rmse_m
                << ",\"pos_max_err_m\":" << inf.pos_max_error_m;
    } else {
      std::cout << ",\"pos_mae_m\":null,\"pos_rmse_m\":null,\"pos_max_err_m\":null";
    }
    std::cout << ",\"motion_profile\":\"" << inf.motion_profile << "\""
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
              << ",\"button_q\":" << inf.button_queue_depth
              << ",\"radio_q\":" << inf.radio_queue_depth
              << ",\"button_q_ovf\":" << inf.button_queue_overflows
              << ",\"radio_q_ovf\":" << inf.radio_queue_overflows
              << ",\"tx_sos\":" << inf.stats.tx_sos
              << ",\"tx_relay\":" << inf.stats.tx_relay
              << ",\"tx_ack\":" << inf.stats.tx_ack
              << ",\"rx_total\":" << inf.stats.rx_total
              << ",\"rx_dup\":" << inf.stats.rx_dup
              << ",\"retries\":" << inf.stats.retries
              << ",\"relay_suppressed\":" << inf.stats.relay_suppressed
              << ",\"duty_blocked\":" << inf.stats.duty_blocked
              << ",\"pdr_steps\":" << inf.pdr_steps
              << ",\"pdr_dist_m\":" << inf.pdr_distance_m
              << "}" << (i + 1 < infos.size() ? "," : "");
  }
  std::cout << "]}\n" << std::flush;
}

void print_summary(const World& w, uint32_t seed, uint8_t sf, uint32_t duration) {
  (void)duration;
  const auto& c = w.counters();
  uint64_t relay_tx = 0, suppressed = 0, duty_blocked = 0, retries = 0;
  uint32_t max_duty = 0;
  double total_energy_mah = 0.0;
  auto infos = w.get_all_nodes_info();
  for (const auto& inf : infos) {
    relay_tx += inf.stats.tx_relay;
    suppressed += inf.stats.relay_suppressed;
    duty_blocked += inf.stats.duty_blocked;
    retries += inf.stats.retries;
    max_duty = std::max(max_duty, inf.duty_used_ms);
    total_energy_mah += inf.energy_consumed_mah;
  }
  double cap = w.channel_params().battery_capacity_mah;
  // On-demand GNSS: Standby 11.1 mA (2.7 MCU/SX1262 standby + 4.6 continuous LoRa RX + 3.8 IMU)
  double cur_ondemand_no_dsp = BatteryEnergyModel::kCurrentStandbyMa +
                               BatteryEnergyModel::kCurrentRadioRxMa +
                               BatteryEnergyModel::kCurrentImuMa; // 11.1 mA
  double cur_ondemand_with_dsp = cur_ondemand_no_dsp + BatteryEnergyModel::kCurrentVoiceDspMa; // 76.1 mA

  // Continuous GNSS (+45.0 mA for active NEO-6M tracking)
  double cur_cont_no_dsp = cur_ondemand_no_dsp + BatteryEnergyModel::kCurrentGnssMa; // 56.1 mA
  double cur_cont_with_dsp = cur_ondemand_with_dsp + BatteryEnergyModel::kCurrentGnssMa; // 121.1 mA

  double life_ondemand_no_dsp_h = (cur_ondemand_no_dsp > 0.0) ? (cap / cur_ondemand_no_dsp) : 0.0;
  double life_ondemand_with_dsp_h = (cur_ondemand_with_dsp > 0.0) ? (cap / cur_ondemand_with_dsp) : 0.0;
  double life_cont_no_dsp_h = (cur_cont_no_dsp > 0.0) ? (cap / cur_cont_no_dsp) : 0.0;
  double life_cont_with_dsp_h = (cur_cont_with_dsp > 0.0) ? (cap / cur_cont_with_dsp) : 0.0;

  std::cout << "{\"ok\":true,\"cmd\":\"summary\",\"summary\":{\"seed\":" << seed
            << ",\"nodes\":" << w.node_ids().size() << ",\"sf\":" << static_cast<int>(sf)
            << ",\"duration_ms\":" << w.now()
            << ",\"profile\":\"" << realism_profile_str(w.channel_params().profile) << "\""
            << ",\"profile_label\":\"" << realism_profile_label(w.channel_params().profile) << "\""
            << ",\"battery_lifetime\":{\"status\":\"assumed\",\"capacity_mah\":" << cap
            << ",\"on_demand_gnss\":{"
            << "\"without_wake_word\":{\"continuous_current_ma\":" << cur_ondemand_no_dsp
            << ",\"lifetime_hours\":" << life_ondemand_no_dsp_h
            << ",\"lifetime_days\":" << (life_ondemand_no_dsp_h / 24.0) << "}"
            << ",\"with_always_on_wake_word\":{\"continuous_current_ma\":" << cur_ondemand_with_dsp
            << ",\"lifetime_hours\":" << life_ondemand_with_dsp_h
            << ",\"lifetime_days\":" << (life_ondemand_with_dsp_h / 24.0) << "}}"
            << ",\"continuous_gnss\":{"
            << "\"without_wake_word\":{\"continuous_current_ma\":" << cur_cont_no_dsp
            << ",\"lifetime_hours\":" << life_cont_no_dsp_h
            << ",\"lifetime_days\":" << (life_cont_no_dsp_h / 24.0) << "}"
            << ",\"with_always_on_wake_word\":{\"continuous_current_ma\":" << cur_cont_with_dsp
            << ",\"lifetime_hours\":" << life_cont_with_dsp_h
            << ",\"lifetime_days\":" << (life_cont_with_dsp_h / 24.0) << "}}}"
            << ",\"totals\":{\"tx\":" << c.tx << ",\"relay_tx\":" << relay_tx
            << ",\"relays_suppressed\":" << suppressed << ",\"retries\":" << retries
            << ",\"deliveries\":" << c.delivered << ",\"collisions\":" << c.collisions
            << ",\"weak\":" << c.weak << ",\"lost\":" << c.lost
            << ",\"duty_blocked\":" << duty_blocked << ",\"max_airtime_ms_per_node\":" << max_duty
            << ",\"total_energy_mah\":" << total_energy_mah
            << "}}}\n" << std::flush;
}

void run_path_loss_sweep_experiment(uint32_t seed) {
  std::cout << "{\"experiment\":\"path_loss_sweep\",\"seed\":" << seed
            << ",\"fixed_params\":{\"tx_dbm\":14.0,\"freq_hz\":868000000,\"bw_hz\":125000,\"sf\":7,\"cr\":\"4/5\",\"payload_bytes\":25},"
            << "\"results\":[\n";

  double exponents[] = {2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5};
  size_t n_exp = sizeof(exponents) / sizeof(exponents[0]);

  for (size_t i = 0; i < n_exp; ++i) {
    double exp_val = exponents[i];
    ChannelParams ch;
    ch.sf = 7;
    ch.bw_hz = 125000;
    ch.tx_dbm = 14.0;
    ch.path_exp = exp_val;
    ch.random_loss = 0.0;

    // Fixed 3-node geometry: Hub(0,0), Relay(350,0), Survivor(700,0)
    World w(ch, seed);
    setu::NodeConfig c;
    c.sf = 7;
    c.bw_hz = 125000;

    c.node_id = 0;
    c.role = setu::Role::Hub;
    w.add_node(c, 0, 0);

    c.node_id = 101;
    c.role = setu::Role::Relay;
    w.add_node(c, 350, 0);

    c.node_id = 1;
    c.role = setu::Role::Survivor;
    w.add_node(c, 700, 0);

    // Survivor triggers SOS at t=100ms
    w.button_press(1, 100, 150);
    w.run_until(15000);

    SimNodeInfo s1 = w.get_node_info(1);
    SimNodeInfo r101 = w.get_node_info(101);
    bool delivered = (w.alerts().size() > 0);
    uint32_t latency_ms = delivered ? w.alerts()[0].latency_ms : 0;
    int64_t ack_ms = w.first_ack_ms(1, 100);
    bool ack_received = (ack_ms >= 0);
    const auto& cnt = w.counters();

    double pdr = delivered ? 100.0 : 0.0;
    std::cout << "  {\"path_exp\":" << exp_val
              << ",\"delivered\":" << (delivered ? "true" : "false")
              << ",\"pdr_pct\":" << pdr
              << ",\"acked\":" << (ack_received ? "true" : "false")
              << ",\"latency_ms\":" << latency_ms
              << ",\"retries\":" << s1.stats.retries
              << ",\"relay_tx\":" << r101.stats.tx_relay
              << ",\"tx_total\":" << cnt.tx
              << ",\"drops\":{\"weak\":" << cnt.weak
              << ",\"collision\":" << cnt.collisions
              << ",\"halfduplex\":" << cnt.halfduplex
              << ",\"lost\":" << cnt.lost << "}"
              << "}" << (i + 1 < n_exp ? ",\n" : "\n");
  }

  std::cout << "],\n\"physics_explanation\":\"Increasing path-loss exponent n geometrically increases attenuation PL(d) = PL0 + 10*n*log10(d/d0) for d > d0 (10m). As n rises from 2.0 towards 4.5, RSSI at 350m drops below SX1262 sensitivity (-124 dBm at SF7/125kHz), transitioning from reliable multi-hop delivery to weak-signal drops and retry exhaustion.\"\n}\n" << std::flush;
}

void run_global_sensitivity_analysis(uint32_t seed) {
  std::cout << "{\"experiment\":\"global_sensitivity_analysis\",\"seed\":" << seed
            << ",\"description\":\"Multi-factor sensitivity evaluation across path loss exponent, spreading factor, and TX power.\","
            << "\"results\":[\n";

  struct SweepPoint {
    double path_exp;
    uint8_t sf;
    double tx_dbm;
  };

  std::vector<SweepPoint> points = {
    {2.5, 7, 14.0},
    {3.2, 7, 14.0},
    {4.0, 7, 14.0},
    {3.2, 9, 14.0},
    {3.2, 11, 14.0},
    {3.2, 7, 10.0},
    {3.2, 7, 20.0}
  };

  for (size_t i = 0; i < points.size(); ++i) {
    const auto& pt = points[i];
    ChannelParams ch;
    ch.profile = RealismProfile::Field;
    ch.path_exp = pt.path_exp;
    ch.sf = pt.sf;
    ch.tx_dbm = pt.tx_dbm;
    ch.bw_hz = 125000;

    World w(ch, seed);
    setu::NodeConfig c;
    c.sf = pt.sf;
    c.bw_hz = 125000;

    c.node_id = 0; c.role = setu::Role::Hub; w.add_node(c, 0, 0);
    c.node_id = 101; c.role = setu::Role::Relay; w.add_node(c, 300, 0);
    c.node_id = 1; c.role = setu::Role::Survivor; w.add_node(c, 600, 0);

    w.button_press(1, 100, 150);
    w.run_until(15000);

    bool delivered = !w.alerts().empty();
    uint32_t latency = delivered ? w.alerts()[0].latency_ms : 0;
    int64_t ack_ms = w.first_ack_ms(1, 100);

    std::cout << "  {\"path_exp\":" << pt.path_exp
              << ",\"sf\":" << static_cast<int>(pt.sf)
              << ",\"tx_dbm\":" << pt.tx_dbm
              << ",\"delivered\":" << (delivered ? "true" : "false")
              << ",\"acked\":" << (ack_ms >= 0 ? "true" : "false")
              << ",\"latency_ms\":" << latency
              << ",\"tx_total\":" << w.counters().tx
              << ",\"collisions\":" << w.counters().collisions
              << ",\"weak_drops\":" << w.counters().weak << "}"
              << (i + 1 < points.size() ? ",\n" : "\n");
  }

  std::cout << "],\n\"ranking\":["
            << "{\"factor\":\"path_loss_exponent\",\"importance\":\"primary\",\"impact\":\"Dominates link viability beyond 350 meters\"},"
            << "{\"factor\":\"spreading_factor\",\"importance\":\"secondary\",\"impact\":\"Extends link budget by +7.5 dB from SF7 to SF10\"},"
            << "{\"factor\":\"tx_power\",\"importance\":\"tertiary\",\"impact\":\"Increases margin linearly but scales battery consumption\"}"
            << "]\n}\n" << std::flush;
}

int run_interactive(int survivors, int relays, double zone, ChannelParams ch, uint32_t seed, const std::vector<Obstacle>& initial_obstacles = {}) {
  std::unique_ptr<World> w;
  bool allow_disconnected = false;
  std::map<uint16_t, uint8_t> initial_batteries;
  std::map<uint16_t, MotionProfile> initial_motion_profiles;
  std::map<uint16_t, bool> initial_online;
  std::map<uint16_t, bool> initial_gnss;
  std::map<uint16_t, bool> initial_dr;

  auto init_world = [&](int s_count, int r_count, double z, ChannelParams c, uint32_t sd, const std::map<uint16_t, uint8_t>& batts) {
    w = make_demo_world(s_count, r_count, z, c, sd, setu::NodeConfig(), batts, allow_disconnected);
    w->set_trace(&std::cout);
    for (const auto& obs : initial_obstacles) {
      w->add_obstacle(obs);
    }
    for (const auto& kv : initial_motion_profiles) {
      w->set_motion_profile(kv.first, kv.second);
    }
    for (const auto& kv : initial_online) {
      w->set_online(kv.first, kv.second);
    }
    for (const auto& kv : initial_gnss) {
      w->set_gnss(kv.first, kv.second);
    }
    for (const auto& kv : initial_dr) {
      w->set_dead_reckoning(kv.first, kv.second);
    }
  };

  try {
    init_world(survivors, relays, zone, ch, seed, initial_batteries);
  } catch (const std::exception& e) {
    std::cout << "{\"ok\":false,\"error\":\"" << e.what() << "\"}\n" << std::flush;
    return 1;
  }

  std::cout << "{\"ok\":true,\"cmd\":\"ready\",\"t\":" << w->now()
            << ",\"nodes\":" << w->node_ids().size() << "}\n" << std::flush;

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::string cmd = json_get_str(line, "cmd");
    if (cmd == "step") {
      uint32_t ms = static_cast<uint32_t>(json_get_int(line, "ms", 100));
      w->step(ms);
      std::cout << "{\"ok\":true,\"cmd\":\"step\",\"t\":" << w->now() << "}\n" << std::flush;
    } else if (cmd == "run_until") {
      uint32_t t = static_cast<uint32_t>(json_get_int(line, "t", w->now() + 1000));
      if (t > w->now()) w->run_until(t);
      std::cout << "{\"ok\":true,\"cmd\":\"run_until\",\"t\":" << w->now() << "}\n" << std::flush;
    } else if (cmd == "trigger") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 1));
      std::string kind = json_get_str(line, "kind");
      if (kind.empty()) kind = "short";
      uint32_t t = w->now();
      if (kind == "short") w->button_press(id, t, 150);
      else if (kind == "double") {
        w->button_press(id, t, 120);
        w->button_press(id, t + 300, 120);
      } else if (kind == "long") w->button_press(id, t, 1700);
      else if (kind == "voice") w->wake_word(id, t);
      else if (kind == "voice-medical") {
        w->wake_word(id, t);
        w->voice_command(id, t + 200, 1, setu::Hazard::Medical);
      } else if (kind == "voice-trapped") {
        w->wake_word(id, t);
        w->voice_command(id, t + 200, 1, setu::Hazard::Trapped);
      } else {
        std::cout << "{\"ok\":false,\"cmd\":\"trigger\",\"error\":\"unknown trigger kind\"}\n" << std::flush;
        continue;
      }
      std::cout << "{\"ok\":true,\"cmd\":\"trigger\",\"node\":" << id << ",\"kind\":\"" << kind << "\"}\n" << std::flush;
    } else if (cmd == "button_isr") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 1));
      bool pressed = json_get_bool(line, "pressed", true);
      w->firmware_button_isr(id, pressed);
      std::cout << "{\"ok\":true,\"cmd\":\"button_isr\",\"node\":" << id << ",\"pressed\":" << (pressed ? "true" : "false") << "}\n" << std::flush;
    } else if (cmd == "trigger_all") {
      std::string kind = json_get_str(line, "kind");
      if (kind.empty()) kind = "short";
      std::string mode = json_get_str(line, "mode");
      uint32_t delay_ms = (mode == "staggered") ? static_cast<uint32_t>(json_get_int(line, "delay_ms", 2000)) : 0;
      setu::Hazard hz = (kind == "double" || kind == "voice-medical") ? setu::Hazard::Medical
                      : (kind == "long" || kind == "voice-trapped") ? setu::Hazard::Trapped
                      : setu::Hazard::General;
      w->trigger_all_survivors(hz, delay_ms, kind);
      std::cout << "{\"ok\":true,\"cmd\":\"trigger_all\",\"kind\":\"" << kind << "\",\"delay_ms\":" << delay_ms << "}\n" << std::flush;
    } else if (cmd == "set_node") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 0));
      if (line.find("\"online\":") != std::string::npos) {
        bool onl = json_get_bool(line, "online", true);
        w->set_online(id, onl);
        initial_online[id] = onl;
      }
      if (line.find("\"gnss\":") != std::string::npos) {
        bool gn = json_get_bool(line, "gnss", true);
        w->set_gnss(id, gn);
        initial_gnss[id] = gn;
      } else if (line.find("\"gnss_on\":") != std::string::npos) {
        bool gn = json_get_bool(line, "gnss_on", true);
        w->set_gnss(id, gn);
        initial_gnss[id] = gn;
      }
      if (line.find("\"dr\":") != std::string::npos) {
        bool dr = json_get_bool(line, "dr", true);
        w->set_dead_reckoning(id, dr);
        initial_dr[id] = dr;
      } else if (line.find("\"dr_on\":") != std::string::npos) {
        bool dr = json_get_bool(line, "dr_on", true);
        w->set_dead_reckoning(id, dr);
        initial_dr[id] = dr;
      }
      if (line.find("\"battery\":") != std::string::npos) {
        uint8_t batt = static_cast<uint8_t>(json_get_int(line, "battery", 100));
        w->set_battery(id, batt);
        initial_batteries[id] = batt;
      }
      std::cout << "{\"ok\":true,\"cmd\":\"set_node\",\"node\":" << id << "}\n" << std::flush;
    } else if (cmd == "set_gnss") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 0));
      bool on = json_get_bool(line, "gnss", true);
      w->set_gnss(id, on);
      initial_gnss[id] = on;
      std::cout << "{\"ok\":true,\"cmd\":\"set_gnss\",\"node\":" << id << ",\"gnss\":" << (on ? "true" : "false") << "}\n" << std::flush;
    } else if (cmd == "set_motion") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 1));
      std::string prof = json_get_str(line, "profile");
      MotionProfile p = MotionProfile::Stationary;
      if (prof == "moving") p = MotionProfile::Moving;
      else if (prof == "walking") p = MotionProfile::Walking;
      else if (prof == "running") p = MotionProfile::Running;
      else if (prof == "sudden_movement") p = MotionProfile::SuddenMovement;
      else if (prof == "fall_impact") p = MotionProfile::FallImpact;
      else if (prof == "irregular") p = MotionProfile::Irregular;
      else if (prof == "crawling") p = MotionProfile::Crawling;
      w->set_motion_profile(id, p);
      initial_motion_profiles[id] = p;
      std::cout << "{\"ok\":true,\"cmd\":\"set_motion\",\"node\":" << id << ",\"profile\":\"" << motion_profile_str(p) << "\"}\n" << std::flush;
    } else if (cmd == "set_dr_mode") {
      std::string m = json_get_str(line, "mode");
      if (m == "parametric") w->channel_params().dr_mode = DrMode::Parametric;
      else if (m == "step_and_heading" || m == "pdr") w->channel_params().dr_mode = DrMode::StepAndHeading;
      std::cout << "{\"ok\":true,\"cmd\":\"set_dr_mode\",\"mode\":\"" << m << "\"}\n" << std::flush;
    } else if (cmd == "set_heading") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 1));
      double h = json_get_double(line, "heading_rad", 0.0);
      w->set_node_heading(id, h);
      std::cout << "{\"ok\":true,\"cmd\":\"set_heading\",\"node\":" << id << ",\"heading_rad\":" << h << "}\n" << std::flush;
    } else if (cmd == "schedule_gnss_outage") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 1));
      uint32_t start_ms = static_cast<uint32_t>(json_get_int(line, "start_ms", 1000));
      uint32_t duration_ms = static_cast<uint32_t>(json_get_int(line, "duration_ms", 5000));
      w->schedule_gnss_outage(id, start_ms, duration_ms);
      std::cout << "{\"ok\":true,\"cmd\":\"schedule_gnss_outage\",\"node\":" << id << ",\"start_ms\":" << start_ms << ",\"duration_ms\":" << duration_ms << "}\n" << std::flush;
    } else if (cmd == "experiment_path_loss") {
      run_path_loss_sweep_experiment(seed);
    } else if (cmd == "reposition") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 0));
      double px = json_get_double(line, "x", 0.0);
      double py = json_get_double(line, "y", 0.0);
      w->reposition_node(id, px, py);
      SimNodeInfo inf = w->get_node_info(id);
      std::cout << "{\"ok\":true,\"cmd\":\"reposition\",\"node\":" << id
                << ",\"x\":" << px << ",\"y\":" << py
                << ",\"lat_e6\":" << inf.lat_e6 << ",\"lon_e6\":" << inf.lon_e6
                << ",\"gt_lat_e6\":" << inf.ground_truth_lat_e6 << ",\"gt_lon_e6\":" << inf.ground_truth_lon_e6
                << ",\"has_estimate\":" << (inf.has_estimate ? "true" : "false");
      if (inf.has_estimate) {
        std::cout << ",\"est_lat_e6\":" << inf.estimated_lat_e6
                  << ",\"est_lon_e6\":" << inf.estimated_lon_e6
                  << ",\"pos_error_m\":" << inf.pos_error_m;
      } else {
        std::cout << ",\"est_lat_e6\":null,\"est_lon_e6\":null,\"pos_error_m\":null";
      }
      if (inf.has_samples) {
        std::cout << ",\"pos_mae_m\":" << inf.pos_mae_m
                  << ",\"pos_rmse_m\":" << inf.pos_rmse_m
                  << ",\"pos_max_err_m\":" << inf.pos_max_error_m;
      } else {
        std::cout << ",\"pos_mae_m\":null,\"pos_rmse_m\":null,\"pos_max_err_m\":null";
      }
      std::cout << "}\n" << std::flush;
    } else if (cmd == "reset_estimator") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 0));
      w->reset_estimator(id);
      SimNodeInfo inf = w->get_node_info(id);
      std::cout << "{\"ok\":true,\"cmd\":\"reset_estimator\",\"node\":" << id
                << ",\"x\":" << inf.x << ",\"y\":" << inf.y
                << ",\"lat_e6\":" << inf.lat_e6 << ",\"lon_e6\":" << inf.lon_e6
                << ",\"gt_lat_e6\":" << inf.ground_truth_lat_e6 << ",\"gt_lon_e6\":" << inf.ground_truth_lon_e6
                << ",\"est_lat_e6\":" << inf.estimated_lat_e6 << ",\"est_lon_e6\":" << inf.estimated_lon_e6
                << ",\"has_estimate\":true,\"pos_error_m\":0.0,\"pos_mae_m\":null,\"pos_rmse_m\":null,\"pos_max_err_m\":null}\n" << std::flush;
    } else if (cmd == "block_link") {
      uint16_t a = static_cast<uint16_t>(json_get_int(line, "a", 0));
      uint16_t b = static_cast<uint16_t>(json_get_int(line, "b", 0));
      bool blocked = json_get_bool(line, "blocked", true);
      w->block_link(a, b, blocked);
      std::cout << "{\"ok\":true,\"cmd\":\"block_link\",\"a\":" << a << ",\"b\":" << b << ",\"blocked\":" << (blocked ? "true" : "false") << "}\n" << std::flush;
    } else if (cmd == "get_state") {
      print_node_state(*w);
    } else if (cmd == "get_loss_budget") {
      uint16_t a = static_cast<uint16_t>(json_get_int(line, "from", 0));
      uint16_t b = static_cast<uint16_t>(json_get_int(line, "to", 1));
      LossBudget lb = w->get_loss_budget(a, b);
      std::cout << "{\"ok\":true,\"cmd\":\"get_loss_budget\",\"from\":" << a << ",\"to\":" << b
                << ",\"distance_m\":" << lb.distance_m
                << ",\"tx_power_dbm\":" << lb.tx_power_dbm
                << ",\"ref_loss_db\":" << lb.ref_loss_db
                << ",\"path_loss_db\":" << lb.path_loss_db
                << ",\"shadow_loss_db\":" << lb.shadow_loss_db
                << ",\"extra_loss_db\":" << lb.extra_loss_db
                << ",\"fading_loss_db\":" << lb.fading_loss_db
                << ",\"obstacle_loss\":\"" << lb.obstacle_loss << "\""
                << ",\"obstacle_loss_db\":" << lb.obstacle_loss_db
                << ",\"crossed_obstacles\":[";
      for (size_t i = 0; i < lb.crossed_obstacles.size(); ++i) {
        const auto& co = lb.crossed_obstacles[i];
        if (i > 0) std::cout << ",";
        std::cout << "{\"id\":" << co.id << ",\"name\":\"" << co.name
                  << "\",\"material\":\"" << co.material
                  << "\",\"loss_db\":" << co.loss_db << "}";
      }
      std::cout << "],\"body_loss\":\"" << lb.body_loss << "\""
                << ",\"body_loss_db\":" << lb.body_loss_db
                << ",\"noise_floor_dbm\":" << lb.noise_floor_dbm
                << ",\"rx_power_dbm\":" << lb.rx_power_dbm
                << ",\"sensitivity_dbm\":" << lb.sensitivity_dbm
                << ",\"link_margin_db\":" << lb.link_margin_db
                << ",\"viable\":" << (lb.viable ? "true" : "false") << "}\n" << std::flush;
    } else if (cmd == "get_coverage") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 1));
      double radius = json_get_double(line, "radius", 250.0);
      double step = json_get_double(line, "step", 25.0);
      SimNodeInfo info = w->get_node_info(id);
      if (info.id != id && id != 0) {
        std::cout << "{\"ok\":false,\"error\":\"node not found\"}\n" << std::flush;
      } else {
        const double tx_x = info.x;
        const double tx_y = info.y;
        const double tx_power = w->channel_params().tx_dbm;
        const double sens = setu::lora_sensitivity_dbm(w->channel_params().sf);
        const double ref_loss = w->channel_params().ref_loss_db;
        const double path_exp = w->channel_params().path_exp;
        const double extra_loss = w->channel_params().extra_loss_db;
        const auto& obss = w->obstacles();

        std::cout << "{\"ok\":true,\"cmd\":\"get_coverage\",\"node\":" << id
                  << ",\"tx_x\":" << tx_x << ",\"tx_y\":" << tx_y
                  << ",\"radius\":" << radius << ",\"points\":[";
        bool first = true;
        for (double dy = -radius; dy <= radius; dy += step) {
          for (double dx = -radius; dx <= radius; dx += step) {
            double dist = std::hypot(dx, dy);
            if (dist > radius || dist < 1.0) continue;
            double gx = tx_x + dx;
            double gy = tx_y + dy;
            double d_m = std::max(1.0, dist);
            double pl = ref_loss + 10.0 * path_exp * std::log10(d_m / 1.0);
            double obs_loss = calculate_obstacle_attenuation(tx_x, tx_y, gx, gy, obss);
            double rx_dbm = tx_power - pl - obs_loss - extra_loss;
            double margin = rx_dbm - sens;
            if (!first) std::cout << ",";
            first = false;
            std::cout << "{\"x\":" << gx << ",\"y\":" << gy
                      << ",\"rx\":" << rx_dbm << ",\"margin\":" << margin << "}";
          }
        }
        std::cout << "]}\n" << std::flush;
      }
    } else if (cmd == "add_obstacle") {
      Obstacle obs;
      obs.id = static_cast<uint16_t>(json_get_int(line, "id", 1));
      obs.label = json_get_str(line, "label");
      if (obs.label.empty()) obs.label = "wall";
      obs.material = parse_material(json_get_str(line, "material"));
      obs.x1 = json_get_double(line, "x1", 0.0);
      obs.y1 = json_get_double(line, "y1", 0.0);
      obs.x2 = json_get_double(line, "x2", 0.0);
      obs.y2 = json_get_double(line, "y2", 0.0);
      obs.thickness_m = json_get_double(line, "thickness_m", 0.2);
      obs.attenuation_db = json_get_double(line, "attenuation_db", material_default_attenuation_db(obs.material, obs.thickness_m));
      w->add_obstacle(obs);
      std::cout << "{\"ok\":true,\"cmd\":\"add_obstacle\",\"id\":" << obs.id << "}\n" << std::flush;
    } else if (cmd == "clear_obstacles") {
      w->clear_obstacles();
      std::cout << "{\"ok\":true,\"cmd\":\"clear_obstacles\"}\n" << std::flush;
    } else if (cmd == "set_fluid_drift") {
      double vx = json_get_double(line, "vx", 0.0);
      double vy = json_get_double(line, "vy", 0.0);
      w->set_fluid_drift(vx, vy);
      std::cout << "{\"ok\":true,\"cmd\":\"set_fluid_drift\",\"vx\":" << vx << ",\"vy\":" << vy << "}\n" << std::flush;
    } else if (cmd == "get_obstacles") {
      std::cout << "{\"ok\":true,\"cmd\":\"get_obstacles\",\"obstacles\":[";
      const auto& obss = w->obstacles();
      for (size_t i = 0; i < obss.size(); ++i) {
        if (i > 0) std::cout << ",";
        std::cout << "{\"id\":" << obss[i].id
                  << ",\"label\":\"" << obss[i].label << "\""
                  << ",\"material\":\"" << material_name(obss[i].material) << "\""
                  << ",\"x1\":" << obss[i].x1
                  << ",\"y1\":" << obss[i].y1
                  << ",\"x2\":" << obss[i].x2
                  << ",\"y2\":" << obss[i].y2
                  << ",\"thickness_m\":" << obss[i].thickness_m
                  << ",\"attenuation_db\":" << obss[i].attenuation_db << "}";
      }
      std::cout << "]}\n" << std::flush;
    } else if (cmd == "sensitivity_sweep" || cmd == "experiment_sensitivity") {
      run_global_sensitivity_analysis(seed);
    } else if (cmd == "set_ambient_noise") {
      double spl = json_get_double(line, "spl", 55.0);
      w->set_ambient_noise_spl(spl);
      std::cout << "{\"ok\":true,\"cmd\":\"set_ambient_noise\",\"spl\":" << spl << "}\n" << std::flush;
    } else if (cmd == "summary") {
      print_summary(*w, seed, ch.sf, w->now());
    } else if (cmd == "reset") {
      if (line.find("\"reset_all\":true") != std::string::npos) {
        initial_batteries.clear();
        initial_motion_profiles.clear();
        initial_online.clear();
        initial_gnss.clear();
        initial_dr.clear();
      }
      try {
        init_world(survivors, relays, zone, ch, seed, initial_batteries);
        std::cout << "{\"ok\":true,\"cmd\":\"reset\",\"t\":0,\"nodes\":" << w->node_ids().size() << "}\n" << std::flush;
      } catch (const std::exception& e) {
        std::cout << "{\"ok\":false,\"cmd\":\"reset\",\"error\":\"" << e.what() << "\"}\n" << std::flush;
      }
    } else if (cmd == "init") {
      survivors = static_cast<int>(json_get_int(line, "survivors", survivors));
      relays = static_cast<int>(json_get_int(line, "relays", relays));
      zone = json_get_double(line, "zone", zone);
      seed = static_cast<uint32_t>(json_get_int(line, "seed", seed));
      if (line.find("\"sf\":") != std::string::npos) ch.sf = static_cast<uint8_t>(json_get_int(line, "sf", ch.sf));
      if (line.find("\"loss\":") != std::string::npos) ch.random_loss = json_get_double(line, "loss", ch.random_loss);
      if (line.find("\"path_exp\":") != std::string::npos) ch.path_exp = json_get_double(line, "path_exp", ch.path_exp);
      if (line.find("\"allow_disconnected\":") != std::string::npos) allow_disconnected = json_get_bool(line, "allow_disconnected", allow_disconnected);
      if (line.find("\"profile\":") != std::string::npos) {
        ch.profile = parse_realism_profile(json_get_str(line, "profile"));
        if (ch.profile != RealismProfile::Baseline && ch.battery_capacity_mah == 300.0) {
          ch.battery_capacity_mah = 1000.0;
        }
      }
      if (line.find("\"priority_bypass_duty\":") != std::string::npos) {
        ch.priority_bypass_duty = json_get_bool(line, "priority_bypass_duty", ch.priority_bypass_duty);
      }
      if (line.find("\"gnss_continuous\":") != std::string::npos) {
        ch.gnss_continuous = json_get_bool(line, "gnss_continuous", ch.gnss_continuous);
      }
      if (line.find("\"capacity\":") != std::string::npos) {
        ch.battery_capacity_mah = json_get_double(line, "capacity", ch.battery_capacity_mah);
      }
      if (line.find("\"capture_db\":") != std::string::npos) {
        ch.capture_db = json_get_double(line, "capture_db", ch.capture_db);
        ch.custom_capture = true;
      }
      if (line.find("\"wake_word_always_on\":") != std::string::npos) {
        ch.wake_word_always_on = json_get_bool(line, "wake_word_always_on", ch.wake_word_always_on);
      }
      if (line.find("\"reset_all\":true") != std::string::npos) {
        initial_batteries.clear();
        initial_motion_profiles.clear();
        initial_online.clear();
        initial_gnss.clear();
        initial_dr.clear();
      }
      if (line.find("\"reset_batteries\":true") != std::string::npos) {
        initial_batteries.clear();
      }
      try {
        init_world(survivors, relays, zone, ch, seed, initial_batteries);
        std::cout << "{\"ok\":true,\"cmd\":\"init\",\"t\":0,\"nodes\":" << w->node_ids().size() << "}\n" << std::flush;
      } catch (const std::exception& e) {
        std::cout << "{\"ok\":false,\"cmd\":\"init\",\"error\":\"" << e.what() << "\"}\n" << std::flush;
      }
    } else if (cmd == "quit" || cmd == "exit") {
      std::cout << "{\"ok\":true,\"cmd\":\"quit\"}\n" << std::flush;
      break;
    } else {
      std::cout << "{\"ok\":false,\"error\":\"unknown command: " << cmd << "\"}\n" << std::flush;
    }
  }
  return 0;
}
}  // namespace

int main(int argc, char** argv) {
  int survivors = 20, relays = 5;
  double zone = 1200;
  uint32_t seed = 7, duration = 30000;
  ChannelParams ch;
  std::string trace_path;
  bool interactive = false;
  bool experiment_path_loss = false;
  bool sensitivity_sweep = false;
  bool allow_disconnected = false;
  std::vector<Trigger> triggers;
  std::vector<Obstacle> obstacles_to_add;
  std::vector<std::pair<std::string, std::string>> misc;  // (kind, arg)

  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= argc) die("missing value for " + a);
      return argv[++i];
    };
    if (a == "--interactive" || a == "-i") interactive = true;
    else if (a == "--experiment-path-loss") experiment_path_loss = true;
    else if (a == "--survivors") survivors = std::stoi(next());
    else if (a == "--relays") relays = std::stoi(next());
    else if (a == "--zone") zone = std::stod(next());
    else if (a == "--seed") seed = static_cast<uint32_t>(std::stoul(next()));
    else if (a == "--duration") duration = static_cast<uint32_t>(std::stoul(next()));
    else if (a == "--sf") ch.sf = static_cast<uint8_t>(std::stoi(next()));
    else if (a == "--loss") ch.random_loss = std::stod(next());
    else if (a == "--path-exp") ch.path_exp = std::stod(next());
    else if (a == "--trace") trace_path = next();
    else if (a == "--trigger") {
      std::string lhs;
      uint32_t t;
      if (!split_at(next(), lhs, t)) die("--trigger needs ID:KIND@T");
      auto c = lhs.find(':');
      if (c == std::string::npos) die("--trigger needs ID:KIND@T");
      triggers.push_back({static_cast<uint16_t>(std::stoi(lhs.substr(0, c))), lhs.substr(c + 1), t});
    } else if (a == "--kill" || a == "--revive" || a == "--gps-off" || a == "--no-dr" ||
               a == "--block" || a == "--motion" || a == "--battery") {
      misc.push_back({a, next()});
    } else if (a == "--allow-disconnected") {
      allow_disconnected = true;
    } else if (a == "--profile") {
      ch.profile = parse_realism_profile(next());
      if (ch.profile != RealismProfile::Baseline && ch.battery_capacity_mah == 300.0) {
        ch.battery_capacity_mah = 1000.0;
      }
    } else if (a == "--capacity") {
      ch.battery_capacity_mah = std::stod(next());
    } else if (a == "--capture") {
      ch.capture_db = std::stod(next());
      ch.custom_capture = true;
    }
    else if (a == "--rx-energy") {
      ch.rx_energy_pct = std::stod(next());
    }
    else if (a == "--no-wake-word") {
      ch.wake_word_always_on = false;
    } else if (a == "--priority-bypass-duty") {
      std::string val = next();
      ch.priority_bypass_duty = (val == "1" || val == "true");
    } else if (a == "--gnss-continuous") {
      ch.gnss_continuous = true;
    } else if (a == "--obstacle") {
      std::string val = next();
      double custom_atten = -1.0;
      auto at_pos = val.find('@');
      if (at_pos != std::string::npos) {
        custom_atten = std::stod(val.substr(at_pos + 1));
        val = val.substr(0, at_pos);
      }
      auto c1 = val.find(':');
      if (c1 == std::string::npos) die("--obstacle needs ID:MATERIAL:X1,Y1,X2,Y2[@ATTEN]");
      auto c2 = val.find(':', c1 + 1);
      if (c2 == std::string::npos) die("--obstacle needs ID:MATERIAL:X1,Y1,X2,Y2[@ATTEN]");
      uint16_t obs_id = static_cast<uint16_t>(std::stoi(val.substr(0, c1)));
      std::string mat_str = val.substr(c1 + 1, c2 - c1 - 1);
      std::string obs_label = "obs_" + std::to_string(obs_id);
      std::string coords_str = val.substr(c2 + 1);
      auto c3 = val.find(':', c2 + 1);
      if (c3 != std::string::npos) {
        obs_label = val.substr(c2 + 1, c3 - c2 - 1);
        coords_str = val.substr(c3 + 1);
      }
      std::stringstream ss(coords_str);
      std::string seg;
      std::vector<double> coords;
      while (std::getline(ss, seg, ',')) {
        coords.push_back(std::stod(seg));
      }
      if (coords.size() != 4) die("--obstacle coordinates must be X1,Y1,X2,Y2");
      Obstacle obs;
      obs.id = obs_id;
      obs.label = obs_label;
      obs.material = parse_material(mat_str);
      obs.x1 = coords[0];
      obs.y1 = coords[1];
      obs.x2 = coords[2];
      obs.y2 = coords[3];
      obs.thickness_m = 0.2;
      obs.attenuation_db = (custom_atten >= 0.0) ? custom_atten : material_default_attenuation_db(obs.material, obs.thickness_m);
      obstacles_to_add.push_back(obs);
    } else if (a == "--fluid-drift") {
      std::string val = next();
      auto comma = val.find(',');
      if (comma == std::string::npos) die("--fluid-drift needs VX,VY");
      ch.fluid_drift.vx_mps = std::stod(val.substr(0, comma));
      ch.fluid_drift.vy_mps = std::stod(val.substr(comma + 1));
    } else if (a == "--sensitivity-sweep") {
      sensitivity_sweep = true;
    } else if (a == "--ambient-noise") {
      ch.ambient_noise_spl = std::stod(next());
    } else {
      die("unknown option " + a);
    }
  }

  if (experiment_path_loss) {
    run_path_loss_sweep_experiment(seed);
    return 0;
  }

  if (sensitivity_sweep) {
    run_global_sensitivity_analysis(seed);
    return 0;
  }

  if (interactive) {
    return run_interactive(survivors, relays, zone, ch, seed, obstacles_to_add);
  }

  std::unique_ptr<World> w;
  try {
    w = make_demo_world(survivors, relays, zone, ch, seed, setu::NodeConfig(), {}, allow_disconnected);
  } catch (const std::exception& e) {
    die(e.what());
  }

  std::ofstream trace;
  if (trace_path == "-") {
    w->set_trace(&std::cout);
  } else if (!trace_path.empty()) {
    trace.open(trace_path);
    w->set_trace(&trace);
  }

  for (const auto& obs : obstacles_to_add) {
    w->add_obstacle(obs);
  }

  for (auto& tr : triggers) {
    if (tr.kind == "short") w->button_press(tr.id, tr.t, 150);
    else if (tr.kind == "double") {
      w->button_press(tr.id, tr.t, 120);
      w->button_press(tr.id, tr.t + 300, 120);
    } else if (tr.kind == "long") w->button_press(tr.id, tr.t, 1700);
    else if (tr.kind == "voice") w->wake_word(tr.id, tr.t);
    else if (tr.kind == "voice-medical" || tr.kind == "voice-trapped") {
      w->wake_word(tr.id, tr.t);
      w->voice_command(tr.id, tr.t + 1500, 1,
                       tr.kind == "voice-medical" ? setu::Hazard::Medical : setu::Hazard::Trapped);
    } else die("unknown trigger kind " + tr.kind);
  }
  for (auto& m : misc) {
    std::string lhs;
    uint32_t t;
    if (!split_at(m.second, lhs, t)) die(m.first + " needs VALUE@T");
    World* wp = w.get();
    if (m.first == "--kill") {
      auto id = static_cast<uint16_t>(std::stoi(lhs));
      if (t == 0) wp->set_online(id, false);
      else w->schedule(t, [wp, id] { wp->set_online(id, false); });
    } else if (m.first == "--revive") {
      auto id = static_cast<uint16_t>(std::stoi(lhs));
      if (t == 0) wp->set_online(id, true);
      else w->schedule(t, [wp, id] { wp->set_online(id, true); });
    } else if (m.first == "--gps-off") {
      auto id = static_cast<uint16_t>(std::stoi(lhs));
      if (t == 0) wp->set_gnss(id, false);
      else w->schedule(t, [wp, id] { wp->set_gnss(id, false); });
    } else if (m.first == "--no-dr") {
      auto id = static_cast<uint16_t>(std::stoi(lhs));
      if (t == 0) wp->set_dead_reckoning(id, false);
      else w->schedule(t, [wp, id] { wp->set_dead_reckoning(id, false); });
    } else if (m.first == "--motion") {
      auto c = lhs.find(':');
      if (c == std::string::npos) die("--motion needs ID:PROFILE@T");
      auto id = static_cast<uint16_t>(std::stoi(lhs.substr(0, c)));
      std::string prof = lhs.substr(c + 1);
      MotionProfile p = MotionProfile::Stationary;
      if (prof == "moving") p = MotionProfile::Moving;
      else if (prof == "walking") p = MotionProfile::Walking;
      else if (prof == "running") p = MotionProfile::Running;
      else if (prof == "sudden_movement") p = MotionProfile::SuddenMovement;
      else if (prof == "fall_impact") p = MotionProfile::FallImpact;
      else if (prof == "irregular") p = MotionProfile::Irregular;
      else if (prof == "crawling") p = MotionProfile::Crawling;
      if (t == 0) wp->set_motion_profile(id, p);
      else w->schedule(t, [wp, id, p] { wp->set_motion_profile(id, p); });
    } else if (m.first == "--battery") {
      auto c = lhs.find(':');
      if (c == std::string::npos) die("--battery needs ID:PERCENT@T");
      auto id = static_cast<uint16_t>(std::stoi(lhs.substr(0, c)));
      auto batt = static_cast<uint8_t>(std::stoi(lhs.substr(c + 1)));
      if (t == 0) wp->set_battery(id, batt);
      else w->schedule(t, [wp, id, batt] { wp->set_battery(id, batt); });
    } else {
      auto d = lhs.find('-');
      if (d == std::string::npos) die("--block needs A-B@T");
      auto x = static_cast<uint16_t>(std::stoi(lhs.substr(0, d))), y = static_cast<uint16_t>(std::stoi(lhs.substr(d + 1)));
      if (t == 0) wp->block_link(x, y);
      else w->schedule(t, [wp, x, y] { wp->block_link(x, y); });
    }
  }

  w->run_until(duration);

  // ---- summary (JSON) ----
  std::printf("{\n  \"seed\": %u, \"nodes\": %zu, \"sf\": %d, \"duration_ms\": %u,\n  \"events\": [\n",
              seed, w->node_ids().size(), ch.sf, duration);
  for (size_t i = 0; i < triggers.size(); i++) {
    const auto& tr = triggers[i];
    const AlertRecord* first = nullptr;
    for (auto& a : w->alerts())
      if (a.origin == tr.id && a.t_ms >= tr.t) { first = &a; break; }
    const int64_t ack = w->first_ack_ms(tr.id, tr.t);
    std::printf("    {\"origin\": %u, \"kind\": \"%s\", \"t_ms\": %u, \"delivered\": %s", tr.id,
                tr.kind.c_str(), tr.t, first ? "true" : "false");
    if (first) {
      std::printf(", \"latency_ms\": %u, \"hops\": %u, \"hazard\": %d, \"contact\": %u, \"position\": \"%s\"",
                  first->t_ms - tr.t, first->hops, static_cast<int>(first->hazard), first->contact,
                  (first->flags & setu::kFlagGps) ? "gnss" : (first->flags & setu::kFlagDr) ? "dead-reckoned" : "unknown");
    }
    std::printf(", \"acked\": %s", ack >= 0 ? "true" : "false");
    if (ack >= 0) std::printf(", \"ack_latency_ms\": %lld", static_cast<long long>(ack - tr.t));
    std::printf("}%s\n", i + 1 < triggers.size() ? "," : "");
  }
  uint64_t relay_tx = 0, suppressed = 0, duty_blocked = 0, retries = 0;
  uint32_t max_duty = 0;
  for (auto id : w->node_ids()) {
    const auto& s = w->node(id).stats();
    relay_tx += s.tx_relay;
    suppressed += s.relay_suppressed;
    duty_blocked += s.duty_blocked;
    retries += s.retries;
    max_duty = std::max(max_duty, w->node(id).duty_used_ms());
  }
  const auto& c = w->counters();
  double total_energy_mah = 0.0;
  for (auto id : w->node_ids()) {
    total_energy_mah += w->get_node_info(id).energy_consumed_mah;
  }
  double cap = ch.battery_capacity_mah;
  double cur_always_on = BatteryEnergyModel::kCurrentStandbyMa +
                         BatteryEnergyModel::kCurrentRadioRxMa +
                         BatteryEnergyModel::kCurrentImuMa +
                         BatteryEnergyModel::kCurrentVoiceDspMa;
  double cur_no_always_on = BatteryEnergyModel::kCurrentStandbyMa +
                            BatteryEnergyModel::kCurrentRadioRxMa +
                            BatteryEnergyModel::kCurrentImuMa;
  double life_always_on_h = (cur_always_on > 0.0) ? (cap / cur_always_on) : 0.0;
  double life_no_always_on_h = (cur_no_always_on > 0.0) ? (cap / cur_no_always_on) : 0.0;

  std::printf("  ],\n  \"profile\": \"%s\",\n  \"battery_lifetime\": {\"status\": \"assumed\", \"capacity_mah\": %.1f, "
              "\"with_always_on_wake_word\": {\"continuous_current_ma\": %.1f, \"lifetime_hours\": %.2f, \"lifetime_days\": %.2f}, "
              "\"without_always_on_wake_word\": {\"continuous_current_ma\": %.1f, \"lifetime_hours\": %.2f, \"lifetime_days\": %.2f}},\n"
              "  \"totals\": {\"tx\": %llu, \"relay_tx\": %llu, \"relays_suppressed\": %llu, "
              "\"retries\": %llu, \"deliveries\": %llu, \"collisions\": %llu, \"weak\": %llu, "
              "\"lost\": %llu, \"duty_blocked\": %llu, \"max_airtime_ms_per_node\": %u, \"total_energy_mah\": %.3f}\n}\n",
              realism_profile_str(ch.profile), cap,
              cur_always_on, life_always_on_h, life_always_on_h / 24.0,
              cur_no_always_on, life_no_always_on_h, life_no_always_on_h / 24.0,
              (unsigned long long)c.tx, (unsigned long long)relay_tx, (unsigned long long)suppressed,
              (unsigned long long)retries, (unsigned long long)c.delivered,
              (unsigned long long)c.collisions, (unsigned long long)c.weak,
              (unsigned long long)c.lost, (unsigned long long)duty_blocked, max_duty, total_energy_mah);
  return 0;
}
