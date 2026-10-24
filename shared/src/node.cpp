#include "setu/node.hpp"

#include <cstdio>

namespace setu {
namespace {
// Wrap-safe "now has reached t".
inline bool reached(uint32_t now, uint32_t t) { return static_cast<int32_t>(now - t) >= 0; }
inline int16_t seq_diff(uint16_t a, uint16_t b) { return static_cast<int16_t>(a - b); }
}  // namespace

Node::Node(const NodeConfig& cfg, const Hal& hal)
    : cfg_(cfg), hal_(hal), button_(cfg.button), duty_(cfg.duty_window_ms, cfg.duty_limit_permille), seq_(cfg.initial_seq) {}

uint32_t Node::duty_used_ms() const { return duty_.used_ms(hal_.clock->now_ms()); }

void Node::play(HapticPattern h) {
  if (hal_.haptic) hal_.haptic->play(h);
}

void Node::trace_ev(const char* ev, const char* extra) {
  if (hal_.trace) hal_.trace->on_node_event(cfg_.node_id, ev, extra);
}

// ---------------------------------------------------------------- inputs

void Node::on_button_edge(bool pressed) {
  if (cfg_.role == Role::Hub) return;
  if (button_.on_edge(pressed, hal_.clock->now_ms()) && pressed) play(HapticPattern::PressRegistered);
}

void Node::on_wake_word() {
  if (cfg_.role == Role::Hub || voice_active_) return;
  voice_active_ = true;
  voice_deadline_ = hal_.clock->now_ms() + cfg_.voice_window_ms;
  play(HapticPattern::WakeDetected);
}

void Node::on_voice_command(uint8_t contact, Hazard hz) {
  if (!voice_active_) return;  // a command is only valid inside the wake-word window
  voice_active_ = false;
  start_sos(hz, contact);
}

void Node::handle_button(ButtonEvent e) {
  switch (e) {
    case ButtonEvent::Short:
      play(HapticPattern::TierShort);
      start_sos(Hazard::General, 0);
      break;
    case ButtonEvent::Double:
      play(HapticPattern::TierDouble);
      start_sos(Hazard::Medical, 0);
      break;
    case ButtonEvent::Long:
      play(HapticPattern::TierLong);
      start_sos(Hazard::Trapped, 0);
      break;
    case ButtonEvent::Invalid:
      play(HapticPattern::Reject);
      break;
    case ButtonEvent::None:
      break;
  }
}

// ---------------------------------------------------------------- SOS origination

Packet Node::base_packet(uint16_t seq) const {
  Packet p;
  p.node_id = cfg_.node_id;
  p.seq = seq;
  p.ts = hal_.clock->unix_s();
  p.battery = hal_.battery ? hal_.battery->percent() : 100;
  return p;
}

void Node::start_sos(Hazard hz, uint8_t contact) {
  const uint32_t now = hal_.clock->now_ms();
  // Ignore an identical trigger repeated inside the resend guard.
  if (active_ && hz == cur_hazard_ && contact == cur_contact_ &&
      !reached(now, last_origin_ms_ + cfg_.min_resend_ms))
    return;

  const bool escalation = active_;  // still waiting for an ACK: same episode, new content
  if (!escalation) {
    episode_first_seq_ = static_cast<uint16_t>(seq_ + 1);
    acked_ = false;
    gave_up_ = false;
  }
  active_ = true;
  cur_hazard_ = hz;
  cur_contact_ = contact;
  retries_left_ = cfg_.max_retries;
  attempt_ = 0;
  originate();
}

void Node::originate() {
  const uint32_t now = hal_.clock->now_ms();
  Packet p = base_packet(++seq_);
  p.hazard = cur_hazard_;
  p.contact = cur_contact_;
  // Position: GNSS fix, else dead-reckoned estimate, else unknown (no flag set).
  if (hal_.gnss && hal_.gnss->get_fix(p.lat_e6, p.lon_e6)) {
    p.flags |= kFlagGps;
  } else if (hal_.dr && hal_.dr->estimate(p.lat_e6, p.lon_e6)) {
    p.flags |= kFlagDr;
  }
  dedup_.observe(key_of(p));  // so our own packet echoing back is ignored
  if (!enqueue(Kind::Origin, p, 0)) {
    // Priority 5 Fix: Queue full - do not drop originating SOS or wait full retry timeout.
    // Schedule immediate fast re-attempt so the emergency SOS is not lost.
    retry_at_ = now + 50;
    return;
  }
  last_origin_ms_ = now;
  ever_sent_ = true;
  retry_at_ = now + cfg_.retry_timeout_ms * (attempt_ + 1u);
  char b[96];
  std::snprintf(b, sizeof b, ",\"seq\":%u,\"hazard\":%d,\"contact\":%u,\"flags\":%u", p.seq,
                static_cast<int>(p.hazard), p.contact, p.flags);
  trace_ev("originate", b);
}

void Node::handle_ack(const Packet& p) {
  if (p.target != cfg_.node_id) return;
  // Accept an ACK for any SOS sent during the current episode.
  // If gave_up_, accept only within a bounded rescue window.
  const uint32_t now = hal_.clock->now_ms();
  if (!active_) {
    if (!gave_up_) return;
    const uint32_t late_window_ms = cfg_.retry_timeout_ms * (cfg_.max_retries + 2u);
    if (!reached(last_origin_ms_ + late_window_ms, now)) return;
  }
  if (seq_diff(p.ref_seq, episode_first_seq_) < 0 || seq_diff(seq_, p.ref_seq) < 0) return;
  stats_.acks_rx++;
  active_ = false;
  gave_up_ = false;
  acked_ = true;
  char b[64];
  std::snprintf(b, sizeof b, ",\"ref_seq\":%u", p.ref_seq);
  trace_ev("ack_rx", b);
  play(HapticPattern::AckReceived);
}

// ---------------------------------------------------------------- hub + relay

void Node::send_ack(const Packet& sos) {
  Packet a = base_packet(++seq_);
  a.flags = kFlagAck;
  a.target = sos.node_id;
  a.ref_seq = sos.seq;
  a.hazard = sos.hazard;
  dedup_.observe(key_of(a));
  enqueue(Kind::Ack, a, hal_.rng->uniform(30));
}

void Node::relay(const Packet& p) {
  if (p.hop >= cfg_.max_hops) {
    stats_.ttl_drops++;
    char b[64];
    std::snprintf(b, sizeof b, ",\"origin\":%u,\"seq\":%u,\"hop\":%u", p.node_id, p.seq, p.hop);
    trace_ev("ttl_drop", b);
    return;
  }
  // Spread rebroadcasts over several packet airtimes, otherwise slow spreading factors
  // (long packets) make neighbouring relays collide on every hop.
  const uint32_t air = lora_airtime_ms(kPacketSize, cfg_.sf, cfg_.bw_hz);
  const uint32_t window = cfg_.rebroadcast_backoff_max_ms > 6 * air ? cfg_.rebroadcast_backoff_max_ms : 6 * air;
  enqueue(Kind::Relay, p.hopped(), hal_.rng->uniform(window + 1));
}

void Node::on_radio_rx(const uint8_t* data, size_t len) {
  stats_.rx_total++;
  Packet p;
  if (parse(data, len, p) != ParseResult::Ok) {
    stats_.rx_invalid++;
    return;
  }
  if (p.node_id == cfg_.node_id) return;  // own packet echoed back

  // Packet expiry check
  // Discard packet only if both packet timestamp and local clock are non-zero,
  // local clock is ahead of packet timestamp, and age exceeds max_packet_age_s.
  // Packets with ts == 0 or where local clock is 0/behind are preserved (preventing false drops on unsynchronized clocks).
  if (cfg_.max_packet_age_s > 0 && p.ts > 0 && hal_.clock) {
    const uint32_t now_unix = hal_.clock->unix_s();
    if (now_unix > 0 && now_unix > p.ts && (now_unix - p.ts) > cfg_.max_packet_age_s) {
      stats_.rx_expired++;
      char b[64];
      std::snprintf(b, sizeof b, ",\"origin\":%u,\"seq\":%u,\"age_s\":%u", p.node_id, p.seq, now_unix - p.ts);
      trace_ev("expired_drop", b);
      return;
    }
  }

  if (dedup_.observe(key_of(p)) > 1) {
    stats_.rx_dup++;
    char b[64];
    std::snprintf(b, sizeof b, ",\"origin\":%u,\"seq\":%u", p.node_id, p.seq);
    trace_ev("dedup_drop", b);
    return;
  }
  if (p.is_ack()) {
    if (p.target == cfg_.node_id) {
      handle_ack(p);
    } else if (cfg_.role != Role::Hub) {
      relay(p);
    }
    return;
  }
  // SOS
  if (cfg_.role == Role::Hub) {
    if (hal_.alerts) hal_.alerts->on_alert(p, hal_.clock->now_ms());
    send_ack(p);
  } else {
    relay(p);
  }
}

// ---------------------------------------------------------------- transmit queue

bool Node::enqueue(Kind k, const Packet& p, uint32_t delay_ms) {
  const uint32_t now = hal_.clock->now_ms();
  Pending* slot = nullptr;
  for (auto& q : q_)
    if (!q.used) {
      slot = &q;
      break;
    }
  if (!slot && k != Kind::Relay) {  // own traffic evicts a queued relay
    for (auto& q : q_)
      if (q.kind == Kind::Relay) {
        slot = &q;
        stats_.queue_drops++;
        break;
      }
  }
  if (!slot) {
    stats_.queue_drops++;
    return false;
  }
  slot->used = true;
  slot->kind = k;
  slot->pkt = p;
  slot->due_ms = now + delay_ms;
  slot->attempts = 0;
  return true;
}

void Node::service(Pending& q) {
  const uint32_t now = hal_.clock->now_ms();
  if (q.kind == Kind::Relay && dedup_.count(key_of(q.pkt)) >= cfg_.suppress_after) {
    stats_.relay_suppressed++;  // neighbours already covered this one
    char b[64];
    std::snprintf(b, sizeof b, ",\"origin\":%u,\"seq\":%u", q.pkt.node_id, q.pkt.seq);
    trace_ev("relay_suppressed", b);
    q.used = false;
    return;
  }
  const uint32_t air = lora_airtime_ms(kPacketSize, cfg_.sf, cfg_.bw_hz);
  const bool priority = q.kind != Kind::Relay && cfg_.priority_ignores_duty;
  if (!priority && !duty_.can_send(now, air)) {
    stats_.duty_blocked++;
    char b[64];
    std::snprintf(b, sizeof b, ",\"origin\":%u,\"seq\":%u", q.pkt.node_id, q.pkt.seq);
    trace_ev("duty_blocked", b);
    q.used = false;
    return;
  }
  // Listen before talk: defer a few times, then transmit anyway.
  if (hal_.radio->channel_busy() && q.attempts < 6) {
    q.attempts++;
    q.due_ms = now + 20 + hal_.rng->uniform(150);
    return;
  }
  uint8_t buf[kPacketSize];
  const size_t n = serialize(q.pkt, buf, sizeof buf);
  if (!hal_.radio->send(buf, n)) {  // radio busy: try again shortly
    if (++q.attempts >= 10) {
      q.used = false;
      stats_.queue_drops++;
      // Priority 5 Fix: If originating SOS transmission dropped due to radio fault,
      // reschedule protocol retry promptly instead of stalling.
      if (q.kind == Kind::Origin && active_) {
        retry_at_ = now + 50;
      }
    } else {
      q.due_ms = now + 10 + hal_.rng->uniform(50);
    }
    return;
  }
  duty_.record(now, air);
  if (q.kind == Kind::Origin) stats_.tx_sos++;
  else if (q.kind == Kind::Ack) stats_.tx_ack++;
  else stats_.tx_relay++;
  q.used = false;
}

// ---------------------------------------------------------------- periodic work

void Node::tick() {
  const uint32_t now = hal_.clock->now_ms();

  if (cfg_.role != Role::Hub) {
    handle_button(button_.tick(now));

    if (voice_active_ && reached(now, voice_deadline_)) {
      voice_active_ = false;
      start_sos(Hazard::General, 0);  // wake word alone == short press
    }

    if (active_ && reached(now, retry_at_)) {
      if (retries_left_ > 0) {
        retries_left_--;
        attempt_++;
        stats_.retries++;
        char b[48];
        std::snprintf(b, sizeof b, ",\"attempt\":%u", attempt_);
        trace_ev("retry", b);
        originate();  // new seq so neighbours do not drop it as a duplicate
      } else {
        active_ = false;
        gave_up_ = true;
        trace_ev("gave_up");
        play(HapticPattern::SendFailed);
      }
    }
  }

  for (auto& q : q_)
    if (q.used && reached(now, q.due_ms)) service(q);
}

}  // namespace setu
