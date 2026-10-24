// Minimal dependency-free test harness.
#pragma once
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace testlib {
struct Case {
  const char* name;
  std::function<void()> fn;
};
inline std::vector<Case>& registry() {
  static std::vector<Case> r;
  return r;
}
inline int& failures() {
  static int f = 0;
  return f;
}
struct Reg {
  Reg(const char* n, std::function<void()> f) { registry().push_back({n, std::move(f)}); }
};
}  // namespace testlib

#define TEST(name)                                         \
  static void test_##name();                               \
  static testlib::Reg reg_##name(#name, test_##name);      \
  static void test_##name()

#define CHECK(cond)                                                              \
  do {                                                                           \
    if (!(cond)) {                                                               \
      std::printf("    FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);            \
      testlib::failures()++;                                                     \
    }                                                                            \
  } while (0)

#define CHECK_EQ(a, b)                                                                     \
  do {                                                                                     \
    auto va_ = (a);                                                                        \
    auto vb_ = (b);                                                                        \
    if (!(va_ == vb_)) {                                                                   \
      std::printf("    FAIL %s:%d  %s == %s  (%lld vs %lld)\n", __FILE__, __LINE__, #a, #b, \
                  static_cast<long long>(va_), static_cast<long long>(vb_));               \
      testlib::failures()++;                                                               \
    }                                                                                      \
  } while (0)
