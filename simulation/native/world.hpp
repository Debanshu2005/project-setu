// In-process RF world: runs the REAL setu::Node on many virtual devices.
// Channel model: log-distance path loss + per-link shadowing + fast fading,
// LoRa time-on-air, half-duplex radios, listen-before-talk, collisions with capture effect.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <ostream>
#include <random>
#include <set>
#include <vector>

#include "setu/node.hpp"
#include "sensor_models.hpp"

namespace sim {

struct ChannelParams {
  uint8_t sf = 7;
  uint32_t bw_hz = 125000;
  double tx_dbm = 14.0;
  double ref_loss_db = 31.2;     // free-space loss at 1 m, 868 MHz
  double path_exp = 3.5;         // rubble / urban
  double extra_loss_db = 15.0;   // body shadowing + small wrist antenna
  double shadow_sigma_db = 4.0;  // fixed per link
  double fading_sigma_db = 1.5;  // per packet
  double capture_db = 6.0;       // stronger signal survives a collision if this much louder
  double random_loss = 0.0;      // extra independent packet loss probability
  double connect_margin_db = 3.0;  // margin used when judging planned connectivity
  // Configurable battery consumption simulation parameters
  double tx_energy_pct = 0.5;          // energy consumed per LoRa transmission (%)
  double rx_energy_pct = 0.1;          // energy consumed per packet reception (%)
  double idle_energy_pct_per_s = 0.01; // energy consumed per second idle standby (%)
  double battery_capacity_mah = 300.0; // nominal 1S LiPo capacity
};

struct AlertRecord {
  uint16_t origin;
  setu::Hazard hazard;
  uint8_t contact;
  uint8_t hops;
  uint8_t flags;
  uint8_t battery;
  uint32_t t_ms;
  uint32_t latency_ms = 0;
};

struct Counters {
  uint64_t tx = 0, delivered = 0, collisions = 0, weak = 0, lost = 0, halfduplex = 0;
};

struct SimNodeInfo {
  uint16_t id = 0;
  setu::Role role = setu::Role::Survivor;
  double x = 0, y = 0;
  int32_t lat_e6 = 0, lon_e6 = 0;
  double ground_truth_x = 0, ground_truth_y = 0;
  int32_t ground_truth_lat_e6 = 0, ground_truth_lon_e6 = 0;
  int32_t estimated_lat_e6 = 0, estimated_lon_e6 = 0;
  double pos_error_m = 0.0;
  double pos_mae_m = 0.0;
  double pos_rmse_m = 0.0;
  double pos_max_error_m = 0.0;
  std::string motion_profile = "stationary";
  std::string gnss_status = "valid_fix";
  uint8_t battery = 100;
  uint8_t initial_battery = 100;
  double energy_consumed_mah = 0.0;
  bool online = true;
  bool gnss_on = true;
  bool dr_on = true;
  bool active = false;
  bool acked = false;
  bool gave_up = false;
  uint16_t seq = 0;
  uint32_t duty_used_ms = 0;
  size_t button_queue_depth = 0;
  size_t radio_queue_depth = 0;
  uint32_t button_queue_overflows = 0;
  uint32_t radio_queue_overflows = 0;
  setu::NodeStats stats;
};

class World {
 public:
  World(const ChannelParams& ch, uint32_t seed);
  ~World();

  uint16_t add_node(const setu::NodeConfig& cfg, double x, double y, uint8_t initial_battery = 100);

  // --- environment / fault injection ---
  void set_online(uint16_t id, bool on);
  void set_gnss(uint16_t id, bool available);         // GNSS fix on/off
  void set_dead_reckoning(uint16_t id, bool available);
  void set_battery(uint16_t id, uint8_t pct);
  void block_link(uint16_t a, uint16_t b, bool blocked = true);
  void schedule(uint32_t at_ms, std::function<void()> fn);
  void reposition_node(uint16_t id, double x, double y);
  void set_motion_profile(uint16_t id, MotionProfile p);
  void schedule_gnss_outage(uint16_t id, uint32_t start_ms, uint32_t duration_ms);
  void set_node_heading(uint16_t id, double heading_rad);

  // --- virtual firmware hardware interrupt simulation (drives real FreeRTOS queues) ---
  void firmware_button_isr(uint16_t id, bool pressed);
  void firmware_radio_isr(uint16_t receiver_id, const uint8_t* data, size_t len, int16_t rssi, int8_t snr);

  // --- virtual user input (drives the real button classifier) ---
  void button_press(uint16_t id, uint32_t at_ms, uint32_t hold_ms);
  void wake_word(uint16_t id, uint32_t at_ms);
  void voice_command(uint16_t id, uint32_t at_ms, uint8_t contact, setu::Hazard hz);
  void trigger_all_survivors(setu::Hazard hz, uint32_t delay_spread_ms = 0, const std::string& kind = "short");

  void run_until(uint32_t t_ms);
  void step(uint32_t ms = 100);
  uint32_t now() const { return now_; }

  // --- results ---
  setu::Node& node(uint16_t id);
  SimNodeInfo get_node_info(uint16_t id) const;
  std::vector<SimNodeInfo> get_all_nodes_info() const;
  const PositionMetricsTracker* get_position_metrics(uint16_t id) const;
  const ChannelParams& channel_params() const { return ch_; }
  const std::vector<AlertRecord>& alerts() const { return alerts_; }
  // time the node first played AckReceived at/after t0 (or -1)
  int64_t first_ack_ms(uint16_t id, uint32_t t0 = 0) const;
  const Counters& counters() const { return counters_; }
  std::vector<uint16_t> node_ids() const;
  double mean_rssi(uint16_t a, uint16_t b) const;   // dBm, -inf if blocked
  double sensitivity() const { return sens_; }
  bool planned_connected() const;                   // every node can reach a hub at connect_margin
  double position_error_m(uint16_t id, int32_t lat_e6, int32_t lon_e6) const;
  void dump_topology_trace();
  void set_trace(std::ostream* os);

 private:
  struct SimNode;
  struct Tx {
    uint16_t from;
    uint32_t start, end;
    std::vector<uint8_t> data;
  };
  friend struct SimNode;

  bool start_tx(uint16_t from, const uint8_t* d, size_t n);
  bool channel_busy_for(uint16_t id) const;
  void finish_tx(const Tx& tx);
  void trace_event(const char* ev, uint16_t node, const char* extra = "");

  ChannelParams ch_;
  uint32_t seed_;
  double sens_;
  uint32_t now_ = 0;
  std::mt19937 rng_;
  std::map<uint16_t, std::unique_ptr<SimNode>> nodes_;
  std::set<std::pair<uint16_t, uint16_t>> blocked_;
  std::vector<Tx> txs_;
  std::multimap<uint32_t, std::function<void()>> actions_;
  std::vector<AlertRecord> alerts_;
  std::vector<std::pair<uint16_t, uint32_t>> acks_;
  std::map<std::pair<uint16_t, uint16_t>, uint32_t> orig_time_;
  Counters counters_;
  std::ostream* trace_ = nullptr;
};

// Hub in a corner, relays on a loose grid, survivors scattered. Retries seeds until the
// planned topology is connected. Hub id 0, relays 100.., survivors 1..N.
std::unique_ptr<World> make_demo_world(int survivors, int relays, double zone_m,
                                       const ChannelParams& ch, uint32_t seed,
                                       const setu::NodeConfig& base = setu::NodeConfig(),
                                       const std::map<uint16_t, uint8_t>& initial_batteries = {});

}  // namespace sim
