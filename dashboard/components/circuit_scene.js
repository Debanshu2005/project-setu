// Project Setu: Multi-Board Circuit Assembly 3D Scene
// Procedural models of LoRa (SX1262), Mic (INMP441), IMU (MPU-6050), and Tactile SOS Push Button.
import { toon } from '../vendor/esp-labs/toon.js';

export const MODULES_ANCHORS = {
  esp32: [0, 0.25, 0],
  imu: [-4.5, 0.35, 2.2],
  button: [-4.5, 0.35, -2.2],
  lora: [4.5, 0.35, -2.2],
  mic: [4.5, 0.35, 2.2],
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
  p('button', 3, 'Tactile Panic Push Button', 'Emergency SOS Trigger (GPIO 16)', 'left',
    'Tactile momentary push button switch mounted on a breakout with hardware debounce filtering.',
    'Allows the wearer or rescuer to manually initiate high-priority SOS emergency beacon transmissions.',
    'Signal: GPIO 16 (Header L Pin 9, dedicated non-strapping IO). Return: System Ground (GND).',
    'Click the button on the 3D model or toolbar to test short press, double press, and long press flows.',
    [pv('Debounce timing nominal 50 ms', 'model', 'Firmware Debounce Spec', 'docs/PARAMETERS.md'), pv('Dedicated GPIO 16 avoids boot strapping risk', 'cited', 'firmware/pinmap.json')],
    [ch('Button triggers: open Twin', 'twin'), ch('SOS events: open Timeline', 'timeline')]
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
    'Round circular black PCB with gold perimeter ring, silver MEMS package, and yellow pin header spacers.',
    'Enables hands-free voice emergency detection ("Say Setu") using embedded WakeNet neural model.',
    'I2S Bus: Serial Data (SD) on GPIO 38, Word Select (WS) on GPIO 42, Serial Clock (SCK) on GPIO 41.',
    'Observe 10-second voice activation countdown and acoustic pulse wave rings when triggered.',
    [pv('I2S 24-bit 16 kHz sampling', 'cited', 'INMP441 Datasheet'), pv('Signal-to-noise ratio 61 dBA', 'cited', 'TDK InvenSense Product Spec')],
    [ch('Acoustic trigger: test in Twin', 'twin'), ch('Voice telemetry: open Timeline', 'timeline')]
  ),
  p('wires', 6, 'Jumper Wire Interconnects', 'Color-Coded Bus Harness', 'right',
    'Multi-strand flexible breadboard jumper harness connecting module pins to ESP32 header sockets.',
    'Routes high-speed SPI, I2C, and I2S buses with matched return paths for signal integrity.',
    'Cyan: SPI (LoRa); Purple: I2S (Mic); Amber: I2C (IMU); Orange: SOS Button; Red: 3.3V; Slate: GND.',
    'Trace individual wires to verify pinout agreement between firmware pinmap.json and physical headers.',
    [pv('Jumper wire resistance nominal 0.08 Ohm', 'assumed', 'Standard 24AWG Breadboard Lead'), pv('Pin assignments in pinmap.json', 'cited', 'firmware/pinmap.json')],
    [ch('Wiring map: inspect Pins', 'wiring'), ch('System topology: open Map', 'topology')]
  )
];

function createInmp441Texture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  ctx.fillStyle = '#090d16';
  ctx.beginPath();
  ctx.arc(128, 128, 126, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#090d16';
  ctx.beginPath();
  ctx.arc(128, 2, 22, 0, Math.PI * 2);
  ctx.arc(128, 254, 22, 0, Math.PI * 2);
  ctx.fill();

  const pinCoords = [
    [64, 46], [128, 34], [192, 46],
    [64, 210], [128, 222], [192, 210]
  ];
  pinCoords.forEach(([px, py]) => {
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(px, py, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#d97706';
  ctx.fillRect(80, 84, 10, 16);
  ctx.fillRect(98, 84, 10, 16);
  ctx.fillRect(80, 108, 10, 16);
  ctx.fillRect(98, 108, 10, 16);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('INMP441', 128, 185);

  return c;
}

function createMpu6050Texture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 360;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  ctx.fillStyle = '#0047ba';
  ctx.fillRect(0, 0, 256, 360);

  ctx.strokeStyle = '#023896';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const py = 32 + i * 42;
    ctx.moveTo(34, py);
    ctx.lineTo(80, py);
    ctx.lineTo(105, 140 + i * 10);
  }
  ctx.stroke();

  const pinLabels = ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'];
  pinLabels.forEach((label, i) => {
    const py = 32 + i * 42;
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(24, py, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(24, py, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(24, py, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 48, py);
  });

  [[218, 52], [218, 308]].forEach(([hx, hy]) => {
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(hx, hy, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(hx, hy, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0c1715';
    ctx.beginPath();
    ctx.arc(hx, hy, 13, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.save();
  ctx.translate(236, 180);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px monospace, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MPU-6050', 0, 0);
  ctx.restore();

  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2.5;

  const ax = 125, ay = 332;
  ctx.beginPath();
  ctx.arc(ax, ay, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ax - 5, ay); ctx.lineTo(ax + 5, ay);
  ctx.moveTo(ax, ay - 5); ctx.lineTo(ax, ay + 5);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ax + 28, ay + 6); ctx.lineTo(ax + 28, ay - 14);
  ctx.lineTo(ax + 24, ay - 9);
  ctx.moveTo(ax + 28, ay - 14); ctx.lineTo(ax + 32, ay - 9);
  ctx.stroke();
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('Y', ax + 25, ay - 18);

  ctx.beginPath();
  ctx.moveTo(ax + 28, ay + 6); ctx.lineTo(ax + 48, ay + 6);
  ctx.lineTo(ax + 43, ay + 2);
  ctx.moveTo(ax + 48, ay + 6); ctx.lineTo(ax + 43, ay + 10);
  ctx.stroke();
  ctx.fillText('X', ax + 52, ay + 9);

  return c;
}

function createQfnChipTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  ctx.fillStyle = '#1c1917';
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = '#44403c';
  ctx.beginPath();
  ctx.arc(16, 16, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#a8a29e';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('INVENSENSE', 64, 46);
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('MPU-6050', 64, 70);
  ctx.font = '10px monospace';
  ctx.fillText('D4L673L B1', 64, 92);

  return c;
}

function createButtonPcbTexture() {
  const c = document.createElement('canvas');
  c.width = 180;
  c.height = 180;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 180, 180);

  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 168, 168);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SETU SOS', 90, 32);

  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#f97316';
  ctx.fillText('GPIO 16 (SIG)', 90, 154);

  ctx.fillStyle = '#94a3b8';
  ctx.fillText('GND RETURN', 90, 170);

  return c;
}

export function buildCircuitScene(T, stage) {
  const group = new T.Group();
  stage.scene.add(group);

  const parts = { esp32: [], imu: [], button: [], lora: [], mic: [], wires: [] };
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

  // 1. SX1262 LoRa Breakout Board (Top-Right: [4.5, 0.08, -2.2])
  const loraX = 4.5, loraZ = -2.2;
  mesh(bG(2.6, 0.08, 1.9), mat('lora', '#1e3a8a'), loraX, 0.08, loraZ); // Blue PCB
  mesh(bG(1.5, 0.18, 1.2), mat('lora', '#94a3b8'), loraX - 0.2, 0.21, loraZ); // Silver RF Shield Can
  mesh(cG(0.18, 0.18, 0.35, 16), mat('lora', '#d97706'), loraX + 1.1, 0.22, loraZ - 0.5); // Brass SMA Jack
  mesh(cG(0.06, 0.06, 1.4, 12), mat('lora', '#1e293b'), loraX + 1.1, 0.8, loraZ - 0.5); // Spring Antenna
  for (let i = 0; i < 8; i += 1) {
    const pz = loraZ - 0.7 + i * 0.2;
    mesh(cG(0.025, 0.025, 0.24, 8), mat('lora', '#f59e0b'), loraX - 1.1, 0.18, pz, false);
    mesh(bG(0.1, 0.12, 0.1), mat('lora', '#0f172a'), loraX - 1.1, 0.12, pz, false);
  }

  // 2. INMP441 MEMS Microphone Module (Bottom-Right: [4.5, 0.08, 2.2], matching Pic 1)
  const micX = 4.5, micZ = 2.2;
  // Circular black PCB disk
  mesh(cG(0.85, 0.85, 0.08, 48), mat('mic', '#090d16'), micX, 0.08, micZ);
  // Gold ring and soldermask top face disc
  const inmpTex = new T.CanvasTexture(createInmp441Texture());
  const inmpTopMesh = new T.Mesh(new T.CircleGeometry(0.84, 48), new T.MeshBasicMaterial({ map: inmpTex, transparent: true }));
  inmpTopMesh.rotation.x = -Math.PI / 2;
  inmpTopMesh.position.set(micX, 0.122, micZ);
  inmpTopMesh.userData.noOutline = true;
  group.add(inmpTopMesh);

  // Central rectangular metallic MEMS microphone package
  mesh(bG(0.58, 0.12, 0.44), mat('mic', '#cbd5e1'), micX, 0.18, micZ);
  mesh(bG(0.52, 0.04, 0.38), mat('mic', '#e2e8f0'), micX, 0.25, micZ); // Chamfered lid

  // SMD 0402/0603 passives on top-left of mic can (matching Pic 1)
  mesh(bG(0.13, 0.08, 0.08), mat('mic', '#d4b996'), micX - 0.24, 0.17, micZ - 0.26); // Tan ceramic cap
  mesh(bG(0.13, 0.08, 0.08), mat('mic', '#18181b'), micX - 0.24, 0.17, micZ - 0.13); // Black 104 resistor

  // 6 Header Pins with bright yellow plastic spacers (matching Pic 1)
  const micPins = [
    [-0.42, -0.52], [0, -0.60], [0.42, -0.52],
    [-0.42, 0.52], [0, 0.60], [0.42, 0.52]
  ];
  micPins.forEach(([dx, dz]) => {
    const px = micX + dx, pz = micZ + dz;
    mesh(cG(0.025, 0.035, 0.08, 8), mat('mic', '#cbd5e1'), px, 0.16, pz, false); // Top solder point
    mesh(bG(0.18, 0.22, 0.18), mat('mic', '#eab308'), px, -0.06, pz, false);     // Yellow plastic spacer
    mesh(cG(0.024, 0.024, 0.46, 8), mat('mic', '#cbd5e1'), px, -0.32, pz, false); // Lower pin post
  });

  // 3. MPU-6050 6-Axis IMU GY-521 Module (Bottom-Left: [-4.5, 0.08, 2.2], matching Pic 2)
  const imuX = -4.5, imuZ = 2.2;
  // Deep royal blue rectangular PCB
  mesh(bG(1.7, 0.08, 2.4), mat('imu', '#0047ba'), imuX, 0.08, imuZ);
  const mpuTex = new T.CanvasTexture(createMpu6050Texture());
  const mpuTopMesh = new T.Mesh(new T.PlaneGeometry(1.68, 2.38), new T.MeshBasicMaterial({ map: mpuTex, transparent: true }));
  mpuTopMesh.rotation.x = -Math.PI / 2;
  mpuTopMesh.position.set(imuX, 0.122, imuZ);
  mpuTopMesh.userData.noOutline = true;
  group.add(mpuTopMesh);

  // Central InvenSense QFN-24 chip package
  mesh(bG(0.64, 0.10, 0.64), mat('imu', '#1c1917'), imuX + 0.02, 0.17, imuZ + 0.02);
  const qfnTex = new T.CanvasTexture(createQfnChipTexture());
  const qfnTopMesh = new T.Mesh(new T.PlaneGeometry(0.62, 0.62), new T.MeshBasicMaterial({ map: qfnTex, transparent: true }));
  qfnTopMesh.rotation.x = -Math.PI / 2;
  qfnTopMesh.position.set(imuX + 0.02, 0.222, imuZ + 0.02);
  qfnTopMesh.userData.noOutline = true;
  group.add(qfnTopMesh);
  mesh(bG(0.72, 0.03, 0.72), mat('imu', '#cbd5e1'), imuX + 0.02, 0.13, imuZ + 0.02, false); // 24 silver lead pins

  // SOT-23 LDO regulator (top edge, matching Pic 2)
  mesh(bG(0.32, 0.08, 0.18), mat('imu', '#27272a'), imuX - 0.06, 0.16, imuZ - 0.85);
  mesh(bG(0.40, 0.02, 0.14), mat('imu', '#cbd5e1'), imuX - 0.06, 0.13, imuZ - 0.85, false);

  // Amber tantalum capacitor 106C (right edge, matching Pic 2)
  mesh(bG(0.22, 0.14, 0.44), mat('imu', '#f59e0b'), imuX + 0.44, 0.19, imuZ + 0.06);
  mesh(bG(0.23, 0.142, 0.08), mat('imu', '#b45309'), imuX + 0.44, 0.19, imuZ - 0.12, false); // Polarity line

  // SMD passives
  mesh(bG(0.14, 0.08, 0.10), mat('imu', '#d4b996'), imuX - 0.08, 0.16, imuZ - 0.58);
  mesh(bG(0.14, 0.08, 0.10), mat('imu', '#d4b996'), imuX + 0.28, 0.16, imuZ - 0.46);
  mesh(bG(0.14, 0.08, 0.10), mat('imu', '#d4b996'), imuX + 0.28, 0.16, imuZ - 0.32);
  mesh(bG(0.14, 0.08, 0.10), mat('imu', '#d4b996'), imuX - 0.08, 0.16, imuZ + 0.44);
  mesh(bG(0.14, 0.08, 0.10), mat('imu', '#d4b996'), imuX + 0.28, 0.16, imuZ + 0.44);

  // Left 8 header pins with black spacer blocks
  for (let i = 0; i < 8; i += 1) {
    const pz = imuZ - 0.98 + i * 0.28;
    mesh(cG(0.025, 0.025, 0.26, 8), mat('imu', '#f59e0b'), imuX - 0.64, 0.18, pz, false);
    mesh(bG(0.12, 0.14, 0.12), mat('imu', '#0f172a'), imuX - 0.64, 0.12, pz, false);
  }

  // 4. Tactile Emergency Push Button Breakout (Upper-Left: [-4.5, 0.08, -2.2])
  const btnX = -4.5, btnZ = -2.2;
  mesh(bG(1.8, 0.08, 1.8), mat('button', '#0f172a'), btnX, 0.08, btnZ);
  const btnTex = new T.CanvasTexture(createButtonPcbTexture());
  const btnTopMesh = new T.Mesh(new T.PlaneGeometry(1.76, 1.76), new T.MeshBasicMaterial({ map: btnTex, transparent: true }));
  btnTopMesh.rotation.x = -Math.PI / 2;
  btnTopMesh.position.set(btnX, 0.122, btnZ);
  btnTopMesh.userData.noOutline = true;
  group.add(btnTopMesh);

  // 6x6mm tactile button switch housing
  mesh(bG(0.95, 0.32, 0.95), mat('button', '#1f2937'), btnX, 0.24, btnZ); // Black body
  mesh(bG(0.97, 0.04, 0.97), mat('button', '#94a3b8'), btnX, 0.41, btnZ); // Silver metal retention bracket
  // 4 corner bracket rivets
  [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]].forEach(([rx, rz]) => {
    mesh(cG(0.04, 0.04, 0.06, 8), mat('button', '#64748b'), btnX + rx, 0.43, btnZ + rz, false);
  });
  // Clickable red actuator plunger (the tactile button itself)
  const buttonPlunger = mesh(cG(0.26, 0.26, 0.24, 24), mat('button', '#ef4444'), btnX, 0.52, btnZ);

  // Power distribution rail adjacent to button
  mesh(bG(1.6, 0.10, 0.5), mat('button', '#e2e8f0'), btnX, 0.09, btnZ + 1.2);
  mesh(bG(1.4, 0.02, 0.06), mat('button', '#ef4444'), btnX, 0.15, btnZ + 1.08, false); // 3.3V
  mesh(bG(1.4, 0.02, 0.06), mat('button', '#334155'), btnX, 0.15, btnZ + 1.32, false); // GND

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
    { from: [btnX, 0.16, btnZ + 1.08], to: [loraX - 1.1, 0.2, loraZ - 0.7], c: '#ef4444', sag: 1.1 }, // 3.3V
    { from: [btnX, 0.16, btnZ + 1.32], to: [loraX - 1.1, 0.2, loraZ - 0.5], c: '#475569', sag: 1.2 }, // GND

    // INMP441 Microphone I2S Bus (Purple #c084fc)
    { from: [pinX(6), 0.16, ROW_Z], to: [micX - 0.42, 0.2, micZ + 0.52], c: '#c084fc', sag: 0.7 }, // GPIO 41 -> SCK
    { from: [pinX(5), 0.16, ROW_Z], to: [micX, 0.2, micZ + 0.60], c: '#c084fc', sag: 0.8 },        // GPIO 42 -> WS
    { from: [pinX(9), 0.16, ROW_Z], to: [micX + 0.42, 0.2, micZ + 0.52], c: '#c084fc', sag: 0.6 }, // GPIO 38 -> SD
    // Mic Power & Ground
    { from: [btnX + 0.4, 0.16, btnZ + 1.08], to: [micX - 0.42, 0.2, micZ - 0.52], c: '#ef4444', sag: 1.2 }, // VDD
    { from: [btnX + 0.4, 0.16, btnZ + 1.32], to: [micX + 0.42, 0.2, micZ - 0.52], c: '#475569', sag: 1.3 }, // GND

    // MPU-6050 IMU I2C Bus (Amber #fbbf24)
    { from: [pinX(17), 0.16, ROW_Z], to: [imuX - 0.64, 0.2, imuZ - 0.14], c: '#fbbf24', sag: 0.8 }, // GPIO 21 -> SDA
    { from: [pinX(14), 0.16, -ROW_Z], to: [imuX - 0.64, 0.2, imuZ - 0.42], c: '#fbbf24', sag: 0.9 }, // GPIO 9 -> SCL
    // IMU Power & Ground
    { from: [btnX - 0.4, 0.16, btnZ + 1.08], to: [imuX - 0.64, 0.2, imuZ - 0.98], c: '#ef4444', sag: 0.7 }, // VCC
    { from: [btnX - 0.4, 0.16, btnZ + 1.32], to: [imuX - 0.64, 0.2, imuZ - 0.70], c: '#475569', sag: 0.8 }, // GND

    // Emergency Panic Button (Orange #f97316)
    { from: [pinX(8), 0.16, -ROW_Z], to: [btnX, 0.2, btnZ + 0.45], c: '#f97316', sag: 0.6 }, // GPIO 16 -> Panic Button
    { from: [btnX, 0.16, btnZ + 1.32], to: [btnX, 0.2, btnZ - 0.45], c: '#475569', sag: 0.4 }, // GND Return

    // ESP32 to Power Rail Feeders
    { from: [pinX(0), 0.16, -ROW_Z], to: [btnX - 0.6, 0.16, btnZ + 1.08], c: '#ef4444', sag: 0.6 }, // DevKitC 3V3 -> Rail
    { from: [pinX(0), 0.16, ROW_Z], to: [btnX - 0.6, 0.16, btnZ + 1.32], c: '#475569', sag: 0.7 }   // DevKitC GND -> Rail
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
    button: buttonPlunger,
    parts: MODULES_PARTS,
    anchors: MODULES_ANCHORS,
    update(node = {}) {
      // Live hooks for peripheral telemetry
    },
    highlight(partId) {
      activeLitPart = partId;
    },
    frame
  };
}
