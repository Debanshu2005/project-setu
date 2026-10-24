// Setu SOS / ACK frame: fixed 25 bytes, little-endian, no padding.
//
//  off  size  field
//   0    2    node_id   originator (for ACK: the hub that sent it)
//   2    2    seq       originator's sequence number (new value for every transmission)
//   4    2    target    ACK only: node being acknowledged (0xFFFF for SOS)
//   6    2    ref_seq   ACK only: the SOS seq being acknowledged
//   8    1    hazard    0 general, 1 medical, 2 trapped
//   9    1    flags     bit0 GNSS fix, bit1 ACK, bit2 dead-reckoned position
//  10    4    lat_e6    degrees * 1e6, signed
//  14    4    lon_e6
//  18    4    ts        unix seconds
//  22    1    battery   percent
//  23    1    hop       incremented by every relay
//  24    1    contact   fixed-vocabulary contact id (0 = none)
#pragma once
#include <cstddef>
#include <cstdint>

namespace setu {

constexpr size_t kPacketSize = 25;
constexpr uint16_t kNoTarget = 0xFFFF;
constexpr uint8_t kMaxHopField = 32;

enum class Hazard : uint8_t { General = 0, Medical = 1, Trapped = 2 };

enum Flags : uint8_t { kFlagGps = 1, kFlagAck = 2, kFlagDr = 4 };

struct Packet {
  uint16_t node_id = 0;
  uint16_t seq = 0;
  uint16_t target = kNoTarget;
  uint16_t ref_seq = 0;
  Hazard hazard = Hazard::General;
  uint8_t flags = 0;
  int32_t lat_e6 = 0;
  int32_t lon_e6 = 0;
  uint32_t ts = 0;
  uint8_t battery = 100;
  uint8_t hop = 0;
  uint8_t contact = 0;

  bool is_ack() const { return (flags & kFlagAck) != 0; }
  Packet hopped() const {
    Packet p = *this;
    p.hop++;
    return p;
  }
};

// Identity used for duplicate suppression.
struct PacketKey {
  uint16_t node_id;
  uint16_t seq;
  bool ack;
  bool operator==(const PacketKey& o) const {
    return node_id == o.node_id && seq == o.seq && ack == o.ack;
  }
};
inline PacketKey key_of(const Packet& p) { return {p.node_id, p.seq, p.is_ack()}; }

enum class ParseResult : uint8_t { Ok, BadLength, BadField };

// Returns bytes written (kPacketSize) or 0 if `cap` is too small.
size_t serialize(const Packet& p, uint8_t* out, size_t cap);
ParseResult parse(const uint8_t* data, size_t len, Packet& out);

}  // namespace setu
