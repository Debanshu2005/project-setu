// Project Setu - Unit Tests for MPU6050, GNSS, Motion Profiles & Battery Models
#include <cmath>
#include <string>
#include <vector>

#include "sensor_models.hpp"
#include "testlib.hpp"

using namespace sim;

TEST(mpu6050_stationary_profile_measures_gravity) {
  Mpu6050SensorModel imu(1234);
  imu.set_profile(MotionProfile::Stationary);
  imu.set_orientation(0.0, 0.0, 0.0); // device flat

  ImuSample s = imu.update(100);

  // When flat and stationary, az should be close to 1g (9.80665 m/s^2), ax/ay close to 0
  CHECK(std::abs(s.az - 9.80665) <= 0.35); // within 0.35 m/s^2 of 1g
  CHECK(std::abs(s.ax - 0.0) <= 0.25);
  CHECK(std::abs(s.ay - 0.0) <= 0.25);

  // Raw 16-bit register LSBs: 1g in +/- 4g mode corresponds to 8192 LSB
  CHECK(s.raw_az >= 7800);
  CHECK(s.raw_az <= 8600);
  CHECK(!s.step_detected);
}

TEST(mpu6050_walking_and_running_cadence_step_detection) {
  Mpu6050SensorModel walking_imu(42);
  walking_imu.set_profile(MotionProfile::Walking);

  int walking_steps = 0;
  // Simulate 3 seconds of walking (300 ticks of 10ms = 100 Hz)
  for (uint32_t t = 10; t <= 3000; t += 10) {
    ImuSample s = walking_imu.update(t);
    if (s.step_detected) {
      walking_steps++;
      CHECK(std::abs(s.step_length_m - 0.72f) <= 0.05f);
    }
  }
  // Human walking at ~1.8 Hz for 3 seconds -> ~5 steps
  CHECK(walking_steps >= 4);
  CHECK(walking_steps <= 6);

  Mpu6050SensorModel running_imu(43);
  running_imu.set_profile(MotionProfile::Running);

  int running_steps = 0;
  for (uint32_t t = 10; t <= 3000; t += 10) {
    ImuSample s = running_imu.update(t);
    if (s.step_detected) {
      running_steps++;
      CHECK(std::abs(s.step_length_m - 1.15f) <= 0.05f);
    }
  }
  // Human running at ~2.8 Hz for 3 seconds -> ~7-9 steps
  CHECK(running_steps >= 7);
  CHECK(running_steps <= 10);
  CHECK(running_steps > walking_steps);
}

TEST(mpu6050_fall_impact_signature) {
  Mpu6050SensorModel imu(999);
  imu.set_profile(MotionProfile::FallImpact);

  double min_accel = 100.0;
  double max_accel = 0.0;

  // Simulate 1 second of fall cycle
  for (uint32_t t = 10; t <= 1000; t += 10) {
    ImuSample s = imu.update(t);
    double total_a = std::hypot(s.ax, s.ay, s.az);
    min_accel = std::min(min_accel, total_a);
    max_accel = std::max(max_accel, total_a);
  }

  // Fall must exhibit freefall dip (< 4 m/s^2) followed by heavy impact deceleration (> 30 m/s^2)
  CHECK(min_accel < 4.0);
  CHECK(max_accel > 30.0);
}

TEST(gnss_nmea_checksum_and_format) {
  int32_t lat_e6 = 22572600; // 22.5726 N
  int32_t lon_e6 = 88433800; // 88.4338 E
  std::string nmea = GnssSensorModel::format_nmea_rmc(1000, lat_e6, lon_e6);

  CHECK(nmea.substr(0, 7) == "$GPRMC,");
  // Check that sentence ends with \r\n
  CHECK(nmea.size() >= 10u);
  CHECK(nmea.substr(nmea.size() - 2) == "\r\n");

  // Validate XOR checksum
  size_t star_pos = nmea.find('*');
  CHECK(star_pos != std::string::npos);

  uint8_t calculated_cs = 0;
  for (size_t i = 1; i < star_pos; ++i) {
    calculated_cs ^= static_cast<uint8_t>(nmea[i]);
  }

  std::string cs_str = nmea.substr(star_pos + 1, 2);
  unsigned long expected_cs = std::stoul(cs_str, nullptr, 16);
  CHECK_EQ(calculated_cs, static_cast<uint8_t>(expected_cs));
}

TEST(gnss_sensor_outage_scheduling_and_recovery) {
  GnssSensorModel gnss(777);
  gnss.schedule_outage(2000, 4000); // Outage from t=2000 to t=6000

  int32_t gt_lat_e6 = 22572600, gt_lon_e6 = 88433800;
  int32_t out_lat = 0, out_lon = 0;

  // t = 1000: Fix should be valid
  bool fix_1000 = gnss.update(1000, 0, 0, gt_lat_e6, gt_lon_e6, out_lat, out_lon);
  CHECK(fix_1000);
  CHECK(gnss.status() == GnssFixStatus::ValidFix);

  // t = 3000: Inside scheduled outage -> returns false
  bool fix_3000 = gnss.update(3000, 0, 0, gt_lat_e6, gt_lon_e6, out_lat, out_lon);
  CHECK(!fix_3000);
  CHECK(gnss.status() == GnssFixStatus::TemporaryOutage);

  // t = 7000: Outage concluded -> returns true and status is Recovered
  bool fix_7000 = gnss.update(7000, 0, 0, gt_lat_e6, gt_lon_e6, out_lat, out_lon);
  CHECK(fix_7000);
  CHECK(gnss.status() == GnssFixStatus::Recovered);
}

TEST(position_metrics_tracker_ground_truth_separation) {
  PositionMetricsTracker tracker;

  // Sample 1: GNSS fix with ~3m noise
  tracker.record_sample(0, 0, 22572600, 88433800, 22572625, 88433825, false, true);
  CHECK(tracker.current_error_m() > 0.0);
  CHECK(tracker.current_error_m() < 10.0);
  CHECK_EQ(tracker.sample_count(), 1u);

  // Sample 2: Dead-reckoning drift with ~25m error
  tracker.record_sample(50, 0, 22573000, 88433800, 22573225, 88433800, true, false);
  CHECK_EQ(tracker.sample_count(), 2u);
  CHECK(tracker.mae_m() > 5.0);
  CHECK(tracker.rmse_m() >= tracker.mae_m()); // RMSE >= MAE holds by Cauchy-Schwarz
  CHECK(tracker.max_error_m() > 20.0);
  CHECK(tracker.is_dr_fallback());
}

TEST(battery_energy_model_accounting_and_voltage_curve) {
  BatteryEnergyModel batt(300.0, 100); // 300 mAh capacity, 100% initial
  CHECK_EQ(batt.percent(), 100);
  CHECK(std::abs(batt.consumed_mah() - 0.0) < 0.001);

  // Transmit 10 packets at SF7 (airtime ~62 ms each)
  for (int i = 0; i < 10; ++i) {
    batt.account_tx(62, 14);
  }
  CHECK_EQ(batt.tx_count(), 10u);
  CHECK(batt.consumed_mah() > 0.0);

  // 1 hour of idle standby
  batt.account_idle(3600000);
  CHECK(batt.consumed_mah() > 2.0); // should consume ~2.7+3.8 = ~6.5 mAh

  // Test discharge percentage
  batt.set_percent(50);
  CHECK_EQ(batt.percent(), 50);
  CHECK(std::abs(batt.remaining_mah() - 150.0) <= 0.1);
  CHECK(batt.estimated_lifetime_hours(4.0, 115) > 10.0);
}
