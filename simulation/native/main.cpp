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
              << "}" << (i + 1 < infos.size() ? "," : "");
  }
  std::cout << "]}\n" << std::flush;
}

void print_summary(const World& w, uint32_t seed, uint8_t sf, uint32_t duration) {
  (void)duration;
  const auto& c = w.counters();
  uint64_t relay_tx = 0, suppressed = 0, duty_blocked = 0, retries = 0;
  uint32_t max_duty = 0;
  auto infos = w.get_all_nodes_info();
  for (const auto& inf : infos) {
    relay_tx += inf.stats.tx_relay;
    suppressed += inf.stats.relay_suppressed;
    duty_blocked += inf.stats.duty_blocked;
    retries += inf.stats.retries;
    max_duty = std::max(max_duty, inf.duty_used_ms);
  }
  std::cout << "{\"ok\":true,\"cmd\":\"summary\",\"summary\":{\"seed\":" << seed
            << ",\"nodes\":" << w.node_ids().size() << ",\"sf\":" << static_cast<int>(sf)
            << ",\"duration_ms\":" << w.now()
            << ",\"totals\":{\"tx\":" << c.tx << ",\"relay_tx\":" << relay_tx
            << ",\"relays_suppressed\":" << suppressed << ",\"retries\":" << retries
            << ",\"deliveries\":" << c.delivered << ",\"collisions\":" << c.collisions
            << ",\"weak\":" << c.weak << ",\"lost\":" << c.lost
            << ",\"duty_blocked\":" << duty_blocked << ",\"max_airtime_ms_per_node\":" << max_duty
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

int run_interactive(int survivors, int relays, double zone, ChannelParams ch, uint32_t seed) {
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
      w->set_motion_profile(id, p);
      initial_motion_profiles[id] = p;
      std::cout << "{\"ok\":true,\"cmd\":\"set_motion\",\"node\":" << id << ",\"profile\":\"" << motion_profile_str(p) << "\"}\n" << std::flush;
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
  bool allow_disconnected = false;
  std::vector<Trigger> triggers;
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
    } else {
      die("unknown option " + a);
    }
  }

  if (experiment_path_loss) {
    run_path_loss_sweep_experiment(seed);
    return 0;
  }

  if (interactive) {
    return run_interactive(survivors, relays, zone, ch, seed);
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
  std::printf("  ],\n  \"totals\": {\"tx\": %llu, \"relay_tx\": %llu, \"relays_suppressed\": %llu, "
              "\"retries\": %llu, \"deliveries\": %llu, \"collisions\": %llu, \"weak\": %llu, "
              "\"lost\": %llu, \"duty_blocked\": %llu, \"max_airtime_ms_per_node\": %u}\n}\n",
              (unsigned long long)c.tx, (unsigned long long)relay_tx, (unsigned long long)suppressed,
              (unsigned long long)retries, (unsigned long long)c.delivered,
              (unsigned long long)c.collisions, (unsigned long long)c.weak,
              (unsigned long long)c.lost, (unsigned long long)duty_blocked, max_duty);
  return 0;
}
