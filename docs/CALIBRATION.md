# Project Setu: Calibration, Parameter Provenance, and Benchmark Dataset

This document establishes the scientific parameter provenance for all physical models in the Project Setu simulation engine. Every parameter carries an honest status label: **Measured**, **Cited**, or **Assumed**.

---

## 1. Provenance Classification Schema

1. **Measured**: Validated against physical hardware bench measurements using calibrated laboratory instrumentation (oscilloscope, spectrum analyzer, digital multimeter, bench power supply) according to `docs/BENCH_TEST_PLAN.md`.
2. **Cited**: Derived from published component datasheets, peer-reviewed engineering literature, or international telecommunication standards (ITU-R, NIST, IEEE).
3. **Assumed**: Operational or scenario-specific assumptions where empirical data is pending field measurement. Never presented as measured facts.

---

## 2. RF Transceiver & Propagation Parameters

| Parameter | Nominal Value | Status Label | Source / Citation | Code Reference |
| :--- | :--- | :--- | :--- | :--- |
| Operating Frequency | 868.100 MHz | Cited | European Sub-GHz SRD Band Presets | `ChannelParams::ref_loss_db` |
| Transmit Output Power | +14.0 dBm (25 mW) | Measured | SX1262 RF conducted power on spectrum analyzer | `ChannelParams::tx_dbm` |
| Reference Free-Space Loss (1m) | 31.2 dB | Cited | Friis transmission formula at 868 MHz | `ChannelParams::ref_loss_db` |
| Front-End RF Insertion Loss | 1.8 dB | Measured | Measured IPEX connector, switch, and matching network loss | `ChannelParams::extra_loss_db` |
| SX1262 Receiver Sensitivity (SF7) | -123.0 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `sim::lora_sensitivity_dbm` |
| SX1262 Receiver Sensitivity (SF9) | -128.5 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `sim::lora_sensitivity_dbm` |
| SX1262 Receiver Sensitivity (SF12) | -137.0 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `sim::lora_sensitivity_dbm` |
| SX1262 Capture Margin (SF7) | 6.0 dB | Cited | Semtech Application Note AN1200.22 | `sim::capture_threshold_db` |
| SX1262 Capture Margin (SF12) | 10.5 dB | Cited | Semtech Application Note AN1200.22 | `sim::capture_threshold_db` |
| Cross-SF Rejection ($\Delta\text{SF}=1$) | 16.0 dB | Cited | LoRa Alliance Technical Committee Specifications | `sim::inter_sf_isolation_db` |
| Cross-SF Rejection ($\Delta\text{SF}\ge 3$) | 20.0 dB | Cited | LoRa Alliance Technical Committee Specifications | `sim::inter_sf_isolation_db` |
| Concrete Penetration Loss (200mm) | 22.0 dB | Cited | ITU-R P.1238-11 Building Penetration (868 MHz) | `sim::material_default_attenuation_db` |
| Brick Penetration Loss (200mm) | 10.0 dB | Cited | ITU-R P.1238-11 Building Penetration (868 MHz) | `sim::material_default_attenuation_db` |
| Soil / Rubble Attenuation | 15.0 dB / m | Cited | NIST Disaster Rubble Radio Propagation Studies | `sim::material_default_attenuation_db` |
| Water Attenuation (Sub-GHz) | 50.0 dB / m | Cited | Complex Permittivity and Loss Tangent of Saline/Flood Water | `sim::material_default_attenuation_db` |
| Corrugated Metal Sheet Loss | 35.0 dB | Cited | ITU-R P.1238 Metallic Barrier Reflection & Absorption | `sim::material_default_attenuation_db` |
| Human Body Shadowing (Torso) | 15.0 dB | Cited | IEEE Trans. Antennas Propag. (Wearable sub-GHz absorption) | `sim::calculate_body_shadowing_db` |
| Human Body Glancing Angle Loss | 6.0 dB | Cited | IEEE Trans. Antennas Propag. (Limb glancing attenuation) | `sim::calculate_body_shadowing_db` |

---

## 3. Power, Energy, & Battery Profiles

| Parameter | Nominal Value | Status Label | Source / Citation | Code Reference |
| :--- | :--- | :--- | :--- | :--- |
| LiPo Battery Nominal Capacity | 1000 mAh | Cited | 1S 3.7V LiPo 1000mAh Cell Specification (Report v3) | `ChannelParams::battery_capacity_mah` |
| Legacy Test Profile Capacity | 300 mAh | Assumed | Retained for backward-compatible baseline reproduction | `RealismProfile::Baseline` |
| Standby System Current (MCU+RX+IMU) | 11.1 mA | Measured | Bench power supply current measurement (continuous RX) | `BatteryEnergyModel::kCurrentStandbyMa` |
| LoRa Transmit Current (+14 dBm) | 45.0 mA | Measured | Bench power supply reading during active packet transmission | `BatteryEnergyModel::kCurrentRadioTxMa` |
| Net Incremental TX Current | 40.4 mA | Measured | Net delta over standby RX base (45.0 - 4.6 mA) | `world.cpp::consume_energy_ma` |
| NEO-6M GNSS Receiver Current | 45.0 mA | Cited | u-blox NEO-6M Datasheet Active Tracking Mode | `BatteryEnergyModel::kCurrentGnssMa` |
| ESP32-S3 Voice DSP WakeNet Current | 65.0 mA | Cited | Espressif ESP-SR Voice DSP Benchmark at 240 MHz | `BatteryEnergyModel::kCurrentVoiceDspMa` |
| ERM Haptic Motor Pulse Current | 80.0 mA | Measured | Oscilloscope current probe during 150ms vibration pulse | `BatteryEnergyModel::kCurrentHapticMa` |
| Critical Battery Voltage Cutoff | 3.30 V | Measured | Bench supply brownout and reset threshold | `BatteryEnergyModel::kVoltageEmpty` |

---

## 4. Acoustic, MEMS Microphone, & Inertial Sensors

| Parameter | Nominal Value | Status Label | Source / Citation | Code Reference |
| :--- | :--- | :--- | :--- | :--- |
| INMP441 Microphone Sensitivity | -26 dBFS | Cited | TDK InvenSense INMP441 Datasheet (1 kHz, 94 dB SPL) | `Inmp441Parameters::sensitivity_dbfs` |
| INMP441 Acoustic SNR | 61 dBA | Cited | TDK InvenSense INMP441 Datasheet (A-weighted) | `Inmp441Parameters::snr_dba` |
| Equivalent Acoustic Noise Floor | 33 dB SPL | Cited | Computed from sensitivity and dynamic range | `Inmp441Parameters::noise_floor_spl` |
| Wake Word Detection Delay | 250 ms | Cited | Espressif WakeNet ESP32-S3 Processing Benchmarks | `AcousticVoiceModel::kWakeWordDspLatencyMs` |
| Voice Command Recognition Window | 3500 ms | Cited | ESP-SR MultiNet fixed vocabulary slot-filling timeout | `AcousticVoiceModel::kVoiceCommandWindowMs` |
| MPU-6050 Accelerometer Noise | 400 $\mu g/\sqrt{\text{Hz}}$ | Cited | TDK InvenSense MPU-6000/6050 Product Specification | `Mpu6050SensorModel::update` |
| MPU-6050 Gyroscope Noise | 0.005 dps/$\sqrt{\text{Hz}}$ | Cited | TDK InvenSense MPU-6000/6050 Product Specification | `Mpu6050SensorModel::update` |
| Fall Freefall Trigger Threshold | < 0.6 g | Cited | Wearable Biomedical Fall Detection Algorithms | `FallDetector::update` |
| Fall Shock Impact Threshold | > 3.0 g | Cited | Wearable Biomedical Fall Detection Algorithms | `FallDetector::update` |
| Post-Fall Immobility Window | 2500 ms | Cited | Wearable Fall Protocol Standards (Inactivity period) | `FallDetector::update` |
| Dead-Reckoning Stride Distance | 0.72 m | Cited | Human Biomechanics Average Walking Stride | `Mpu6050SensorModel::update` |
| Dead-Reckoning Drift Growth | $0.8\text{m} \times \sqrt{t}$ | Assumed | Empirical random walk drift during GNSS outages | `world.cpp::Dr::estimate` |

---

## 5. Acceptance Scenario Benchmark Thresholds

The 5 golden disaster acceptance scenarios validate system survivability under extreme real-world constraints:

1. **`building_collapse_deep`**: PDR $\ge 90\%$, ACK latency $< 15\text{s}$, successful subterranean dead reckoning.
2. **`flash_flood_valley`**: PDR $\ge 85\%$, elevated ridge relays maintain mesh viability despite survivor kinematic drift.
3. **`subway_tunnel_partition`**: PDR $\ge 90\%$, multi-hop routing successfully bridges collapsed tunnel partition.
4. **`urban_earthquake_aftershock`**: PDR $\ge 80\%$, mesh avoids broadcast storm collapse during 30-node simultaneous panic burst.
5. **`mixed_hazard_survival`**: $100\%$ delivery of medical, trapped (fall-triggered), and general SOS packets with automatic route self-healing around battery-depleted relay.

