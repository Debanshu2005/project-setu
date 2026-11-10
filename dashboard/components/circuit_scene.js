// Project Setu: Multi-Board Circuit Assembly 3D Scene
// Procedural models of LoRa (SX1262), Mic (INMP441), IMU (MPU-6050) with 3D jumper wires.
import { glowTexture, toon } from '../vendor/esp-labs/toon.js';

export const MODULES_ANCHORS = {
  esp32: [0, 0.25, 0],
  imu: [-4.4, 0.35, 2.3],
  power: [-4.4, 0.35, -2.3],
  lora: [4.4, 0.35, -2.3],
  mic: [4.4, 0.35, 2.3],
  wires: [0, 1.2, 0]
};

const p = (id, number, title, subtitle, side, what, why, pins, simulator, provenance, chips) =>
  ({ id, number, title, subtitle, side, what, why, pins, simulator, provenance, chips });
const pv = (fact, tag, source, paramLink) => (paramLink ? { fact, tag, source, paramLink } : { fact, tag, source });
const ch = (label, action, paramLink) => (paramLink ? { label, action, paramLink } : { label, action });

export const MODULES_PARTS = [
  p('esp32', 1, 'ESP32-S3 DevKitC-1', 'Central Edge AI & Mesh Controller', 'left',
    'Dual-core 240 MHz Xtensa LX7 processor hosting FreeRTOS, neural speech inference, and mesh state.',
    'Acts as the master node controller, polling sensors, running WakeNet, and coordinating LoRa packets.',
    'Header L & Header R bringing out 36 GPIOs, dual 3.3V rails, 5V input, and system ground returns.',
    'Observe CPU load, task queue depth, and interrupt handling across SPI, I2C, and I2S peripherals.',
    [pv('Dual-core 240 MHz clock', 'cited', 'ESP32-S3 Datasheet'), pv('512 KB SRAM + 8 MB PSRAM', 'cited', 'ESP32-S3 TRM Rev 1.4')],
    [ch('MCU tasks: open Timeline', 'timeline'), ch('Hardware architecture: open Analytics', 'analytics')]
  ),
  p('imu', 2, 'MPU-6050 6-Axis IMU', 'GY-521 Inertial Motion Sensor', 'left',
    'Triple-axis MEMS accelerometer and triple-axis gyroscope on a blue GY-521 breakout module.',
    'Provides acceleration and angular velocity for pedestrian dead reckoning (PDR) during GPS denial.',
    'I2C Bus: SDA on GPIO 21, SCL relocated to GPIO 9 (400 kHz Fast-Mode). VCC: 3.3V, GND.',
    'Watch step detection count, step cadence, and orientation drift updates in real-time telemetry.',
    [pv('I2C Fast Mode 400 kHz', 'cited', 'MPU-6050 Datasheet'), pv('PDR step length nominal 0.72 m', 'model', 'PDR Kinematics', 'docs/PARAMETERS.md')],
    [ch('Dead reckoning filter: open PDR', 'pdr'), ch('Kinematic sensors: view in Twin', 'twin')]
  ),
  p('power', 3, 'Power Distribution Rail', '3.3V Regulated & Ground Return', 'left',
    'Common 3.3V power bus and ground return distributed from the onboard ESP32-S3 LDO regulator.',
    'Maintains clean voltage rails for sensitive analog MEMS microphone and RF transceiver circuitry.',
    'ESP32 3V3 Pin (Header L Pin 1) and GND Pins (Header L Pin 22, Header R Pin 1).',
    'Inspect aggregated current draw, battery state of charge, and low-dropout voltage stability.',
    [pv('3.3V rail nominal ripple <30 mV', 'cited', 'ESP32-S3 Hardware Design Guidelines'), pv('Quiescent draw 18 mA baseline', 'model', 'Energy Model 3.1', 'docs/PARAMETERS.md')],
    [ch('Energy drain: open Energy chart', 'energy'), ch('Battery profile: inspect Twin', 'twin')]
  ),
  p('lora', 4, 'SX1262 LoRa Breakout', '868 MHz Sub-GHz RF Transceiver', 'right',
    'Semtech SX1262 Sub-GHz radio module with IPEX connector, spring antenna, and crystal oscillator.',
    'Delivers resilient non-line-of-sight disaster mesh networking penetrating rubble, concrete, and soil.',
    'SPI Bus: NSS on GPIO 5, MOSI on 6, MISO on 7, SCK on 8, DIO1 on 4, BUSY on 2, RST on 3.',
    'Watch radio transmission wave rings, airtime duration (56 ms at SF7), and ACK turnaround time.',
    [pv('Frequency 868.100 MHz European SRD', 'cited', 'Sub-GHz Band Regulations', 'docs/PARAMETERS.md'), pv('Sensitivity -125 dBm at SF7/125kHz', 'cited', 'SX1262 Product Datasheet')],
    [ch('Radio airtime: open Analytics', 'analytics'), ch('Transceiver: view in Twin', 'twin')]
  ),
  p('mic', 5, 'INMP441 MEMS Microphone', 'Digital I2S Omnidirectional Sensor', 'right',
    'Low-noise digital MEMS microphone with bottom acoustic port mounted on a purple breakout board.',
    'Enables hands-free voice emergency detection ("Say Setu") using embedded WakeNet neural model.',
    'I2S Bus: Serial Data (SD) on GPIO 38, Word Select (WS) on GPIO 42, Serial Clock (SCK) on GPIO 41.',
    'Observe 10-second voice activation countdown and acoustic pulse wave rings when triggered.',
    [pv('I2S 24-bit 16 kHz sampling', 'cited', 'INMP441 Datasheet'), pv('Signal-to-noise ratio 61 dBA', 'cited', 'TDK InvenSense Product Spec')],
    [ch('Acoustic trigger: test in Twin', 'twin'), ch('Voice telemetry: open Timeline', 'timeline')]
  ),
  p('wires', 6, 'Jumper Wire Interconnects', 'Color-Coded Bus Harness', 'right',
    'Multi-strand flexible breadboard jumper harness connecting module pins to ESP32 header sockets.',
    'Routes high-speed SPI, I2C, and I2S buses with matched return paths for signal integrity.',
    'Cyan: SPI (LoRa); Purple: I2S (Mic); Amber: I2C (IMU); Red: 3.3V Power; Slate: System Ground.',
    'Trace individual wires to verify pinout agreement between firmware pinmap.json and physical headers.',
    [pv('Jumper wire resistance nominal 0.08 Ohm', 'assumed', 'Standard 24AWG Breadboard Lead'), pv('Pin assignments in pinmap.json', 'cited', 'firmware/pinmap.json')],
    [ch('Wiring map: inspect Pins', 'wiring'), ch('System topology: open Map', 'topology')]
  )
];

export function buildCircuitScene(T, stage) {
  const group = new T.Group();
  stage.scene.add(group);

  const parts = { esp32: [], imu: [], power: [], lora: [], mic: [], wires: [] };
  const mat = (part, color, extra = {}) => {
    const m = toon(T, color, extra);
    if (part && parts[part]) parts[part].push(m);
    return m;
  };
  const mesh = (geo, material, x, y, z, outline = true) => {
    const m = new T.Mesh(geo, material);
    m.position.set(x, y, z);
    m.userData.noOutline = !outline;
    group.add(m);
    return m;
  };

  const bG = (w, h, d) => new T.BoxGeometry(w, h, d);
  const cG = (rt, rb, h, s) => new T.CylinderGeometry(rt, rb, h, s);

  // 1. SX1262 LoRa Breakout Board (Top-Right: [4.4, 0.1, -2.4])
  const loraX = 4.4, loraZ = -2.4;
  mesh(bG(2.6, 0.08, 1.9), mat('lora', '#1e3a8a'), loraX, 0.08, loraZ); // Blue PCB
  mesh(bG(1.5, 0.18, 1.2), mat('lora', '#94a3b8'), loraX - 0.2, 0.21, loraZ); // Silver RF Shield Can
  mesh(cG(0.18, 0.18, 0.35, 16), mat('lora', '#d97706'), loraX + 1.1, 0.22, loraZ - 0.5); // Brass SMA Jack
  mesh(cG(0.06, 0.06, 1.4, 12), mat('lora', '#1e293b'), loraX + 1.1, 0.8, loraZ - 0.5); // Spring Antenna
  // 8 gold header pins
  for (let i = 0; i < 8; i += 1) {
    const pz = loraZ - 0.7 + i * 0.2;
    mesh(cG(0.025, 0.025, 0.24, 8), mat('lora', '#f59e0b'), loraX - 1.1, 0.18, pz, false);
    mesh(bG(0.1, 0.12, 0.1), mat('lora', '#0f172a'), loraX - 1.1, 0.12, pz, false);
  }

  // 2. INMP441 MEMS Microphone Breakout Board (Bottom-Right: [4.4, 0.1, 2.4])
  const micX = 4.4, micZ = 2.4;
  mesh(bG(1.6, 0.08, 1.6), mat('mic', '#581c87'), micX, 0.08, micZ); // Purple PCB
  mesh(cG(0.16, 0.16, 0.06, 20), mat('mic', '#d97706'), micX - 0.2, 0.14, micZ - 0.1); // Gold acoustic ring
  mesh(cG(0.06, 0.06, 0.07, 16), mat('mic', '#090d16'), micX - 0.2, 0.15, micZ - 0.1, false); // Acoustic sound port
  mesh(bG(0.4, 0.06, 0.3), mat('mic', '#334155'), micX + 0.3, 0.13, micZ + 0.2); // Sensor IC
  // 6 gold header pins
  for (let i = 0; i < 6; i += 1) {
    const pz = micZ - 0.5 + i * 0.2;
    mesh(cG(0.025, 0.025, 0.24, 8), mat('mic', '#f59e0b'), micX - 0.65, 0.18, pz, false);
    mesh(bG(0.1, 0.12, 0.1), mat('mic', '#0f172a'), micX - 0.65, 0.12, pz, false);
  }

  // 3. MPU-6050 6-Axis IMU GY-521 Breakout Board (Bottom-Left: [-4.4, 0.1, 2.4])
  const imuX = -4.4, imuZ = 2.4;
  mesh(bG(2.3, 0.08, 1.7), mat('imu', '#0284c7'), imuX, 0.08, imuZ); // GY-521 Blue PCB
  mesh(bG(0.65, 0.08, 0.65), mat('imu', '#0f172a'), imuX - 0.2, 0.14, imuZ - 0.1); // QFN-24 IMU sensor
  mesh(bG(0.12, 0.06, 0.18), mat('imu', '#ef4444'), imuX + 0.6, 0.13, imuZ - 0.5); // Power LED
  mesh(bG(0.3, 0.08, 0.2), mat('imu', '#475569'), imuX + 0.5, 0.14, imuZ + 0.3); // SOT-23 LDO
  // 8 gold header pins
  for (let i = 0; i < 8; i += 1) {
    const pz = imuZ - 0.7 + i * 0.2;
    mesh(cG(0.025, 0.025, 0.24, 8), mat('imu', '#f59e0b'), imuX + 0.95, 0.18, pz, false);
    mesh(bG(0.1, 0.12, 0.1), mat('imu', '#0f172a'), imuX + 0.95, 0.12, pz, false);
  }

  // 4. Power & Ground Distribution Rail (Upper-Left: [-4.4, 0.1, -2.4])
  const pwrX = -4.4, pwrZ = -2.4;
  mesh(bG(2.8, 0.14, 1.5), mat('power', '#e2e8f0'), pwrX, 0.07, pwrZ); // White mini-rail base
  mesh(bG(2.4, 0.02, 0.08), mat('power', '#ef4444'), pwrX, 0.15, pwrZ - 0.4, false); // Red 3V3 stripe
  mesh(bG(2.4, 0.02, 0.08), mat('power', '#334155'), pwrX, 0.15, pwrZ + 0.4, false); // Blue/slate GND stripe
  for (let i = 0; i < 10; i += 1) {
    const rx = pwrX - 1.0 + i * 0.22;
    mesh(cG(0.025, 0.025, 0.12, 8), mat('power', '#cbd5e1'), rx, 0.16, pwrZ - 0.2, false);
    mesh(cG(0.025, 0.025, 0.12, 8), mat('power', '#cbd5e1'), rx, 0.16, pwrZ + 0.2, false);
  }

  // 5. 3D Curved Jumper Wires connecting Module Pins to DevKitC-1 Header Pins
  const PIN0_X = 2.95, PITCH = 0.254, ROW_Z = 2.54 / 2 - 0.13;
  const pinX = i => PIN0_X - i * PITCH;

  const wireDefs = [
    // LoRa SPI Bus (Cyan #38bdf8)
    { from: [pinX(4), 0.16, -ROW_Z], to: [loraX - 1.1, 0.2, loraZ - 0.3], c: '#38bdf8', sag: 0.6 }, // GPIO 5 -> NSS
    { from: [pinX(5), 0.16, -ROW_Z], to: [loraX - 1.1, 0.2, loraZ - 0.1], c: '#38bdf8', sag: 0.7 }, // GPIO 6 -> MOSI
    { from: [pinX(6), 0.16, -ROW_Z], to: [loraX - 1.1, 0.2, loraZ + 0.1], c: '#38bdf8', sag: 0.8 }, // GPIO 7 -> MISO
    { from: [pinX(11), 0.16, -ROW_Z], to: [loraX - 1.1, 0.2, loraZ + 0.3], c: '#38bdf8', sag: 0.9 }, // GPIO 8 -> SCK
    { from: [pinX(3), 0.16, -ROW_Z], to: [loraX - 1.1, 0.2, loraZ + 0.5], c: '#60a5fa', sag: 0.5 }, // GPIO 4 -> DIO1
    // LoRa Power & Ground
    { from: [pwrX + 0.8, 0.18, pwrZ - 0.2], to: [loraX - 1.1, 0.2, loraZ - 0.7], c: '#ef4444', sag: 1.1 }, // 3.3V
    { from: [pwrX + 0.8, 0.18, pwrZ + 0.2], to: [loraX - 1.1, 0.2, loraZ - 0.5], c: '#475569', sag: 1.2 }, // GND

    // INMP441 Microphone I2S Bus (Purple #c084fc)
    { from: [pinX(6), 0.16, ROW_Z], to: [micX - 0.65, 0.2, micZ + 0.3], c: '#c084fc', sag: 0.7 }, // GPIO 41 -> SCK
    { from: [pinX(5), 0.16, ROW_Z], to: [micX - 0.65, 0.2, micZ + 0.1], c: '#c084fc', sag: 0.8 }, // GPIO 42 -> WS
    { from: [pinX(9), 0.16, ROW_Z], to: [micX - 0.65, 0.2, micZ - 0.1], c: '#c084fc', sag: 0.6 }, // GPIO 38 -> SD
    // Mic Power & Ground
    { from: [pwrX + 0.5, 0.18, pwrZ - 0.2], to: [micX - 0.65, 0.2, micZ - 0.5], c: '#ef4444', sag: 1.2 }, // VDD
    { from: [pwrX + 0.5, 0.18, pwrZ + 0.2], to: [micX - 0.65, 0.2, micZ - 0.3], c: '#475569', sag: 1.3 }, // GND

    // MPU-6050 IMU I2C Bus (Amber #fbbf24)
    { from: [pinX(17), 0.16, ROW_Z], to: [imuX + 0.95, 0.2, imuZ - 0.1], c: '#fbbf24', sag: 0.8 }, // GPIO 21 -> SDA
    { from: [pinX(14), 0.16, -ROW_Z], to: [imuX + 0.95, 0.2, imuZ - 0.3], c: '#fbbf24', sag: 0.9 }, // GPIO 9 -> SCL
    // IMU Power & Ground
    { from: [pwrX - 0.2, 0.18, pwrZ - 0.2], to: [imuX + 0.95, 0.2, imuZ - 0.7], c: '#ef4444', sag: 0.7 }, // VCC
    { from: [pwrX - 0.2, 0.18, pwrZ + 0.2], to: [imuX + 0.95, 0.2, imuZ - 0.5], c: '#475569', sag: 0.8 }, // GND

    // ESP32 to Power Rail Feeders
    { from: [pinX(0), 0.16, -ROW_Z], to: [pwrX - 0.8, 0.18, pwrZ - 0.2], c: '#ef4444', sag: 0.6 }, // DevKitC 3V3 -> Rail
    { from: [pinX(0), 0.16, ROW_Z], to: [pwrX - 0.8, 0.18, pwrZ + 0.2], c: '#475569', sag: 0.7 }   // DevKitC GND -> Rail
  ];

  wireDefs.forEach(w => {
    const pA = new T.Vector3(...w.from);
    const pB = new T.Vector3(...w.to);
    const midX = (pA.x + pB.x) / 2;
    const midY = Math.max(pA.y, pB.y) + (w.sag || 0.6);
    const midZ = (pA.z + pB.z) / 2;
    const curve = new T.CatmullRomCurve3([
      pA,
      new T.Vector3(pA.x, pA.y + 0.2, pA.z),
      new T.Vector3(midX, midY, midZ),
      new T.Vector3(pB.x, pB.y + 0.2, pB.z),
      pB
    ]);
    const geo = new T.TubeGeometry(curve, 16, 0.032, 6, false);
    const wireMat = mat('wires', w.c);
    mesh(geo, wireMat, 0, 0, 0, false);
  });

  let activeLitPart = null;
  const hotspotColor = new T.Color('#2dd4bf'), blackColor = new T.Color(0);

  const frame = (t) => {
    const pulse = stage.reduce ? 0.4 : 0.3 + 0.15 * Math.sin(t * 5);
    for (const [k, list] of Object.entries(parts)) {
      const on = (k === activeLitPart);
      for (const m of list) {
        if (m.emissive) {
          m.emissive.copy(on ? hotspotColor : blackColor);
          m.emissiveIntensity = on ? pulse : 0;
        }
      }
    }
  };
  stage.onFrame(frame);
  group.visible = false;

  return {
    group,
    parts: MODULES_PARTS,
    anchors: MODULES_ANCHORS,
    update(node = {}) {
      // Future live hooks for peripheral telemetry
    },
    highlight(partId) {
      activeLitPart = partId;
    },
    frame
  };
}

