# Project Setu: ESP32-S3 Firmware & Hardware Readiness Guide

## 1. ESP32-S3 Hardware Target

Project Setu is designed for the Espressif ESP32-S3 dual-core Xtensa microcontroller with 2.4GHz Wi-Fi/Bluetooth LE (disabled in disaster mode to preserve power).

### Peripheral Pinout & Interface Mapping
| Component | Module | Interface | ESP32-S3 Pins | Function | Status |
|-----------|--------|-----------|---------------|----------|--------|
| **LoRa Radio** | Semtech SX1262 | SPI | MOSI: 11, MISO: 13, SCK: 12, CS: 5, DIO1: 4, BUSY: 2, RST: 3 | Long-range 868/915 MHz RF packet exchange | Hardware driver adapter ready (`Sx1262Radio`) |
| **Microphone** | INMP441 | I2S | BCLK: 41, WS: 42, DATA: 2 | Digital audio capture for ESP-SR WakeNet / MultiNet | Architecture & task pipeline ready |
| **GPS / GNSS** | NEO-6M / ATGM336H | UART | TX: 17, RX: 18 (9600 baud) | 3D latitude/longitude fix & UTC time | Driver adapter ready (`Neo6mGnss`) |
| **IMU** | MPU-6050 | I2C | SDA: 21, SCL: 22 (400 kHz) | Accelerometer/gyroscope dead-reckoning fallback | Driver adapter ready (`Mpu6050DeadReckoning`) |
| **Panic Button** | Tactile Switch | GPIO | GPIO 0 (Interrupt both edges) | Debounced Short / Double / Long press input | Pure C++ classifier implemented & verified |
| **Haptic Motor** | ERM Vibration | GPIO PWM | GPIO 13 | Tactical tactile feedback patterns | Driver adapter ready (`HapticLedDriver`) |
| **Status LEDs** | Dual Green/Red | GPIO | Red: 14, Green: 15 | Visual alert confirm and battery warning | Driver adapter ready (`HapticLedDriver`) |
| **Battery Fuel**| LiPo Resistor Div | ADC1 | GPIO 1 (ADC1_CH0) | Battery voltage measurement (100% - 0%) | Driver adapter ready (`BatteryMonitor`) |

---

## 2. Firmware Tasks & FreeRTOS Architecture

```text
 ┌────────────────────────────────────────────────────────┐
 │                   ESP32-S3 FREERTOS                    │
 ├────────────────────────────────────────────────────────┤
 │                                                        │
 │ [Button ISR]   ──> xQueueSend(gpio_evt_queue)          │
 │                                │                       │
 │ [Core Task]    <───────────────┘                       │
 │  (100 Hz Tick) ──> node.on_button_edge()               │
 │                ──> node.tick()                         │
 │                                                        │
 │ [Audio Task]   ──> I2S DMA -> WakeNet ("Setu")        │
 │  (Priority 5)  ──> MultiNet slot-fill                  │
 │                ──> node.on_wake_word()                 │
 │                ──> node.on_voice_command(contact, hz)  │
 │                                                        │
 │ [Radio Task]   ──> SX1262 DIO1 IRQ                     │
 │  (Priority 4)  ──> SPI Read FIFO                       │
 │                ──> node.on_radio_rx(buf, len)          │
 │                                                        │
 └────────────────────────────────────────────────────────┘
```

---

## 3. Host-Side Verification & Test Vectors

To prevent software issues when physical boards arrive:
1. **Zero Padding Guarantee**: The wire protocol is strictly 25 bytes.
2. **Mock HAL Harness**: `firmware/esp32s3/include/host_mocks.hpp` provides complete simulated hardware interfaces for tests without ESP-IDF dependencies.
3. **Automated Unit Testing**: `tests/unit/test_firmware_mocks.cpp` tests the exact binary serialization, GNSS-to-DR location fallback pipeline, and disciplined clocks.

All 39 unit tests and 13 integration tests compile and run natively on host systems.
