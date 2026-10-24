#include "testlib.hpp"

int main() {
  int before_total = 0;
  for (auto& c : testlib::registry()) {
    int before = testlib::failures();
    std::printf("Running %s... ", c.name);
    std::fflush(stdout);
    c.fn();
    std::printf("[%s]\n", testlib::failures() == before ? " ok " : "FAIL");
    std::fflush(stdout);
    before_total++;
  }
  std::printf("%d tests, %d failed checks\n", before_total, testlib::failures());
  return testlib::failures() ? 1 : 0;
}
