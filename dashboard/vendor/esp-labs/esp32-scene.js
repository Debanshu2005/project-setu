// Adapted from esp-labs-web (https://github.com/agharsallah/esp-labs-web), MIT License,
// Copyright (c) 2026 Abderrehmen Gharsallah. Original file: src/features/home/board3d/esp32-scene.ts.
// Changes: TypeScript types removed, import paths rewritten. See THIRD_PARTY_NOTICE.txt.
import { HEADER, pinLabel } from "./board.js";
import { definePalette } from "./palette.js";
import { glowTexture, toon } from "./toon.js";
const colours = definePalette({
  pcb: "--pcb",
  edge: "--pcb-edge",
  silk: "--silk",
  silkDim: "--silk-dim",
  pad: "--pad",
  copper: "--copper",
  gold: "--gold",
  metal: "--metal",
  metalDark: "--metal-dark",
  plastic: "--plastic",
  hotspot: "--hotspot",
  power: "--danger",
  white: "--card-white",
  mono: "--font-mono"
});
const L = 6.9;
const W = 2.54;
const H = 0.16;
const PITCH = 0.254;
const PIN0_X = 2.95;
const ROW_Z = W / 2 - 0.13;
const pinX = (i) => PIN0_X - i * PITCH;
const PART_ANCHORS = {
  usb: [-3.3, 0.33, -0.6],
  buttons: [-2.78, 0.24, 0.86],
  rgb: [0.3, 0.12, 0.62],
  module: [1.6, 0.42, -0.2],
  antenna: [3.18, 0.1, 0.1],
  headers: [pinX(16), 0.06, ROW_Z]
};
/**
 * Build the ESP32-S3 DevKitC-1 procedural scene.
 *
 * @param {typeof import('three')} T Three.js namespace.
 * @param {import('./stage3d.js').Stage3d} S Destination stage.
 * @returns {{highlight: (part: string | null) => void, can: unknown, frame: (time: number) => void}}
 */
function buildBoardScene(T, S) {
  const C = colours();
  const board = new T.Group();
  S.scene.add(board);
  const parts = {
    usb: [],
    buttons: [],
    rgb: [],
    module: [],
    antenna: [],
    headers: []
  };
  const mat = (part, color, extra = {}) => {
    const m = toon(T, color, extra);
    if (part) parts[part].push(m);
    return m;
  };
  const mesh = (geo, material, x, y, z, outline = true) => {
    const m = new T.Mesh(geo, material);
    m.position.set(x, y, z);
    m.userData.noOutline = !outline;
    board.add(m);
    return m;
  };
  const top = toon(T, C.white, { map: silkscreen(T, C) });
  const side = toon(T, C.edge);
  mesh(new T.BoxGeometry(L, H, W), [side, side, top, toon(T, C.pcb), side, side], 0, -H / 2, 0);
  const modX0 = L / 2 - 2.55;
  mesh(new T.BoxGeometry(2.55, 0.08, 1.8), mat("antenna", C.pcb), modX0 + 1.275, 0.04, 0);
  const can = mat("module", C.metal);
  const canTop = mat("module", C.metal, { map: canLabel(T, C) });
  const canMesh = mesh(
    new T.BoxGeometry(1.9, 0.32, 1.66),
    [can, can, canTop, can, can, can],
    modX0 + 0.08 + 0.95,
    0.08 + 0.16,
    0
  );
  const trace = mat("antenna", C.gold);
  const runs = 8;
  for (let i = 0; i < runs; i++) {
    const z = -0.7 + i * 1.4 / (runs - 1);
    mesh(new T.BoxGeometry(0.36, 0.012, 0.035), trace, 3.15, 0.086, z, false);
    if (i < runs - 1)
      mesh(
        new T.BoxGeometry(0.035, 0.012, 1.4 / (runs - 1)),
        trace,
        i % 2 ? 2.97 : 3.33,
        0.086,
        z + 0.7 / (runs - 1),
        false
      );
  }
  const usbShape = roundedShape(T, 0.89, 0.32, 0.15);
  const usbGeo = new T.ExtrudeGeometry(usbShape, { depth: 0.73, bevelEnabled: false });
  usbGeo.rotateY(-Math.PI / 2);
  const shell = mat("usb", C.metal);
  const mouth = mat("usb", C.plastic);
  for (const z of [-0.6, 0.6]) {
    mesh(usbGeo, shell, -L / 2 + 0.65, 0.16, z);
    mesh(new T.BoxGeometry(0.02, 0.2, 0.7), mouth, -L / 2 - 0.085, 0.16, z, false);
  }
  for (const z of [-0.86, 0.86]) {
    mesh(new T.BoxGeometry(0.36, 0.12, 0.36), mat("buttons", C.metal), -2.78, 0.06, z);
    mesh(new T.CylinderGeometry(0.1, 0.1, 0.1, 20), mat("buttons", C.plastic), -2.78, 0.17, z);
  }
  const ledMat = mat("rgb", C.white, { emissive: new T.Color(C.hotspot), emissiveIntensity: 0.6 });
  mesh(new T.BoxGeometry(0.5, 0.1, 0.5), ledMat, 0.3, 0.05, 0.62);
  const glowMat = new T.SpriteMaterial({
    map: glowTexture(T),
    color: new T.Color(C.hotspot),
    blending: T.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });
  const glow = new T.Sprite(glowMat);
  glow.position.set(0.3, 0.2, 0.62);
  glow.scale.setScalar(1.3);
  board.add(glow);
  mesh(new T.BoxGeometry(0.42, 0.08, 0.42), toon(T, C.plastic), -2, 0.04, 0.25);
  mesh(new T.BoxGeometry(0.66, 0.16, 0.36), toon(T, C.plastic), -1.45, 0.08, -0.5);
  mesh(new T.BoxGeometry(0.32, 0.03, 0.18), toon(T, C.metal), -1.45, 0.015, -0.8, false);
  const powerLed = toon(T, C.power, { emissive: new T.Color(C.power), emissiveIntensity: 0.8 });
  mesh(new T.BoxGeometry(0.16, 0.06, 0.09), powerLed, -2.35, 0.03, -0.2, false);
  const passive = toon(T, C.metalDark);
  for (const [x, z, turn] of PASSIVES) {
    const m = mesh(new T.BoxGeometry(0.16, 0.06, 0.08), passive, x, 0.03, z, false);
    m.rotation.y = turn;
  }
  const spacer = mat("headers", C.plastic);
  const pin = mat("headers", C.gold);
  const solder = mat("headers", C.metal);
  const pinGeo = new T.BoxGeometry(0.064, 0.86, 0.064);
  const jointGeo = new T.CylinderGeometry(0.03, 0.065, 0.06, 10);
  for (const z of [-ROW_Z, ROW_Z]) {
    const n = HEADER.L.length;
    mesh(new T.BoxGeometry(n * PITCH, 0.25, PITCH), spacer, pinX((n - 1) / 2), -H - 0.125, z);
    for (let i = 0; i < n; i++) {
      mesh(pinGeo, pin, pinX(i), -0.43 + 0.06, z, false);
      mesh(jointGeo, solder, pinX(i), 0.03, z, false);
    }
  }
  const waves = Array.from({ length: 3 }, () => {
    const m = new T.MeshBasicMaterial({
      color: new T.Color(C.hotspot),
      transparent: true,
      opacity: 0,
      side: T.DoubleSide,
      depthWrite: false
    });
    const ring = new T.Mesh(new T.RingGeometry(0.95, 1, 40, 1, 0, Math.PI), m);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(L / 2 + 0.05, 0.05, 0);
    board.add(ring);
    return { ring, m };
  });
  let lit = null;
  const hotspot = new T.Color(C.hotspot);
  const black = new T.Color(0);
  const led = new T.Color();
  const frame = (t) => {
    led.setHSL(S.reduce ? 0.47 : t * 0.08 % 1, 0.9, 0.55);
    ledMat.emissive.copy(led);
    glowMat.color.copy(led);
    glow.scale.setScalar(lit === "rgb" ? 1.9 : 1.3);
    waves.forEach(({ ring, m }, i) => {
      if (S.reduce) {
        m.opacity = lit === "antenna" ? 0.5 : 0;
        ring.scale.setScalar(1.2 + i * 0.5);
        return;
      }
      const k = (t * 0.35 + i / waves.length) % 1;
      ring.scale.setScalar(0.4 + k * 2.4);
      m.opacity = (1 - k) * (lit === "antenna" ? 0.85 : 0.35);
    });
    const pulse = S.reduce ? 0.35 : 0.25 + 0.15 * Math.sin(t * 5);
    for (const [part, list] of Object.entries(parts)) {
      if (part === "rgb") continue;
      for (const m of list) {
        m.emissive.copy(part === lit ? hotspot : black);
        m.emissiveIntensity = part === lit ? pulse : 0;
      }
    }
  };
  S.onFrame(frame);
  return {
    board,
    setTransmitting(active) {
      lit = active ? "antenna" : null;
    },
    highlight(part) {
      lit = part;
    },
    can: canMesh,
    frame
  };
}
const PASSIVES = [
  [-2.45, 0.3, 0],
  [-2.45, 0.5, 0],
  [-1.6, 0.35, Math.PI / 2],
  [-1, 0.2, 0],
  [-0.9, -0.45, Math.PI / 2],
  [-0.5, 0.55, 0],
  [-0.2, -0.3, 0],
  [0.55, -0.6, Math.PI / 2]
];
function roundedShape(T, w, h, r) {
  const s = new T.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function silkscreen(T, C) {
  const k = 2048 / L;
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = Math.round(W * k);
  const g = c.getContext("2d");
  const tex = new T.CanvasTexture(c);
  if (!g) return tex;
  const px = (x) => (x + L / 2) * k;
  const pz = (z) => (z + W / 2) * k;
  g.fillStyle = C.pcb;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = C.edge;
  g.lineWidth = 7;
  g.lineJoin = "round";
  for (const [z0, z1, bend] of TRACES) {
    g.beginPath();
    g.moveTo(px(-2.6), pz(z0));
    g.lineTo(px(bend), pz(z0));
    g.lineTo(px(bend + 0.4), pz(z1));
    g.lineTo(px(0.85), pz(z1));
    g.stroke();
    g.fillStyle = C.edge;
    g.beginPath();
    g.arc(px(bend + 0.4), pz(z1), 11, 0, Math.PI * 2);
    g.fill();
  }
  const font = C.mono || "monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [side, z, labelZ] of [
    ["L", -ROW_Z, -ROW_Z + 0.2],
    ["R", ROW_Z, ROW_Z - 0.2]
  ]) {
    HEADER[side].forEach((name, i) => {
      g.fillStyle = C.pad;
      g.beginPath();
      g.arc(px(pinX(i)), pz(z), 0.085 * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.silk;
      g.font = `600 ${Math.round(0.07 * k)}px ${font}`;
      g.fillText(pinLabel(name).replace(/^(TX|RX) /, ""), px(pinX(i)), pz(labelZ));
    });
  }
  g.fillStyle = C.silk;
  g.font = `700 ${Math.round(0.17 * k)}px ${font}`;
  g.textAlign = "left";
  g.fillText("ESP32-S3-DevKitC-1", px(-1.9), pz(-0.12));
  g.font = `500 ${Math.round(0.1 * k)}px ${font}`;
  g.fillStyle = C.silkDim;
  g.fillText("N16R8 \xB7 v1.0", px(-1.9), pz(0.16));
  g.fillStyle = C.silk;
  g.font = `700 ${Math.round(0.09 * k)}px ${font}`;
  g.textAlign = "center";
  g.fillText("COM", px(-2.55), pz(-0.6));
  g.fillText("USB", px(-2.55), pz(0.6));
  g.fillText("BOOT", px(-2.78), pz(-0.56));
  g.fillText("RST", px(-2.78), pz(0.56));
  g.fillText("RGB", px(0.3), pz(0.25));
  g.strokeStyle = C.silk;
  g.lineWidth = 4;
  g.strokeRect(px(0.3) - 0.3 * k, pz(0.62) - 0.3 * k, 0.6 * k, 0.6 * k);
  return tex;
}
const TRACES = [
  [0.25, 0.05, -1.2],
  [0.35, 0.15, -1],
  [-0.15, -0.35, -0.9],
  [-0.25, -0.45, -0.6],
  [0.45, 0.35, -0.4]
];
function canLabel(T, C) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 448;
  const g = c.getContext("2d");
  const tex = new T.CanvasTexture(c);
  if (!g) return tex;
  g.fillStyle = C.metal;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = C.metalDark;
  const font = C.mono || "monospace";
  g.textAlign = "center";
  g.font = `700 46px ${font}`;
  g.fillText("ESPRESSIF", 256, 150);
  g.font = `600 34px ${font}`;
  g.fillText("ESP32-S3-WROOM-1", 256, 220);
  g.font = `500 30px ${font}`;
  g.fillText("N16R8", 256, 278);
  g.strokeStyle = C.metalDark;
  g.lineWidth = 4;
  g.strokeRect(24, 24, 464, 400);
  return tex;
}
export {
  PART_ANCHORS,
  buildBoardScene
};
