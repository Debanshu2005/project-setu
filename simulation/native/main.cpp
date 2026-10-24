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
              << ",\"battery\":" << static_cast<int>(inf.battery)
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

int run_interactive(int survivors, int relays, double zone, ChannelParams ch, uint32_t seed) {
  std::unique_ptr<World> w;
  auto init_world = [&](int s_count, int r_count, double z, ChannelParams c, uint32_t sd) {
    w = make_demo_world(s_count, r_count, z, c, sd);
    w->set_trace(&std::cout);
  };

  try {
    init_world(survivors, relays, zone, ch, seed);
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
        w->voice_command(id, t + 1500, 1, setu::Hazard::Medical);
      } else if (kind == "voice-trapped") {
        w->wake_word(id, t);
        w->voice_command(id, t + 1500, 1, setu::Hazard::Trapped);
      } else {
        std::cout << "{\"ok\":false,\"cmd\":\"trigger\",\"error\":\"unknown trigger kind\"}\n" << std::flush;
        continue;
      }
      std::cout << "{\"ok\":true,\"cmd\":\"trigger\",\"node\":" << id << ",\"kind\":\"" << kind << "\"}\n" << std::flush;
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
      if (line.find("\"online\":") != std::string::npos) w->set_online(id, json_get_bool(line, "online", true));
      if (line.find("\"gnss\":") != std::string::npos) w->set_gnss(id, json_get_bool(line, "gnss", true));
      if (line.find("\"dr\":") != std::string::npos) w->set_dead_reckoning(id, json_get_bool(line, "dr", true));
      if (line.find("\"battery\":") != std::string::npos) w->set_battery(id, static_cast<uint8_t>(json_get_int(line, "battery", 100)));
      std::cout << "{\"ok\":true,\"cmd\":\"set_node\",\"node\":" << id << "}\n" << std::flush;
    } else if (cmd == "reposition") {
      uint16_t id = static_cast<uint16_t>(json_get_int(line, "node", 0));
      double px = json_get_double(line, "x", 0.0);
      double py = json_get_double(line, "y", 0.0);
      w->reposition_node(id, px, py);
      std::cout << "{\"ok\":true,\"cmd\":\"reposition\",\"node\":" << id << ",\"x\":" << px << ",\"y\":" << py << "}\n" << std::flush;
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
      try {
        init_world(survivors, relays, zone, ch, seed);
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
      try {
        init_world(survivors, relays, zone, ch, seed);
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
  std::vector<Trigger> triggers;
  std::vector<std::pair<std::string, std::string>> misc;  // (kind, arg)

  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= argc) die("missing value for " + a);
      return argv[++i];
    };
    if (a == "--interactive" || a == "-i") interactive = true;
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
               a == "--block") {
      misc.push_back({a, next()});
    } else {
      die("unknown option " + a);
    }
  }

  if (interactive) {
    return run_interactive(survivors, relays, zone, ch, seed);
  }

  std::unique_ptr<World> w;
  try {
    w = make_demo_world(survivors, relays, zone, ch, seed);
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
    if (m.first == "--kill") { auto id = static_cast<uint16_t>(std::stoi(lhs)); w->schedule(t, [wp, id] { wp->set_online(id, false); }); }
    else if (m.first == "--revive") { auto id = static_cast<uint16_t>(std::stoi(lhs)); w->schedule(t, [wp, id] { wp->set_online(id, true); }); }
    else if (m.first == "--gps-off") { auto id = static_cast<uint16_t>(std::stoi(lhs)); w->schedule(t, [wp, id] { wp->set_gnss(id, false); }); }
    else if (m.first == "--no-dr") { auto id = static_cast<uint16_t>(std::stoi(lhs)); w->schedule(t, [wp, id] { wp->set_dead_reckoning(id, false); }); }
    else {
      auto d = lhs.find('-');
      if (d == std::string::npos) die("--block needs A-B@T");
      auto x = static_cast<uint16_t>(std::stoi(lhs.substr(0, d))), y = static_cast<uint16_t>(std::stoi(lhs.substr(d + 1)));
      w->schedule(t, [wp, x, y] { wp->block_link(x, y); });
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
