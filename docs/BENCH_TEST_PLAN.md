# Project Setu — Physical Hardware Bench-Test & Validation Procedure

This document specifies the authoritative, step-by-step physical laboratory test procedure for commissioning, verifying, and validating the **Project Setu ESP32-S3 Disaster Rescue Wristband** once physical PCBA boards and peripherals arrive.

---

## 1. Hardware Identification & Pre-Power Verification

### 1.1 Microcontroller Target Identification
- **Target Microcontroller**: Espressif ESP32-S3-WROOM-1 / ESP32-S3-DevKitC-1
- **Silicon Architecture**: Dual-core 32-bit Xtensa LX7 @ 240 MHz, 512 KB SRAM, 8 MB Flash
- **RF Subsystem**: Semtech SX1262 LoRa Transceiver (SPI) + Antenna matching network

### 1.2 Unpowered Continuity & Schematic Check
Before connecting any battery or USB-C power source:
1. Verify resistance between `3V3` and `GND` using a Digital Multimeter (DMM) in resistance mode. Resistance must be $> 10\,\text{k}\Omega$. If $< 100\,\Omega$, inspect for solder bridging or tantalum capacitor short.
2. Verify continuity of all peripheral buses:
   - **SPI Bus**: GPIO 5 (NSS/CS), GPIO 6 (SCK), GPIO 7 (MOSI), GPIO 8 (MISO).
   - **Radio Control**: GPIO 4 (DIO1), GPIO 3 (NRESET), GPIO 2 (BUSY).
   - **UART Bus**: GPIO 17 (TX to GNSS RX), GPIO 18 (RX from GNSS TX).
   - **I2C Bus**: GPIO 21 (SDA), GPIO 22 (SCL) with external 4.7kΩ pull-up resistors to 3.3V.
   - **Analog Input**: GPIO 1 (ADC1_CH0) connected to center tap of 100kΩ/100kΩ divider.
   - **Inputs/Outputs**: GPIO 0 (BOOT Switch), GPIO 13 (Haptic Gate), GPIO 14 (Red LED), GPIO 15 (Green LED).
3. Verify that the LoRa IPEX/U.FL connector is firmly attached and an appropriate 868/915 MHz whip antenna is connected. **NEVER transmit on an SX1262 without an antenna connected; doing so damages the RF output stage.**

---

## 2. Power Supply, Regulator, and Brownout Validation

### 2.1 Voltage Rail Checks
1. Supply 4.0V DC from a precision bench power supply with current limiting set to 250 mA.
2. Measure 3.3V LDO regulator output on test pad `TP_3V3`. Voltage must read $3.30\text{V} \pm 0.05\text{V}$.
3. Verify quiescent sleep current: with ESP32-S3 in deep sleep and peripherals powered down, current should drop below $50\,\mu\text{A}$.
4. Test brownout threshold: lower supply voltage slowly from 3.7V down to 3.0V. Verify ESP32 brownout detector trips cleanly at $\sim 2.8\text{V}$ without flash memory corruption.

### 2.2 Battery Resistor Divider & ADC Calibration
1. Set bench supply to exactly 4.200V, 3.800V, 3.600V, and 3.300V.
2. At each point, measure voltage on GPIO 1 with DMM (should be exactly $V_{\text{batt}} / 2$).
3. Compare ADC reading from `s_battery.percent()` and `s_battery.raw_millivolts()`.
4. Calibrate the divider scale factor in firmware if resistor tolerances cause $> 2\%$ variance.

---

## 3. Peripheral-Level Validation Procedures

### 3.1 Button Debounce & Hold Classification
1. Connect oscilloscope to GPIO 0.
2. Perform a Short Press ($< 500\text{ms}$): Verify single click registered, `HapticPattern::TierShort` triggered, and `originate()` dispatched.
3. Perform a Double Click ($< 400\text{ms}$ gap): Verify `HapticPattern::TierDouble` triggered and Medical emergency hazard code transmitted.
4. Perform a Long Press ($> 1500\text{ms}$): Verify `HapticPattern::TierLong` fires while button is held down, Trapped hazard code transmitted.
5. Perform an invalid intermediate press (e.g. 800ms): Verify rejection feedback (`HapticPattern::Reject`).

### 3.2 Haptic Motor & Dual LED Testing
1. Execute `s_haptics.play(HapticPattern::PressRegistered)`: Observe single 30ms gate pulse on GPIO 13.
2. Execute `s_haptics.play(HapticPattern::AckReceived)`: Observe 3x 150ms vibration pulses and 3x Green LED flashes on GPIO 15.
3. Execute `s_haptics.play(HapticPattern::SendFailed)`: Observe 3x 250ms buzzes and solid Red LED illumination on GPIO 14.

### 3.3 GNSS UART Acquisition & Clock Discipline
1. Connect active GNSS antenna with clear sky view.
2. Monitor UART1 serial stream at 9600 baud.
3. Verify `$GPRMC` and `$GPGGA` sentences stream continuously without checksum errors.
4. Verify Cold-Start Time-To-First-Fix (TTFF) is recorded (typically 27–35 seconds).
5. Verify valid 3D fix transitions `has_fix_` to `true`, and latitude/longitude microdegrees match true bench coordinates.
6. Verify UTC date/time in RMC disciplines `Esp32Clock::discipline_unix_time()`.
7. Disconnect antenna inside RF shield box: Verify `has_fix_` transitions to `false` within 10 seconds (stale fix timeout).

### 3.4 MPU-6050 IMU Communication & Dead Reckoning
1. Verify I2C `WHO_AM_I` register reads `0x68`.
2. Anchor last GNSS position via `dr.anchor_last_gnss(lat, lon)`.
3. Simulate human wrist motion / stride impulses: observe peak acceleration magnitude $> 1.25g$ increments step counter.
4. Verify geodesic displacement moves estimated coordinates proportionally.
5. Inactive drift test: leave device stationary for 5 minutes. Verify dead-reckoned confidence expires (`has_estimate_` transitions to `false`).

### 3.5 SX1262 LoRa Radio RF & SPI Validation
1. Verify NRESET pulse toggles GPIO 3 LOW for $150\,\mu\text{s}$ and BUSY pin (GPIO 2) returns LOW within $1\,\text{ms}$.
2. Read SX1262 status via SPI: verify `SetStandby(STDBY_RC)` returns valid status byte `0x02`.
3. Configure frequency: 868.100 MHz (Europe) or 915.000 MHz (US), SF7, BW 125 kHz, CR 4/5, Power +14 dBm.
4. Transmit 25-byte Setu SOS packet:
   - Monitor RF output on spectrum analyzer: verify center frequency, 125 kHz bandwidth lobe, and TX power level.
   - Verify DIO1 (GPIO 4) asserts rising edge upon `TxDone`.
   - Verify radio immediately returns to continuous RX mode.

---

## 4. Multi-Node Integration & Fault Injection Testing

### 4.1 Two-Node Over-The-Air Transmission & ACK
1. Device A (Survivor) and Device B (Rescue Hub) separated by 50 meters line-of-sight.
2. Trigger Short Press on Device A:
   - Device A transmits 25-byte SOS (`node_id=1, hazard=General, target=0xFFFF`).
   - Device B receives packet: verifies CRC, extracts payload, fires `on_alert()`.
   - Device B transmits 25-byte ACK (`target=1, ref_seq=1, flags=kFlagAck`).
   - Device A receives ACK: terminates retry timer, emits `HapticPattern::AckReceived`.
3. Measure round-trip latency over the air (expected $\sim 120 - 180\,\text{ms}$).

### 4.2 Multi-Node Relay Flooding
1. Place Survivor node, 2 Relay nodes, and 1 Rescue Hub in a linear chain ($S \to R_1 \to R_2 \to H$).
2. Trigger SOS on Survivor:
   - Verify $R_1$ receives, increments hop counter to 1, waits random backoff, and rebroadcasts.
   - Verify $R_2$ receives from $R_1$, increments hop to 2, and rebroadcasts.
   - Verify duplicate suppression: $R_1$ does not rebroadcast $R_2$'s transmission of the same packet key.
   - Verify Hub receives packet with hop=2, originate ACK, and ACK reaches Survivor back through relays.

### 4.3 Fault Injection Matrix
- **Radio Disconnect Fault**: Disconnect SX1262 CS pin during transmit. Verify firmware detects SPI timeout, recovers radio, and does not hang FreeRTOS task.
- **Lost ACK / Retransmission**: Place Hub in RF shield box. Verify Survivor attempts 3 retries with exponential backoff, and transitions to `gave_up_` with `HapticPattern::SendFailed`.
- **Reboot Sequence Test**: Power cycle Survivor device after sending SOS. Verify persistent sequence ID in NVS is advanced by 100, preventing duplicate suppression collision on the mesh.

---

## 5. Master Hardware Readiness & Execution Matrix

| Subsystem / Test Item | Validation Method | Current Software / Host State | Physical Hardware Bench Status | Remarks |
|---|---|---|---|---|
| **FreeRTOS Queues & ISR Dispatch** | Host Mock & FITL Tests | **PASSED (52/52 Tests)** | **NOT TESTED** | Requires physical ESP32-S3 flashing |
| **NVS Sequence Persistence** | Unit Tested & Host Verified | **PASSED** | **NOT TESTED** | Verified logic; pending physical flash write |
| **SX1262 SPI Driver & State Machine** | Host Unit Tested & Simulated | **PASSED** | **NOT TESTED** | Pending physical SPI bus transactions |
| **SX1262 RF Over-the-Air Transmission**| Native World RF Simulator | **SIMULATED** | **NOT TESTED** | Physical radio breakout pending |
| **NEO-6M NMEA Checksum & Parser** | Strict Unit Tested | **PASSED** | **NOT TESTED** | Pending outdoor antenna GPS fix |
| **MPU-6050 Dead-Reckoning IMU** | Flat-Earth Geodesic Tested | **PASSED** | **NOT TESTED** | Pending physical I2C sensor reading |
| **Battery ADC Non-Linear Curve** | Unit Tested Model | **PASSED** | **NOT TESTED** | Pending DMM resistor divider calibration |
| **Haptic ERM & Dual LED Driver** | Host Verified State Machine | **PASSED** | **NOT TESTED** | Pending physical MOSFET gate drive |
| **Dual-Node Over-the-Air SOS/ACK** | World Mesh Integration Tests | **PASSED (13/13 Tests)** | **NOT TESTED** | Requires 2 physical hardware prototypes |
