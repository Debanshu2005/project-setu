# Project Setu: ESP32-S3 Firmware Architecture & PlatformIO Guide

## 1. Executive Overview

**Project Setu** is an emergency SOS off-grid disaster rescue system featuring an **ESP32-S3** microcontroller, a **Semtech SX1262** LoRa radio transceiver, satellite GNSS positioning, an MPU-6050 dead-reckoning sensor, and non-volatile NVS flash sequence persistence.

The firmware is built using **PlatformIO with the ESP-IDF framework**, sharing a 100% portable C++ protocol core (`setu::Node`) across both the physical embedded device and the native host simulator (`setu_sim`).

---

## 2. Hardware Architecture & Pin Mapping

### Target Hardware Specification
- **SoC**: Espressif ESP32-S3-WROOM-1 / ESP32-S3-DevKitC-1-N8
- **Core Architecture**: Dual-core 32-bit Xtensa LX7 @ 240 MHz
- **Memory**: 512 KB SRAM, 8 MB Quad SPI Flash (DIO, 80 MHz)
- **Power Rail**: 3.3V LDO regulator powered from 1S LiPo (3.7V - 4.2V)
- **Partition Table**: Custom layout (`firmware/partitions.csv`):
  - `nvs`: 0x9000, 24 KB (Sequence number and config persistence)
  - `phy_init`: 0xF000, 4 KB
  - `factory`: 0x10000, 2 MB application image

### Verified Pin Assignment Matrix
All hardware pins are defined in `firmware/esp32s3/include/esp32_adapters.hpp` and `firmware/main/app_main.cpp`:

| Subsystem | Signal / Function | ESP32-S3 GPIO | Bus / Interface | Electrical Notes |
|:---|:---|:---|:---|:---|
| **SX1262 LoRa** | SPI NSS / CS | **GPIO 5** | SPI2 (FSPI) | Active LOW hardware chip select |
| **SX1262 LoRa** | SPI SCK | **GPIO 6** | SPI2 (FSPI) | Up to 10 MHz SPI clock |
| **SX1262 LoRa** | SPI MOSI | **GPIO 7** | SPI2 (FSPI) | Master Out Slave In |
| **SX1262 LoRa** | SPI MISO | **GPIO 8** | SPI2 (FSPI) | Master In Slave Out |
| **SX1262 LoRa** | DIO1 (IRQ) | **GPIO 4** | GPIO Interrupt | Rising edge interrupt on packet RX/TX done |
| **SX1262 LoRa** | NRESET | **GPIO 3** | Open Drain / Push-pull | Active LOW hardware reset pulse (150 µs) |
| **SX1262 LoRa** | BUSY | **GPIO 2** | Digital Input | High while internal state machine is busy |
| **NEO-6M GNSS** | UART TX | **GPIO 17** | UART1 | Connects to GNSS Module RX (9600 baud) |
| **NEO-6M GNSS** | UART RX | **GPIO 18** | UART1 | Connects to GNSS Module TX (9600 baud NMEA) |
| **MPU-6050 IMU** | I2C SDA | **GPIO 21** | I2C0 | 400 kHz fast mode, external 4.7kΩ pull-up to 3.3V |
| **MPU-6050 IMU** | I2C SCL | **GPIO 22** | I2C0 | 400 kHz fast mode, external 4.7kΩ pull-up to 3.3V |
| **Battery Monitor** | ADC Voltage Input | **GPIO 1** | ADC1_CH0 | 2:1 resistive divider (100kΩ / 100kΩ to LiPo cell) |
| **Panic Button** | Tactile Switch | **GPIO 0** | GPIO Interrupt | Active LOW with internal pull-up (`BOOT` button) |
| **Haptic Motor** | ERM Gate Drive | **GPIO 13** | Digital Out | N-channel logic MOSFET gate (2N7002 / AO3400) |
| **Status LED (Red)** | Alert / Fail Indicator | **GPIO 14** | Digital Out | Active HIGH, 330Ω current limiting resistor |
| **Status LED (Green)**| ACK / Healthy Indicator| **GPIO 15** | Digital Out | Active HIGH, 330Ω current limiting resistor |

---

## 3. PlatformIO Build, Flash & Monitor Instructions

### 3.1 PlatformIO Environment Setup
1. Ensure Python 3.10+ is installed.
2. Install PlatformIO Core:
   ```bash
   pip install --upgrade platformio
   ```
3. Inspect the environment definition in [`platformio.ini`](file:///platformio.ini):
   - **Environment**: `esp32-s3-devkitc-1`
   - **Platform**: `espressif32`
   - **Framework**: `espidf`
   - **Board**: `esp32-s3-devkitc-1`

### 3.2 Compilation Command
Run the PlatformIO target build from the repository root:
```bash
pio run -e esp32-s3-devkitc-1
```
*Expected Result:*
- Successful compilation of Xtensa target sources.
- Generated binaries in `.pio/build/esp32-s3-devkitc-1/`:
  - `firmware.bin` (~280 KB)
  - `bootloader.bin` (~21 KB)
  - `partitions.bin` (~3 KB)

### 3.3 Flashing to Physical Hardware
Connect your ESP32-S3 DevKit via USB and execute:
```bash
pio run -e esp32-s3-devkitc-1 -t upload
```
*Note for manual COM port specification:*
```bash
pio run -e esp32-s3-devkitc-1 -t upload --upload-port COM3
```

### 3.4 Serial Monitor
Open the serial terminal with automatic exception decoding:
```bash
pio device monitor -b 115200
```

---

## 4. FreeRTOS Multi-Tasking Architecture

The firmware utilizes ESP-IDF FreeRTOS across both Xtensa LX7 CPU cores:

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      ESP32-S3 FREERTOS ARCHITECTURE                    │
 ├────────────────────────────────────────────────────────────────────────┤
 │                                                                        │
 │  [Button Edge ISR] ──> xQueueSendFromISR(s_gpio_queue)                │
 │                             │                                          │
 │  [Core Task] <──────────────┘                                          │
 │   - Core Affinity: Core 0 (Priority 3, 4096 bytes stack)              │
 │   - 100 Hz Loop: node.on_button_edge(), node.tick()                   │
 │   - Dispatches outgoing transmissions via HAL IRadio                  │
 │                                                                        │
 │  [Radio Task]                                                          │
 │   - Core Affinity: Core 1 (Priority 4, 4096 bytes stack)              │
 │   - SX1262 DIO1 Interrupt -> xSemaphoreGiveFromISR(s_radio_sem)       │
 │   - Reads SPI FIFO -> node.on_radio_rx(buf, len)                      │
 │                                                                        │
 │  [Audio / Voice Task]                                                  │
 │   - Core Affinity: Core 1 (Priority 5, 8192 bytes stack)              │
 │   - I2S DMA Ring Buffer -> ESP-SR WakeNet ("Setu")                    │
 │   - MultiNet Intent Recognition -> node.on_wake_word()                │
 │                                                                        │
 └────────────────────────────────────────────────────────────────────────┘
```

### Concurrency & ISR Safety
- **Interrupts**: Both GPIO 0 (Button) and GPIO 4 (SX1262 DIO1) execute minimal ISR handlers that dispatch events to FreeRTOS queues/semaphores using `FromISR` variants.
- **Mutual Exclusion**: `setu::Node` protocol state is owned exclusively by the Core Task. Inbound radio packets from the Radio Task are handed off via synchronized buffer copies, preventing race conditions or corrupted duplicate-detection windows.

---

## 5. Hardware Adapters & Driver Implementations

### 5.1 Semtech SX1262 LoRa Driver (`Sx1262Radio`)
- **SPI Transactions**: Uses ESP-IDF SPI master bus with hardware NSS and polling/DMA transfers.
- **State Machine**: Sequences `SetStandby(STDBY_RC)`, `SetPacketType(LORA)`, `SetRfFrequency()`, `SetTxParams()`, and `SetBufferBaseAddress()`.
- **Packet Validation**: Rejects packets failing hardware CRC. Reads RSSI (`-(raw / 2)`) and SNR (`raw / 4`).
- **Half-Duplex Guard**: Automatically returns to continuous RX mode after completing any TX transaction.

### 5.2 Satellite GNSS Driver (`Neo6mGnss`)
- **UART Interface**: UART1 at 9600 baud 8N1 with 1024-byte ring buffer.
- **NMEA Parser**: Parses `$GPRMC` and `$GPGGA` sentences with strict XOR checksum validation.
- **Conversion**: Converts `ddmm.mmmm` to signed integer microdegrees ($10^{-6}$ degrees).
- **Stale Fix Timeout**: If no valid 3D fix is received within 10,000 ms, `has_fix()` transitions to `false` and invalidates the location status, triggering fallback to dead-reckoning.

### 5.3 Dead-Reckoning IMU (`Mpu6050DeadReckoning`)
- **I2C Bus**: I2C0 at 400 kHz with external pull-ups.
- **Identity Check**: Queries register `0x75 (WHO_AM_I)` expecting `0x68`.
- **Anchor Mechanism**: Caches the last known valid satellite fix. When GNSS is lost, step impulses ($> 1.25g$) displace the anchor along the current compass heading.
- **Confidence Decay**: If no movement occurs or after 5 minutes of dead-reckoning, `has_estimate_` expires, preventing unbounded drift error.

### 5.4 LiPo Battery Monitor (`BatteryMonitor`)
- **ADC Calibration**: Uses ESP-IDF `adc_oneshot` driver on `ADC_UNIT_1`, `ADC_CHANNEL_0` (GPIO 1) with `ADC_ATTEN_DB_12`.
- **Divider Scale**: 2:1 resistive divider (100kΩ / 100kΩ) maps 3.3V–4.2V battery voltage into the 0–2.1V ADC linear zone.
- **Discharge Curve**: Multi-point piecewise linear curve (4200mV = 100%, 3900mV = 75%, 3800mV = 50%, 3650mV = 25%, 3300mV = 0%).

### 5.5 Persistent Sequence Storage (`Esp32SequenceStore`)
- **NVS Namespace**: `setu_nvs` with key `seq_counter`.
- **Block Allocation**: To protect flash memory from write fatigue during rapid emergency button presses, the counter is reserved in blocks of 100. Upon boot, the counter jumps forward to the next reserved block, guaranteeing strict monotonic sequence numbers across power cuts and reboots without writing to flash on every packet.

---

## 6. Testing, CI/CD & Verification

### Test Matrix
1. **Unit Tests (Host Native)**:
   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/build_windows.ps1
   powershell -ExecutionPolicy Bypass -File scripts/test_windows.ps1
   ```
   *Status*: **52/52 PASSED**. Covers wire serialization (25 bytes), deduplication, backoff, battery curve, GNSS parsing, and DR math.
2. **Integration Tests (Mesh Network)**:
   *Status*: **13/13 PASSED**. Covers multi-hop relay forwarding, duplicate drop, and ACK round-trips.
3. **Backend & Dashboard Verification**:
   *Status*: **112/112 PASSED**. Covers REST APIs, WebSocket streaming, Vercel config, and Render deployment contracts.
4. **PlatformIO Target Compilation**:
   ```bash
   pio run -e esp32-s3-devkitc-1
   ```
   *Status*: **PASSED**. Compiles with Xtensa GCC into deployable `.bin` files.

---

## 7. Laboratory Bench-Test Readiness

For detailed step-by-step physical hardware validation, refer to:
- [`docs/BENCH_TEST_PLAN.md`](file:///docs/BENCH_TEST_PLAN.md)
- [`docs/HARDWARE_MATRIX.md`](file:///docs/HARDWARE_MATRIX.md)
