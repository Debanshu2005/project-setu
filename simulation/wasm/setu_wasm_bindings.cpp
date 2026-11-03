// Project Setu: WebAssembly Simulation Bindings
// Exposes authoritative C++ world and protocol simulation directly to browser and Node.js environments.

#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "world.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#endif

namespace setu_wasm {

class WasmSimSession {
 public:
  WasmSimSession() = default;

  bool init(int survivors, int relays, double zone, uint32_t seed, const std::string& profile_name) {
    sim::ChannelParams ch;
    ch.profile = sim::parse_realism_profile(profile_name);
    if (ch.profile != sim::RealismProfile::Baseline) {
      ch.battery_capacity_mah = 1000.0;
    }
    trace_stream_.str("");
    trace_stream_.clear();

    try {
      world_ = sim::make_demo_world(survivors, relays, zone, ch, seed, setu::NodeConfig(), {}, true);
      world_->set_trace(&trace_stream_);
      seed_ = seed;
      return true;
    } catch (...) {
      return false;
    }
  }

  void step(uint32_t ms) {
    if (world_) world_->step(ms);
  }

  void run_until(uint32_t t_ms) {
    if (world_ && t_ms > world_->now()) world_->run_until(t_ms);
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
    if (kind == "voice-medical") {
      world_->voice_command(id, t + 300, 1, setu::Hazard::Medical);
    } else if (kind == "voice-trapped") {
      world_->voice_command(id, t + 300, 1, setu::Hazard::Trapped);
    }
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

 private:
  std::unique_ptr<sim::World> world_;
  std::ostringstream trace_stream_;
  uint32_t seed_ = 0;
};

}  // namespace setu_wasm

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_BINDINGS(setu_wasm_module) {
  emscripten::class_<setu_wasm::WasmSimSession>("WasmSimSession")
      .constructor<>()
      .function("init", &setu_wasm::WasmSimSession::init)
      .function("step", &setu_wasm::WasmSimSession::step)
      .function("run_until", &setu_wasm::WasmSimSession::run_until)
      .function("now", &setu_wasm::WasmSimSession::now)
      .function("trigger_button", &setu_wasm::WasmSimSession::trigger_button)
      .function("trigger_voice", &setu_wasm::WasmSimSession::trigger_voice)
      .function("get_loss_budget_json", &setu_wasm::WasmSimSession::get_loss_budget_json)
      .function("get_trace_log", &setu_wasm::WasmSimSession::get_trace_log)
      .function("get_summary_json", &setu_wasm::WasmSimSession::get_summary_json);
}
#endif
