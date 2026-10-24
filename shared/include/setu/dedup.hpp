// Fixed-size duplicate cache for flooding. No heap allocation.
#pragma once
#include <cstddef>
#include <cstdint>

#include "setu/packet.hpp"

namespace setu {

class DedupCache {
 public:
  static constexpr size_t kCapacity = 64;

  // Records one sighting. Returns how many times this key has now been seen (1 = new).
  uint8_t observe(const PacketKey& k);
  // Sightings so far (0 if unknown / evicted).
  uint8_t count(const PacketKey& k) const;

 private:
  struct Entry {
    PacketKey key{0, 0, false};
    uint8_t count = 0;
  };
  Entry e_[kCapacity];
  size_t next_ = 0;  // ring replacement: oldest entry is overwritten first
};

}  // namespace setu
