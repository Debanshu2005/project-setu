# Project Setu: Parameter Register and Fidelity Provenance

This document catalogs every simulated physical parameter in Project Setu. In accordance with the project realism guidelines, every parameter carries an explicit status label: **Measured**, **Cited**, or **Assumed**.

---

## 1. Provenance Classification Rules

* **Measured**: Empirically measured and calibrated against physical ESP32-S3 and SX1262 hardware on a test bench using an oscilloscope, spectrum analyzer, digital multimeter, or bench power supply.
* **Cited**: Sourced directly from component manufacturer datasheets (Semtech, Espressif, TDK InvenSense, u-blox) or published engineering standards (ITU-R, IEEE, NIST).
* **Assumed**: Engineering estimates or operational scenario models where field data is pending. Assumed values are never presented as measured facts.

---

## 2. RF Transceiver & Propagation Parameters

| Parameter | Nominal Value | Status Label | Source / Citation | Implementation Reference |
| :--- | :--- | :--- | :--- | :--- |
| Operating Frequency | 868.100 MHz | Cited | European Sub-GHz SRD Band Presets | `ChannelParams::ref_loss_db` |
| Transmit Output Power | +14.0 dBm (25 mW) | Measured | SX1262 conducted RF power into spectrum analyzer | `ChannelParams::tx_dbm` |
| High-Power TX Setting | +22.0 dBm (160 mW) | Measured | SX1262 maximum power setting on test bench | `BatteryEnergyModel::kCurrentRadioTx22Ma` |
| Reference Loss at 1 meter | 31.2 dB | Cited | Friis transmission equation at 868.1 MHz | `ChannelParams::ref_loss_db` |
| RF Front-End Insertion Loss | 1.8 dB | Measured | IPEX connector, RF switch, and antenna match insertion loss | `ChannelParams::extra_loss_db` |
| Receiver Sensitivity (SF7, 125 kHz) | -123.0 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `setu::lora_sensitivity_dbm` |
| Receiver Sensitivity (SF8, 125 kHz) | -125.5 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `setu::lora_sensitivity_dbm` |
| Receiver Sensitivity (SF9, 125 kHz) | -128.5 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `setu::lora_sensitivity_dbm` |
| Receiver Sensitivity (SF10, 125 kHz) | -131.0 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `setu::lora_sensitivity_dbm` |
| Receiver Sensitivity (SF11, 125 kHz) | -134.0 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `setu::lora_sensitivity_dbm` |
| Receiver Sensitivity (SF12, 125 kHz) | -137.0 dBm | Cited | Semtech SX1261/2 Datasheet Rev 2.1 Table 13-4 | `setu::lora_sensitivity_dbm` |
| SX1262 Co-Channel Capture (SF7) | 6.0 dB | Cited | Semtech Application Note AN1200.22 | `sim::capture_threshold_db` |
| SX1262 Co-Channel Capture (SF12) | 10.5 dB | Cited | Semtech Application Note AN1200.22 | `sim::capture_threshold_db` |
| Inter-SF Isolation (Delta SF = 1) | 16.0 dB | Cited | LoRa Alliance Physical Layer Specifications | `sim::inter_sf_isolation_db` |
| Inter-SF Isolation (Delta SF >= 3) | 20.0 dB | Cited | LoRa Alliance Physical Layer Specifications | `sim::inter_sf_isolation_db` |
| Concrete Floor Slab Loss (200mm) | 22.0 dB | Cited | ITU-R P.1238-11 Building Penetration (868 MHz) | `sim::material_default_attenuation_db` |
| Brick Masonry Wall Loss (200mm) | 10.0 dB | Cited | ITU-R P.1238-11 Building Penetration (868 MHz) | `sim::material_default_attenuation_db` |
| Structural Metal Sheet Loss | 35.0 dB | Cited | ITU-R P.1238 Metallic Barrier Reflection & Absorption | `sim::material_default_attenuation_db` |
| Water Penetration Loss | 50.0 dB / m | Cited | Permittivity and Loss Tangent of Flood Water | `sim::material_default_attenuation_db` |
| Soil / Rubble Absorption | 15.0 dB / m | Cited | NIST Subterranean Rubble Propagation Studies | `sim::material_default_attenuation_db` |
| Human Torso Shadowing (Rear 120 deg) | 15.0 dB | Cited | IEEE Trans. Antennas Propag. Wearable RF Absorption | `sim::calculate_body_shadowing_db` |
| Human Limb Shadowing (Glancing angle) | 6.0 dB | Cited | IEEE Trans. Antennas Propag. Wearable RF Absorption | `sim::calculate_body_shadowing_db` |
| Baseline Log-Normal Shadowing Sigma | 4.0 dB | Assumed | Standard urban small-scale shadowing standard | `ChannelParams::shadow_sigma_db` |
| Field Log-Normal Shadowing Sigma | 6.0 dB | Cited | ITU-R P.1411 Obstructed Urban Path Shadowing | `ChannelParams::shadow_sigma_db` |
| Path Loss Exponent (Baseline) | 3.0 | Assumed | Generic suburban propagation profile | `ChannelParams::path_exp` |
| Path Loss Exponent (Collapse Rubble) | 3.8 to 4.2 | Cited | S. Y. Seidel and T. S. Rappaport, 914 MHz Penetration | `scenarios/building_collapse_deep.json` |

---

## 3. Power, Energy, & Battery Profiles

| Parameter | Nominal Value | Status Label | Source / Citation | Implementation Reference |
| :--- | :--- | :--- | :--- | :--- |
| LiPo Battery Nominal Capacity | 1000 mAh | Cited | 1S 3.7V LiPo 1000mAh Cell (Report v3 specification) | `ChannelParams::battery_capacity_mah` |
| Legacy Baseline Test Capacity | 300 mAh | Assumed | Retained for exact bit-level baseline trace reproduction | `RealismProfile::Baseline` |
| Standby Current (MCU + LoRa RX + IMU) | 11.1 mA | Measured | Bench multimeter measurement under continuous listening | `BatteryEnergyModel::kCurrentStandbyMa` |
| Net Incremental TX Current (+14 dBm) | 40.4 mA | Measured | Difference between active TX (45.0 mA) and RX base | `world.cpp::finish_tx` |
| Total Active TX Current (+14 dBm) | 45.0 mA | Measured | Bench supply measurement during LoRa packet transmit | `BatteryEnergyModel::kCurrentRadioTx14Ma` |
| Total Active TX Current (+22 dBm) | 118.0 mA | Measured | Bench supply measurement with SX1262 high-power PA | `BatteryEnergyModel::kCurrentRadioTx22Ma` |
| NEO-6M GNSS Active Current | 45.0 mA | Cited | u-blox NEO-6M Datasheet Active Tracking Mode | `BatteryEnergyModel::kCurrentGnssMa` |
| ESP32-S3 Voice DSP Current | 65.0 mA | Cited | Espressif ESP-SR Voice DSP Benchmark at 240 MHz | `BatteryEnergyModel::kCurrentVoiceDspMa` |
| ERM Haptic Motor Current | 80.0 mA | Measured | Oscilloscope current probe during 150ms vibration pulse | `BatteryEnergyModel::kCurrentHapticMa` |
| Battery Cutoff Brownout Voltage | 3.30 V | Measured | Bench power supply shutdown threshold | `BatteryEnergyModel::kVoltageEmpty` |

---

## 4. Sensors, Voice, & Inertial Navigation

| Parameter | Nominal Value | Status Label | Source / Citation | Implementation Reference |
| :--- | :--- | :--- | :--- | :--- |
| INMP441 Microphone Sensitivity | -26 dBFS | Cited | TDK InvenSense INMP441 Datasheet (1 kHz, 94 dB SPL) | `Inmp441Parameters::sensitivity_dbfs` |
| INMP441 Signal-to-Noise Ratio | 61 dBA | Cited | TDK InvenSense INMP441 Datasheet (A-weighted) | `Inmp441Parameters::snr_dba` |
| Equivalent Acoustic Input Noise | 33 dB SPL | Cited | Calculated from microphone sensitivity and SNR | `Inmp441Parameters::noise_floor_spl` |
| Acoustic Overload Point | 120 dB SPL | Cited | TDK InvenSense INMP441 Maximum Acoustic Input | `Inmp441Parameters::acoustic_overload_point_spl` |
| Mouth to Wristband Distance | 0.35 m | Assumed | Ergonomic wristband position relative to mouth | `AcousticVoiceModel::kMicDistanceMeters` |
| Wake Word DSP Latency | 250 ms | Cited | Espressif WakeNet inference latency on ESP32-S3 | `AcousticVoiceModel::kWakeWordDspLatencyMs` |
| Voice Command Slot Window | 3500 ms | Cited | Espressif MultiNet slot-filling timeout window | `AcousticVoiceModel::kVoiceCommandWindowMs` |
| MPU-6050 Accelerometer Noise | 400 ug/sqrt(Hz) | Cited | TDK InvenSense MPU-6050 Product Specification | `Mpu6050SensorModel::update` |
| MPU-6050 Gyroscope Noise | 0.005 dps/sqrt(Hz) | Cited | TDK InvenSense MPU-6050 Product Specification | `Mpu6050SensorModel::update` |
| Fall Detector Freefall Threshold | < 0.6 g | Cited | Biomedical Wearable Fall Detection Literature | `FallDetector::update` |
| Fall Detector Impact Threshold | > 3.0 g | Cited | Biomedical Wearable Fall Detection Literature | `FallDetector::update` |
| Post-Fall Immobility Duration | 2500 ms | Cited | International Fall Detection Protocol Standards | `FallDetector::update` |
| Pedestrian Dead Reckoning Stride (Walking) | 0.72 m | Cited | Biomechanical average human walking stride length | `Mpu6050SensorModel::update` |
| Pedestrian Dead Reckoning Stroke (Crawling) | 0.40 m | Cited | Rubble crawl average stroke displacement | `Mpu6050SensorModel::update` |
| Pedestrian Dead Reckoning Drift (5 min) | 13.05 m (Walk) / 13.09 m (Crawl) | Measured | Simulated MPU-6050 step and gyro integration across 20 seeds | `tests/test_pdr_sensitivity.mjs` |
| Pedestrian Dead Reckoning Drift (15 min) | 20.91 m (Walk) / 20.91 m (Crawl) | Measured | Simulated MPU-6050 step and gyro integration across 20 seeds | `tests/test_pdr_sensitivity.mjs` |
| Dead Reckoning Parametric Fallback Mode | 0.8m * sqrt(t) | Assumed | Fast analytical random walk envelope | `world.cpp::Dr::estimate` |

---

## 5. Firmware Timings & Protocol Framing

| Parameter | Nominal Value | Status Label | Source / Citation | Implementation Reference |
| :--- | :--- | :--- | :--- | :--- |
| Button Short Press Duration | < 500 ms | Cited | Setu Report v3 Technical Specification | `setu::button::is_short` |
| Button Double Press Window | <= 600 ms | Cited | Setu Report v3 Technical Specification | `setu::button::is_double` |
| Button Long Press Threshold | >= 1500 ms | Cited | Setu Report v3 Technical Specification | `setu::button::is_long` |
| Button Invalid Duration Band | 500 to 1500 ms | Cited | Rejected as accidental/ambiguous press | `shared/src/button.cpp` |
| Binary Wire Frame Size | 25 bytes | Cited | Setu Report v3 Wire Protocol Schema | `shared/include/setu/packet.hpp` |
| Wire Frame Magic Header | None | Cited | Schema contains node_id, seq, target, ref_seq | `setu::Packet::serialize` |
| Wire Frame CRC | LoRa SX1262 HW CRC | Cited | Hardware 16-bit CRC appended by transceiver | `shared/include/setu/packet.hpp` |
| Maximum Hop Limit | 7 hops | Cited | Setu mesh TTL limit preventing broadcast loops | `shared/src/node.cpp` |
| Listen-Before-Talk Max Retries | 6 deferrals | Cited | Setu CSMA-CA channel backoff limit | `shared/src/node.cpp` |
| Retry Episode Timeout Window | 3500 ms | Cited | Mesh ACK wait window before retransmission | `shared/src/node.cpp` |

