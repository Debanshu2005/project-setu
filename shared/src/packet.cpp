#include "setu/packet.hpp"

namespace setu {
namespace {
void put16(uint8_t* p, uint16_t v) {
  p[0] = static_cast<uint8_t>(v);
  p[1] = static_cast<uint8_t>(v >> 8);
}
void put32(uint8_t* p, uint32_t v) {
  for (int i = 0; i < 4; i++) p[i] = static_cast<uint8_t>(v >> (8 * i));
}
uint16_t get16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t get32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
}  // namespace

size_t serialize(const Packet& p, uint8_t* out, size_t cap) {
  if (cap < kPacketSize) return 0;
  put16(out + 0, p.node_id);
  put16(out + 2, p.seq);
  put16(out + 4, p.target);
  put16(out + 6, p.ref_seq);
  out[8] = static_cast<uint8_t>(p.hazard);
  out[9] = p.flags;
  put32(out + 10, static_cast<uint32_t>(p.lat_e6));
  put32(out + 14, static_cast<uint32_t>(p.lon_e6));
  put32(out + 18, p.ts);
  out[22] = p.battery;
  out[23] = p.hop;
  out[24] = p.contact;
  return kPacketSize;
}

ParseResult parse(const uint8_t* d, size_t len, Packet& o) {
  if (d == nullptr || len != kPacketSize) return ParseResult::BadLength;
  Packet p;
  p.node_id = get16(d + 0);
  p.seq = get16(d + 2);
  p.target = get16(d + 4);
  p.ref_seq = get16(d + 6);
  if (d[8] > static_cast<uint8_t>(Hazard::Trapped)) return ParseResult::BadField;
  p.hazard = static_cast<Hazard>(d[8]);
  p.flags = d[9];
  if (p.flags & ~(kFlagGps | kFlagAck | kFlagDr)) return ParseResult::BadField;
  if ((p.flags & kFlagGps) && (p.flags & kFlagDr)) return ParseResult::BadField;
  p.lat_e6 = static_cast<int32_t>(get32(d + 10));
  p.lon_e6 = static_cast<int32_t>(get32(d + 14));
  if (p.lat_e6 < -90000000 || p.lat_e6 > 90000000) return ParseResult::BadField;
  if (p.lon_e6 < -180000000 || p.lon_e6 > 180000000) return ParseResult::BadField;
  p.ts = get32(d + 18);
  p.battery = d[22];
  if (p.battery > 100) return ParseResult::BadField;
  p.hop = d[23];
  if (p.hop > kMaxHopField) return ParseResult::BadField;
  p.contact = d[24];
  // An ACK must name its target; an SOS must not.
  if (p.is_ack() == (p.target == kNoTarget)) return ParseResult::BadField;
  o = p;
  return ParseResult::Ok;
}

}  // namespace setu
