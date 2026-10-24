#include <cstring>

#include "setu/packet.hpp"
#include "testlib.hpp"

using namespace setu;

static Packet sample() {
  Packet p;
  p.node_id = 0x1234;
  p.seq = 0xBEEF;
  p.hazard = Hazard::Trapped;
  p.flags = kFlagGps;
  p.lat_e6 = 22572600;
  p.lon_e6 = -88433800;
  p.ts = 1700000123;
  p.battery = 87;
  p.hop = 3;
  p.contact = 2;
  return p;
}

TEST(packet_size_is_25) { CHECK_EQ(kPacketSize, 25u); }

TEST(packet_roundtrip) {
  uint8_t buf[kPacketSize];
  CHECK_EQ(serialize(sample(), buf, sizeof buf), kPacketSize);
  Packet q;
  CHECK(parse(buf, sizeof buf, q) == ParseResult::Ok);
  CHECK_EQ(q.node_id, 0x1234);
  CHECK_EQ(q.seq, 0xBEEF);
  CHECK(q.hazard == Hazard::Trapped);
  CHECK_EQ(q.lat_e6, 22572600);
  CHECK_EQ(q.lon_e6, -88433800);
  CHECK_EQ(q.ts, 1700000123u);
  CHECK_EQ(q.battery, 87);
  CHECK_EQ(q.hop, 3);
  CHECK_EQ(q.contact, 2);
}

TEST(packet_wire_layout_is_little_endian) {
  uint8_t buf[kPacketSize];
  serialize(sample(), buf, sizeof buf);
  CHECK_EQ(buf[0], 0x34);
  CHECK_EQ(buf[1], 0x12);
  CHECK_EQ(buf[8], 2);  // hazard
  CHECK_EQ(buf[9], kFlagGps);
}

TEST(serialize_rejects_small_buffer) {
  uint8_t buf[10];
  CHECK_EQ(serialize(sample(), buf, sizeof buf), 0u);
}

TEST(parse_rejects_bad_input) {
  uint8_t buf[kPacketSize];
  serialize(sample(), buf, sizeof buf);
  Packet q;
  CHECK(parse(buf, 24, q) == ParseResult::BadLength);
  CHECK(parse(nullptr, 25, q) == ParseResult::BadLength);

  uint8_t b[kPacketSize];
  std::memcpy(b, buf, sizeof b);
  b[8] = 3;  // bad hazard
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);

  std::memcpy(b, buf, sizeof b);
  b[9] = 0x80;  // unknown flag
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);

  std::memcpy(b, buf, sizeof b);
  b[9] = kFlagGps | kFlagDr;  // GNSS and DR are exclusive
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);

  std::memcpy(b, buf, sizeof b);
  b[22] = 101;  // battery
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);

  std::memcpy(b, buf, sizeof b);
  b[23] = 200;  // hop
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);

  Packet far = sample();
  far.lat_e6 = 91000000;
  serialize(far, b, sizeof b);
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);
}

TEST(ack_must_name_target_and_sos_must_not) {
  Packet a = sample();
  a.flags = kFlagAck;  // target still kNoTarget -> invalid
  uint8_t b[kPacketSize];
  serialize(a, b, sizeof b);
  Packet q;
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);
  a.target = 7;
  serialize(a, b, sizeof b);
  CHECK(parse(b, sizeof b, q) == ParseResult::Ok);
  Packet s = sample();
  s.target = 7;  // SOS with a target -> invalid
  serialize(s, b, sizeof b);
  CHECK(parse(b, sizeof b, q) == ParseResult::BadField);
}

TEST(key_distinguishes_ack_from_sos) {
  Packet s = sample();
  Packet a = sample();
  a.flags = kFlagAck;
  a.target = 5;
  CHECK(!(key_of(s) == key_of(a)));
}
