#include "testlib.hpp"

int main() {
  int before_total = 0;
  for (auto& c : testlib::registry()) {
    int before = testlib::failures();
    c.fn();
    std::printf("[%s] %s\n", testlib::failures() == before ? " ok " : "FAIL", c.name);
    before_total++;
  }
  std::printf("%d tests, %d failed checks\n", before_total, testlib::failures());
  return testlib::failures() ? 1 : 0;
}
