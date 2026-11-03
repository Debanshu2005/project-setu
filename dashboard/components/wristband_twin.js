// Project Setu: Procedural Wristband Digital Twin Component
// Renders an inspectable procedural 3D model of the hardware wristband without external CAD/GLTF files.
// Displays live telemetry: button state, status LEDs, ERM haptic vibration, battery consumption, and loss budget.

export class WristbandTwinComponent {
  constructor(containerId, options = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.options = options;
    this.currentNode = null;
    this.lossBudget = null;
    this.isPressed = false;
    this.hapticActive = false;
    this.hapticTimer = null;
    this.canvas = null;
    this.ctx = null;
    this.animFrameId = null;
    this.angle = 0;
    this.vibrationOffset = 0;

    if (this.container) {
      this.init();
    }
  }

  init() {
    this.container.innerHTML = `
      <div class="wristband-twin-panel" style="display:flex; flex-direction:column; gap:12px; background:#0f172a; color:#f8fafc; border-radius:8px; padding:16px; border:1px solid #334155; font-family:sans-serif;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
          <h3 style="margin:0; font-size:14px; text-transform:uppercase; letter-spacing:0.05em; color:#38bdf8;">Setu Twin: Procedural Hardware Inspector</h3>
          <span id="wtNodeBadge" style="font-size:12px; background:#1e293b; padding:2px 8px; border-radius:4px; color:#94a3b8;">No Node Selected</span>
        </div>

        <div style="position:relative; width:100%; height:200px; background:#020617; border-radius:6px; overflow:hidden; border:1px solid #1e293b; display:flex; justify-content:center; align-items:center;">
          <canvas id="wristbandCanvas" width="360" height="200" style="display:block;"></canvas>
          <div id="wtHapticIndicator" style="position:absolute; bottom:8px; left:8px; font-size:11px; color:#f59e0b; opacity:0; transition:opacity 0.2s;">
            VIBRATING (ERM Haptic Active)
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px;">
          <div style="background:#1e293b; padding:8px; border-radius:4px;">
            <div style="color:#94a3b8; font-size:10px; text-transform:uppercase;">Battery & Draw</div>
            <div id="wtBattery" style="font-size:16px; font-weight:bold; color:#10b981;">100%</div>
            <div id="wtCurrentDraw" style="color:#cbd5e1; font-size:11px;">11.1 mA standby</div>
          </div>
          <div style="background:#1e293b; padding:8px; border-radius:4px;">
            <div style="color:#94a3b8; font-size:10px; text-transform:uppercase;">Kinematics & GNSS</div>
            <div id="wtMotion" style="font-size:14px; font-weight:bold; color:#38bdf8;">Stationary</div>
            <div id="wtGnss" style="color:#cbd5e1; font-size:11px;">GNSS Fix: Valid</div>
          </div>
        </div>

        <div style="background:#1e293b; padding:10px; border-radius:4px; font-size:11px;">
          <div style="color:#94a3b8; font-size:10px; text-transform:uppercase; margin-bottom:4px; font-weight:bold;">Loss Budget & Link Margin (Hub 0)</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px;">
            <div>TX Power: <span id="wtTxPower" style="color:#f8fafc;">+14.0 dBm</span></div>
            <div>Ref Loss (1m): <span id="wtRefLoss" style="color:#f8fafc;">31.2 dB</span></div>
            <div>Path Loss: <span id="wtPathLoss" style="color:#f8fafc;">0.0 dB</span></div>
            <div>Shadow Loss: <span id="wtShadowLoss" style="color:#f8fafc;">0.0 dB</span></div>
            <div>Obstacle Loss: <span id="wtObstacleLoss" style="color:#f8fafc;">0.0 dB</span></div>
            <div>Body Shadowing: <span id="wtBodyLoss" style="color:#f8fafc;">0.0 dB</span></div>
            <div>Receiver Sens: <span id="wtSens" style="color:#f8fafc;">-123.0 dBm</span></div>
            <div>Link Margin: <span id="wtLinkMargin" style="font-weight:bold; color:#10b981;">+0.0 dB</span></div>
          </div>
        </div>

        <div style="display:flex; gap:6px;">
          <button id="wtBtnShort" style="flex:1; background:#ef4444; color:white; border:none; padding:8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Short Press</button>
          <button id="wtBtnDouble" style="flex:1; background:#e11d48; color:white; border:none; padding:8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Double Press</button>
          <button id="wtBtnLong" style="flex:1; background:#991b1b; color:white; border:none; padding:8px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Long Press</button>
        </div>
      </div>
    `;

    this.canvas = document.getElementById('wristbandCanvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.startAnimation();
    }

    this.bindEvents();
  }

  bindEvents() {
    const btnShort = document.getElementById('wtBtnShort');
    const btnDouble = document.getElementById('wtBtnDouble');
    const btnLong = document.getElementById('wtBtnLong');

    if (btnShort) btnShort.addEventListener('click', () => this.simulatePress('short'));
    if (btnDouble) btnDouble.addEventListener('click', () => this.simulatePress('double'));
    if (btnLong) btnLong.addEventListener('click', () => this.simulatePress('long'));
  }

  simulatePress(kind) {
    if (!this.currentNode) return;
    this.isPressed = true;
    this.triggerHaptic(kind === 'long' ? 600 : 200);

    setTimeout(() => {
      this.isPressed = false;
    }, kind === 'long' ? 1600 : 200);

    if (typeof this.options.onTrigger === 'function') {
      this.options.onTrigger(this.currentNode.id, kind);
    }
  }

  triggerHaptic(durationMs = 250) {
    this.hapticActive = true;
    const ind = document.getElementById('wtHapticIndicator');
    if (ind) ind.style.opacity = '1';

    if (this.hapticTimer) clearTimeout(this.hapticTimer);
    this.hapticTimer = setTimeout(() => {
      this.hapticActive = false;
      if (ind) ind.style.opacity = '0';
    }, durationMs);
  }

  updateNode(node, lossBudget = null) {
    this.currentNode = node;
    this.lossBudget = lossBudget;

    const badge = document.getElementById('wtNodeBadge');
    if (badge) {
      badge.textContent = node ? `Node ${node.id} (${node.role || 'survivor'})` : 'No Node Selected';
    }

    const batt = document.getElementById('wtBattery');
    if (batt && node) {
      batt.textContent = `${node.battery || 100}%`;
      batt.style.color = (node.battery < 20) ? '#ef4444' : (node.battery < 50) ? '#f59e0b' : '#10b981';
    }

    const motion = document.getElementById('wtMotion');
    if (motion && node) {
      motion.textContent = (node.motion_profile || 'stationary').toUpperCase();
    }

    const gnss = document.getElementById('wtGnss');
    if (gnss && node) {
      gnss.textContent = node.gnss_on !== false ? 'GNSS Fix: Valid' : 'GNSS: Denied (IMU DR)';
    }

    if (lossBudget) {
      const elTx = document.getElementById('wtTxPower');
      const elPath = document.getElementById('wtPathLoss');
      const elObs = document.getElementById('wtObstacleLoss');
      const elBody = document.getElementById('wtBodyLoss');
      const elMargin = document.getElementById('wtLinkMargin');
      if (elTx) elTx.textContent = `${lossBudget.tx_power_dbm.toFixed(1)} dBm`;
      if (elPath) elPath.textContent = `${lossBudget.path_loss_db.toFixed(1)} dB`;
      if (elObs) elObs.textContent = typeof lossBudget.obstacle === 'string' ? lossBudget.obstacle : `${(lossBudget.obstacle_loss_db || 0).toFixed(1)} dB`;
      if (elBody) elBody.textContent = typeof lossBudget.body === 'string' ? lossBudget.body : `${(lossBudget.body_loss_db || 0).toFixed(1)} dB`;
      if (elMargin) {
        elMargin.textContent = `${lossBudget.link_margin_db >= 0 ? '+' : ''}${lossBudget.link_margin_db.toFixed(1)} dB`;
        elMargin.style.color = lossBudget.link_margin_db >= 0 ? '#10b981' : '#ef4444';
      }
    }
  }

  startAnimation() {
    const render = () => {
      this.renderCanvas();
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  renderCanvas() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;

    if (this.hapticActive) {
      this.vibrationOffset = (Math.random() - 0.5) * 6;
    } else {
      this.vibrationOffset = 0;
    }

    ctx.save();
    ctx.translate(cx + this.vibrationOffset, cy + this.vibrationOffset);

    // 1. Procedural Silicone Wrist Strap
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;

    // Top strap
    ctx.beginPath();
    ctx.roundRect(-24, -90, 48, 45, [4, 4, 0, 0]);
    ctx.fill();
    ctx.stroke();

    // Bottom strap
    ctx.beginPath();
    ctx.roundRect(-24, 45, 48, 45, [0, 0, 4, 4]);
    ctx.fill();
    ctx.stroke();

    // Strap textured grooves
    ctx.strokeStyle = '#334155';
    for (let y = -80; y <= -55; y += 8) {
      ctx.beginPath();
      ctx.moveTo(-16, y);
      ctx.lineTo(16, y);
      ctx.stroke();
    }
    for (let y = 55; y <= 80; y += 8) {
      ctx.beginPath();
      ctx.moveTo(-16, y);
      ctx.lineTo(16, y);
      ctx.stroke();
    }

    // 2. Procedural Enclosure (ESP32-S3 + SX1262 chassis)
    const encGrad = ctx.createLinearGradient(-40, -45, 40, 45);
    encGrad.addColorStop(0, '#334155');
    encGrad.addColorStop(1, '#1e293b');

    ctx.fillStyle = encGrad;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-42, -45, 84, 90, 10);
    ctx.fill();
    ctx.stroke();

    // Screenless Top Bezel
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(-34, -36, 68, 72, 6);
    ctx.fill();
    ctx.stroke();

    // Sub-GHz Internal Antenna Trace
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-28, -30);
    ctx.lineTo(28, -30);
    ctx.lineTo(28, -20);
    ctx.stroke();

    // Project Setu Brand mark
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SETU', 0, 0);

    // 3. Status LEDs
    const isSos = this.currentNode && this.currentNode.active;
    const isAcked = this.currentNode && this.currentNode.acked;
    const isRelay = this.currentNode && this.currentNode.role === 'relay';

    // Red SOS LED
    ctx.beginPath();
    ctx.arc(-18, 22, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isSos ? '#ef4444' : '#450a0a';
    ctx.fill();
    if (isSos) {
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Green ACK LED
    ctx.beginPath();
    ctx.arc(0, 22, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isAcked ? '#10b981' : '#064e3b';
    ctx.fill();
    if (isAcked) {
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Blue Mesh Activity LED
    ctx.beginPath();
    ctx.arc(18, 22, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isRelay ? '#38bdf8' : '#082f49';
    ctx.fill();

    // 4. Sealed Panic Button (Right Edge)
    const btnDepth = this.isPressed ? 3 : 6;
    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(42 - (6 - btnDepth), -15, btnDepth, 30, [0, 3, 3, 0]);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  destroy() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
  }
}

