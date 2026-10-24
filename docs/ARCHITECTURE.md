# Project Setu: System Architecture & Wire Protocol Specification

## 1. System Overview

Project Setu is an off-grid, phone-free emergency communication wristband and disaster-response mesh network. It operates without cellular networks or internet infrastructure, using multi-hop LoRa packet flooding to deliver SOS alerts from survivors to mobile rescue hubs.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          PROJECT SETU SYSTEM                           │
└────────────────────────────────────────────────────────────────────────┘

 [ Survivor Wristband ]             [ Relay Tower / Node ]             [ Rescue Hub ]
 ┌────────────────────┐             ┌────────────────────┐             ┌────────────┐
 │  Panic Button      │             │  Solar / LiFePO4   │             │ Mobile Ops │
 │  INMP441 Mic (SR)  │             │  SX1262 LoRa SPI   │             │ Dashboard  │
 │  NEO-6M GPS (UART) │             │  Relay Core        │             │ SX1262 Rx  │
 │  MPU6050 IMU (I2C) │             │  Hop Enforcement   │             │ Visualizer │
 │  SX1262 LoRa (SPI) │───[LoRa]───>│  Relay Suppress    │───[LoRa]───>│ Hub Core   │
 │  Haptic & LED      │<───[ACK]────│  Duty-Cycle Budget │<───[ACK]────│ Return ACK │
 └────────────────────┘             └────────────────────┘             └────────────┘
```

---

## 2. 25-Byte Binary Little-Endian Wire Layout

To ensure zero alignment padding differences across host (x86_64) and ESP32-S3 (Xtensa/RISC-V) compilers, Setu mandates an explicit 25-byte packed wire frame:

```text
 Byte Offset    Field Name      Size (Bytes)   Data Type       Description
 ─────────────────────────────────────────────────────────────────────────────────────────
  0 .. 1        node_id         2              uint16_t (LE)   Originator Node ID (for ACK: Hub ID)
  2 .. 3        seq             2              uint16_t (LE)   Monotonic Sequence ID
  4 .. 5        target          2              uint16_t (LE)   Target ID (0xFFFF for SOS, Node ID for ACK)
  6 .. 7        ref_seq         2              uint16_t (LE)   Reference Seq being acknowledged
  8             hazard          1              uint8_t         0: General, 1: Medical, 2: Trapped
  9             flags           1              uint8_t         bit0: GNSS, bit1: ACK, bit2: DR Fallback
 10 .. 13       lat_e6          4              int32_t (LE)    Latitude (degrees * 1e6, signed)
 14 .. 17       lon_e6          4              int32_t (LE)    Longitude (degrees * 1e6, signed)
 18 .. 21       ts              4              uint32_t (LE)   Unix epoch seconds
 22             battery         1              uint8_t         Battery remaining (0 - 100 %)
 23             hop             1              uint8_t         Hop counter (incremented per relay)
 24             contact         1              uint8_t         Optional vocabulary contact ID (0 = none)
 ─────────────────────────────────────────────────────────────────────────────────────────
 Total Payload Length: 25 Bytes (200 bits)
```

---

## 3. Protocol Rules & State Transitions

1. **SOS Triggering & Classification**:
   - Short Button Press (< 500 ms): General SOS (`hazard = 0`).
   - Double Button Press (two short presses within 600 ms gap): Medical Emergency (`hazard = 1`).
   - Long Button Press (held $\ge$ 1500 ms): Trapped or Structural Collapse (`hazard = 2`).
   - Wake-Word ("Setu") without command: General SOS fallback (`hazard = 0`).
   - Wake-Word + Voice Command: Classified alert with registered contact (`contact > 0`).

2. **Multi-Hop Flooding & Duplicate Suppression**:
   - Every node maintains a deduplication ring cache (`DedupCache`, capacity 64).
   - Identity key: `(node_id, seq, is_ack)`.
   - Repeated sightings increment the sighting counter. Packets seen $> 1$ time are immediately dropped.

3. **Relay Suppression & Density Throttling**:
   - Before retransmitting, relay nodes schedule a randomized jitter backoff.
   - If a relay overhears the same packet $\ge 3$ times (`suppress_after`) from neighbours before its backoff expires, it cancels transmission.

4. **Hop Limit & Packet Expiry**:
   - Relays drop packets exceeding `max_hops` (default 8).
   - Relays drop packets with timestamp older than `max_packet_age_s` (default 7200 s).

5. **Bounded Retransmission & Escalation**:
   - Up to 3 retries scheduled with growing linear backoff: $4000 \times (\text{attempt} + 1)$ ms.
   - If a new button press occurs while waiting for ACK, the episode escalates to the higher hazard with a new sequence ID while maintaining ACK correlation.
   - Upon receiving an ACK matching any sequence ID in the current episode, retries terminate and the haptic motor plays `HapticPattern::AckReceived`.

6. **Duty-Cycle Budget**:
   - Standard rolling 1-hour window enforcing 1% duty cycle (10 per-mille).
   - Prioritized traffic (originator's own SOS and Rescue Hub ACKs) ignores duty cycle constraints in disaster mode; relayed background traffic strictly respects duty budget.
