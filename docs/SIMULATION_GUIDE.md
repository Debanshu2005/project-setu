# Project Setu: Simulation & Verification Guide

## 1. Native Simulator (`setu_sim`)

The native discrete-event simulator runs the identical C++ portable core logic (`setu_core`) across multiple virtual devices over a calibrated physical RF channel model.

### Key Capabilities
- **Log-Distance Path Loss**: $\text{PL}(d) = \text{PL}_0 + 10 \cdot n \cdot \log_{10}(d) + X_\sigma + \text{loss}_{\text{extra}}$
- **Log-Normal Shadowing & Fast Rayleigh Fading**: Per-link and per-packet variations.
- **LoRa Semtech Time-on-Air (AN1200.13)**: Exact explicit header, CRC on, CR 4/5 airtime calculation.
- **Half-Duplex Hardware**: Transmitting nodes cannot receive packets simultaneously.
- **Collisions with Capture Effect**: Stronger packet survives overlapping collision if $\text{RSSI}_1 - \text{RSSI}_2 \ge 6.0\text{ dB}$.
- **Fault & Environment Injection**: Scheduled node destruction (`--kill`), GPS loss (`--gps-off`), IMU failure (`--no-dr`), and radio barrier obstruction (`--block`).

---

## 2. Running Simulations from CLI

```bash
# Basic run with 20 survivors, 5 relays, 30s duration
./build/Release/setu_sim.exe --survivors 20 --relays 5 --seed 42 --duration 30000 --trace out.jsonl

# High-concurrency disaster scenario with fault injections
./build/Release/setu_sim.exe --survivors 25 --relays 6 --zone 1200 --seed 42 --duration 35000 \
  --sf 8 --loss 0.04 --path-exp 3.6 \
  --trigger 7:long@1000 --trigger 3:voice-medical@4000 --trigger 14:short@6500 \
  --kill 102@2000 --gps-off 7@500 --block 100-101@3000 \
  --trace scenarios/traces/urban_earthquake.jsonl
```

### CLI Arguments
| Argument | Description | Default |
|----------|-------------|---------|
| `--survivors <N>` | Number of survivor wristbands (IDs 1..N) | 20 |
| `--relays <N>` | Number of relay nodes (IDs 100..100+N-1) | 5 |
| `--zone <meters>` | Simulation area width and height | 1200 |
| `--seed <int>` | PRNG seed for deterministic placement and fading | 7 |
| `--duration <ms>` | Simulation run time in milliseconds | 30000 |
| `--sf <7-12>` | LoRa spreading factor (SF7 = 62ms, SF9 = 210ms) | 7 |
| `--loss <0.0-1.0>` | Independent packet drop probability | 0.0 |
| `--path-exp <float>`| Path loss exponent (3.5 = rubble, 4.2 = tunnel) | 3.5 |
| `--trace <path>` | Path to output JSONL trace (`-` for stdout) | none |
| `--trigger <ID:KIND@T>` | Trigger SOS: `short`, `double`, `long`, `voice`, `voice-medical`, `voice-trapped` | none |
| `--kill <ID@T>` | Destroy / power-off node at timestamp T ms | none |
| `--revive <ID@T>` | Restore node to online state at timestamp T ms | none |
| `--gps-off <ID@T>` | Cut GNSS satellite lock at timestamp T ms | none |
| `--no-dr <ID@T>` | Disable dead-reckoning fallback at timestamp T ms | none |
| `--block <A-B@T>` | Sever radio link between nodes A and B | none |

---

## 3. Operations Dashboard & Local API

The operations dashboard connects directly to the native simulator backend via pure Node.js HTTP server.

```bash
# Start dashboard server (port 3000)
node dashboard/server.js

# Access dashboard in web browser
http://localhost:3000
```

### Features
- **Interactive Topology**: Canvas rendering with pan/zoom, link RSSI gradients, and moving packet pulses.
- **Trace Replayer**: Scrub timeline, 0.5x to 10x playback speed, step-by-step event forward/backward.
- **SOS Console**: Trigger survivor alerts directly from operator panel.
- **25-Byte Wire Inspector**: Raw hex viewer with field boundaries and parsed protocol values.
- **Chronological Timeline**: Searchable logs filtered by TX, RX, Drops, Alerts, Protocol, and Faults.
- **Analytics Charts**: SVG visualizations of PDR, drop causes, hop distributions, and latency.
- **Data Export**: One-click download of full JSON simulation report or CSV node telemetry.
