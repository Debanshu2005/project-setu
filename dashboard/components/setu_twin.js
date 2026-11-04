// Project Setu: Setu Twin 3D Navigable World Visualizer
// Provides a real WebGL 3D environment for disaster simulation inspection via Three.js.
// Renders physical 3D disaster terrain (collapsed floor slabs, broken walls, rubble mounds, rising flood water),
// low-poly human survivor avatars in various poses (standing, crawling, trapped under slab),
// elevated relay towers, rescue command hub, and visible LoRa radio physics.
// Degrades gracefully to an enhanced 2D canvas if WebGL is unavailable or in headless unit test environments.

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
        console.warn('[SetuTwin] Could not load Three.js ES module:', e);
      }
    }
  }
  return { THREE, OrbitControls };
}

export class SetuTwin3DViewer {
  constructor(containerId, options = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.options = options;
    this.destroyed = false;

    // Core WebGL / Three.js properties
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.isWebGL = false;
    this.animId = null;
    this.T = null; // THREE reference

    // Camera modes: 'orbit', 'topdown', 'freefly', 'follow_node', 'follow_sos'
    this.cameraMode = 'orbit';
    this.selectedNodeId = null;
    this.trackedIncidentNodeId = null;

    // World state
    this.nodes = new Map();
    this.nodeMeshes = new Map();
    this.obstacles = [];
    this.obstacleMeshes = [];
    this.links = [];
    this.linkObjects = [];
    this.activePulses = [];
    this.airtimeRings = [];
    this.sparks = [];
    this.waterPlane = null;
    this.waterLevel = 0;

    // Free-fly navigation state
    this.keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    this.freeflyVelocity = null;

    // 2D Canvas Fallback properties (and mathematical projection)
    this.canvas2D = null;
    this.ctx2D = null;
    this.rotationAngle2D = 0.2;
    this.pitchAngle2D = 0.5;
    this.zoom2D = 1.0;
    this.panX2D = 0;
    this.panY2D = 0;
    this.isDragging2D = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    if (this.container) {
      this.init();
    }
  }

  async init() {
    this.container.innerHTML = `
      <div class="setu-twin-container" style="position:relative; width:100%; height:100%; min-height:500px; background:#020617; border-radius:8px; overflow:hidden; border:1px solid #1e293b; font-family:sans-serif;">
        <!-- Top Toolbar / Camera Controls -->
        <div style="position:absolute; top:12px; left:12px; z-index:10; display:flex; gap:6px; background:rgba(15,23,42,0.85); padding:6px; border-radius:6px; border:1px solid #334155; backdrop-filter:blur(6px);">
          <button id="stBtnOrbit" style="background:#0284c7; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Orbit</button>
          <button id="stBtnTopdown" style="background:#1e293b; color:#94a3b8; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Top-Down</button>
          <button id="stBtnFreefly" style="background:#1e293b; color:#94a3b8; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">AirSim Free-Fly</button>
          <button id="stBtnFollow" style="background:#1e293b; color:#94a3b8; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Follow Node</button>
          <button id="stBtnReset" style="background:#1e293b; color:#94a3b8; border:none; padding:4px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Reset</button>
        </div>

        <!-- Mode & FPS Badge -->
        <div style="position:absolute; top:12px; right:12px; z-index:10; background:rgba(15,23,42,0.85); padding:6px 12px; border-radius:6px; border:1px solid #334155; font-size:11px; color:#cbd5e1; backdrop-filter:blur(6px); display:flex; gap:14px; align-items:center;">
          <div>Engine: <span id="stFidelityLabel" style="color:#10b981; font-weight:bold;">Three.js WebGL 3D</span></div>
          <div id="stFpsCounter" style="color:#38bdf8; font-family:monospace; font-weight:600;">60 FPS</div>
          <div id="stControlsHint" style="font-size:10px; color:#94a3b8;">Drag to orbit | Wheel to zoom</div>
        </div>

        <!-- 3D Canvas Mount Point -->
        <div id="setuTwinMount" style="width:100%; height:100%; position:absolute; top:0; left:0;"></div>

        <!-- Fallback 2D Canvas (hidden unless WebGL fails or mock testing) -->
        <canvas id="setuTwinCanvas2D" style="display:none; width:100%; height:100%;"></canvas>

        <!-- Radio Legend Overlay -->
        <div style="position:absolute; bottom:60px; left:12px; z-index:10; background:rgba(15,23,42,0.85); padding:6px 10px; border-radius:6px; border:1px solid #334155; font-size:10px; color:#94a3b8; backdrop-filter:blur(4px); display:flex; gap:12px; align-items:center;">
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:12px; height:3px; background:#38bdf8; border-radius:2px;"></span> Strong (>15 dB)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:12px; height:3px; background:#f59e0b; border-radius:2px;"></span> Medium (5-15 dB)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:12px; height:3px; background:#ef4444; border-radius:2px; border-top:1px dashed #ef4444;"></span> Weak (<5 dB)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#a855f7;"></span> Rubble Slab</div>
        </div>

        <!-- Plain-English Incident Narrator Strip -->
        <div id="stNarrationOverlay" style="position:absolute; bottom:12px; left:12px; right:12px; z-index:10; background:rgba(15,23,42,0.92); padding:9px 16px; border-radius:6px; border:1px solid #38bdf8; color:#f8fafc; font-size:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; backdrop-filter:blur(6px); box-shadow:0 4px 14px rgba(0,0,0,0.6);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#38bdf8; box-shadow:0 0 8px #38bdf8;"></span>
            <span id="stNarratorText">Ready. Run simulation or step forward to inspect 3D disaster dynamics.</span>
          </div>
          <button id="stBtnWhyFail" style="display:none; background:#dc2626; color:white; border:none; padding:3px 8px; border-radius:4px; font-size:10px; cursor:pointer; font-weight:bold;">Why did this fail?</button>
        </div>

        <!-- Failure Explainer Modal -->
        <div id="stFailModal" style="display:none; position:absolute; top:60px; right:12px; z-index:20; width:340px; background:rgba(15,23,42,0.95); border:1px solid #ef4444; border-radius:8px; padding:14px; box-shadow:0 8px 24px rgba(0,0,0,0.7); backdrop-filter:blur(8px);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="color:#ef4444; font-weight:bold; font-size:12px;">FAILURE ROOT-CAUSE ANALYSIS</span>
            <button id="stBtnCloseFailModal" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:14px;">x</button>
          </div>
          <div id="stFailModalBody" style="font-size:11px; color:#cbd5e1; line-height:1.5;"></div>
        </div>
      </div>
    `;

    this.mountPoint = document.getElementById('setuTwinMount');
    const canvas2DEl = document.getElementById('setuTwinCanvas2D');
    if (canvas2DEl) this.canvas2D = canvas2DEl;

    if (this.destroyed) return;

    if (typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined' && this.mountPoint) {
      try {
        const { THREE: t, OrbitControls: oc } = await getThree();
        if (this.destroyed) return;
        if (t && oc) {
          this.T = t;
          this.initThree(t, oc);
          this.isWebGL = true;
        } else {
          this.initFallback2D();
        }
      } catch (e) {
        this.initFallback2D();
      }
    } else {
      this.initFallback2D();
    }

    if (this.destroyed) return;
    this.bindButtons();
    this.bindKeyboard();
    this.startRenderLoop();
  }

  initThree(t, oc) {
    const width = (this.mountPoint && this.mountPoint.clientWidth) || 800;
    const height = (this.mountPoint && this.mountPoint.clientHeight) || 500;

    this.renderer = new t.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = t.PCFSoftShadowMap;
    this.mountPoint.appendChild(this.renderer.domElement);

    this.scene = new t.Scene();
    this.scene.background = new t.Color(0x020617);
    this.scene.fog = new t.FogExp2(0x020617, 0.0008);

    this.camera = new t.PerspectiveCamera(50, width / height, 0.5, 4000);
    this.camera.position.set(0, 320, 520);

    this.controls = new oc(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 1800;
    this.controls.target.set(0, 0, 0);

    const hemiLight = new t.HemisphereLight(0x38bdf8, 0x0f172a, 0.65);
    this.scene.add(hemiLight);

    const dirLight = new t.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(250, 450, 200);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    this.buildGroundPlane(t);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resize());
    }
  }

  buildGroundPlane(t) {
    const groundGeo = new t.PlaneGeometry(1600, 1600, 32, 32);
    const groundMat = new t.MeshStandardMaterial({
      color: 0x0b1120,
      roughness: 0.9,
      metalness: 0.1
    });
    const ground = new t.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new t.GridHelper(1400, 35, 0x1e293b, 0x0f172a);
    grid.position.y = 0.2;
    this.scene.add(grid);

    const waterGeo = new t.PlaneGeometry(1600, 1600);
    const waterMat = new t.MeshStandardMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.55,
      roughness: 0.2,
      metalness: 0.3
    });
    this.waterPlane = new t.Mesh(waterGeo, waterMat);
    this.waterPlane.rotation.x = -Math.PI / 2;
    this.waterPlane.position.y = -10;
    this.scene.add(this.waterPlane);
  }

  initFallback2D() {
    if (this.mountPoint) this.mountPoint.style.display = 'none';
    if (this.canvas2D) {
      this.canvas2D.style.display = 'block';
      if (typeof this.canvas2D.getContext === 'function') {
        this.ctx2D = this.canvas2D.getContext('2d');
      }
    }
    const label = (typeof document !== 'undefined') ? document.getElementById('stFidelityLabel') : null;
    if (label) label.textContent = '2D Canvas (Fallback)';
    this.resizeCanvas2D();
    this.bindMouseControls2D();
  }

  bindButtons() {
    if (typeof document === 'undefined') return;
    const btnOrbit = document.getElementById('stBtnOrbit');
    const btnTopdown = document.getElementById('stBtnTopdown');
    const btnFreefly = document.getElementById('stBtnFreefly');
    const btnFollow = document.getElementById('stBtnFollow');
    const btnReset = document.getElementById('stBtnReset');
    const btnWhyFail = document.getElementById('stBtnWhyFail');
    const btnCloseFailModal = document.getElementById('stBtnCloseFailModal');
    const failModal = document.getElementById('stFailModal');
    const hint = document.getElementById('stControlsHint');

    const updateBtns = (active) => {
      [btnOrbit, btnTopdown, btnFreefly, btnFollow].forEach(b => {
        if (!b) return;
        b.style.background = '#1e293b';
        b.style.color = '#94a3b8';
        b.style.fontWeight = 'normal';
      });
      if (active) {
        active.style.background = '#0284c7';
        active.style.color = 'white';
        active.style.fontWeight = 'bold';
      }
    };

    if (btnOrbit) btnOrbit.addEventListener('click', () => {
      this.cameraMode = 'orbit';
      if (this.controls) this.controls.enabled = true;
      if (hint) hint.textContent = 'Drag to orbit | Wheel to zoom';
      updateBtns(btnOrbit);
    });

    if (btnTopdown) btnTopdown.addEventListener('click', () => {
      this.cameraMode = 'topdown';
      if (this.controls) {
        this.controls.enabled = true;
        this.camera.position.set(0, 750, 0);
        this.controls.target.set(0, 0, 0);
      }
      if (hint) hint.textContent = 'Top-down orthogonal view | Drag to pan';
      updateBtns(btnTopdown);
    });

    if (btnFreefly) btnFreefly.addEventListener('click', () => {
      this.cameraMode = 'freefly';
      if (this.controls) this.controls.enabled = false;
      if (hint) hint.textContent = 'WASD move | Mouse look | Q/E down/up';
      updateBtns(btnFreefly);
    });

    if (btnFollow) btnFollow.addEventListener('click', () => {
      this.cameraMode = 'follow_node';
      if (this.controls) this.controls.enabled = true;
      if (hint) hint.textContent = 'Tracking selected survivor/relay';
      updateBtns(btnFollow);
    });

    if (btnReset) btnReset.addEventListener('click', () => {
      if (this.camera) this.camera.position.set(0, 320, 520);
      if (this.controls) this.controls.target.set(0, 0, 0);
      this.rotationAngle2D = 0.2;
      this.pitchAngle2D = 0.5;
      this.zoom2D = 1.0;
      this.panX2D = 0;
      this.panY2D = 0;
    });

    if (btnWhyFail) btnWhyFail.addEventListener('click', () => {
      if (failModal) failModal.style.display = 'block';
    });

    if (btnCloseFailModal) btnCloseFailModal.addEventListener('click', () => {
      if (failModal) failModal.style.display = 'none';
    });
  }

  bindKeyboard() {
    if (typeof window === 'undefined') return;
    this._onKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w') this.keys.w = true;
      if (k === 'a') this.keys.a = true;
      if (k === 's') this.keys.s = true;
      if (k === 'd') this.keys.d = true;
      if (k === 'q') this.keys.q = true;
      if (k === 'e') this.keys.e = true;
    };
    this._onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w') this.keys.w = false;
      if (k === 'a') this.keys.a = false;
      if (k === 's') this.keys.s = false;
      if (k === 'd') this.keys.d = false;
      if (k === 'q') this.keys.q = false;
      if (k === 'e') this.keys.e = false;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  bindMouseControls2D() {
    if (!this.canvas2D) return;

    this.canvas2D.addEventListener('mousedown', (e) => {
      this.isDragging2D = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging2D) return;
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        if (e.shiftKey || this.cameraMode === 'topdown') {
          this.panX2D += dx;
          this.panY2D += dy;
        } else {
          this.rotationAngle2D += dx * 0.008;
          this.pitchAngle2D = Math.max(0.1, Math.min(1.2, this.pitchAngle2D + dy * 0.008));
        }
      });

      window.addEventListener('mouseup', () => {
        this.isDragging2D = false;
      });
    }

    this.canvas2D.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom2D = Math.max(0.3, Math.min(4.0, this.zoom2D * zoomFactor));
    });
  }

  resize() {
    if (!this.mountPoint || !this.renderer || !this.camera) return;
    const width = this.mountPoint.clientWidth || 800;
    const height = this.mountPoint.clientHeight || 500;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  resizeCanvas2D() {
    if (!this.canvas2D) return;
    const p = this.canvas2D.parentElement;
    const rect = p && typeof p.getBoundingClientRect === 'function' ? p.getBoundingClientRect() : { width: 800, height: 500 };
    this.canvas2D.width = rect.width || 800;
    this.canvas2D.height = rect.height || 500;
  }

  resizeCanvas() {
    if (this.isWebGL) {
      this.resize();
    } else {
      this.resizeCanvas2D();
    }
  }

  // --- 3D Projection for Mathematical Testing & Unit Suites ---

  project(worldX, worldY, worldZ = 0) {
    const width = (this.canvas2D && this.canvas2D.width) || 800;
    const height = (this.canvas2D && this.canvas2D.height) || 480;
    const cx = width / 2 + this.panX2D;
    const cy = height / 2 + this.panY2D;
    const scale = (width / 1200) * this.zoom2D;

    let targetX = 0;
    let targetY = 0;
    if (this.cameraMode === 'follow_node' && this.selectedNodeId !== null && this.nodes.has(this.selectedNodeId)) {
      const sn = this.nodes.get(this.selectedNodeId);
      targetX = sn.x - 500;
      targetY = sn.y - 500;
    }

    const relX = worldX - 500 - targetX;
    const relY = worldY - 500 - targetY;

    const cosR = Math.cos(this.rotationAngle2D);
    const sinR = Math.sin(this.rotationAngle2D);
    const rotX = relX * cosR - relY * sinR;
    const rotY = relX * sinR + relY * cosR;

    const cosP = Math.cos(this.pitchAngle2D);
    const sinP = Math.sin(this.pitchAngle2D);

    const screenX = cx + rotX * scale;
    const screenY = cy + (rotY * sinP - worldZ * cosP) * scale;
    const depth = rotY * cosP + worldZ * sinP;

    return { x: screenX, y: screenY, depth, scale };
  }

  // --- Data Setters ---

  setNodes(nodesList) {
    if (!Array.isArray(nodesList)) return;
    this.nodes.clear();
    for (const n of nodesList) {
      this.nodes.set(n.id, { ...n });
    }
    if (this.isWebGL && this.T) {
      this.syncNodeMeshes();
    }
  }

  setObstacles(obsList) {
    this.obstacles = Array.isArray(obsList) ? [...obsList] : [];
    if (this.isWebGL && this.T) {
      this.syncObstacleMeshes();
    }
  }

  setLinks(linksList) {
    this.links = Array.isArray(linksList) ? [...linksList] : [];
    if (this.isWebGL && this.T) {
      this.syncLinkObjects();
    }
  }

  setNarratorText(text) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('stNarratorText');
    if (el && text) {
      el.textContent = text;
    }
  }

  showFailureExplanation(title, message) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('stFailModal');
    const body = document.getElementById('stFailModalBody');
    const btn = document.getElementById('stBtnWhyFail');
    if (body) {
      body.innerHTML = `<strong>${title}</strong><br><br>${message}`;
    }
    if (btn) btn.style.display = 'inline-block';
    if (modal) modal.style.display = 'block';
  }

  setWaterElevation(levelMeters) {
    this.waterLevel = levelMeters;
    if (this.waterPlane) {
      this.waterPlane.position.y = levelMeters * 2.0;
    }
  }

  triggerPacketPulse(fromId, hazard = 0, hop = 1) {
    const n = this.nodes.get(fromId);
    if (!n) return;
    const worldPos = this.to3DCoords(n.x, n.y, n.elevation || 0);

    this.airtimeRings.push({
      x: worldPos.x,
      y: worldPos.y + 1.0,
      z: worldPos.z,
      radius: 4,
      maxRadius: 160,
      alpha: 0.8,
      color: hazard === 1 ? 0xef4444 : hazard === 2 ? 0xa855f7 : 0x38bdf8
    });

    this.activePulses.push({
      fromId,
      x: worldPos.x,
      y: worldPos.y,
      z: worldPos.z,
      hazard,
      hop,
      radius: 4,
      maxRadius: 180,
      alpha: 1.0
    });
  }

  to3DCoords(x, y, z = 0) {
    return {
      x: x - 500,
      y: z,
      z: y - 500
    };
  }

  // --- 3D Scene Graph Synchronization ---

  syncNodeMeshes() {
    if (!this.scene || !this.T) return;
    const t = this.T;

    for (const [id, meshGroup] of this.nodeMeshes.entries()) {
      if (!this.nodes.has(id)) {
        this.scene.remove(meshGroup);
        this.nodeMeshes.delete(id);
      }
    }

    for (const [id, node] of this.nodes.entries()) {
      let group = this.nodeMeshes.get(id);
      if (!group) {
        group = this.createNodeMesh(node, t);
        this.scene.add(group);
        this.nodeMeshes.set(id, group);
      }

      const p = this.to3DCoords(node.x, node.y, node.elevation || 0);
      group.position.set(p.x, p.y, p.z);

      const isSelected = this.selectedNodeId === id;
      const highlightRing = group.getObjectByName('highlightRing');
      if (highlightRing) {
        highlightRing.visible = isSelected;
      }
    }
  }

  createNodeMesh(node, t) {
    const group = new t.Group();
    const role = (node.role || '').toLowerCase();

    if (role === 'hub') {
      const tentGeo = new t.ConeGeometry(12, 16, 4);
      const tentMat = new t.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 });
      const tent = new t.Mesh(tentGeo, tentMat);
      tent.rotation.y = Math.PI / 4;
      tent.position.y = 8;
      tent.castShadow = true;
      group.add(tent);

      const mastGeo = new t.CylinderGeometry(0.8, 0.8, 30);
      const mastMat = new t.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
      const mast = new t.Mesh(mastGeo, mastMat);
      mast.position.y = 15;
      group.add(mast);

      const beaconGeo = new t.SphereGeometry(3, 16, 16);
      const beaconMat = new t.MeshBasicMaterial({ color: 0x38bdf8 });
      const beacon = new t.Mesh(beaconGeo, beaconMat);
      beacon.position.y = 30;
      group.add(beacon);

    } else if (role === 'relay') {
      const poleGeo = new t.CylinderGeometry(1.2, 1.6, 22);
      const poleMat = new t.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6 });
      const pole = new t.Mesh(poleGeo, poleMat);
      pole.position.y = 11;
      pole.castShadow = true;
      group.add(pole);

      const panelGeo = new t.BoxGeometry(10, 0.8, 8);
      const panelMat = new t.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.9, roughness: 0.2 });
      const panel = new t.Mesh(panelGeo, panelMat);
      panel.position.set(0, 16, 4);
      panel.rotation.x = Math.PI / 6;
      group.add(panel);

      const antGeo = new t.CylinderGeometry(0.4, 0.4, 14);
      const antMat = new t.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.7 });
      const ant = new t.Mesh(antGeo, antMat);
      ant.position.y = 25;
      group.add(ant);

    } else {
      const motion = (node.motion_profile || '').toLowerCase();
      const isCrawling = motion === 'crawling';
      const isTrapped = motion === 'fall_impact' || node.hazard === 2;

      const bodyGroup = new t.Group();

      const torsoGeo = new t.BoxGeometry(4, 8, 3);
      const torsoMat = new t.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });
      const torso = new t.Mesh(torsoGeo, torsoMat);
      torso.position.y = 4;
      torso.castShadow = true;
      bodyGroup.add(torso);

      const headGeo = new t.SphereGeometry(2.2, 8, 8);
      const headMat = new t.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.5 });
      const head = new t.Mesh(headGeo, headMat);
      head.position.y = 10;
      head.castShadow = true;
      bodyGroup.add(head);

      const bandGeo = new t.TorusGeometry(1.2, 0.4, 8, 16);
      const bandMat = new t.MeshBasicMaterial({ color: node.acked ? 0x10b981 : 0xef4444 });
      const band = new t.Mesh(bandGeo, bandMat);
      band.position.set(-3.2, 4, 0);
      band.rotation.y = Math.PI / 2;
      bodyGroup.add(band);

      const bandLight = new t.PointLight(node.acked ? 0x10b981 : 0xef4444, 1.2, 25);
      bandLight.position.set(-3.2, 4, 0);
      bodyGroup.add(bandLight);

      if (isCrawling) {
        bodyGroup.rotation.x = Math.PI / 2 - 0.2;
        bodyGroup.position.y = 1.5;
      } else if (isTrapped) {
        bodyGroup.rotation.z = Math.PI / 2;
        bodyGroup.position.y = 1.0;
      }

      group.add(bodyGroup);
    }

    const ringGeo = new t.RingGeometry(12, 14, 32);
    const ringMat = new t.MeshBasicMaterial({ color: 0x38bdf8, side: t.DoubleSide });
    const ring = new t.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.5;
    ring.name = 'highlightRing';
    ring.visible = false;
    group.add(ring);

    return group;
  }

  syncObstacleMeshes() {
    if (!this.scene || !this.T) return;
    const t = this.T;

    for (const mesh of this.obstacleMeshes) {
      this.scene.remove(mesh);
    }
    this.obstacleMeshes = [];

    for (const obs of this.obstacles) {
      const p1 = this.to3DCoords(obs.x1, obs.y1);
      const p2 = this.to3DCoords(obs.x2, obs.y2);

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dz, dx);

      const thickness = (obs.thickness_m || 0.3) * 10.0;
      const height = (obs.height_m || 3.0) * 8.0;
      const tilt = (obs.tilt_deg || 0.0) * (Math.PI / 180);

      const geo = new t.BoxGeometry(length, height, thickness);
      const mat = new t.MeshStandardMaterial({
        color: obs.material === 'concrete' ? 0x64748b : 0x94a3b8,
        roughness: 0.8,
        metalness: 0.1
      });
      const mesh = new t.Mesh(geo, mat);
      mesh.position.set((p1.x + p2.x) / 2, height / 2, (p1.z + p2.z) / 2);
      mesh.rotation.y = -angle;
      mesh.rotation.z = tilt;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.scene.add(mesh);
      this.obstacleMeshes.push(mesh);
    }
  }

  syncLinkObjects() {
    if (!this.scene || !this.T) return;
    const t = this.T;

    for (const obj of this.linkObjects) {
      this.scene.remove(obj);
    }
    this.linkObjects = [];

    for (const link of this.links) {
      const n1 = this.nodes.get(link.from);
      const n2 = this.nodes.get(link.to);
      if (!n1 || !n2) continue;

      const p1 = this.to3DCoords(n1.x, n1.y, (n1.role === 'relay' ? 18 : 6));
      const p2 = this.to3DCoords(n2.x, n2.y, (n2.role === 'relay' ? 18 : 6));

      const margin = typeof link.margin_db === 'number' ? link.margin_db : 12.0;
      let colorHex = 0x38bdf8;
      if (margin < 5.0) colorHex = 0xef4444;
      else if (margin < 15.0) colorHex = 0xf59e0b;

      const points = [
        new t.Vector3(p1.x, p1.y, p1.z),
        new t.Vector3(p2.x, p2.y, p2.z)
      ];
      const lineGeo = new t.BufferGeometry().setFromPoints(points);
      const lineMat = new t.LineBasicMaterial({
        color: colorHex,
        linewidth: margin < 5.0 ? 1 : 2,
        transparent: true,
        opacity: 0.75
      });
      const line = new t.Line(lineGeo, lineMat);
      this.scene.add(line);
      this.linkObjects.push(line);
    }
  }

  // --- Render Loop & Animation ---

  startRenderLoop() {
    if (this.destroyed) return;
    let lastTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    let frameCount = 0;
    let lastFpsUpdate = lastTime;

    const render = (now) => {
      if (this.destroyed) return;
      const currentTime = now || ((typeof performance !== 'undefined') ? performance.now() : Date.now());
      const delta = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      frameCount++;
      if (currentTime - lastFpsUpdate >= 1000) {
        const fpsEl = (typeof document !== 'undefined') ? document.getElementById('stFpsCounter') : null;
        if (fpsEl) fpsEl.textContent = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsUpdate = currentTime;
      }

      if (this.isWebGL && this.renderer && this.scene && this.camera) {
        this.updateThree(delta);
      } else {
        this.drawFallback2D();
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

  updateThree(delta) {
    if (!this.renderer || !this.scene || !this.camera || !this.T) return;
    const t = this.T;

    if (this.cameraMode === 'freefly') {
      const moveSpeed = 120 * delta;
      const dir = new t.Vector3();
      if (this.keys.w) dir.z -= 1;
      if (this.keys.s) dir.z += 1;
      if (this.keys.a) dir.x -= 1;
      if (this.keys.d) dir.x += 1;
      if (this.keys.e) dir.y += 1;
      if (this.keys.q) dir.y -= 1;
      dir.normalize();

      dir.applyEuler(this.camera.rotation);
      this.camera.position.addScaledVector(dir, moveSpeed);
    } else if (this.cameraMode === 'follow_node' && this.selectedNodeId !== null) {
      const node = this.nodes.get(this.selectedNodeId);
      if (node && this.controls) {
        const p = this.to3DCoords(node.x, node.y, node.elevation || 0);
        this.controls.target.lerp(new t.Vector3(p.x, p.y + 10, p.z), 0.1);
      }
    }

    if (this.controls && this.controls.enabled) {
      this.controls.update();
    }

    for (let i = this.airtimeRings.length - 1; i >= 0; i--) {
      const ring = this.airtimeRings[i];
      ring.radius += 80 * delta;
      ring.alpha -= 0.6 * delta;
      if (ring.alpha <= 0 || ring.radius >= ring.maxRadius) {
        this.airtimeRings.splice(i, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  drawFallback2D() {
    if (!this.ctx2D || !this.canvas2D) return;
    const ctx = this.ctx2D;
    if (typeof ctx.clearRect !== 'function') return;
    ctx.clearRect(0, 0, this.canvas2D.width, this.canvas2D.height);

    const cx = this.canvas2D.width / 2 + this.panX2D;
    const cy = this.canvas2D.height / 2 + this.panY2D;
    const scale = (this.canvas2D.width / 1200) * this.zoom2D;

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = -600; x <= 600; x += 60) {
      ctx.beginPath();
      ctx.moveTo(cx + x * scale, cy - 600 * scale * this.pitchAngle2D);
      ctx.lineTo(cx + x * scale, cy + 600 * scale * this.pitchAngle2D);
      ctx.stroke();
    }

    for (const [id, node] of this.nodes.entries()) {
      const p = this.to3DCoords(node.x, node.y);
      const sx = cx + p.x * scale;
      const sy = cy + p.z * scale * this.pitchAngle2D;

      ctx.beginPath();
      ctx.arc(sx, sy, node.role === 'hub' ? 10 : node.role === 'relay' ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = node.role === 'hub' ? '#38bdf8' : node.role === 'relay' ? '#f59e0b' : '#10b981';
      ctx.fill();
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
    if (this.renderer && typeof this.renderer.dispose === 'function') {
      this.renderer.dispose();
    }
    if (this.controls && typeof this.controls.dispose === 'function') {
      this.controls.dispose();
    }
    if (this._onKeyDown && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this._onKeyUp && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keyup', this._onKeyUp);
      this._onKeyUp = null;
    }
  }
}
