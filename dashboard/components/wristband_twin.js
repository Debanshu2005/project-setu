// Project Setu: Inspectable 3D Wristband Digital Twin Component
// Renders an interactive WebGL 3D model of the Setu wristband hardware using Three.js:
// strap, polycarbonate casing, internal PCB, SX1262 LoRa transceiver, ESP32-S3 MCU,
// 1000 mAh LiPo pouch, tactile SOS button, OLED display, RGB status LED, and haptic vibration ripple.
// Supports direct controls: button press, voice trigger, battery level, motion profile.

let THREE = null;
let OrbitControls = null;

async function getThree() {
  if (THREE && OrbitControls) return { THREE, OrbitControls };
  if (typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined') {
    try {
      THREE = await import('three');
      const oc = await import('three/addons/OrbitControls.js');
      OrbitControls = oc.OrbitControls;
    } catch (_) {
      try {
        THREE = await import('../vendor/three/three.module.js');
        const oc = await import('../vendor/three/OrbitControls.js');
        OrbitControls = oc.OrbitControls;
      } catch (e) {
        console.warn('[WristbandTwin] Could not load Three.js ES module:', e);
      }
    }
  }
  return { THREE, OrbitControls };
}

export class WristbandTwinComponent {
  constructor(containerId, options = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.options = options;
    this.destroyed = false;
    this.T = null;
    this.currentNode = null;
    this.lossBudget = null;
    this.isPressed = false;
    this.hapticActive = false;
    this.hapticTimer = null;

    // Three.js 3D properties
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.wristbandGroup = null;
    this.buttonMesh = null;
    this.ledMesh = null;
    this.oledMesh = null;
    this.hapticRipples = [];
    this.animId = null;

    if (this.container) {
      this.init();
    }
  }

  async init() {
    this.container.innerHTML = `
      <div class="wristband-twin-panel" style="display:flex; flex-direction:column; gap:12px; background:#0f172a; color:#f8fafc; border-radius:8px; padding:16px; border:1px solid #334155; font-family:sans-serif;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
          <h3 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.05em; color:#38bdf8; font-weight:bold;">Setu Wristband 3D Digital Twin</h3>
          <span id="wtNodeBadge" style="font-size:11px; background:#1e293b; padding:2px 8px; border-radius:4px; color:#94a3b8;">No Node Selected</span>
        </div>

        <!-- 3D Wristband Viewport -->
        <div id="wristband3dMount" style="position:relative; width:100%; height:220px; background:#020617; border-radius:6px; overflow:hidden; border:1px solid #1e293b; cursor:grab;">
          <div id="wtHapticIndicator" style="position:absolute; bottom:8px; left:8px; z-index:10; font-size:10px; color:#f59e0b; opacity:0; transition:opacity 0.2s; font-weight:bold;">
            VIBRATING (ERM Haptic Active)
          </div>
          <div style="position:absolute; top:8px; right:8px; z-index:10; font-size:10px; color:#64748b;">
            Drag to inspect 3D wristband
          </div>
        </div>

        <!-- Direct 3D Operational Controls -->
        <div style="display:flex; flex-direction:column; gap:8px; background:#1e293b; padding:10px; border-radius:6px;">
          <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; font-weight:bold;">Tactile SOS Button</div>
          <div style="display:flex; gap:6px;">
            <button id="wtBtnShort" style="flex:1; background:#ef4444; color:white; border:none; padding:6px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Short Press</button>
            <button id="wtBtnDouble" style="flex:1; background:#e11d48; color:white; border:none; padding:6px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Double Press</button>
            <button id="wtBtnLong" style="flex:1; background:#991b1b; color:white; border:none; padding:6px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Long Press</button>
          </div>
          <div style="display:flex; gap:6px; margin-top:4px;">
            <button id="wtBtnVoice" style="flex:1; background:#0284c7; color:white; border:none; padding:6px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:600;">Voice "Help Setu"</button>
            <select id="wtSelMotion" style="flex:1; background:#0f172a; color:#cbd5e1; border:1px solid #334155; padding:6px; border-radius:4px; font-size:11px;">
              <option value="stationary">Stationary</option>
              <option value="walking">Walking (1.8 Hz)</option>
              <option value="crawling">Rubble Crawl (1.0 Hz)</option>
              <option value="fall_impact">Fall Impact</option>
            </select>
          </div>
        </div>

        <!-- Current Draw Breakdown & Power Telemetry -->
        <div style="background:#1e293b; padding:10px; border-radius:6px; font-size:11px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="color:#94a3b8; font-size:10px; text-transform:uppercase; font-weight:bold;">Power & Battery Telemetry</span>
            <span id="wtBattery" style="font-weight:bold; color:#10b981; font-size:12px;">100% (1000 mAh)</span>
          </div>
          <!-- Current Draw Bars -->
          <div style="display:flex; flex-direction:column; gap:4px; font-size:10px;">
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#94a3b8;">ESP32-S3 Base:</span>
              <span id="wtMcuDraw" style="color:#cbd5e1;">11.1 mA</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#94a3b8;">LoRa SX1262 State:</span>
              <span id="wtLoraDraw" style="color:#cbd5e1;">4.6 mA (RX)</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#94a3b8;">WakeNet Acoustic DSP:</span>
              <span id="wtDspDraw" style="color:#cbd5e1;">65.0 mA (On)</span>
            </div>
            <div style="display:flex; justify-content:space-between; border-top:1px solid #334155; padding-top:4px; font-weight:bold;">
              <span style="color:#38bdf8;">Total Current Draw:</span>
              <span id="wtTotalDraw" style="color:#38bdf8;">80.7 mA (~12.4h life)</span>
            </div>
          </div>
        </div>

        <!-- Kinematics & PDR Positioning Telemetry -->
        <div style="background:#1e293b; padding:10px; border-radius:6px; font-size:11px;">
          <div style="color:#94a3b8; font-size:10px; text-transform:uppercase; font-weight:bold; margin-bottom:4px;">Positioning & PDR Pipeline</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:10px;">
            <div>GNSS: <span id="wtGnssStatus" style="color:#10b981;">Valid Fix</span></div>
            <div>Motion: <span id="wtMotionStatus" style="color:#38bdf8;">Stationary</span></div>
            <div>PDR Drift: <span id="wtPdrDrift" style="color:#cbd5e1;">0.00 m</span></div>
            <div>Search Radius: <span id="wtSearchRadius" style="color:#cbd5e1;">5.0 m</span></div>
          </div>
        </div>

        <!-- Loss Budget & RF Link Margin -->
        <div style="background:#1e293b; padding:10px; border-radius:6px; font-size:11px;">
          <div style="color:#94a3b8; font-size:10px; text-transform:uppercase; margin-bottom:4px; font-weight:bold;">RF Loss Budget to Hub 0</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:10px;">
            <div>TX Power: <span id="wtTxPower" style="color:#f8fafc;">+14.0 dBm</span></div>
            <div>Path Loss: <span id="wtPathLoss" style="color:#f8fafc;">0.0 dB</span></div>
            <div>Obstacles: <span id="wtObstacleLoss" style="color:#f8fafc;">0.0 dB</span></div>
            <div>Body Loss: <span id="wtBodyLoss" style="color:#f8fafc;">0.0 dB</span></div>
            <div>Receiver Sens: <span id="wtSens" style="color:#f8fafc;">-123.0 dBm</span></div>
            <div>Link Margin: <span id="wtLinkMargin" style="font-weight:bold; color:#10b981;">+0.0 dB</span></div>
          </div>
        </div>
      </div>
    `;

    this.mountPoint = document.getElementById('wristband3dMount');
    if (this.mountPoint && typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined') {
      try {
        const { THREE: t, OrbitControls: oc } = await getThree();
        if (this.destroyed) return;
        if (t && oc) {
          this.initThree(t, oc);
        }
      } catch (e) {
        console.warn('[WristbandTwin] WebGL init failed:', e);
      }
    }

    if (this.destroyed) return;
    this.bindEvents();
  }

  initThree(t, oc) {
    this.T = t;
    const width = this.mountPoint.clientWidth || 340;
    const height = this.mountPoint.clientHeight || 220;

    // Renderer
    this.renderer = new t.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.mountPoint.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new t.Scene();
    this.scene.background = new t.Color(0x020617);

    // Camera
    this.camera = new t.PerspectiveCamera(40, width / height, 0.1, 500);
    this.camera.position.set(0, 45, 65);

    // Controls
    this.controls = new oc(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 140;
    this.controls.target.set(0, 0, 0);

    // Lighting
    const amb = new t.AmbientLight(0xffffff, 0.7);
    this.scene.add(amb);

    const dirLight = new t.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(30, 60, 40);
    this.scene.add(dirLight);

    const backLight = new t.DirectionalLight(0x38bdf8, 0.5);
    backLight.position.set(-30, -20, -30);
    this.scene.add(backLight);

    // Build 3D Wristband Model
    this.buildWristband();

    // Render Loop
    this.startRenderLoop();
  }

  buildWristband() {
    const t = this.T;
    if (!t) return;
    this.wristbandGroup = new t.Group();

    // 1. Elastomer Strap (curved loop)
    const strapGeo = new t.TorusGeometry(18, 4.5, 16, 48, Math.PI * 1.5);
    const strapMat = new t.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.8,
      metalness: 0.1
    });
    const strap = new t.Mesh(strapGeo, strapMat);
    strap.rotation.z = Math.PI / 4;
    strap.position.y = -6;
    this.wristbandGroup.add(strap);

    // 2. Ruggedized Polycarbonate Casing
    const caseGeo = new t.BoxGeometry(26, 8, 30);
    const caseMat = new t.MeshPhysicalMaterial({
      color: 0x0f172a,
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: 0.88,
      transmission: 0.3
    });
    const caseMesh = new t.Mesh(caseGeo, caseMat);
    caseMesh.position.y = 4;
    this.wristbandGroup.add(caseMesh);

    // 3. Internal PCB Board
    const pcbGeo = new t.BoxGeometry(22, 1, 26);
    const pcbMat = new t.MeshStandardMaterial({ color: 0x065f46, roughness: 0.5 });
    const pcb = new t.Mesh(pcbGeo, pcbMat);
    pcb.position.y = 3;
    this.wristbandGroup.add(pcb);

    // 4. ESP32-S3 Microcontroller Chip
    const mcuGeo = new t.BoxGeometry(7, 1.2, 7);
    const mcuMat = new t.MeshStandardMaterial({ color: 0x111827, metalness: 0.7, roughness: 0.3 });
    const mcu = new t.Mesh(mcuGeo, mcuMat);
    mcu.position.set(-4, 4.2, -4);
    this.wristbandGroup.add(mcu);

    // 5. Semtech SX1262 LoRa Transceiver
    const loraGeo = new t.BoxGeometry(6, 1.2, 6);
    const loraMat = new t.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.8, roughness: 0.2 });
    const lora = new t.Mesh(loraGeo, loraMat);
    lora.position.set(4, 4.2, -4);
    this.wristbandGroup.add(lora);

    // 6. LiPo Battery Pouch (1000 mAh)
    const battGeo = new t.BoxGeometry(18, 2.5, 11);
    const battMat = new t.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.3 });
    const batt = new t.Mesh(battGeo, battMat);
    batt.position.set(0, 2, 5);
    this.wristbandGroup.add(batt);

    // 7. Tactile SOS Button (depresses on click)
    const btnGeo = new t.CylinderGeometry(4.5, 5, 3, 32);
    const btnMat = new t.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3, metalness: 0.1 });
    this.buttonMesh = new t.Mesh(btnGeo, btnMat);
    this.buttonMesh.position.set(0, 8.5, 0);
    this.wristbandGroup.add(this.buttonMesh);

    // 8. OLED Mini Display
    const oledGeo = new t.PlaneGeometry(16, 7);
    const oledMat = new t.MeshBasicMaterial({ color: 0x0284c7 });
    this.oledMesh = new t.Mesh(oledGeo, oledMat);
    this.oledMesh.rotation.x = -Math.PI / 2;
    this.oledMesh.position.set(0, 8.1, -9);
    this.wristbandGroup.add(this.oledMesh);

    // 9. RGB Status LED
    const ledGeo = new t.SphereGeometry(1.2, 16, 16);
    const ledMat = new t.MeshBasicMaterial({ color: 0x10b981 });
    this.ledMesh = new t.Mesh(ledGeo, ledMat);
    this.ledMesh.position.set(-9, 8.2, 0);
    this.wristbandGroup.add(this.ledMesh);

    // 10. Microphone Port
    const micGeo = new t.CylinderGeometry(0.8, 0.8, 1, 16);
    const micMat = new t.MeshBasicMaterial({ color: 0x0f172a });
    const mic = new t.Mesh(micGeo, micMat);
    mic.position.set(9, 8.1, 0);
    this.wristbandGroup.add(mic);

    this.scene.add(this.wristbandGroup);
  }

  bindEvents() {
    const btnShort = document.getElementById('wtBtnShort');
    const btnDouble = document.getElementById('wtBtnDouble');
    const btnLong = document.getElementById('wtBtnLong');
    const btnVoice = document.getElementById('wtBtnVoice');
    const selMotion = document.getElementById('wtSelMotion');

    if (btnShort) btnShort.addEventListener('click', () => this.simulatePress('short'));
    if (btnDouble) btnDouble.addEventListener('click', () => this.simulatePress('double'));
    if (btnLong) btnLong.addEventListener('click', () => this.simulatePress('long'));
    if (btnVoice) btnVoice.addEventListener('click', () => this.simulateVoice());
    if (selMotion) selMotion.addEventListener('change', (e) => this.setMotionProfile(e.target.value));
  }

  simulatePress(kind) {
    this.isPressed = true;
    if (this.buttonMesh) {
      this.buttonMesh.position.y = 7.0; // Depress button
    }
    if (this.ledMesh) {
      this.ledMesh.material.color.setHex(0xef4444); // Flash red
    }
    this.triggerHaptic(kind === 'long' ? 700 : 250);

    setTimeout(() => {
      this.isPressed = false;
      if (this.buttonMesh) {
        this.buttonMesh.position.y = 8.5; // Return button
      }
    }, 200);

    if (this.options.onButtonPress) {
      this.options.onButtonPress(kind);
    }
  }

  simulateVoice() {
    if (this.ledMesh) {
      this.ledMesh.material.color.setHex(0x38bdf8); // Flash blue on voice
    }
    this.triggerHaptic(150);
    if (this.options.onVoiceTrigger) {
      this.options.onVoiceTrigger();
    }
  }

  setMotionProfile(profile) {
    if (this.options.onMotionChange) {
      this.options.onMotionChange(profile);
    }
  }

  triggerHaptic(durationMs = 250) {
    this.hapticActive = true;
    const ind = document.getElementById('wtHapticIndicator');
    if (ind) ind.style.opacity = '1';

    // Add haptic visual ripple ring
    const t = this.T;
    if (this.wristbandGroup && t) {
      const rippleGeo = new t.RingGeometry(14, 15, 32);
      const rippleMat = new t.MeshBasicMaterial({ color: 0xf59e0b, side: t.DoubleSide, transparent: true, opacity: 0.9 });
      const ripple = new t.Mesh(rippleGeo, rippleMat);
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.y = 4;
      this.wristbandGroup.add(ripple);
      this.hapticRipples.push({ mesh: ripple, life: 1.0 });
    }

    if (this.hapticTimer) clearTimeout(this.hapticTimer);
    this.hapticTimer = setTimeout(() => {
      this.hapticActive = false;
      if (ind) ind.style.opacity = '0';
    }, durationMs);
  }

  updateNode(node, lb = null) {
    this.currentNode = node;
    if (lb) this.updateLossBudget(lb);
    const badge = document.getElementById('wtNodeBadge');
    if (badge) {
      badge.textContent = node ? `Node ${node.id} (${(node.role || 'survivor').toUpperCase()})` : 'No Node Selected';
    }

    // Update Battery & Power
    const battEl = document.getElementById('wtBattery');
    if (battEl) {
      const pct = typeof node.battery === 'number' ? node.battery : 100;
      battEl.textContent = `${pct}% (${node.capacity_mah || 1000} mAh)`;
      battEl.style.color = pct < 20 ? '#ef4444' : pct < 50 ? '#f59e0b' : '#10b981';
    }

    // Update Status LED in 3D
    if (this.ledMesh) {
      if (node.acked) this.ledMesh.material.color.setHex(0x10b981); // Green ACK
      else if (node.active) this.ledMesh.material.color.setHex(0xef4444); // Red SOS
      else this.ledMesh.material.color.setHex(0x64748b); // Idle
    }

    // Update Kinematics & PDR
    const motionEl = document.getElementById('wtMotionStatus');
    if (motionEl) {
      motionEl.textContent = node.motion_profile || 'Stationary';
    }
    const gnssEl = document.getElementById('wtGnssStatus');
    if (gnssEl) {
      gnssEl.textContent = node.gnss ? 'Valid Fix' : 'Denied (PDR Mode)';
      gnssEl.style.color = node.gnss ? '#10b981' : '#f59e0b';
    }
    const pdrEl = document.getElementById('wtPdrDrift');
    if (pdrEl) {
      const err = typeof node.pos_error_m === 'number' ? node.pos_error_m.toFixed(2) : '0.00';
      pdrEl.textContent = `${err} m`;
    }
  }

  updateLossBudget(lb) {
    this.lossBudget = lb;
    const setVal = (id, val, color) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val;
        if (color) el.style.color = color;
      }
    };

    if (!lb) {
      setVal('wtTxPower', '+14.0 dBm');
      setVal('wtPathLoss', '0.0 dB');
      setVal('wtObstacleLoss', '0.0 dB');
      setVal('wtBodyLoss', '0.0 dB');
      setVal('wtSens', '-123.0 dBm');
      setVal('wtLinkMargin', '+0.0 dB', '#10b981');
      return;
    }

    setVal('wtTxPower', `+${(lb.tx_power_dbm || 14.0).toFixed(1)} dBm`);
    setVal('wtPathLoss', `${(lb.path_loss_db || 0.0).toFixed(1)} dB`);
    setVal('wtObstacleLoss', typeof lb.obstacle_loss === 'string' ? lb.obstacle_loss : `${(lb.obstacle_loss || 0).toFixed(1)} dB`);
    setVal('wtBodyLoss', typeof lb.body_loss === 'string' ? lb.body_loss : `${(lb.body_loss || 0).toFixed(1)} dB`);
    setVal('wtSens', `${(lb.sensitivity_dbm || -123.0).toFixed(1)} dBm`);

    const margin = typeof lb.link_margin_db === 'number' ? lb.link_margin_db : 0.0;
    const marginColor = margin > 15 ? '#10b981' : margin > 5 ? '#f59e0b' : '#ef4444';
    setVal('wtLinkMargin', `${margin > 0 ? '+' : ''}${margin.toFixed(1)} dB`, marginColor);
  }

  startRenderLoop() {
    if (this.destroyed) return;
    let lastTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const render = (now) => {
      if (this.destroyed) return;
      const currentTime = now || (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const delta = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      if (this.controls) {
        this.controls.update();
      }

      // Haptic Vibration Jitter
      if (this.hapticActive && this.wristbandGroup) {
        this.wristbandGroup.position.x = (Math.random() - 0.5) * 0.8;
        this.wristbandGroup.position.z = (Math.random() - 0.5) * 0.8;
      } else if (this.wristbandGroup) {
        this.wristbandGroup.position.x = 0;
        this.wristbandGroup.position.z = 0;
      }

      // Animate Haptic Ripple Rings
      for (let i = this.hapticRipples.length - 1; i >= 0; i--) {
        const r = this.hapticRipples[i];
        r.mesh.scale.multiplyScalar(1.0 + delta * 2.5);
        r.life -= delta * 2.0;
        r.mesh.material.opacity = Math.max(0, r.life);
        if (r.life <= 0) {
          this.wristbandGroup.remove(r.mesh);
          this.hapticRipples.splice(i, 1);
        }
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }

      if (this.destroyed) return;
      if (typeof requestAnimationFrame === 'function') {
        this.animId = requestAnimationFrame(render);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      this.animId = requestAnimationFrame(render);
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.animId) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.animId);
      }
      this.animId = null;
    }
    if (this.hapticTimer) {
      clearTimeout(this.hapticTimer);
      this.hapticTimer = null;
    }
    if (this.renderer && typeof this.renderer.dispose === 'function') {
      this.renderer.dispose();
    }
    if (this.controls && typeof this.controls.dispose === 'function') {
      this.controls.dispose();
    }
  }
}
