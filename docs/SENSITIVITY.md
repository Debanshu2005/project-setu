# Project Setu: Global Sensitivity Analysis & Parameter Importance Report

This document reports the global sensitivity analysis conducted across the Project Setu simulator parameter space. It identifies which assumed and cited physical parameters have the greatest impact on packet delivery ratio, alert delivery latency, and battery lifetime.

This analysis provides engineering guidance on which parameters require physical field calibration first.

---

## 1. Sensitivity Sweep Methodology

A multi-factor factorial sweep was executed using the native simulation engine (`--sensitivity-sweep`) across disaster scenarios. The analysis varied:
1. **Path Loss Exponent ($n$):** Varied from 2.5 (semi-open suburban) to 4.2 (severe concrete structural collapse).
2. **Spreading Factor (SF):** Evaluated across SF7 (fast airtime, 125 kHz), SF9 (medium robustness), and SF10 (high sensitivity).
3. **Transmit Output Power ($P_{\text{tx}}$):** Evaluated from +14 dBm (standard European SRD limit) to +22 dBm (SX1262 maximum PA output).
4. **Always-On Voice DSP:** Evaluated with continuous WakeNet listening enabled (65 mA) versus disabled.
5. **Human Torso Shadowing:** Evaluated with 0 dB (line of sight), 6 dB (glancing), and 15 dB (body obstruction).
6. **Ambient Acoustic Noise:** Swept from 45 dB SPL (quiet shelter) to 92 dB SPL (heavy concrete saws and rubble collapse rumble).

---

## 2. Parameter Importance Ranking

| Rank | Parameter / Factor | Nominal Status | Primary Impact Metric | Sensitivity Magnitude | Physical Engineering Consequence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Path Loss Exponent ($n$)** | Cited / Scenario | Packet Delivery Ratio & Latency | **High (Critical)** | Increasing $n$ from 2.8 to 4.0 drops mesh delivery from 100% to 54% and increases median latency by 320%. Demands dense relay placement in structural collapses. |
| **2** | **Always-On Voice DSP Current** | Cited (65 mA) | Fleet Battery Lifetime | **High (Critical)** | Continuous WakeNet listening drains a 1000 mAh cell in 13.1 hours, compared to 90.1 hours in button-only mode. Recommend voice duty-cycling or push-to-talk. |
| **3** | **Spreading Factor (SF)** | Cited (SF7 to SF12) | Sensitivity vs Airtime Contention | **High** | SF9 provides +5.5 dB link margin over SF7, enabling concrete slab penetration. However, SF10 quadruples airtime, multiplying collision drops by 2.8x during simultaneous bursts. |
| **4** | **Transmit Power ($P_{\text{tx}}$)** | Measured (+14 / +22 dBm) | Link Margin vs Peak Current | **Medium** | Boosting to +22 dBm adds +8 dB margin, cutting required relay hops in half, but increases transmit current from 45 mA to 118 mA. |
| **5** | **Concrete Slab Attenuation** | Cited (22 dB / slab) | Subterranean Penetration | **Medium** | Links passing through 2 slabs suffer 44 dB attenuation. At $n=3.8$, this severs direct links beyond 45 meters, making relay stairwell deployment mandatory. |
| **6** | **Torso Shadowing** | Cited (15 dB rear) | Single-Hop Reliability | **Medium** | Wearer orientation facing away from a relay introduces a 15 dB notch, intermittently dropping packets until user motion restores line of sight. |
| **7** | **Ambient Acoustic Noise** | Scenario (40 to 92 dB) | Voice SOS Trigger Probability | **Medium** | Noise exceeding 85 dB SPL degrades voice SNR below 2 dB, causing the INMP441 sigmoid detector to reject voice commands. Button backup is critical. |
| **8** | **Inertial Dead Reckoning Drift** | Assumed ($0.8\sqrt{t}$ m) | Localization Accuracy | **Low** | Position uncertainty grows to 24 meters after 15 minutes of subterranean transit. Does not affect mesh packet delivery. |

---

## 3. Detailed Parameter Sweep Observations

### 3.1 Path Loss Exponent Sweeps ($n = 2.5 \to 4.2$)
* At $n \le 3.0$: Mesh delivery ratio is $100\%$ across a 1000m zone with 5 relays. Hops to rescue hub average 1.8 hops.
* At $n = 3.5$: Mesh delivery remains robust ($96\%$) due to relay flooding, but average hops increase to 3.2.
* At $n \ge 3.8$: Without line of sight relays along perimeter openings, deep subterranean survivor packets drop below the -128.5 dBm receiver sensitivity.

### 3.2 Energy Budget Breakdown
* **Standby Base (MCU + continuous LoRa RX):** 11.1 mA $\implies$ 90.1 hours operation on a 1000 mAh LiPo.
* **Standby with Always-On WakeNet DSP:** $11.1 + 65.0 = 76.1$ mA $\implies$ 13.1 hours operation.
* **Active Periodic Retransmission (1 packet every 3.5s at SF9):** Adds $0.58$ mA average $\implies$ negligible lifetime degradation compared to standby base.
* **Conclusion for Hardware Team:** Continuous voice DSP is the dominant energy drain. Implementing voice activity detection (VAD) or acoustic threshold wakeups will extend device life by $6\times$.

### 3.3 Acoustic Voice Detection under Disaster Noise
* In quiet ambient conditions ($45\text{ dB SPL}$): Voice commands at $0.35\text{ m}$ achieve $+35\text{ dB SNR} \implies 99.8\%$ detection probability.
* Under heavy machinery / rubble clearing ($88\text{ dB SPL}$): Shouted voice ($94\text{ dB SPL}$ at mic) yields $+6\text{ dB SNR} \implies 45\%$ detection probability.
* Under structural collapse roar ($92\text{ dB SPL}$): Voice commands fall below $+2\text{ dB SNR} \implies <15\%$ detection probability.
* **Conclusion for Operations Team:** Responders must be trained that physical button triggers are required during loud heavy-equipment operation.

---

## 4. Priority Recommendation for Physical Measurement

Based on variance contribution to operational mission success, the following parameters should be prioritized for physical field calibration:

1. **Concrete rubble path loss exponent ($n$):** Conduct empirical RSSI distance sweeps inside a reinforced concrete demolition site to fit $n$ accurately.
2. **ESP32-S3 Voice DSP power optimization:** Measure actual power consumption of WakeNet under duty-cycled acoustic interrupt modes.
3. **Wristband antenna detuning against human wrist:** Measure SX1262 radiated efficiency (TRP) while worn on human arm versus free space.
