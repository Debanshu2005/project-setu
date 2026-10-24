// One Setu device: wristband, relay or rescue hub. All behaviour from the report lives here:
// button/voice triggers -> SOS packet -> flood relay -> hub ACK -> retry/escalation.
#pragma once
#include <cstdint>

#include "setu/button.hpp"
#include "setu/dedup.hpp"
#include "setu/duty_cycle.hpp"
#include "setu/hal.hpp"
#include "setu/packet.hpp"

namespace setu {

enum class Role : uint8_t { Survivor, Relay, Hub };

struct NodeConfig {
  uint16_t node_id = 1;
  Role role = Role::Survivor;

  // Flooding
  uint8_t max_hops = 8;
  uint32_t rebroadcast_backoff_max_ms = 250;  // random delay before relaying
  uint8_t suppress_after = 3;                 // skip a pending relay if heard this many times

  // Reliability
  uint32_t retry_timeout_ms = 4000;           // first retry; grows linearly per attempt
  uint8_t max_retries = 3;
  uint32_t min_resend_ms = 1000;              // ignore identical trigger repeats inside this
  uint32_t max_packet_age_s = 7200;           // discard packets older than 2 hours if unix_s set

  // Voice
  uint32_t voice_window_ms = 3500;            // wake word -> command window

  // Radio
  uint8_t sf = 7;
  uint32_t bw_hz = 125000;
  uint32_t duty_window_ms = 3600000UL;
  uint32_t duty_limit_permille = 10;
  // Own SOS and ACKs may exceed the duty-cycle budget; relayed traffic may not.
  // Design decision: check against the regulations of the deployment region.
  bool priority_ignores_duty = true;

  ButtonConfig button;
};

struct NodeStats {
  uint32_t tx_sos = 0;       // originated SOS transmissions (incl. retries)
  uint32_t tx_ack = 0;       // ACKs originated (hub)
  uint32_t tx_relay = 0;     // packets relayed for others
  uint32_t rx_total = 0;
  uint32_t rx_dup = 0;
  uint32_t rx_invalid = 0;
  uint32_t rx_expired = 0;
  uint32_t relay_suppressed = 0;
  uint32_t ttl_drops = 0;
  uint32_t duty_blocked = 0;
  uint32_t queue_drops = 0;
  uint32_t retries = 0;
  uint32_t acks_rx = 0;
};

class Node {
 public:
  Node(const NodeConfig& cfg, const Hal& hal);

  // --- Inputs (called by firmware tasks or the simulator) ---
  void on_button_edge(bool pressed);
  void on_wake_word();                                 // "Setu" detected
  void on_voice_command(uint8_t contact, Hazard hz);   // MultiNet slot-fill result
  void on_radio_rx(const uint8_t* data, size_t len);
  void tick();                                         // call at >= 100 Hz

  // --- Introspection ---
  const NodeConfig& config() const { return cfg_; }
  const NodeStats& stats() const { return stats_; }
  bool sos_active() const { return active_; }   // sent, awaiting ACK
  bool sos_acked() const { return acked_; }
  bool sos_gave_up() const { return gave_up_; }
  uint16_t seq() const { return seq_; }
  uint32_t duty_used_ms() const;

 private:
  enum class Kind : uint8_t { Origin, Ack, Relay };
  struct Pending {
    bool used = false;
    Kind kind = Kind::Relay;
    Packet pkt;
    uint32_t due_ms = 0;
    uint8_t attempts = 0;
  };
  static constexpr int kQueue = 8;

  void handle_button(ButtonEvent e);
  void start_sos(Hazard hz, uint8_t contact);
  void originate();
  void handle_ack(const Packet& p);
  void send_ack(const Packet& sos);
  void relay(const Packet& p);
  bool enqueue(Kind k, const Packet& p, uint32_t delay_ms);
  void service(Pending& p);
  void play(HapticPattern h);
  void trace_ev(const char* ev, const char* extra = "");
  Packet base_packet(uint16_t seq) const;

  NodeConfig cfg_;
  Hal hal_;
  ButtonClassifier button_;
  DedupCache dedup_;
  DutyCycle duty_;
  NodeStats stats_;
  Pending q_[kQueue];

  uint16_t seq_ = 0;

  // SOS episode state
  bool active_ = false, acked_ = false, gave_up_ = false;
  Hazard cur_hazard_ = Hazard::General;
  uint8_t cur_contact_ = 0;
  uint16_t episode_first_seq_ = 0;
  uint8_t retries_left_ = 0, attempt_ = 0;
  uint32_t retry_at_ = 0, last_origin_ms_ = 0;
  bool ever_sent_ = false;

  // Voice window
  bool voice_active_ = false;
  uint32_t voice_deadline_ = 0;
};

}  // namespace setu
