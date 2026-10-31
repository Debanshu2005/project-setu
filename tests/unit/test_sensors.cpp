// Project Setu - Unit Tests for MPU6050, GNSS, Motion Profiles & Battery Models
#include <cmath>
#include <string>
#include <vector>

#include "sensor_models.hpp"
#include "world.hpp"
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

TEST(coordinate_transformation_and_roundtrip) {
  // 1. Origin test: (0, 0) Cartesian should correspond to exact configured origin
  int32_t origin_lat_e6 = 0, origin_lon_e6 = 0;
  xy_to_e6(0.0, 0.0, origin_lat_e6, origin_lon_e6);
  CHECK_EQ(origin_lat_e6, static_cast<int32_t>(std::lround(kOriginLat * 1e6)));
  CHECK_EQ(origin_lon_e6, static_cast<int32_t>(std::lround(kOriginLon * 1e6)));

  double rx0 = 0.0, ry0 = 0.0;
  e6_to_xy(origin_lat_e6, origin_lon_e6, rx0, ry0);
  CHECK(std::abs(rx0 - 0.0) < 0.05);
  CHECK(std::abs(ry0 - 0.0) < 0.05);

  // 2. Arbitrary point test (e.g., Node 18 location: X=1109.4, Y=1021.5)
  double test_x = 1109.4, test_y = 1021.5;
  int32_t lat_e6 = 0, lon_e6 = 0;
  xy_to_e6(test_x, test_y, lat_e6, lon_e6);

  CHECK(lat_e6 > origin_lat_e6);
  CHECK(lon_e6 > origin_lon_e6);

  double roundtrip_x = 0.0, roundtrip_y = 0.0;
  e6_to_xy(lat_e6, lon_e6, roundtrip_x, roundtrip_y);
  CHECK(std::abs(roundtrip_x - test_x) < 0.1);
  CHECK(std::abs(roundtrip_y - test_y) < 0.1);

  // 3. Negative quadrant (South-West)
  int32_t sw_lat_e6 = 0, sw_lon_e6 = 0;
  xy_to_e6(-500.0, -300.0, sw_lat_e6, sw_lon_e6);
  CHECK(sw_lat_e6 < origin_lat_e6);
  CHECK(sw_lon_e6 < origin_lon_e6);

  double sw_x = 0.0, sw_y = 0.0;
  e6_to_xy(sw_lat_e6, sw_lon_e6, sw_x, sw_y);
  CHECK(std::abs(sw_x - (-500.0)) < 0.1);
  CHECK(std::abs(sw_y - (-300.0)) < 0.1);
}

TEST(position_tracker_ground_truth_repositioning_and_estimate_independence) {
  PositionMetricsTracker tracker;
  // Initially, no estimate and no samples exist
  CHECK(!tracker.has_estimate());
  CHECK(!tracker.has_samples());
  CHECK(tracker.current_error_m() < 0.0);
  CHECK_EQ(tracker.sample_count(), 0u);

  // Initialize ground truth at (0, 0)
  int32_t lat0 = 0, lon0 = 0;
  xy_to_e6(0.0, 0.0, lat0, lon0);
  tracker.update_ground_truth(0.0, 0.0, lat0, lon0);
  CHECK(!tracker.has_estimate());

  // Record a simulated fix with ~4m X and ~3m Y displacement
  int32_t fix_lat = 0, fix_lon = 0;
  xy_to_e6(4.0, 3.0, fix_lat, fix_lon);
  tracker.record_sample(0.0, 0.0, lat0, lon0, fix_lat, fix_lon, false, true);

  CHECK(tracker.has_estimate());
  CHECK(tracker.has_samples());
  CHECK_EQ(tracker.sample_count(), 1u);
  CHECK(std::abs(tracker.current_error_m() - 5.0) < 0.2); // hypot(4, 3) = 5.0m
  CHECK(std::abs(tracker.mae_m() - 5.0) < 0.2);

  // User drags node from (0, 0) to (104.0, 3.0) -> delta X = 104m, delta Y = 3m
  // The estimated position must stay at (4.0, 3.0)
  // Distance from (104.0, 3.0) to (4.0, 3.0) is exactly 100m
  int32_t new_gt_lat = 0, new_gt_lon = 0;
  xy_to_e6(104.0, 3.0, new_gt_lat, new_gt_lon);
  tracker.update_ground_truth(104.0, 3.0, new_gt_lat, new_gt_lon);

  // Estimate coordinates must remain untouched
  CHECK_EQ(tracker.last_est_lat_e6(), fix_lat);
  CHECK_EQ(tracker.last_est_lon_e6(), fix_lon);

  // Instantaneous error must now reflect the new 100m displacement
  CHECK(std::abs(tracker.current_error_m() - 100.0) < 0.5);

  // Sample count must NOT be incremented (drag is a GT change, not a sensor observation)
  CHECK_EQ(tracker.sample_count(), 1u);
  CHECK(std::abs(tracker.mae_m() - 5.0) < 0.2);

  // Now perform an explicit estimator reset
  tracker.reset_estimator(104.0, 3.0, new_gt_lat, new_gt_lon);
  CHECK(tracker.has_estimate());
  CHECK(!tracker.has_samples()); // samples cleared for fresh trajectory
  CHECK_EQ(tracker.sample_count(), 0u);
  CHECK_EQ(tracker.last_est_lat_e6(), new_gt_lat);
  CHECK_EQ(tracker.last_est_lon_e6(), new_gt_lon);
  CHECK_EQ(tracker.current_error_m(), 0.0);
}

TEST(mpu6050_moving_profile_step_detection_and_kinematics) {
  Mpu6050SensorModel moving_imu(101);
  moving_imu.set_profile(MotionProfile::Moving);

  CHECK(std::string(motion_profile_str(MotionProfile::Moving)) == "moving");

  int moving_steps = 0;
  // Simulate 3 seconds of moving profile (300 ticks of 10ms = 100 Hz)
  for (uint32_t t = 10; t <= 3000; t += 10) {
    ImuSample s = moving_imu.update(t);
    if (s.step_detected) {
      moving_steps++;
      CHECK(std::abs(s.step_length_m - 0.72f) <= 0.05f);
    }
  }
  // Human moving at ~1.8 Hz cadence for 3 seconds -> ~5 steps (cadence active)
  CHECK(moving_steps >= 4);
  CHECK(moving_steps <= 6);
}
