# Project Setu — Hardware Readiness & Driver Implementation Matrix

This document provides a transparent engineering audit of **Project Setu's embedded hardware readiness**, pin assignments, driver implementation statuses, and testing blockers for the target **ESP32-S3 disaster rescue wristband**.

---

## 1. Executive Hardware Readiness Summary

| Subsystem | Target Hardware | Interface | Implementation Status | Validation Level | Blockers / Next Steps |
|---|---|---|---|---|---|
| **Portable Protocol Core** | Reusable C++20 | `setu::Node` | **100% COMPLETE** | Authoritative Native Tests Passed (52/52) | None. Ready for target compilation. |
| **Monotonic Clock** | ESP32-S3 Hardware Timer | `esp_timer_get_time()` | **COMPLETE** | Unit Tested with GNSS discipline hooks | Target ESP32 hardware flash required. |
| **True Random Number Generator** | ESP32 Hardware RF Noise RNG | `esp_random()` | **COMPLETE** | Verified via host mock & ESP32 driver | Target ESP32 hardware flash required. |
| **LoRa Radio Transceiver** | Semtech SX1262 (SPI) | SPI DMA + DIO1 IRQ | **ADAPTER READY / DRIVER IN PROGRESS** | Channel model simulated in C++ | Physical SPI wiring to SX1262 breakout required. |
| **Satellite Positioning** | u-blox NEO-6M / ATGM336H | UART (9600 baud NMEA) | **PARSER IMPLEMENTED** | Unit tested NMEA $GPRMC parser | Antenna clear-sky lock needed for physical fix. |
| **Dead-Reckoning IMU** | InvenSense MPU-6050 6-DOF | I2C (400 kHz) | **ESTIMATOR IMPLEMENTED** | Flat-earth geodesic displacement tested | Physical I2C sensor reading & gyro calibration. |
| **Battery Monitor** | 1S LiPo (3.7V - 4.2V) | ADC1 Resistor Divider (2:1) | **CURVE IMPLEMENTED** | Non-linear discharge model verified | Resistor divider ratio calibration against DMM. |
| **Haptic Motor & LEDs** | ERM Vibration Motor + LEDs | GPIO MOSFET Gates | **ADAPTER IMPLEMENTED** | Pattern enum mapped to pulse timings | Physical transistor gate testing. |
| **FreeRTOS Multi-tasking** | Dual-core Xtensa LX7 | Tasks, Queues, ISRs | **ARCHITECTURE IMPLEMENTED** | Host-stubbed; `app_main.cpp` structured | ESP-IDF toolchain build on physical dev board. |

---

## 2. Target Board Pinout & Wiring Specification

All pin assignments are mapped in `firmware/esp32s3/include/esp32_adapters.hpp` and `firmware/main/app_main.cpp`:

| Peripheral | Signal | ESP32-S3 GPIO | Notes / Electrical Requirements |
|---|---|---|---|
| **SX1262 LoRa** | SPI NSS / CS | **GPIO 5** | Active LOW hardware chip select |
| **SX1262 LoRa** | SPI SCK | **GPIO 6** | Up to 10 MHz SPI clock |
| **SX1262 LoRa** | SPI MOSI | **GPIO 7** | Master Out Slave In |
| **SX1262 LoRa** | SPI MISO | **GPIO 8** | Master In Slave Out |
| **SX1262 LoRa** | DIO1 (IRQ) | **GPIO 4** | Rising edge interrupt on packet RX/TX done |
| **SX1262 LoRa** | NRESET | **GPIO 3** | Active LOW radio hardware reset |
| **SX1262 LoRa** | BUSY | **GPIO 2** | High when radio internal state machine is busy |
| **NEO-6M GNSS** | UART TX | **GPIO 17** | ESP32 RX <- GPS TX (9600 baud NMEA) |
| **NEO-6M GNSS** | UART RX | **GPIO 18** | ESP32 TX -> GPS RX |
| **MPU-6050 IMU** | I2C SDA | **GPIO 21** | 4.7kΩ pull-up to 3.3V |
| **MPU-6050 IMU** | I2C SCL | **GPIO 22** | 4.7kΩ pull-up to 3.3V |
| **LiPo Battery** | ADC Input | **GPIO 1 (ADC1_CH0)** | 2:1 resistive divider (100kΩ / 100kΩ, 0-2.1V ADC range) |
| **Emergency Button** | Push Button | **GPIO 0 (BOOT / SW1)** | Active LOW with internal pull-up and dual-edge ISR |
| **Haptic ERM Motor** | Gate Drive | **GPIO 13** | N-channel logic level MOSFET gate (e.g. 2N7002 / AO3400) |
| **Status LED (Red)** | Red Cathode | **GPIO 14** | Current-limiting resistor (330Ω) |
| **Status LED (Green)**| Green Cathode | **GPIO 15** | Current-limiting resistor (330Ω) |

---

## 3. Detailed Component Audit

### 3.1 LoRa Transceiver (Semtech SX1262)
- **Completed**:
  - Hal `IRadio` interface definition in `shared/include/setu/hal.hpp`.
  - Authoritative C++ log-distance path loss, shadowing, fading, sensitivity, and collision capture model in `simulation/native/channel.cpp`.
  - Half-duplex collision handling verified in native integration tests.
  - SPI pin definitions and packet buffer layout ready.
- **Pending / Blocker**:
  - Compiling against the vendor-specific RadioLib or SX1262 driver requires an ESP-IDF toolchain (`idf.py build`).
  - Listen-Before-Talk (LBT) using Channel Activity Detection (CAD) requires physical RF testing on real hardware to tune the threshold against local 868/915 MHz noise floors.

### 3.2 GNSS Satellite Receiver (NEO-6M)
- **Completed**:
  - NMEA `$GPRMC` sentence parser converting ddmm.mmmm to signed integer microdegrees (`lat_e6`, `lon_e6`).
  - Active/Void validity check (`'A'` vs `'V'`).
  - Coordinate range sanity bounds ($[-90^\circ, +90^\circ]$ lat, $[-180^\circ, +180^\circ]$ lon).
- **Pending / Blocker**:
  - GPS antenna reception requires outdoor clear-sky conditions to acquire the initial ephemeris almanac (Cold Start ~27s).
  - Power management (putting the GNSS into cyclic power-save mode) is pending physical battery current profiling.

### 3.3 Dead-Reckoning (MPU-6050)
- **Completed**:
  - Step detection integration and geodesic displacement math in microdegrees.
  - Automatic anchoring to last valid GNSS position before satellite fix loss.
  - GPS flag clearing and DR flag setting in 25-byte wire packet flags byte.
- **Pending / Blocker**:
  - Accelerometer peak thresholding for step detection needs calibration against human wrist motion.
  - Gyroscope zero-rate bias drift integration requires complementary or Madgwick filter tuning on actual silicon.

### 3.4 LiPo Battery Monitor
- **Completed**:
  - Non-linear LiPo discharge table mapping ADC millivolts to percentage (4200mV = 100%, 3800mV = 50%, 3300mV = 0%).
  - Range validation preventing wire packet battery overflows ($[0, 100]\%$).
- **Pending / Blocker**:
  - ADC two-point calibration using ESP32 factory eFuse Vref values (`esp_adc_cal`).

---

## 4. Verification Policy & Honest Claims
- **We DO claim**: The shared protocol core (`setu::Node`), packet wire format (25-byte), duplicate suppression, ACK verification, backoff, and radio propagation models are fully implemented, authoritative, and passing 52 automated tests.
- **We DO NOT claim**: Physical radio range over real disaster rubble has been experimentally measured or that the physical ESP32 device has been flashed, until physical hardware arrives and bench testing is performed.
