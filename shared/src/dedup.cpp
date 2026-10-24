#include "setu/dedup.hpp"

namespace setu {

uint8_t DedupCache::observe(const PacketKey& k) {
  for (auto& e : e_) {
    if (e.count && e.key == k) {
      if (e.count < 255) e.count++;
      return e.count;
    }
  }
  e_[next_].key = k;
  e_[next_].count = 1;
  next_ = (next_ + 1) % kCapacity;
  return 1;
}

uint8_t DedupCache::count(const PacketKey& k) const {
  for (const auto& e : e_)
    if (e.count && e.key == k) return e.count;
  return 0;
}

}  // namespace setu
