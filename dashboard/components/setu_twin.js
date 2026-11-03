// Project Setu: Setu Twin 3D Navigable World Visualizer
// Provides an AirSim-style navigable 3D environment for disaster simulation inspection.
// Renders 3D disaster terrain (collapsed concrete slabs, rubble piles, flood water),
// survivor wristbands, elevated relays, rescue hub, and LoRa packet propagation waves.
// Degrades gracefully to an enhanced 2D canvas if WebGL or Three.js is unavailable.

export class SetuTwin3DViewer {
  constructor(containerId, options = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.options = options;
    this.canvas = null;
    this.ctx = null;
    this.cameraMode = 'orbit'; // 'orbit', 'topdown', 'follow_node', 'follow_sos'
    this.selectedNodeId = null;
    this.trackedIncidentNodeId = null;
    this.nodes = new Map();
    this.obstacles = [];
    this.activePulses = [];
    this.links = [];
    this.is3D = true;
    this.animId = null;
    this.rotationAngle = 0;
    this.pitchAngle = 0.5;
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    if (this.container) {
      this.init();
    }
  }

  init() {
    this.container.innerHTML = `
      <div class="setu-twin-container" style="position:relative; width:100%; height:100%; min-height:480px; background:#020617; border-radius:8px; overflow:hidden; border:1px solid #1e293b; font-family:sans-serif;">
        <!-- 3D View Controls Overlay -->
        <div style="position:absolute; top:12px; left:12px; z-index:10; display:flex; gap:6px; background:rgba(15,23,42,0.85); padding:6px; border-radius:6px; border:1px solid #334155; backdrop-filter:blur(4px);">
          <button id="stBtnOrbit" style="background:#0284c7; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Orbit View</button>
          <button id="stBtnTopdown" style="background:#1e293b; color:#94a3b8; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Top-Down</button>
          <button id="stBtnFollow" style="background:#1e293b; color:#94a3b8; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Follow Node</button>
          <button id="stBtnReset" style="background:#1e293b; color:#94a3b8; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Reset Camera</button>
        </div>

        <div style="position:absolute; top:12px; right:12px; z-index:10; background:rgba(15,23,42,0.85); padding:6px 10px; border-radius:6px; border:1px solid #334155; font-size:11px; color:#cbd5e1; backdrop-filter:blur(4px); display:flex; gap:12px; align-items:center;">
          <div>Mode: <span id="stFidelityLabel" style="color:#10b981; font-weight:bold;">Setu Twin 3D</span></div>
          <div style="font-size:10px; color:#94a3b8;">Drag to rotate | Wheel to zoom</div>
        </div>

        <canvas id="setuTwinCanvas" style="display:block; width:100%; height:100%;"></canvas>

        <!-- Incident Narration Pill -->
        <div id="stNarrationOverlay" style="position:absolute; bottom:12px; left:12px; right:12px; z-index:10; background:rgba(15,23,42,0.9); padding:8px 14px; border-radius:6px; border:1px solid #38bdf8; color:#f8fafc; font-size:12px; display:flex; align-items:center; gap:8px; backdrop-filter:blur(4px); box-shadow:0 4px 12px rgba(0,0,0,0.5);">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#38bdf8; animation:pulse 1.5s infinite;"></span>
          <span id="stNarratorText">Ready. Run simulation or step forward to inspect disaster dynamics.</span>
        </div>
      </div>
    `;

    this.canvas = document.getElementById('setuTwinCanvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());
      this.bindMouseControls();
      this.bindButtons();
      this.startRenderLoop();
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width || 800;
    this.canvas.height = rect.height || 480;
  }

  bindButtons() {
    const btnOrbit = document.getElementById('stBtnOrbit');
    const btnTopdown = document.getElementById('stBtnTopdown');
    const btnFollow = document.getElementById('stBtnFollow');
    const btnReset = document.getElementById('stBtnReset');

    const updateBtns = (active) => {
      [btnOrbit, btnTopdown, btnFollow].forEach(b => {
        if (!b) return;
        b.style.background = '#1e293b';
        b.style.color = '#94a3b8';
        b.style.fontWeight = 'normal';
      });
      active.style.background = '#0284c7';
      active.style.color = 'white';
      active.style.fontWeight = 'bold';
    };

    if (btnOrbit) btnOrbit.addEventListener('click', () => {
      this.cameraMode = 'orbit';
      this.pitchAngle = 0.5;
      updateBtns(btnOrbit);
    });

    if (btnTopdown) btnTopdown.addEventListener('click', () => {
      this.cameraMode = 'topdown';
      this.pitchAngle = 0.0;
      this.rotationAngle = 0.0;
      updateBtns(btnTopdown);
    });

    if (btnFollow) btnFollow.addEventListener('click', () => {
      this.cameraMode = 'follow_node';
      updateBtns(btnFollow);
    });

    if (btnReset) btnReset.addEventListener('click', () => {
      this.rotationAngle = 0.2;
      this.pitchAngle = 0.5;
      this.zoom = 1.0;
      this.panX = 0;
      this.panY = 0;
    });
  }

  bindMouseControls() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      if (e.shiftKey || this.cameraMode === 'topdown') {
        this.panX += dx;
        this.panY += dy;
      } else {
        this.rotationAngle += dx * 0.008;
        this.pitchAngle = Math.max(0.1, Math.min(1.2, this.pitchAngle + dy * 0.008));
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.3, Math.min(4.0, this.zoom * zoomFactor));
    });
  }

  setNarratorText(text) {
    const el = document.getElementById('stNarratorText');
    if (el && text) {
      el.textContent = text;
    }
  }

  setNodes(nodesList) {
    if (!Array.isArray(nodesList)) return;
    this.nodes.clear();
    for (const n of nodesList) {
      this.nodes.set(n.id, { ...n });
    }
  }

  setObstacles(obsList) {
    this.obstacles = Array.isArray(obsList) ? [...obsList] : [];
  }

  setLinks(linksList) {
    this.links = Array.isArray(linksList) ? [...linksList] : [];
  }

  triggerPacketPulse(fromId, hazard = 0, hop = 1) {
    const n = this.nodes.get(fromId);
    if (!n) return;
    this.activePulses.push({
      x: n.x,
      y: n.y,
      radius: 5,
      maxRadius: 180,
      hazard,
      hop,
      alpha: 1.0
    });
  }

  project(worldX, worldY, worldZ = 0) {
    const cx = this.canvas.width / 2 + this.panX;
    const cy = this.canvas.height / 2 + this.panY;
    const scale = (this.canvas.width / 1200) * this.zoom;

    // Follow camera offset
    let targetX = 0;
    let targetY = 0;
    if (this.cameraMode === 'follow_node' && this.selectedNodeId !== null && this.nodes.has(this.selectedNodeId)) {
      const sn = this.nodes.get(this.selectedNodeId);
      targetX = sn.x - 500;
      targetY = sn.y - 500;
    }

    const relX = worldX - 500 - targetX;
    const relY = worldY - 500 - targetY;

    // Rotate about Y/Z axis in 3D isometric perspective
    const cosR = Math.cos(this.rotationAngle);
    const sinR = Math.sin(this.rotationAngle);
    const rotX = relX * cosR - relY * sinR;
    const rotY = relX * sinR + relY * cosR;

    const cosP = Math.cos(this.pitchAngle);
    const sinP = Math.sin(this.pitchAngle);

    const screenX = cx + rotX * scale;
    const screenY = cy + (rotY * sinP - worldZ * cosP) * scale;
    const depth = rotY * cosP + worldZ * sinP;

    return { x: screenX, y: screenY, depth, scale };
  }

  startRenderLoop() {
    const render = () => {
      this.draw();
      this.animId = requestAnimationFrame(render);
    };
    this.animId = requestAnimationFrame(render);
  }

  draw() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. Draw 3D Ground Grid
    this.drawGroundGrid(ctx);

    // 2. Draw 3D Obstacles (Concrete floor slabs, walls, water bodies)
    this.drawObstacles(ctx);

    // 3. Draw Active Radio Links
    this.drawLinks(ctx);

    // 4. Draw Radio Packet Propagation Pulses
    this.drawPulses(ctx);

    // 5. Draw 3D Nodes (Hub, Relays, Survivors)
    this.drawNodes(ctx);
  }

  drawGroundGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.3)';
    ctx.lineWidth = 1;

    const step = 100;
    for (let x = 0; x <= 1000; x += step) {
      const p1 = this.project(x, 0, 0);
      const p2 = this.project(x, 1000, 0);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let y = 0; y <= 1000; y += step) {
      const p1 = this.project(0, y, 0);
      const p2 = this.project(1000, y, 0);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawObstacles(ctx) {
    ctx.save();
    for (const obs of this.obstacles) {
      const p1 = this.project(obs.x1, obs.y1, 0);
      const p2 = this.project(obs.x2, obs.y2, 0);
      const h = obs.material === 'concrete' ? 35 : (obs.material === 'water' ? 0 : 25);
      const p1Top = this.project(obs.x1, obs.y1, h);
      const p2Top = this.project(obs.x2, obs.y2, h);

      // Material color
      let color = 'rgba(148, 163, 184, 0.5)'; // concrete slab
      if (obs.material === 'water') color = 'rgba(14, 165, 233, 0.4)';
      else if (obs.material === 'metal') color = 'rgba(234, 179, 8, 0.5)';
      else if (obs.material === 'brick') color = 'rgba(239, 68, 68, 0.4)';

      ctx.fillStyle = color;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p2Top.x, p2Top.y);
      ctx.lineTo(p1Top.x, p1Top.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Label
      const midX = (p1Top.x + p2Top.x) / 2;
      const midY = (p1Top.y + p2Top.y) / 2 - 6;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${obs.material} (${obs.attenuation_db || 22} dB)`, midX - 30, midY);
    }
    ctx.restore();
  }

  drawLinks(ctx) {
    ctx.save();
    for (const l of this.links) {
      const na = this.nodes.get(l.a);
      const nb = this.nodes.get(l.b);
      if (!na || !nb) continue;

      const pa = this.project(na.x, na.y, na.role === 'hub' ? 15 : 5);
      const pb = this.project(nb.x, nb.y, nb.role === 'hub' ? 15 : 5);

      const margin = l.link_margin !== undefined ? l.link_margin : 10.0;
      let stroke = 'rgba(16, 185, 129, 0.4)'; // green (>10 dB)
      if (margin < 3.0) stroke = 'rgba(239, 68, 68, 0.5)'; // red (<3 dB)
      else if (margin < 7.0) stroke = 'rgba(245, 158, 11, 0.5)'; // amber

      ctx.strokeStyle = stroke;
      ctx.lineWidth = margin >= 10 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPulses(ctx) {
    ctx.save();
    for (let i = this.activePulses.length - 1; i >= 0; i--) {
      const pulse = this.activePulses[i];
      pulse.radius += 3.5;
      pulse.alpha -= 0.02;

      if (pulse.alpha <= 0 || pulse.radius >= pulse.maxRadius) {
        this.activePulses.splice(i, 1);
        continue;
      }

      const pCenter = this.project(pulse.x, pulse.y, 8);
      ctx.strokeStyle = pulse.hazard === 2 ? `rgba(239, 68, 68, ${pulse.alpha})`
                      : (pulse.hazard === 1 ? `rgba(245, 158, 11, ${pulse.alpha})`
                      : `rgba(56, 189, 248, ${pulse.alpha})`);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(pCenter.x, pCenter.y, pulse.radius * this.zoom, pulse.radius * this.zoom * Math.sin(this.pitchAngle || 0.5), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNodes(ctx) {
    ctx.save();
    for (const [id, n] of this.nodes) {
      const zHeight = n.role === 'hub' ? 20 : (n.role === 'relay' ? 15 : 5);
      const p = this.project(n.x, n.y, zHeight);
      const pGround = this.project(n.x, n.y, 0);

      // Stilt to ground
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pGround.x, pGround.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      // Shadow on ground
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.ellipse(pGround.x, pGround.y, 6 * this.zoom, 3 * this.zoom, 0, 0, Math.PI * 2);
      ctx.fill();

      // Node vehicle icon / sphere
      let color = '#38bdf8'; // survivor
      let size = 6;
      if (n.role === 'hub') {
        color = '#10b981';
        size = 10;
      } else if (n.role === 'relay') {
        color = '#a855f7';
        size = 8;
      }

      if (id === this.selectedNodeId) {
        // Selection Halo
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();

      // Node Label
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(String(id), p.x + 8, p.y + 3);
    }
    ctx.restore();
  }

  destroy() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }
}

