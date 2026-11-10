// Project Setu: Procedural Product Wristband 3D Model
import { glowTexture, toon } from '../vendor/esp-labs/toon.js';

export const WRISTBAND_ANCHORS = {
  strap: [-3.2, 0.05, 0], buttons: [-0.85, 0.52, 0.9], rgb: [0, 0.52, -0.22],
  mic: [0.95, 0.49, 0.72], antenna: [0, 0.45, -0.95], gnss: [1.05, 0.48, -0.55]
};

export function buildWristbandScene(T, stage) {
  const group = new T.Group();
  stage.scene.add(group);
  const parts = { strap: [], buttons: [], rgb: [], mic: [], antenna: [], gnss: [], haptic: [], battery: [], usb: [] };
  const mat = (part, c, extra = {}) => {
    const m = toon(T, c, extra);
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

  const housing = mesh(bG(3.5, 0.56, 2.15), mat('strap', '#132e2b'), 0, 0.15, 0);
  mesh(bG(3.2, 0.08, 1.85), mat('strap', '#1b433e'), 0, 0.44, 0);
  const strapMat = mat('strap', '#284b45');
  for (const x of [-4.1, 4.1]) {
    mesh(bG(4.8, 0.2, 1.35), strapMat, x, 0.02, 0);
    for (let r = -1.6; r <= 1.6; r += 0.5) mesh(bG(0.12, 0.04, 1.25), strapMat, x + r, 0.13, 0, false);
  }
  mesh(bG(0.3, 0.28, 1.45), mat('strap', '#64748b'), -6.4, 0.02, 0);
  mesh(cG(0.42, 0.42, 0.08, 24), mat('buttons', '#0b1614'), -0.85, 0.46, 0.9);
  const button = mesh(cG(0.32, 0.32, 0.12, 24), mat('buttons', '#f43f5e'), -0.85, 0.52, 0.9);

  const leds = [], ledGlows = [];
  for (let i = 0; i < 3; i += 1) {
    const light = mesh(new T.SphereGeometry(0.11, 16, 12), mat('rgb', '#2dd4bf', { emissive: new T.Color('#2dd4bf'), emissiveIntensity: 0.5 }), -0.42 + i * 0.42, 0.52, -0.22);
    leds.push(light);
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(T), color: new T.Color('#2dd4bf'), blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
    sprite.position.set(-0.42 + i * 0.42, 0.62, -0.22);
    sprite.scale.setScalar(0.7);
    group.add(sprite);
    ledGlows.push(sprite);
  }

  const micRingMat = new T.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0 });
  mesh(cG(0.08, 0.08, 0.06, 16), mat('mic', '#060d0c'), 0.95, 0.49, 0.72);
  const micSoundRing = new T.Mesh(new T.RingGeometry(0.12, 0.22, 24), micRingMat);
  micSoundRing.rotation.x = -Math.PI / 2;
  micSoundRing.position.set(0.95, 0.52, 0.72);
  group.add(micSoundRing);

  mesh(bG(2.8, 0.04, 0.08), mat('antenna', '#38bdf8'), 0, 0.46, -0.98);
  const radioWaves = Array.from({ length: 3 }, () => {
    const waveMat = new T.MeshBasicMaterial({ color: new T.Color('#38bdf8'), transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false });
    const waveRing = new T.Mesh(new T.RingGeometry(0.9, 0.96, 36, 1, 0, Math.PI), waveMat);
    waveRing.rotation.x = -Math.PI / 2;
    waveRing.position.set(0, 0.5, -1.05);
    group.add(waveRing);
    return { ring: waveRing, mat: waveMat };
  });

  const patchCeramic = mat('gnss', '#d9af55');
  mesh(bG(0.72, 0.06, 0.72), patchCeramic, 1.05, 0.47, -0.55);
  mesh(bG(0.52, 0.02, 0.52), mat('gnss', '#e2e8f0'), 1.05, 0.51, -0.55, false);
  mesh(cG(0.24, 0.24, 0.08, 20), mat('haptic', '#fb923c'), -0.7, 0.22, -0.4, false);
  const battMat = mat('battery', '#3b82f6');
  mesh(bG(1.6, 0.16, 1.4), battMat, 0, 0.06, 0, false);
  mesh(bG(0.12, 0.26, 0.65), mat('usb', '#475569'), -1.78, 0.16, 0);
  mesh(bG(0.04, 0.12, 0.45), mat('usb', '#020617'), -1.83, 0.16, 0, false);

  let activeLitPart = null, isTransmitting = false, isAcousticActive = false, acousticStartTime = 0;
  const hotspotColor = new T.Color('#2dd4bf'), blackColor = new T.Color(0);

  const frame = (t) => {
    radioWaves.forEach(({ ring, mat: rMat }, i) => {
      if (stage.reduce) {
        rMat.opacity = isTransmitting ? 0.6 : 0;
        ring.scale.setScalar(1.2 + i * 0.4);
      } else if (isTransmitting) {
        const k = (t * 0.8 + i / radioWaves.length) % 1;
        ring.scale.setScalar(0.5 + k * 2.2);
        rMat.opacity = (1 - k) * 0.85;
      } else {
        rMat.opacity = 0;
      }
    });
    if (isAcousticActive) {
      const p = ((t - acousticStartTime) * 2.5) % 1;
      micSoundRing.scale.setScalar(1 + p * 2.5);
      micRingMat.opacity = (1 - p) * 0.9;
    } else {
      micRingMat.opacity = 0;
    }

    const pulse = stage.reduce ? 0.4 : 0.3 + 0.15 * Math.sin(t * 5);
    for (const [k, list] of Object.entries(parts)) {
      if (k === 'rgb') continue;
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
    group, button, housing,
    update(node = {}) {
      let c = '#2dd4bf', i = 0.4;
      if (!node.online) { c = '#475569'; i = 0.1; }
      else if (node.bootloader_lock) { c = '#a855f7'; i = 0.8; }
      else if (node.gave_up) { c = '#fb7185'; i = 0.9; }
      else if (node.acked) { c = '#34d399'; i = 1.2; }
      else if (node.active_sos) { c = '#f59e0b'; i = 1.6; }
      else if (node.retry_count > 0) { c = '#fb923c'; i = 1.1; }

      leds.forEach(l => {
        l.material.color.set(c);
        l.material.emissive.set(c);
        l.material.emissiveIntensity = i;
      });
      ledGlows.forEach(s => {
        s.material.color.set(c);
        s.material.opacity = node.online ? (node.active_sos ? 0.95 : 0.6) : 0.1;
        s.scale.setScalar(node.active_sos ? 1.2 : 0.7);
      });
      patchCeramic.color.set((node.gnss_on !== false && node.gnss_status !== 'Lost') ? '#d9af55' : '#64748b');
      const b = typeof node.battery === 'number' ? node.battery : 100;
      battMat.color.set(b < 20 ? '#ef4444' : b < 50 ? '#f59e0b' : '#3b82f6');
    },
    setTransmitting(active) { isTransmitting = Boolean(active); },
    setAcousticPulse(active) {
      isAcousticActive = Boolean(active);
      if (isAcousticActive) acousticStartTime = performance.now() / 1000;
    },
    highlight(partId) { activeLitPart = partId; },
    frame
  };
}
