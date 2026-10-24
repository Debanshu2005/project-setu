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
}  // namespace

int main(int argc, char** argv) {
  int survivors = 20, relays = 5;
  double zone = 1200;
  uint32_t seed = 7, duration = 30000;
  ChannelParams ch;
  std::string trace_path;
  std::vector<Trigger> triggers;
  std::vector<std::pair<std::string, std::string>> misc;  // (kind, arg)

  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= argc) die("missing value for " + a);
      return argv[++i];
    };
    if (a == "--survivors") survivors = std::stoi(next());
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
