// Project Setu: Interactive 3D Hardware Digital Twin & Educational Explorer
import { DEVKITC_PARTS, WRISTBAND_PARTS, BUS_COLORS } from '../src/hardware_parts.js';

const PREVIEW = './vendor/esp-labs/preview.png';
const PIN0_X = 2.95, PITCH = 0.254, ROW_Z = 2.54 / 2 - 0.13;
const pinX = i => PIN0_X - i * PITCH;

export class HardwareExplorer {
  constructor(container) {
    this.container = container;
    this.stage = this.scene = this.wristband = this.T = this.pinMap = null;
    this.model = 'prototype';
    this.wiringOverlay = this.mobileStage = this.active = this._mounted = false;
    this.onTrigger = this.onNavigate = this.onFault = null;
    this.lastTx = this.raf = this.lastFrame = this.settledFrames = this._voiceCountdown = 0;
    this.pinnedPart = this.pinnedPin = this.resizeObserver = this._voiceTimer = this.currentNode = null;
    this.visible = !document.hidden;
    this.wiringMarkers = [];
    this.q = sel => this.container.querySelector(sel);
    this.qa = sel => this.container.querySelectorAll(sel);
    this._onVisibility = () => {
      this.visible = !document.hidden;
      if (this.visible && this.active) this.requestRender();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  async mount() {
    if (this._mounted) return this;
    this._mounted = true;
    try {
      const resp = await fetch('./firmware/pinmap.json');
      if (resp.ok) this.pinMap = await resp.json();
    } catch (_) {}

    const legendHtml = Object.values(BUS_COLORS).map(b => `<span class="legend-item" style="--bus-color:${b.color}">${b.name}</span>`).join('');
    const actBtns = [['short', 'Press (Short)'], ['double', 'Double Press'], ['long', 'Long Press'], ['voice', 'Say Setu'], ['strapping', 'Strapping Lock']]
      .map(([k, t]) => `<button type="button" data-hardware-trigger="${k}">${t}</button>`).join('');
    const ctrlBtns = [['left','↶','Rotate left'],['right','↷','Rotate right'],['out','−','Zoom out'],['in','+','Zoom in'],['reset','Reset','Reset view']]
      .map(([k, t, a]) => `<button type="button" data-hardware-action="${k}" aria-label="${a}">${t}</button>`).join('');

    this.container.innerHTML = `<section class="hardware-explorer" aria-label="Hardware explorer and digital twin"><div class="hardware-explorer-layout"><div class="hardware-card-column hardware-cards-left" aria-label="Left board part callouts">${this.#cardMarkup('left')}</div><div class="hardware-stage" data-hardware-stage tabindex="0" aria-label="Interactive 3D board model. Use arrow keys to rotate, plus and minus to zoom, and Escape to clear selection."><canvas aria-label="Interactive 3D hardware model"></canvas><div class="hardware-labels"></div><p class="hardware-hint">Drag to turn. Pinch to zoom.</p><div class="hardware-model-toggle" role="group" aria-label="Hardware model selector"><button type="button" data-hardware-model="prototype" aria-pressed="true">DevKitC-1</button><button type="button" data-hardware-model="wristband" aria-pressed="false">Setu Wristband</button><button type="button" data-hardware-view="wiring" aria-pressed="false" title="Inspect DevKitC-1 pin headers">Wiring View</button></div><div class="hardware-wiring-legend" hidden aria-label="Wiring bus color legend">${legendHtml}</div><div class="hardware-live-hud hardware-live" aria-live="polite"><span class="hardware-live-node">Node 1 (survivor)</span><span class="hardware-live-led">LED: idle</span><span class="hardware-live-radio">Radio: idle</span><span class="hardware-live-gnss">GNSS: unavailable</span><span class="hardware-live-battery">Battery: 100%</span></div><div class="hardware-voice-panel" hidden aria-label="Voice trigger listening window"><span class="voice-wave-dot"></span><span class="voice-text">WakeNet Listening: "Say Setu"</span><span class="voice-countdown">10s</span></div><div class="hardware-actions" aria-label="Hardware simulation triggers">${actBtns}</div><div class="hardware-controls" aria-label="Camera orbit controls">${ctrlBtns}</div></div><div class="hardware-card-column hardware-cards-right" aria-label="Right board part callouts">${this.#cardMarkup('right')}</div></div><div class="hardware-explainer-dialog" hidden role="dialog" aria-modal="true" aria-label="Component Educational Explainer"></div></section>`;

    if (!this.#canUseWebgl()) {
      this.#showFallback('WebGL is unavailable. Showing the static board preview.');
      return this;
    }

    try {
      const [T, stageModule, sceneModule, wristbandModule] = await Promise.all([
        import('three'),
        import('../vendor/esp-labs/stage3d.js'),
        import('../vendor/esp-labs/esp32-scene.js'),
        import('./wristband_scene.js')
      ]);

      const box = this.q('[data-hardware-stage]');
      const canvas = box.querySelector('canvas');
      const labels = box.querySelector('.hardware-labels');
      this.T = T;

      const isMobile = window.innerWidth <= 600 || box.clientWidth <= 600;
      const dprCap = isMobile ? 1.5 : Math.min(window.devicePixelRatio || 1, 2.0);

      this.stage = new stageModule.Stage3d(T, box, canvas, labels, {
        target: { x: 0.1, y: -0.15, z: 0 },
        radius: 9.5,
        fitWidth: 7.2,
        az: 1.22,
        el: 0.74,
        fov: 30,
        spin: false,
        sway: 0,
        zoom: [0.55, 1.4],
        dragOn: 'canvas',
        ground: { w: 9.5, d: 4.6, y: -0.82 },
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches
      });

      if (this.stage.renderer?.setPixelRatio) this.stage.renderer.setPixelRatio(dprCap);

      this.scene = sceneModule.buildBoardScene(T, this.stage);
      this.wristband = wristbandModule.buildWristbandScene(T, this.stage);
      this.stage.outline();
      this.#setupPartsAndMarkers();
      this.#setupWiringView();

      this.resizeObserver = new ResizeObserver(() => {
        const mobile = box.clientWidth <= 600;
        if (mobile !== this.mobileStage) {
          this.mobileStage = mobile;
          if (mobile) this.stage.zoom(1.28);
          else this.stage.recenter();
        }
        this.requestRender();
      });
      this.resizeObserver.observe(box);
      this.#bindControls();

      canvas.addEventListener('pointermove', () => this.requestRender());
      canvas.addEventListener('pointerdown', () => this.requestRender());
      canvas.addEventListener('pointerup', event => this.#tryModelButton(event));
      canvas.addEventListener('wheel', () => this.requestRender(), { passive: true });
      this.requestRender();
    } catch (error) {
      console.warn('Hardware explorer initialization error:', error);
      this.#showFallback('The 3D board could not load. Showing the static board preview.');
    }
    return this;
  }

  setActive(active) {
    this.active = Boolean(active);
    if (this.active) {
      this.settledFrames = 0;
      this.requestRender();
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  updateNode(node) {
    if (!node) return;
    this.currentNode = node;
    this.wristband?.update(node);

    let led = 'idle';
    if (node.bootloader_lock) led = 'bootloader lock (GPIO 0 trapped)';
    else if (!node.online) led = 'offline';
    else if (node.gave_up) led = 'gave up (timeout)';
    else if (node.acked) led = 'ACK received';
    else if (node.active_sos) led = 'transmitting SOS';
    else if (node.retry_count > 0) led = `retry ${node.retry_count}`;

    const radio = node.stats?.tx ? `TX ${node.stats.tx} pkts` : 'radio standby';
    const gnss = node.gnss_status || (node.gnss_on === false ? 'denied / offline' : 'active fix');
    const batt = typeof node.battery === 'number' ? `${node.battery.toFixed(0)}%` : 'not available';

    const setHud = (cls, text) => {
      const el = this.q(cls);
      if (el) el.textContent = text;
    };
    setHud('.hardware-live-node', `Node ${node.id} (${node.role || 'survivor'})`);
    setHud('.hardware-live-led', `LED: ${led}`);
    setHud('.hardware-live-radio', `Radio: ${radio}`);
    setHud('.hardware-live-gnss', `GNSS: ${gnss}`);
    setHud('.hardware-live-battery', `Battery: ${batt}`);

    const tx = node.stats?.tx || 0;
    if (tx > this.lastTx) {
      this.scene?.setTransmitting(true);
      this.wristband?.setTransmitting(true);
      this.q('.hardware-stage')?.classList.add('is-haptic');
      setTimeout(() => {
        this.scene?.setTransmitting(false);
        this.wristband?.setTransmitting(false);
        this.q('.hardware-stage')?.classList.remove('is-haptic');
        this.requestRender();
      }, 700);
    }
    this.lastTx = tx;
    this.#updateCardLiveValues(node);
    this.requestRender();
  }

  requestRender() {
    if (!this.stage || !this.active || !this.visible || this.raf) return;
    this.raf = requestAnimationFrame(now => {
      this.raf = 0;
      const dt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
      this.lastFrame = now;
      this.stage.tick(now, dt);
      const isMoving = this.stage.camMoving || Boolean(this.scene?.lit) || this._voiceCountdown > 0;
      if (isMoving) {
        this.settledFrames = 0;
        this.requestRender();
      } else if (++this.settledFrames < 4) {
        this.requestRender();
      }
    });
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this._voiceTimer) clearInterval(this._voiceTimer);
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.stage?.dispose();
    this.stage = this.scene = this.wristband = this.T = this.resizeObserver = this._voiceTimer = null;
    this.raf = 0;
    this.container.replaceChildren();
  }

  #setupPartsAndMarkers() {
    const isW = (this.model === 'wristband');
    const list = isW ? WRISTBAND_PARTS : DEVKITC_PARTS;
    const anchors = isW
      ? { strap: [-3.2, 0.05, 0], buttons: [-0.85, 0.52, 0.9], rgb: [0, 0.52, -0.22], mic: [0.95, 0.49, 0.72], antenna: [0, 0.45, -0.95], gnss: [1.05, 0.48, -0.55] }
      : { usb: [-3.3, 0.33, -0.6], buttons: [-2.78, 0.24, 0.86], rgb: [0.3, 0.12, 0.62], module: [1.6, 0.42, -0.2], antenna: [3.18, 0.1, 0.1], headers: [ pinX(16), 0.06, 1.14 ] };

    const leftCol = this.q('.hardware-cards-left');
    const rightCol = this.q('.hardware-cards-right');
    if (leftCol) leftCol.innerHTML = this.#cardMarkup('left');
    if (rightCol) rightCol.innerHTML = this.#cardMarkup('right');

    const labelsEl = this.q('.hardware-labels');
    if (labelsEl) {
      labelsEl.querySelectorAll('.stage-hotspot.hardware-marker').forEach(m => m.remove());
      const svg = labelsEl.querySelector('.stage-leaders');
      if (svg) svg.innerHTML = '';
    }

    if (!this.T || !this.stage) return;
    for (const part of list) {
      const pos = anchors[part.id];
      if (!pos) continue;
      const point = new this.T.Vector3(...pos);
      const card = this.q(`[data-hardware-part="${part.id}"]`);
      const marker = this.stage.label(String(part.number), point, () => !this.wiringOverlay, 'stage-hotspot hardware-marker');
      marker.dataset.hardwarePart = part.id;
      marker.tabIndex = 0;
      marker.setAttribute('role', 'button');
      marker.setAttribute('aria-label', `${part.title}: ${part.what}`);
      this.stage.leader(part.id, point, card);

      const preview = () => this.#previewPart(part.id);
      const release = () => this.#releasePreview();
      [card, marker].forEach(el => {
        el?.addEventListener('pointerenter', preview);
        el?.addEventListener('pointerleave', release);
        el?.addEventListener('focus', preview);
        el?.addEventListener('blur', release);
        el?.addEventListener('click', () => this.#togglePinPart(part.id));
      });
      marker.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.#togglePinPart(part.id);
        }
      });
    }
  }

  #setupWiringView() {
    if (!this.T || !this.stage || !this.pinMap?.pins) return;
    const HL = '3V3,3V3,RST,4,5,6,7,15,16,17,18,8,3,46,9,10,11,12,13,14,5V,GND'.split(',');
    const HR = 'GND,43,44,1,2,42,41,40,39,38,37,36,35,0,45,48,47,21,20,19,GND,GND'.split(',');
    this.wiringMarkers.forEach(m => m.remove());
    this.wiringMarkers = [];

    for (const pin of this.pinMap.pins) {
      const isLeft = pin.header.startsWith('L');
      const idx = (isLeft ? HL : HR).indexOf(String(pin.gpio));
      if (idx === -1) continue;

      const point = new this.T.Vector3(pinX(idx), 0.16, isLeft ? -ROW_Z : ROW_Z);
      const busDef = BUS_COLORS[pin.bus] || { color: '#2dd4bf', name: pin.bus };
      const marker = this.stage.label(`GPIO ${pin.gpio}`, point, () => (this.wiringOverlay && this.model === 'prototype'), 'stage-hotspot hardware-pin-marker');
      marker.style.setProperty('--pin-bus-color', busDef.color);
      marker.dataset.pinGpio = String(pin.gpio);
      marker.dataset.pinBus = pin.bus;
      marker.tabIndex = 0;
      marker.setAttribute('role', 'button');
      marker.setAttribute('aria-label', `GPIO ${pin.gpio}: ${pin.module} (${pin.signal}), Bus: ${busDef.name}`);

      const showTip = () => marker.setAttribute('title', `GPIO ${pin.gpio} · ${pin.signal} · ${pin.module} (${busDef.name})`);
      marker.addEventListener('pointerenter', showTip);
      marker.addEventListener('focus', showTip);
      marker.addEventListener('click', () => {
        this.pinnedPin = (this.pinnedPin === pin.gpio) ? null : pin.gpio;
        const hud = this.q('.hardware-live-node');
        if (hud && this.pinnedPin) hud.textContent = `Pin: GPIO ${pin.gpio} (${pin.signal} / ${pin.module})`;
      });
      this.wiringMarkers.push(marker);
    }
  }

  #bindControls() {
    const actMap = { left: () => this.stage.rotate(-0.4), right: () => this.stage.rotate(0.4), out: () => this.stage.zoom(1.18), in: () => this.stage.zoom(0.85), reset: () => this.stage.recenter() };
    this.q('.hardware-controls')?.addEventListener('click', event => {
      const a = event.target.closest('button')?.dataset.hardwareAction;
      if (a && actMap[a]) { actMap[a](); this.requestRender(); }
    });

    const keyMap = { ArrowLeft: () => this.stage.rotate(-0.2), ArrowRight: () => this.stage.rotate(0.2), '+': () => this.stage.zoom(0.88), '=': () => this.stage.zoom(0.88), '-': () => this.stage.zoom(1.14) };
    this.q('[data-hardware-stage]')?.addEventListener('keydown', event => {
      if (!this.stage) return;
      if (keyMap[event.key]) { keyMap[event.key](); event.preventDefault(); this.requestRender(); }
      else if (event.key === 'Escape') { this.#pinPart(null); this.#closeExplainerDialog(); this.#toggleWiringView(false); this.requestRender(); }
    });

    this.q('.hardware-model-toggle')?.addEventListener('click', event => {
      const mBtn = event.target.closest('button[data-hardware-model]');
      if (mBtn) return this.#setModel(mBtn.dataset.hardwareModel);
      const vBtn = event.target.closest('button[data-hardware-view]');
      if (vBtn) this.#toggleWiringView(!this.wiringOverlay);
    });

    this.q('.hardware-actions')?.addEventListener('click', event => {
      const btn = event.target.closest('button[data-hardware-trigger]');
      if (!btn) return;
      const t = btn.dataset.hardwareTrigger;
      if (t === 'voice') this.#triggerVoiceActivation();
      else if (t === 'strapping') this.#triggerStrappingLock();
      else if (this.onTrigger) {
        this.onTrigger(t);
        this.#animateButtonDepression();
      }
    });
  }

  #setModel(model) {
    if (!model || model === this.model) return;
    this.model = model;
    const isW = (model === 'wristband');
    if (this.scene?.board) this.scene.board.visible = !isW;
    if (this.wristband?.group) this.wristband.group.visible = isW;
    this.qa('[data-hardware-model]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.hardwareModel === model)));
    if (isW && this.wiringOverlay) this.#toggleWiringView(false);
    this.#setupPartsAndMarkers();
    this.requestRender();
  }

  #toggleWiringView(enabled) {
    this.wiringOverlay = Boolean(enabled);
    const btn = this.q('[data-hardware-view="wiring"]');
    if (btn) btn.setAttribute('aria-pressed', String(this.wiringOverlay));
    const leg = this.q('.hardware-wiring-legend');
    if (leg) leg.hidden = !this.wiringOverlay;
    if (this.wiringOverlay && this.model !== 'prototype') this.#setModel('prototype');
    this.requestRender();
  }

  #triggerVoiceActivation() {
    const p = this.q('.hardware-voice-panel');
    const cd = this.q('.voice-countdown');
    if (!p) return;
    this.wristband?.setAcousticPulse(true);
    p.hidden = false;
    this._voiceCountdown = 10;
    if (cd) cd.textContent = '10s';
    if (this._voiceTimer) clearInterval(this._voiceTimer);
    this._voiceTimer = setInterval(() => {
      this._voiceCountdown -= 1;
      if (cd) cd.textContent = `${this._voiceCountdown}s`;
      if (this._voiceCountdown <= 0) {
        clearInterval(this._voiceTimer);
        this._voiceTimer = null;
        p.hidden = true;
        this.wristband?.setAcousticPulse(false);
        if (this.onTrigger) this.onTrigger('voice');
      }
      this.requestRender();
    }, 1000);
    this.requestRender();
  }

  #triggerStrappingLock() {
    if (this.currentNode) {
      this.currentNode.bootloader_lock = !this.currentNode.bootloader_lock;
      this.currentNode.online = !this.currentNode.bootloader_lock;
      this.updateNode(this.currentNode);
      if (this.onFault) this.onFault(this.currentNode.id, { bootloader_lock: this.currentNode.bootloader_lock, online: this.currentNode.online });
    }
  }

  #animateButtonDepression() {
    const btnMesh = (this.model === 'wristband') ? this.wristband?.button : null;
    if (btnMesh) {
      btnMesh.position.y = 0.44;
      setTimeout(() => {
        if (btnMesh) btnMesh.position.y = 0.52;
        this.requestRender();
      }, 160);
    }
    this.requestRender();
  }

  #tryModelButton(event) {
    if (!this.stage?.wasClick() || !this.T) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ptr = new this.T.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const hit = new this.T.Raycaster();
    hit.setFromCamera(ptr, this.stage.camera);
    const target = (this.model === 'wristband') ? this.wristband?.button : null;
    if (target && hit.intersectObject(target, false).length) {
      this.#animateButtonDepression();
      if (this.onTrigger) this.onTrigger('short');
    }
  }

  #cardMarkup(side) {
    const list = (this.model === 'wristband') ? WRISTBAND_PARTS : DEVKITC_PARTS;
    return list.filter(p => p.side === side).map(p => `<button type="button" class="hardware-card" data-hardware-part="${p.id}" aria-pressed="false" aria-label="${p.title}: ${p.subtitle}"><span class="hardware-card-number">${p.number}</span><span class="hardware-card-copy"><strong>${p.title}</strong><span class="hardware-card-sub">${p.subtitle}</span><span class="hardware-card-desc">${p.what}</span><span class="hardware-card-live" data-live-part="${p.id}">Status: standby</span></span></button>`).join('');
  }

  #updateCardLiveValues(node) {
    if (!node) return;
    const liveMap = {
      usb: node.online ? 'UART0 115200' : 'offline',
      buttons: node.bootloader_lock ? 'Stuck in ROM bootloader (GPIO 0 low)' : 'Button ready (GPIO ISR)',
      rgb: node.active_sos ? 'Pattern: SOS active' : node.acked ? 'Pattern: ACK confirmed' : 'Pattern: idle pulse',
      module: `PDR steps: ${node.step_count || 0} · 240 MHz`,
      antenna: `LoRa 868.1 MHz · TX: ${node.stats?.tx || 0}`,
      headers: 'Buses: SPI, UART, I2C, I2S, PWM, ADC',
      gnss: `Fix: ${node.gnss_status || '3D Fix'} · Sats: ${node.satellites || 8}`,
      battery: `Capacity: ${node.battery ? node.battery.toFixed(0) : 100}% · Draw: 22 mA`,
      mic: 'WakeNet listening 16 kHz I2S'
    };
    this.qa('[data-live-part]').forEach(el => {
      const v = liveMap[el.dataset.livePart];
      if (v) el.textContent = v;
    });
  }

  #previewPart(id) {
    if (this.pinnedPart) return;
    this.stage?.focus(id);
    this.scene?.highlight(id);
    this.wristband?.highlight(id);
    this.#setCardState(id, false);
    this.requestRender();
  }

  #releasePreview() {
    if (this.pinnedPart) return;
    this.stage?.focus(null);
    this.scene?.highlight(null);
    this.wristband?.highlight(null);
    this.#setCardState(null, false);
    this.requestRender();
  }

  #togglePinPart(id) {
    if (this.pinnedPart === id) {
      this.#pinPart(null);
      this.#closeExplainerDialog();
    } else {
      this.#pinPart(id);
      this.#openExplainerDialog(id);
    }
  }

  #pinPart(id) {
    this.pinnedPart = id;
    this.stage?.focus(id);
    this.scene?.highlight(id);
    this.wristband?.highlight(id);
    this.#setCardState(id, true);
    this.requestRender();
  }

  #setCardState(id, pinned) {
    this.qa('[data-hardware-part]').forEach(item => {
      const active = (item.dataset.hardwarePart === id);
      item.classList.toggle('is-active', active);
      item.classList.toggle('is-pinned', active && pinned);
      if (item.matches('.hardware-card')) item.setAttribute('aria-pressed', active && pinned ? 'true' : 'false');
    });
  }

  #openExplainerDialog(id) {
    const dialog = this.q('.hardware-explainer-dialog');
    if (!dialog) return;
    const list = (this.model === 'wristband') ? WRISTBAND_PARTS : DEVKITC_PARTS;
    const part = list.find(p => p.id === id);
    if (!part) return;

    const prov = (part.provenance || []).map(p => `<div class="explainer-prov-item"><span class="prov-tag prov-${p.tag}">${p.tag.toUpperCase()}</span><span class="prov-fact">${p.fact}</span>${p.source ? `<span class="prov-source">(${p.source})</span>` : ''}</div>`).join('');
    const chips = (part.chips || []).map(c => `<button type="button" class="explainer-action-chip" data-chip-action="${c.action}" ${c.paramLink ? `data-param-link="${c.paramLink}"` : ''}>${c.label}</button>`).join('');

    const sec = (h, b) => `<div class="explainer-section"><h4>${h}</h4>${b}</div>`;
    dialog.innerHTML = `<div class="explainer-content"><div class="explainer-header"><div><h3>${part.title}</h3><p class="explainer-subtitle">${part.subtitle}</p></div><button type="button" class="explainer-close" aria-label="Close explainer dialog">✕</button></div><div class="explainer-body">${sec('What it is', `<p>${part.what}</p>`)}${sec('Why it matters in Setu', `<p>${part.why}</p>`)}${sec('Pin assignments & buses', `<p class="explainer-code">${part.pins}</p>`)}${sec('What to watch in the simulator', `<p>${part.simulator}</p>`)}${sec('Provenance & physical standards', `<div class="explainer-provenance-list">${prov}</div>`)}${sec('Related views', `<div class="explainer-chips-row">${chips}</div>`)}</div></div>`;
    dialog.hidden = false;

    dialog.querySelector('.explainer-close')?.addEventListener('click', () => {
      this.#closeExplainerDialog();
      this.#pinPart(null);
    });

    dialog.querySelectorAll('.explainer-action-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.chipAction;
        if (action === 'wiring') {
          this.#toggleWiringView(true);
          this.#closeExplainerDialog();
        } else if (action === 'docs') {
          const link = btn.dataset.paramLink || 'docs/PARAMETERS.md';
          window.open(link, '_blank');
        } else if (this.onNavigate) {
          this.onNavigate(action);
        }
      });
    });
  }

  #closeExplainerDialog() {
    const dialog = this.q('.hardware-explainer-dialog');
    if (dialog) dialog.hidden = true;
  }

  #canUseWebgl() {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (_) {
      return false;
    }
  }

  #showFallback(msg) {
    this.container.innerHTML = `<section class="hardware-fallback" role="status"><img src="${PREVIEW}" alt="Illustrated ESP32-S3 DevKitC-1 board preview" /><p>${msg}</p></section>`;
  }
}
