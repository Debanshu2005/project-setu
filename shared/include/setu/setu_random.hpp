#pragma once

#include <cstdint>
#include <cmath>
#include <algorithm>

namespace setu {

// SplitMix64 pseudo-random generator
// High quality 64-bit mixer used to initialize multi-word generator states.
class SplitMix64 {
public:
  explicit SplitMix64(uint64_t seed = 0) : state_(seed) {}

  uint64_t next_u64() {
    uint64_t z = (state_ += 0x9e3779b97f4a7c15ULL);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
  }

  void seed(uint64_t s) {
    state_ = s;
  }

private:
  uint64_t state_;
};

// Xoshiro256++ portable pseudo-random generator
// Standard all-platform generator that produces identical bitstreams across compilers.
class Xoshiro256PlusPlus {
public:
  Xoshiro256PlusPlus() {
    seed(42);
  }

  explicit Xoshiro256PlusPlus(uint64_t s) {
    seed(s);
  }

  void seed(uint64_t s) {
    SplitMix64 sm(s);
    s_[0] = sm.next_u64();
    s_[1] = sm.next_u64();
    s_[2] = sm.next_u64();
    s_[3] = sm.next_u64();
    has_spare_gaussian_ = false;
    spare_gaussian_ = 0.0;
  }

  static inline uint64_t rotl(const uint64_t x, int k) {
    return (x << k) | (x >> (64 - k));
  }

  uint64_t next_u64() {
    const uint64_t result = rotl(s_[0] + s_[3], 23) + s_[0];
    const uint64_t t = s_[1] << 17;
    s_[2] ^= s_[0];
    s_[3] ^= s_[1];
    s_[1] ^= s_[2];
    s_[0] ^= s_[3];
    s_[2] ^= t;
    s_[3] = rotl(s_[3], 45);
    return result;
  }

  // Uniform double in [0, 1) using top 53 bits (IEEE 754 53-bit mantissa)
  double next_u01() {
    return (next_u64() >> 11) * (1.0 / 9007199254740992.0);
  }

  // Uniform double in [min_val, max_val)
  double uniform(double min_val, double max_val) {
    return min_val + (max_val - min_val) * next_u01();
  }

  // Gaussian / Normal distribution using Box-Muller transform
  double gaussian(double mean = 0.0, double stddev = 1.0) {
    if (stddev <= 0.0) return mean;
    if (has_spare_gaussian_) {
      has_spare_gaussian_ = false;
      return mean + stddev * spare_gaussian_;
    }
    double u1 = next_u01();
    while (u1 <= 1e-15) {
      u1 = next_u01();
    }
    double u2 = next_u01();
    double r = std::sqrt(-2.0 * std::log(u1));
    double theta = 6.28318530717958647692 * u2;
    spare_gaussian_ = r * std::sin(theta);
    has_spare_gaussian_ = true;
    return mean + stddev * (r * std::cos(theta));
  }

private:
  uint64_t s_[4];
  double spare_gaussian_ = 0.0;
  bool has_spare_gaussian_ = false;
};

// Hash-keyed draws for per-link and per-transmission deterministic values
class HashRandom {
public:
  static inline uint64_t hash_link_key(uint32_t sim_seed, uint16_t node_a, uint16_t node_b) {
    uint16_t lo = std::min(node_a, node_b);
    uint16_t hi = std::max(node_a, node_b);
    uint64_t k = (static_cast<uint64_t>(sim_seed) << 32) |
                 (static_cast<uint64_t>(lo) << 16) |
                 static_cast<uint64_t>(hi);
    k ^= 0x9e3779b97f4a7c15ULL;
    k = (k ^ (k >> 30)) * 0xbf58476d1ce4e5b9ULL;
    k = (k ^ (k >> 27)) * 0x94d049bb133111ebULL;
    return k ^ (k >> 31);
  }

  static inline double link_gaussian(uint32_t sim_seed, uint16_t node_a, uint16_t node_b, double mean, double stddev) {
    if (stddev <= 0.0) return mean;
    uint64_t key = hash_link_key(sim_seed, node_a, node_b);
    Xoshiro256PlusPlus rng(key);
    return rng.gaussian(mean, stddev);
  }

  static inline uint64_t hash_tx_key(uint32_t sim_seed, uint32_t tx_id, uint16_t rx_node) {
    uint64_t k = (static_cast<uint64_t>(sim_seed) << 48) ^
                 (static_cast<uint64_t>(tx_id) << 16) ^
                 static_cast<uint64_t>(rx_node);
    k ^= 0xd6e8feb86659fd93ULL;
    k = (k ^ (k >> 30)) * 0xbf58476d1ce4e5b9ULL;
    k = (k ^ (k >> 27)) * 0x94d049bb133111ebULL;
    return k ^ (k >> 31);
  }

  static inline double tx_gaussian(uint32_t sim_seed, uint32_t tx_id, uint16_t rx_node, double mean, double stddev) {
    if (stddev <= 0.0) return mean;
    uint64_t key = hash_tx_key(sim_seed, tx_id, rx_node);
    Xoshiro256PlusPlus rng(key);
    return rng.gaussian(mean, stddev);
  }

  static inline double tx_uniform(uint32_t sim_seed, uint32_t tx_id, uint16_t rx_node) {
    uint64_t key = hash_tx_key(sim_seed, tx_id, rx_node);
    Xoshiro256PlusPlus rng(key);
    return rng.next_u01();
  }
};

} // namespace setu

