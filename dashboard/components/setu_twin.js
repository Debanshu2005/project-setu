import { LossWaterfallComponent } from './loss_waterfall.js';
import { getWebGLQualityTier, disposeThreeObject } from '../src/webgl_tier.js';
// Project Setu: Setu Twin 3D Navigable World Visualizer
// Provides a real WebGL 3D environment for disaster simulation inspection via Three.js.
// Renders physical 3D disaster terrain (collapsed floor slabs, broken walls, rubble mounds, subterranean levels),
// prominent screen-space-visible node beacons, low-poly human survivor avatars in various poses,
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
    this.isActive = true;
    this.qualityTier = null;
    this.labelTextureCache = new Map();
    this._renderScheduled = false;
    this._boundRender = null;
    this._onVisibilityChange = null;
    this._observer = null;
    this.T = null; // THREE reference

    // Camera modes: 'orbit', 'topdown', 'freefly', 'follow_node', 'follow_sos'
    this.cameraMode = 'orbit';
    this.selectedNodeId = null;
    this.hoveredNodeId = null;
    this.lossWaterfallModal = null;
    this.activeFailureData = null;
    this.trackedIncidentNodeId = null;
    this.initialFitDone = false;

    // Coordinate system & scenario bounds
    this.scenarioCenter = { x: 500, y: 500 };
    this.scenarioSpan = 300;
    this.scenarioBounds = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };

    // World state
    this.nodes = new Map();
    this.nodeMeshes = new Map();
    this.obstacles = [];
    this.obstacleMeshes = [];
    this.environment = null;
    this.environmentMeshes = [];
    this.links = [];
    this.linkObjects = [];
        this.activePulses = [];
    this.airtimeRings = [];
    this.dropFlashes = [];
    this.wallHighlights = [];
    this.heatmapGroup = null;
    this.showHeatmap = false;
    this.lastProcessedEventTime = -1;
    this.sparks = [];
    this.waterPlane = null;
    this.waterLevel = 0;
    this.groundMesh = null;
    this.gridHelperMajor = null;
    this.gridHelperMinor = null;
    this.boundaryOutline = null;

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
    this._initPromise = null;

    if (this.container) {
      this._initPromise = this.init();
    }
  }

  async init() {
    if (this.destroyed) return;
    this.container.innerHTML = `
      <div class="setu-twin-container" style="position:relative; width:100%; height:100%; min-height:500px; background:#0b1329; border-radius:8px; overflow:hidden; border:1px solid #1e293b; font-family:sans-serif;">
        <!-- Top Toolbar / Camera Controls -->
        <div style="position:absolute; top:12px; left:12px; z-index:10; display:flex; gap:5px; background:rgba(15,23,42,0.92); padding:5px 8px; border-radius:6px; border:1px solid #334155; backdrop-filter:blur(6px); box-shadow:0 4px 12px rgba(0,0,0,0.5);">
          <button id="stBtnOrbit" style="background:#0284c7; color:white; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer; font-weight:bold;">Orbit</button>
          <button id="stBtnTopdown" style="background:#1e293b; color:#94a3b8; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Top-Down</button>
          <button id="stBtnFreefly" style="background:#1e293b; color:#94a3b8; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Free-Fly</button>
          <button id="stBtnFollow" style="background:#1e293b; color:#94a3b8; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Follow</button>
          <button id="stBtnReset" style="background:#1e293b; color:#94a3b8; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Fit View</button>
          <button id="stBtnHeatmap" style="background:#1e293b; color:#94a3b8; border:none; padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer;">Toggle Heatmap</button>
        </div>

        <!-- Mode, Terrain & FPS Badge -->
        <div style="position:absolute; top:12px; right:12px; z-index:10; background:rgba(15,23,42,0.92); padding:5px 10px; border-radius:6px; border:1px solid #334155; font-size:11px; color:#cbd5e1; backdrop-filter:blur(6px); display:flex; gap:10px; align-items:center; box-shadow:0 4px 12px rgba(0,0,0,0.5);">
          <span id="stObstacleBadge" style="background:rgba(56,189,248,0.15); color:#7dd3fc; border:1px solid rgba(56,189,248,0.4); padding:2px 8px; border-radius:4px; font-size: 11px; font-weight:600;">Open Terrain</span>
          <div style="font-size: 11px; color:#10b981; font-weight:bold;">WebGL 3D</div>
          <div id="stFpsCounter" style="color:#38bdf8; font-family:monospace; font-weight:600; font-size: 11px;">60 FPS</div>
        </div>

        <!-- 3D Canvas Mount Point -->
        <div id="setuTwinMount" style="width:100%; height:100%; position:absolute; top:0; left:0;"></div>

        <!-- Fallback 2D Canvas (hidden unless WebGL fails or mock testing) -->
        <canvas id="setuTwinCanvas2D" style="display:none; width:100%; height:100%;"></canvas>

        <!-- Radio & Role Legend Overlay -->
        <div style="position:absolute; bottom:56px; left:12px; z-index:10; background:rgba(15,23,42,0.92); padding:6px 14px; border-radius:6px; border:1px solid #334155; font-size: 11px; color:#cbd5e1; backdrop-filter:blur(6px); display:flex; flex-wrap:wrap; gap:12px; align-items:center; box-shadow:0 4px 12px rgba(0,0,0,0.5);">
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#00f0ff; box-shadow:0 0 6px #00f0ff;"></span> Survivor (Cyan)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f59e0b; box-shadow:0 0 6px #f59e0b;"></span> Relay (Amber)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 6px #10b981;"></span> Hub (Green)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444; box-shadow:0 0 8px #ef4444;"></span> Active SOS (Red)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:14px; height:3px; background:#38bdf8; border-radius:2px;"></span> Strong (>15 dB)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:14px; height:3px; background:#f59e0b; border-radius:2px;"></span> Medium (5-15 dB)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:14px; height:3px; border-bottom:2px dashed #ef4444;"></span> Weak (<5 dB)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#a855f7; box-shadow:0 0 6px #a855f7;"></span> Packet Pulse</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:10px; height:10px; border-radius:50%; border:1px solid #38bdf8;"></span> Airtime Ring</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:#f59e0b;"></span> Obstacle (-N dB)</div>
          <div style="display:flex; align-items:center; gap:4px;"><span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:#ef4444;"></span> Drop Flash</div>
        </div>

        <!-- Plain-English Incident Narrator Strip -->
        <div id="stNarrationOverlay" style="position:absolute; bottom:12px; left:12px; right:12px; z-index:10; background:rgba(15,23,42,0.94); padding:9px 16px; border-radius:6px; border:1px solid #38bdf8; color:#f8fafc; font-size:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; backdrop-filter:blur(6px); box-shadow:0 4px 14px rgba(0,0,0,0.6);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#38bdf8; box-shadow:0 0 8px #38bdf8;"></span>
            <span id="stNarratorText">Ready. Run simulation or step forward to inspect 3D disaster dynamics.</span>
          </div>
          <button id="stBtnWhyFail" style="display:none; background:#dc2626; color:white; border:none; padding:4px 10px; border-radius:4px; font-size: 11px; cursor:pointer; font-weight:bold;">Why did this fail?</button>
        </div>

        <!-- Failure Explainer Modal (RF Loss Budget Waterfall) -->
        <div id="stFailModal" style="display:none; position:absolute; top:46px; right:12px; z-index:25; width:460px; max-width:calc(100% - 24px); max-height:calc(100% - 56px); overflow-y:auto; background:rgba(15,23,42,0.98); border:1px solid #ef4444; border-radius:8px; padding:10px; box-shadow:0 12px 32px rgba(0,0,0,0.8); backdrop-filter:blur(10px);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid #334155;">
            <span style="color:#ef4444; font-weight:bold; font-size:11px; letter-spacing:0.05em; text-transform:uppercase;">RF Loss Budget Waterfall (Failure Analysis)</span>
            <button id="stBtnCloseFailModal" style="background:rgba(255,255,255,0.08); border:1px solid #475569; color:#f8fafc; border-radius:4px; cursor:pointer; font-size:12px; padding:2px 8px; font-weight:bold;" title="Close failure analysis">&times;</button>
          </div>
          <div id="stFailModalBody" style="font-size:11px; color:#cbd5e1;"></div>
        </div>
      </div>
    `;

    this.mountPoint = document.getElementById('setuTwinMount');
    const canvas2DEl = document.getElementById('setuTwinCanvas2D');
    if (canvas2DEl) this.canvas2D = canvas2DEl;

    const failBodyEl = document.getElementById('stFailModalBody');
    if (failBodyEl) {
      this.lossWaterfallModal = new LossWaterfallComponent(failBodyEl);
    }

    if (this.destroyed) return;

    try {
      const { THREE: t, OrbitControls: oc } = await getThree();
      if (this.destroyed) return;
      if (t && oc && typeof window !== 'undefined' && this.mountPoint && typeof window.WebGLRenderingContext !== 'undefined') {
        this.T = t;
        this.initThree(t, oc);
        this.isWebGL = true;
      } else {
        this.initFallback2D();
      }
    } catch (e) {
      this.initFallback2D();
    }

    if (this.destroyed) return;
    this.bindButtons();
    this.bindKeyboard();
    this.bindRaycasting();
    this.startRenderLoop();

    if (this.isWebGL && this.T) {
      if (this.nodes.size > 0) {
        this.syncNodeMeshes();
        this.updateBoundaryOutline();
      }
      if (this.obstacles.length > 0) {
        this.syncObstacleMeshes();
      }
      if (this.environment) {
        this.syncEnvironmentMeshes();
      }
      if (this.links.length > 0) {
        this.syncLinkObjects();
      }
      this.requestRender();
    }
  }

  initThree(t, oc) {
    const width = (this.mountPoint && this.mountPoint.clientWidth) || 800;
    const height = (this.mountPoint && this.mountPoint.clientHeight) || 500;

    this.qualityTier = getWebGLQualityTier();

    this.renderer = new t.WebGLRenderer({
      antialias: this.qualityTier.antialias,
      alpha: false,
      powerPreference: this.qualityTier.isMobile ? 'low-power' : 'high-performance'
    });
    this.renderer.setSize(width, height);
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, this.qualityTier.dprCap);
    this.renderer.setPixelRatio(dpr);
    if (this.qualityTier.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = this.qualityTier.shadowType === 'pcf' ? t.PCFSoftShadowMap : t.BasicShadowMap;
    } else {
      this.renderer.shadowMap.enabled = false;
    }
    this.renderer.setClearColor(0x0c1527, 1);
    this.mountPoint.appendChild(this.renderer.domElement);

    this.scene = new t.Scene();
    this.scene.background = new t.Color(0x0c1527);
    this.scene.fog = new t.Fog(0x0c1527, 200, 2400);

    this.camera = new t.PerspectiveCamera(50, width / height, 0.5, 6000);
    this.camera.position.set(0, 240, 360);

    this.controls = new oc(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 3500;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('change', () => this.requestRender());

    // Three-point balanced lighting (no dark-on-dark figures)
    const ambientLight = new t.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const hemiLight = new t.HemisphereLight(0x38bdf8, 0x1e293b, 0.9);
    hemiLight.position.set(0, 500, 0);
    this.scene.add(hemiLight);

    const dirLight = new t.DirectionalLight(0xfffaf0, 1.5);
    dirLight.position.set(250, 450, 200);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    const fillLight = new t.DirectionalLight(0x60a5fa, 0.6);
    fillLight.position.set(-200, 250, -200);
    this.scene.add(fillLight);

    this.buildSkyDome(t);
    this.buildGroundPlane(t);

    this.onWindowResize = () => this.scheduleResize();
    if (typeof window !== 'undefined') {
      if ('ResizeObserver' in window && this.mountPoint) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
        this.resizeObserver.observe(this.mountPoint);
      } else {
        window.addEventListener('resize', this.onWindowResize, { passive: true });
      }
    }
  }

  buildSkyDome(t) {
    const skyGeo = new t.SphereGeometry(3800, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#070b16');   // Zenith dark deep space
    grad.addColorStop(0.5, '#0c1527'); // Mid sky
    grad.addColorStop(1, '#1e293b');   // Horizon twilight
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);

    const skyTex = new t.CanvasTexture(canvas);
    const skyMat = new t.MeshBasicMaterial({
      map: skyTex,
      side: t.BackSide,
      fog: false
    });
    const skyDome = new t.Mesh(skyGeo, skyMat);
    this.scene.add(skyDome);
  }

  buildGroundPlane(t) {
    const size = 3000;
    const groundGeo = new t.PlaneGeometry(size, size, 32, 32);
    const groundMat = new t.MeshStandardMaterial({
      color: 0x141f33,
      roughness: 0.85,
      metalness: 0.15
    });
    this.groundMesh = new t.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = 0;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // Major grid (50m, bright cyan-tinted)
    this.gridHelperMajor = new t.GridHelper(size, Math.round(size / 50), 0x38bdf8, 0x1e293b);
    this.gridHelperMajor.position.y = 0.2;
    if (this.gridHelperMajor.material) {
      this.gridHelperMajor.material.opacity = 0.35;
      this.gridHelperMajor.material.transparent = true;
    }
    this.scene.add(this.gridHelperMajor);

    // Minor grid (10m, slate)
    this.gridHelperMinor = new t.GridHelper(size, Math.round(size / 10), 0x334155, 0x0f172a);
    this.gridHelperMinor.position.y = 0.1;
    if (this.gridHelperMinor.material) {
      this.gridHelperMinor.material.opacity = 0.22;
      this.gridHelperMinor.material.transparent = true;
    }
    this.scene.add(this.gridHelperMinor);

    // Water plane for flood scenarios
    const waterGeo = new t.PlaneGeometry(size, size);
    const waterMat = new t.MeshStandardMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.65,
      roughness: 0.1,
      metalness: 0.4
    });
    this.waterPlane = new t.Mesh(waterGeo, waterMat);
    this.waterPlane.rotation.x = -Math.PI / 2;
    this.waterPlane.position.y = -20;
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
    const btnHeatmap = document.getElementById('stBtnHeatmap');
    if (btnHeatmap) {
      btnHeatmap.addEventListener('click', () => {
        this.toggleCoverageHeatmap();
      });
    }
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
      this.requestRender();
    });

    if (btnTopdown) btnTopdown.addEventListener('click', () => {
      this.cameraMode = 'topdown';
      if (this.controls) {
        this.controls.enabled = true;
        const span = this.scenarioSpan || 300;
        this.camera.position.set(0, Math.max(220, span * 1.2), 0);
        this.controls.target.set(0, 0, 0);
      }
      if (hint) hint.textContent = 'Top-down orthogonal view | Drag to pan';
      updateBtns(btnTopdown);
      this.requestRender();
    });

    if (btnFreefly) btnFreefly.addEventListener('click', () => {
      this.cameraMode = 'freefly';
      if (this.controls) this.controls.enabled = false;
      if (hint) hint.textContent = 'WASD move | Mouse look | Q/E down/up';
      updateBtns(btnFreefly);
      this.requestRender();
    });

    if (btnFollow) btnFollow.addEventListener('click', () => {
      this.cameraMode = 'follow_node';
      if (this.controls) this.controls.enabled = true;
      if (hint) hint.textContent = 'Tracking selected survivor/relay';
      updateBtns(btnFollow);
      this.requestRender();
    });

    if (btnReset) btnReset.addEventListener('click', () => {
      this.fitCameraToScene();
      this.rotationAngle2D = 0.2;
      this.pitchAngle2D = 0.5;
      this.zoom2D = 1.0;
      this.panX2D = 0;
      this.panY2D = 0;
      this.requestRender();
    });

    if (btnWhyFail) btnWhyFail.addEventListener('click', () => {
      if (this.activeFailureData && this.lossWaterfallModal) {
        this.lossWaterfallModal.update(this.activeFailureData);
      }
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
      if (k === 'escape') {
        const fm = document.getElementById('stFailModal');
        if (fm) fm.style.display = 'none';
      }
      if (k === 'q') this.keys.q = true;
      if (k === 'e') this.keys.e = true;
      this.requestRender();
    };
    this._onKeyUp = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w') this.keys.w = false;
      if (k === 'a') this.keys.a = false;
      if (k === 's') this.keys.s = false;
      if (k === 'd') this.keys.d = false;
      if (k === 'q') this.keys.q = false;
      if (k === 'e') this.keys.e = false;
      this.requestRender();
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  bindRaycasting() {
    if (!this.mountPoint) return;
    this.mountPoint.addEventListener('click', (e) => {
      if (!this.camera || !this.scene || !this.T) return;
      const t = this.T;
      const rect = this.mountPoint.getBoundingClientRect();
      const mouse = new t.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new t.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      const hitCandidates = [];
      for (const [id, group] of this.nodeMeshes.entries()) {
        hitCandidates.push({ id, object: group });
      }

      for (const cand of hitCandidates) {
        const intersects = raycaster.intersectObjects(cand.object.children, true);
        if (intersects.length > 0) {
          this.selectNode(cand.id);
          break;
        }
      }
    });

    this.mountPoint.addEventListener('mousemove', (e) => {
      if (!this.camera || !this.scene || !this.T) return;
      const t = this.T;
      const rect = this.mountPoint.getBoundingClientRect();
      const mouse = new t.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new t.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      let hitId = null;
      for (const [id, group] of this.nodeMeshes.entries()) {
        const intersects = raycaster.intersectObjects(group.children, true);
        if (intersects.length > 0) {
          hitId = id;
          break;
        }
      }
      if (this.hoveredNodeId !== hitId) {
        this.hoveredNodeId = hitId;
        this.mountPoint.style.cursor = hitId !== null ? 'pointer' : 'default';
        this.requestRender();
      }
    });
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

  scheduleResize() {
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = null;
      this.resizeCanvas();
    });
  }

  resize() {
    if (!this.mountPoint || !this.renderer || !this.camera) return;
    const width = this.mountPoint.clientWidth || 800;
    const height = this.mountPoint.clientHeight || 500;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, this.qualityTier ? this.qualityTier.dprCap : 2.0);
    this.renderer.setPixelRatio(dpr);
    this.requestRender();
  }

  resizeCanvas2D() {
    if (!this.canvas2D) return;
    const p = this.canvas2D.parentElement;
    const rect = p && typeof p.getBoundingClientRect === 'function' ? p.getBoundingClientRect() : { width: 800, height: 500 };
    this.canvas2D.width = rect.width || 800;
    this.canvas2D.height = rect.height || 500;
    this.requestRender();
  }

  resizeCanvas() {
    if (this.isWebGL) {
      this.resize();
    } else {
      this.resizeCanvas2D();
    }
    this.requestRender();
  }

  // --- 3D Projection for Mathematical Testing & Unit Suites ---

  project(worldX, worldY, worldZ = 0) {
    const width = (this.canvas2D && this.canvas2D.width) || 800;
    const height = (this.canvas2D && this.canvas2D.height) || 480;
    const cx = width / 2 + this.panX2D;
    const cy = height / 2 + this.panY2D;
    const scale = (width / 1200) * this.zoom2D;

    const centerX = this.scenarioCenter ? this.scenarioCenter.x : 500;
    const centerY = this.scenarioCenter ? this.scenarioCenter.y : 500;

    let targetX = 0;
    let targetY = 0;
    if (this.cameraMode === 'follow_node' && this.selectedNodeId !== null && this.nodes.has(this.selectedNodeId)) {
      const sn = this.nodes.get(this.selectedNodeId);
      targetX = sn.x - centerX;
      targetY = sn.y - centerY;
    }

    const relX = worldX - centerX - targetX;
    const relY = worldY - centerY - targetY;

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

  to3DCoords(x, y, z = 0) {
    const cx = this.scenarioCenter ? this.scenarioCenter.x : 500;
    const cy = this.scenarioCenter ? this.scenarioCenter.y : 500;
    return {
      x: x - cx,
      y: z,
      z: y - cy
    };
  }

  // --- Camera Auto-Fitting & Framing ---

  fitCameraToScene() {
    if (!this.camera || !this.controls) return;
    let span = Math.max(this.scenarioSpan, 100);
    let targetX = 0, targetY = 0, targetZ = 0;

    if (this.environment && this.environment.subterranean && this.environment.cutaway_opening) {
      const cut = this.environment.cutaway_opening;
      const cutCenter = this.to3DCoords((cut.x1 + cut.x2) / 2, (cut.y1 + cut.y2) / 2);
      targetX = cutCenter.x * 0.70;
      targetZ = cutCenter.z * 0.70;
      span = Math.min(span, 260);
    }

    // 45-degree isometric framing tightly from outside
    const camDist = Math.max(90, span * 0.74);
    const posX = targetX + camDist * 0.707;
    const posY = targetY + camDist * 0.60;
    const posZ = targetZ + camDist * 0.707;

    this.camera.position.set(posX, posY, posZ);
    this.controls.target.set(targetX, targetY + 6, targetZ);

    this.camera.near = 0.5;
    this.camera.far = Math.max(6000, span * 6);
    this.camera.updateProjectionMatrix();

    this.controls.minDistance = 5;
    this.controls.maxDistance = Math.max(3000, span * 4);
    this.controls.update();

    if (this.scene && this.T) {
      this.scene.fog = new this.T.Fog(0x0c1527, Math.max(80, span * 0.5), Math.max(2000, span * 4.5));
    }
    this.requestRender();
  }

  // --- Data Setters ---

  setNodes(nodesList) {
    if (!Array.isArray(nodesList)) return;
    this.nodes.clear();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodesList) {
      this.nodes.set(n.id, { ...n });
      if (typeof n.x === 'number') {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
      }
      if (typeof n.y === 'number') {
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
    }

    if (nodesList.length > 0 && Number.isFinite(minX) && Number.isFinite(maxX)) {
      this.scenarioCenter = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2
      };
      const newSpan = Math.max(maxX - minX, maxY - minY, 120);
      this.scenarioSpan = newSpan;
      this.scenarioBounds = { minX, maxX, minY, maxY };

      const spanDelta = Math.abs(newSpan - (this.lastFittedSpan || 0));
      if (!this.initialFitDone || spanDelta > 40) {
        this.fitCameraToScene();
        this.initialFitDone = true;
        this.lastFittedSpan = newSpan;
      }
    }

    if (this.isWebGL && this.T) {
      this.syncNodeMeshes();
      this.updateBoundaryOutline();
    }
    this.requestRender();
  }

  setObstacles(obsList) {
    this.obstacles = Array.isArray(obsList) ? [...obsList] : [];
    this.updateObstacleBadge();
    if (this.isWebGL && this.T) {
      this.syncObstacleMeshes();
    }
    this.requestRender();
  }

  setEnvironment(env) {
    this.environment = env ? { ...env } : null;
    if (this.isWebGL && this.T) {
      this.syncEnvironmentMeshes();
    }
    this.requestRender();
  }

  updateObstacleBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('stObstacleBadge');
    if (!badge) return;

    if (this.obstacles.length > 0) {
      badge.textContent = `Structural Model: ${this.obstacles.length} Obstacles (Concrete / Slabs / Rubble)`;
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      badge.style.color = '#34d399';
    } else {
      badge.textContent = 'Open Terrain Model (No Obstacle Data in Scenario)';
      badge.style.background = 'rgba(56, 189, 248, 0.15)';
      badge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      badge.style.color = '#7dd3fc';
    }
  }

  setLinks(linksList) {
    this.links = Array.isArray(linksList) ? [...linksList] : [];
    if (this.isWebGL && this.T) {
      this.syncLinkObjects();
    }
    this.requestRender();
  }

  setNarratorText(text) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('stNarratorText');
    if (el && text) {
      el.textContent = text;
    }
  }

  setFailureData(data) {
    this.activeFailureData = data;
    if (this.lossWaterfallModal && data) {
      this.lossWaterfallModal.update(data);
    }
  }

  showFailureButton(visible) {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('stBtnWhyFail');
    if (btn) btn.style.display = visible ? 'inline-block' : 'none';
  }

  showFailureExplanation(title, linkDataOrMessage) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('stFailModal');
    const body = document.getElementById('stFailModalBody');
    const btn = document.getElementById('stBtnWhyFail');
    if (btn) btn.style.display = 'inline-block';

    if (typeof linkDataOrMessage === 'object' && linkDataOrMessage !== null) {
      this.activeFailureData = linkDataOrMessage;
      if (this.lossWaterfallModal) {
        this.lossWaterfallModal.update(linkDataOrMessage);
      }
    } else if (body) {
      body.innerHTML = `<div style="padding:10px; font-size:12px; line-height:1.5;"><strong>${title}</strong><br><br>${linkDataOrMessage}</div>`;
    }
    if (modal) modal.style.display = 'block';
  }

  hideFailureExplanation() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('stFailModal');
    if (modal) modal.style.display = 'none';
  }

  setWaterElevation(levelMeters) {
    this.waterLevel = levelMeters;
    if (this.waterPlane) {
      this.waterPlane.position.y = levelMeters * 2.0;
    }
    this.requestRender();
  }

  selectNode(nodeId) {
    this.selectedNodeId = nodeId;
    if (this.isWebGL && this.T) {
      for (const [id, group] of this.nodeMeshes.entries()) {
        const ring = group.getObjectByName('highlightRing');
        if (ring) ring.visible = (id === nodeId);
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('setu:node-selected', { detail: { nodeId } }));
    }
    this.requestRender();
  }



  // --- 3D Scene Graph Synchronization ---

  updateBoundaryOutline() {
    if (!this.scene || !this.T) return;
    const t = this.T;
    if (this.boundaryOutline) {
      disposeThreeObject(this.boundaryOutline);
      this.scene.remove(this.boundaryOutline);
      this.boundaryOutline = null;
    }

    const b = this.scenarioBounds;
    const p1 = this.to3DCoords(b.minX, b.minY, 0.4);
    const p2 = this.to3DCoords(b.maxX, b.minY, 0.4);
    const p3 = this.to3DCoords(b.maxX, b.maxY, 0.4);
    const p4 = this.to3DCoords(b.minX, b.maxY, 0.4);

    const pts = [
      new t.Vector3(p1.x, p1.y, p1.z),
      new t.Vector3(p2.x, p2.y, p2.z),
      new t.Vector3(p3.x, p3.y, p3.z),
      new t.Vector3(p4.x, p4.y, p4.z),
      new t.Vector3(p1.x, p1.y, p1.z)
    ];

    const geo = new t.BufferGeometry().setFromPoints(pts);
    const mat = new t.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45
    });
    this.boundaryOutline = new t.Line(geo, mat);
    this.scene.add(this.boundaryOutline);
  }

  syncNodeMeshes() {
    if (!this.scene || !this.T) return;
    const t = this.T;

    for (const [id, meshGroup] of this.nodeMeshes.entries()) {
      if (!this.nodes.has(id)) {
        disposeThreeObject(meshGroup);
        this.scene.remove(meshGroup);
        this.nodeMeshes.delete(id);
      }
    }

    for (const [id, node] of this.nodes.entries()) {
      let group = this.nodeMeshes.get(id);
      if (group && group.userData && group.userData.role !== node.role) {
        disposeThreeObject(group);
        this.scene.remove(group);
        group = null;
        this.nodeMeshes.delete(id);
      }
      if (!group) {
        group = this.createNodeMesh(node, t);
        this.scene.add(group);
        this.nodeMeshes.set(id, group);
      } else {
        this.updateNodeMeshState(group, node, t);
      }

      let nodeElev = node.elevation || 0;
      if (this.environment && this.environment.subterranean && node.id === 3 && nodeElev === 0) {
        nodeElev = -8.0;
      }
      const p = this.to3DCoords(node.x, node.y, nodeElev);
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
    group.name = `node_${node.id}`;
    group.userData = { id: node.id, role: node.role };

    const role = (node.role || '').toLowerCase();
    const isSos = Boolean(node.sos_active || (node.hazard !== undefined && node.hazard > 0));

    // Role Color Standards:
    // Survivor: Cyan (0x00f0ff)
    // Relay: Amber (0xf59e0b)
    // Hub: Green (0x10b981)
    // Active Emergency: Red (0xef4444)
    let roleColorHex = 0x00f0ff;
    if (isSos) roleColorHex = 0xef4444;
    else if (role === 'hub') roleColorHex = 0x10b981;
    else if (role === 'relay') roleColorHex = 0xf59e0b;

    // 1. Prominent Emissive Beacon Group (Visible at Any Distance / Area Scale)
    const beaconGroup = new t.Group();
    beaconGroup.name = 'beaconGroup';

    // Glowing Vertical Pillar (~38 world units tall)
    const pillarGeo = new t.CylinderGeometry(0.8, 1.4, 38, 16);
    const pillarMat = new t.MeshStandardMaterial({
      color: roleColorHex,
      emissive: roleColorHex,
      emissiveIntensity: isSos ? 1.2 : 0.85,
      roughness: 0.25,
      metalness: 0.2
    });
    const pillar = new t.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 19;
    pillar.castShadow = true;
    beaconGroup.add(pillar);

    // Glowing Gem Topper
    const topperGeo = new t.OctahedronGeometry(2.6, 0);
    const topperMat = new t.MeshStandardMaterial({
      color: roleColorHex,
      emissive: roleColorHex,
      emissiveIntensity: 1.0,
      roughness: 0.1
    });
    const topper = new t.Mesh(topperGeo, topperMat);
    topper.position.y = 39.5;
    topper.name = 'beaconTopper';
    beaconGroup.add(topper);

    // Ground Ring
    const groundRingGeo = new t.RingGeometry(4.5, 6.0, 32);
    const groundRingMat = new t.MeshBasicMaterial({
      color: roleColorHex,
      side: t.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const groundRing = new t.Mesh(groundRingGeo, groundRingMat);
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.y = 0.3;
    beaconGroup.add(groundRing);

    group.add(beaconGroup);

    // 2. High-Contrast Text Badge Sprite (Readable ID & Role)
    const labelSprite = this.createNodeLabelSprite(node, roleColorHex, t);
    labelSprite.position.y = 46;
    labelSprite.name = 'labelSprite';
    group.add(labelSprite);

    // 3. Detailed Low-Poly Model (LOD: Visible within Site Scale / Near Camera)
    if (role === 'hub') {
      const hubStructure = this.createHubStructure(t);
      group.add(hubStructure);
    } else if (role === 'relay') {
      const relayTower = this.createRelayTower(t);
      group.add(relayTower);
    } else {
      const humanGroup = this.createHumanAvatar(node, t);
      humanGroup.name = 'humanGroup';
      humanGroup.visible = false; // Swapped dynamically based on distance in updateThree
      group.add(humanGroup);
    }

    // 4. Selection Highlight Ring
    const highlightGeo = new t.RingGeometry(9.0, 10.5, 32);
    const highlightMat = new t.MeshBasicMaterial({
      color: 0x38bdf8,
      side: t.DoubleSide
    });
    const highlightRing = new t.Mesh(highlightGeo, highlightMat);
    highlightRing.rotation.x = -Math.PI / 2;
    highlightRing.position.y = 0.4;
    highlightRing.name = 'highlightRing';
    highlightRing.visible = false;
    group.add(highlightRing);

    return group;
  }

  createDepthMarkerBadge(text, colorHex = '#38bdf8', t) {
    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(12, 21, 39, 0.90)';
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(4, 4, 332, 56, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 170, 32);

    const texture = new t.CanvasTexture(canvas);
    const mat = new t.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new t.Sprite(mat);
    sprite.scale.set(30, 6.0, 1);
    return sprite;
  }

  updateLabelAvoidance(t) {
    if (!this.camera || !this.nodeMeshes || this.nodeMeshes.size === 0) return;

    const items = [];
    const tempVec = new t.Vector3();
    const viewportH = (this.renderer && this.renderer.domElement && this.renderer.domElement.clientHeight) || 720;
    const tanHalfFov = Math.tan(((this.camera.fov || 45) * Math.PI) / 360);

    for (const [id, group] of this.nodeMeshes.entries()) {
      const node = this.nodes.get(id);
      const label = group.getObjectByName('labelSprite');
      if (!label) continue;

      group.getWorldPosition(tempVec);
      const distToCam = this.camera.position.distanceTo(tempVec);

      const isSelected = (id === this.selectedNodeId);
      const isHovered = (id === this.hoveredNodeId);
      const showFull = isSelected || isHovered;

      if (label.userData) {
        if (showFull && label.userData.fullTex) {
          if (label.material.map !== label.userData.fullTex) {
            label.material.map = label.userData.fullTex;
            label.material.needsUpdate = true;
          }
        } else if (label.userData.compactTex) {
          if (label.material.map !== label.userData.compactTex) {
            label.material.map = label.userData.compactTex;
            label.material.needsUpdate = true;
          }
        }

        const aspect = showFull ? (label.userData.fullAspect || 7.5) : (label.userData.compactAspect || 2.5);
        // Constant screen-pixel scaling: ~13 px for compact at distance, ~18 px when hovered/selected
        const targetPx = showFull ? 18.0 : 13.0;
        let worldH = (targetPx * (2.0 * distToCam * tanHalfFov)) / viewportH;
        // Cap so at extreme close range screen height <= 22px and viewport area footprint is strictly under 1%
        const maxWorldH = (22.0 * (2.0 * distToCam * tanHalfFov)) / viewportH;
        worldH = Math.min(worldH, Math.max(0.4, maxWorldH));
        worldH = Math.max(0.25, Math.min(5.0, worldH));
        label.scale.set(worldH * aspect, worldH, 1.0);
      }

      label.position.y = 44;

      const proj = tempVec.clone();
      proj.y += label.position.y;
      proj.project(this.camera);

      if (proj.z > 1.0) {
        label.visible = false;
        continue;
      }
      label.visible = true;

      let priority = 3;
      if (isSelected || (node && (node.sos_active || (node.hazard !== undefined && node.hazard > 0)))) {
        priority = 0;
      } else if (node && node.role === 'hub') {
        priority = 1;
      } else if (node && node.role === 'relay') {
        priority = 2;
      }

      items.push({
        id,
        node,
        group,
        label,
        showFull,
        screenX: proj.x,
        screenY: proj.y,
        distToCam,
        priority
      });
    }

    items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.distToCam !== b.distToCam) return a.distToCam - b.distToCam;
      return a.id - b.id;
    });

    const placedBoxes = [];
    for (const item of items) {
      let sx = item.screenX;
      let sy = item.screenY;
      const w = item.showFull ? 0.22 : 0.08;
      const h = 0.04;

      let overlap = false;
      for (const b of placedBoxes) {
        if (Math.abs(sx - b.x) < (w + b.w) * 0.45 && Math.abs(sy - b.y) < (h + b.h) * 0.45) {
          overlap = true;
          break;
        }
      }

      if (overlap) {
        if (item.priority > 0) {
          const staggerOffset = (item.id % 2 === 0) ? 14 : -12;
          item.label.position.y = 44 + staggerOffset;

          const reproj = item.group.position.clone();
          reproj.y += item.label.position.y;
          reproj.project(this.camera);
          sx = reproj.x;
          sy = reproj.y;

          let stillOverlap = false;
          for (const b of placedBoxes) {
            if (Math.abs(sx - b.x) < (w + b.w) * 0.45 && Math.abs(sy - b.y) < (h + b.h) * 0.45) {
              stillOverlap = true;
              break;
            }
          }

          if (stillOverlap) {
            if (item.label.material) item.label.material.opacity = 0.18;
          } else {
            if (item.label.material) item.label.material.opacity = 1.0;
          }
        }
      } else {
        if (item.label.material) item.label.material.opacity = 1.0;
      }

      placedBoxes.push({ x: sx, y: sy, w, h });
    }
  }

  createNodeLabelSprite(node, colorHex, t) {
    const role = (node.role || 'survivor').toUpperCase();
    const hexStr = `#${colorHex.toString(16).padStart(6, '0')}`;

    // 1. Compact Texture (Role color dot + Node ID, shown at distance)
    const compactText = node.role === 'hub' ? 'H0' : String(node.id);
    const compactKey = `c_${node.role}_${compactText}_${hexStr}`;
    let compactTex = this.labelTextureCache.get(compactKey);
    if (!compactTex) {
      const compactCanvas = document.createElement('canvas');
      compactCanvas.width = 120;
      compactCanvas.height = 48;
      const cctx = compactCanvas.getContext('2d');
      cctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      cctx.strokeStyle = hexStr;
      cctx.lineWidth = 3;
      const cr = 14, cx = 2, cy = 2, cw = 116, ch = 44;
      cctx.beginPath();
      cctx.moveTo(cx + cr, cy);
      cctx.lineTo(cx + cw - cr, cy);
      cctx.quadraticCurveTo(cx + cw, cy, cx + cw, cy + cr);
      cctx.lineTo(cx + cw, cy + ch - cr);
      cctx.quadraticCurveTo(cx + cw, cy + ch, cx + cw - cr, cy + ch);
      cctx.lineTo(cx + cr, cy + ch);
      cctx.quadraticCurveTo(cx, cy + ch, cx, cy + ch - cr);
      cctx.lineTo(cx, cy + cr);
      cctx.quadraticCurveTo(cx, cy, cx + cr, cy);
      cctx.closePath();
      cctx.fill();
      cctx.stroke();
      // Compact dot
      cctx.beginPath();
      cctx.arc(20, 24, 7, 0, Math.PI * 2);
      cctx.fillStyle = hexStr;
      cctx.fill();
      // Compact text
      cctx.font = 'bold 22px monospace';
      cctx.fillStyle = '#ffffff';
      cctx.textBaseline = 'middle';
      cctx.fillText(compactText, 36, 24);
      compactTex = new t.CanvasTexture(compactCanvas);
      compactTex.minFilter = t.LinearFilter;
      this.labelTextureCache.set(compactKey, compactTex);
    }

    // 2. Full Texture (Node ID + Role description, shown on hover/selection)
    const fullText = node.role === 'hub' ? 'RESCUE HUB 0' : `NODE ${node.id} (${role})`;
    const fullKey = `f_${node.role}_${fullText}_${hexStr}`;
    let fullTex = this.labelTextureCache.get(fullKey);
    if (!fullTex) {
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = 360;
      fullCanvas.height = 48;
      const fctx = fullCanvas.getContext('2d');
      fctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      fctx.strokeStyle = hexStr;
      fctx.lineWidth = 3;
      const fr = 14, fx = 2, fy = 2, fw = 356, fh = 44;
      fctx.beginPath();
      fctx.moveTo(fx + fr, fy);
      fctx.lineTo(fx + fw - fr, fy);
      fctx.quadraticCurveTo(fx + fw, fy, fx + fw, fy + fr);
      fctx.lineTo(fx + fw, fy + fh - fr);
      fctx.quadraticCurveTo(fx + fw, fy + fh, fx + fw - fr, fy + fh);
      fctx.lineTo(fx + fr, fy + fh);
      fctx.quadraticCurveTo(fx, fy + fh, fx, fy + fh - fr);
      fctx.lineTo(fx, fy + fr);
      fctx.quadraticCurveTo(fx, fy, fx + fr, fy);
      fctx.closePath();
      fctx.fill();
      fctx.stroke();
      // Full dot
      fctx.beginPath();
      fctx.arc(20, 24, 7, 0, Math.PI * 2);
      fctx.fillStyle = hexStr;
      fctx.fill();
      // Full text
      fctx.font = 'bold 18px sans-serif';
      fctx.fillStyle = '#ffffff';
      fctx.textBaseline = 'middle';
      fctx.fillText(fullText, 36, 24);
      fullTex = new t.CanvasTexture(fullCanvas);
      fullTex.minFilter = t.LinearFilter;
      this.labelTextureCache.set(fullKey, fullTex);
    }

    const spriteMat = new t.SpriteMaterial({ map: compactTex, depthTest: false, transparent: true });
    const sprite = new t.Sprite(spriteMat);
    sprite.userData = {
      compactTex,
      fullTex,
      compactAspect: 120 / 48,
      fullAspect: 360 / 48,
      nodeId: node.id
    };
    sprite.scale.set(6.0, 2.4, 1.0);
    return sprite;
  }

  createHubStructure(t) {
    const hub = new t.Group();
    hub.name = 'hubStructure';

    // Command tent (octagonal pavilion)
    const tentGeo = new t.ConeGeometry(14, 16, 8);
    const tentMat = new t.MeshStandardMaterial({
      color: 0x10b981,
      roughness: 0.35,
      metalness: 0.1
    });
    const tent = new t.Mesh(tentGeo, tentMat);
    tent.position.y = 8;
    tent.castShadow = true;
    tent.receiveShadow = true;
    hub.add(tent);

    // Communications mast
    const mastGeo = new t.CylinderGeometry(0.7, 0.9, 28, 8);
    const mastMat = new t.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
    const mast = new t.Mesh(mastGeo, mastMat);
    mast.position.set(0, 14, 0);
    hub.add(mast);

    return hub;
  }

  createRelayTower(t) {
    const relay = new t.Group();
    relay.name = 'relayTower';

    // Sturdy utility pole
    const poleGeo = new t.CylinderGeometry(1.0, 1.4, 22, 12);
    const poleMat = new t.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.4 });
    const pole = new t.Mesh(poleGeo, poleMat);
    pole.position.y = 11;
    pole.castShadow = true;
    relay.add(pole);

    // Solar PV panel
    const panelGeo = new t.BoxGeometry(10, 0.6, 7);
    const panelMat = new t.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.9, roughness: 0.2 });
    const panel = new t.Mesh(panelGeo, panelMat);
    panel.position.set(0, 15, 3.5);
    panel.rotation.x = Math.PI / 6;
    relay.add(panel);

    // Collinear LoRa antenna mast
    const antGeo = new t.CylinderGeometry(0.3, 0.3, 14, 8);
    const antMat = new t.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5 });
    const ant = new t.Mesh(antGeo, antMat);
    ant.position.y = 25;
    relay.add(ant);

    return relay;
  }

  createHumanAvatar(node, t) {
    const avatar = new t.Group();
    const motion = (node.motion_profile || '').toLowerCase();
    const isCrawling = motion === 'crawling';
    const isTrapped = motion === 'fall_impact' || node.hazard === 2;

    const bodyMat = new t.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.7 });
    const skinMat = new t.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.6 });
    const bootMat = new t.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

    // Torso (jacket)
    const torsoGeo = new t.BoxGeometry(4.5, 8.0, 3.0);
    const torso = new t.Mesh(torsoGeo, bodyMat);
    torso.position.y = 10;
    torso.castShadow = true;
    avatar.add(torso);

    // Head
    const headGeo = new t.SphereGeometry(2.2, 12, 12);
    const head = new t.Mesh(headGeo, skinMat);
    head.position.y = 16;
    head.castShadow = true;
    avatar.add(head);

    // Legs
    const legGeo = new t.BoxGeometry(1.8, 8.0, 1.8);
    const leftLeg = new t.Mesh(legGeo, bootMat);
    leftLeg.position.set(-1.3, 4.0, 0);
    avatar.add(leftLeg);

    const rightLeg = new t.Mesh(legGeo, bootMat);
    rightLeg.position.set(1.3, 4.0, 0);
    avatar.add(rightLeg);

    // Arms
    const armGeo = new t.BoxGeometry(1.4, 7.5, 1.4);
    const leftArm = new t.Mesh(armGeo, bodyMat);
    leftArm.position.set(-3.2, 9.5, 0);
    avatar.add(leftArm);

    const rightArm = new t.Mesh(armGeo, bodyMat);
    rightArm.position.set(3.2, 9.5, 0);
    avatar.add(rightArm);

    // Glowing Wristband on Left Wrist
    const bandGeo = new t.TorusGeometry(1.2, 0.45, 8, 16);
    const isAcked = Boolean(node.acked);
    const bandColor = isAcked ? 0x10b981 : (node.hazard ? 0xef4444 : 0x00f0ff);
    const bandMat = new t.MeshStandardMaterial({
      color: bandColor,
      emissive: bandColor,
      emissiveIntensity: 1.2
    });
    const band = new t.Mesh(bandGeo, bandMat);
    band.name = 'wristbandTwinMesh';
    band.position.set(-3.2, 6.2, 0);
    band.rotation.x = Math.PI / 2;
    avatar.add(band);

    const bandLight = new t.PointLight(bandColor, 1.5, 20);
    bandLight.position.set(-3.2, 6.2, 0);
    bandLight.name = 'wristbandPointLight';
    avatar.add(bandLight);

    if (isCrawling) {
      avatar.rotation.x = Math.PI / 2 - 0.25;
      avatar.position.y = 2.0;
    } else if (isTrapped) {
      avatar.rotation.z = Math.PI / 2;
      avatar.position.y = 1.2;
    }

    return avatar;
  }

  updateNodeMeshState(group, node, t) {
    const isSos = Boolean(node.sos_active || (node.hazard !== undefined && node.hazard > 0));
    const role = (node.role || '').toLowerCase();

    let roleColorHex = 0x00f0ff;
    if (isSos) roleColorHex = 0xef4444;
    else if (role === 'hub') roleColorHex = 0x10b981;
    else if (role === 'relay') roleColorHex = 0xf59e0b;

    const beaconGroup = group.getObjectByName('beaconGroup');
    if (beaconGroup) {
      beaconGroup.traverse(child => {
        if (child.isMesh && child.material) {
          if (child.material.color) child.material.color.setHex(roleColorHex);
          if (child.material.emissive) child.material.emissive.setHex(roleColorHex);
        }
      });
    }

    const bandMesh = group.getObjectByName('wristbandTwinMesh');
    if (bandMesh && bandMesh.material) {
      const isAcked = Boolean(node.acked);
      const bColor = isAcked ? 0x10b981 : (isSos ? 0xef4444 : 0x00f0ff);
      bandMesh.material.color.setHex(bColor);
      bandMesh.material.emissive.setHex(bColor);
    }
  }

  syncObstacleMeshes() {
    if (!this.scene || !this.T) return;
    const t = this.T;

    for (const mesh of this.obstacleMeshes) {
      disposeThreeObject(mesh);
      this.scene.remove(mesh);
    }
    this.obstacleMeshes = [];

    for (const obs of this.obstacles) {
      const p1 = this.to3DCoords(obs.x1, obs.y1);
      const p2 = this.to3DCoords(obs.x2, obs.y2);

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const length = Math.max(1.0, Math.sqrt(dx * dx + dz * dz));
      const angle = Math.atan2(dz, dx);

      const thickness = (obs.thickness_m || 0.3) * 10.0;
      const height = (obs.height_m || 3.5) * 6.0;
      const tilt = (obs.tilt_deg || 0.0) * (Math.PI / 180);
      const floorIdx = obs.floor_index !== undefined ? obs.floor_index : 0;
      const elevY = (obs.elevation_m !== undefined ? obs.elevation_m : floorIdx * 20.0);

      const geo = new t.BoxGeometry(length, height, thickness);
      const isConcrete = obs.material === 'concrete';
      const mat = new t.MeshStandardMaterial({
        color: isConcrete ? 0x78716c : 0x9a3412,
        roughness: isConcrete ? 0.75 : 0.85,
        metalness: 0.1
      });
      const mesh = new t.Mesh(geo, mat);
      mesh.name = `obs_${obs.id}`;
      mesh.userData = {
        id: obs.id,
        label: obs.label,
        material: obs.material,
        attenuation_db: obs.attenuation_db,
        x1: obs.x1,
        y1: obs.y1,
        x2: obs.x2,
        y2: obs.y2
      };

      mesh.position.set((p1.x + p2.x) / 2, elevY + height / 2, (p1.z + p2.z) / 2);
      mesh.rotation.y = -angle;
      mesh.rotation.z = tilt;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.scene.add(mesh);
      this.obstacleMeshes.push(mesh);
    }
  }

  syncEnvironmentMeshes() {
    if (!this.scene || !this.T) return;
    const t = this.T;

    for (const m of this.environmentMeshes) {
      disposeThreeObject(m);
      this.scene.remove(m);
    }
    this.environmentMeshes = [];

    if (!this.environment) return;
    const env = this.environment;

    // 1. Street rendering
    if (env.street) {
      const p1 = this.to3DCoords(env.street.x1, env.street.y1);
      const p2 = this.to3DCoords(env.street.x2, env.street.y2);
      const sw = Math.abs(p2.x - p1.x) || 30;
      const sh = Math.abs(p2.z - p1.z) || 200;

      const streetGeo = new t.PlaneGeometry(sw, sh);
      const streetMat = new t.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.9,
        metalness: 0.1
      });
      const streetMesh = new t.Mesh(streetGeo, streetMat);
      streetMesh.rotation.x = -Math.PI / 2;
      streetMesh.position.set((p1.x + p2.x) / 2, 0.15, (p1.z + p2.z) / 2);
      streetMesh.receiveShadow = true;
      this.scene.add(streetMesh);
      this.environmentMeshes.push(streetMesh);
    }

    // 2. Rubble mounds
    if (Array.isArray(env.rubble_volumes)) {
      for (const rv of env.rubble_volumes) {
        const p = this.to3DCoords(rv.x, rv.y, rv.z || 0);
        const rad = (rv.radius_m || 8.0) * 1.5;
        const h = (rv.height_m || 2.5) * 4.0;

        const rubbleGeo = new t.ConeGeometry(rad, h, 7);
        const rubbleMat = new t.MeshStandardMaterial({
          color: 0x64748b,
          roughness: 0.95,
          metalness: 0.05
        });
        const mound = new t.Mesh(rubbleGeo, rubbleMat);
        mound.position.set(p.x, h / 2, p.z);
        mound.rotation.y = Math.PI / 5;
        mound.castShadow = true;
        mound.receiveShadow = true;
        this.scene.add(mound);
        this.environmentMeshes.push(mound);
      }
    }

    // 3. Subterranean cutaway / levels
    if (env.subterranean) {
      const depth = (env.depth_m || 12.0) * 4.0;
      const cut = env.cutaway_opening || { x1: 200, y1: 200, x2: 400, y2: 400 };
      const cp1 = this.to3DCoords(cut.x1, cut.y1);
      const cp2 = this.to3DCoords(cut.x2, cut.y2);
      const cw = Math.abs(cp2.x - cp1.x) || 120;
      const cd = Math.abs(cp2.z - cp1.z) || 120;

      // Subterranean floor
      const cx = (cp1.x + cp2.x) / 2;
      const cz = (cp1.z + cp2.z) / 2;

      const subFloorGeo = new t.PlaneGeometry(cw, cd);
      const subFloorMat = new t.MeshStandardMaterial({
        color: 0x223049,
        roughness: 0.8
      });
      const subFloor = new t.Mesh(subFloorGeo, subFloorMat);
      subFloor.rotation.x = -Math.PI / 2;
      subFloor.position.set(cx, -depth, cz);
      this.scene.add(subFloor);
      this.environmentMeshes.push(subFloor);

      // Underground grid lines
      const subGrid = new t.GridHelper(Math.max(cw, cd), 10, 0x38bdf8, 0x334155);
      subGrid.position.set(cx, -depth + 0.1, cz);
      if (subGrid.material) {
        subGrid.material.opacity = 0.45;
        subGrid.material.transparent = true;
      }
      this.scene.add(subGrid);
      this.environmentMeshes.push(subGrid);

      // Perimeter retaining concrete walls of excavation pit
      const wallMat = new t.MeshStandardMaterial({
        color: 0x3a4b66,
        roughness: 0.75
      });
      const nsGeo = new t.BoxGeometry(cw, depth, 4);
      const wallN = new t.Mesh(nsGeo, wallMat);
      wallN.position.set(cx, -depth / 2, cz - cd / 2);
      this.scene.add(wallN);
      this.environmentMeshes.push(wallN);

      const wallS = new t.Mesh(nsGeo, wallMat);
      wallS.position.set(cx, -depth / 2, cz + cd / 2);
      this.scene.add(wallS);
      this.environmentMeshes.push(wallS);

      const ewGeo = new t.BoxGeometry(4, depth, cd);
      const wallE = new t.Mesh(ewGeo, wallMat);
      wallE.position.set(cx + cw / 2, -depth / 2, cz);
      this.scene.add(wallE);
      this.environmentMeshes.push(wallE);

      const wallW = new t.Mesh(ewGeo, wallMat);
      wallW.position.set(cx - cw / 2, -depth / 2, cz);
      this.scene.add(wallW);
      this.environmentMeshes.push(wallW);

      // Translucent ground surface cutaway slab
      const slabGeo = new t.PlaneGeometry(cw + 30, cd + 30);
      const slabMat = new t.MeshStandardMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        roughness: 0.3
      });
      const groundCutaway = new t.Mesh(slabGeo, slabMat);
      groundCutaway.rotation.x = -Math.PI / 2;
      groundCutaway.position.set(cx, 0.5, cz);
      this.scene.add(groundCutaway);
      this.environmentMeshes.push(groundCutaway);

      // Ground level marker and depth level badges (Option A)
      const groundMarker = this.createDepthMarkerBadge('GROUND LEVEL (0.0m)', '#38bdf8', t);
      groundMarker.position.set(cx - cw / 2 - 20, 6.0, cz - cd / 2);
      this.scene.add(groundMarker);
      this.environmentMeshes.push(groundMarker);

      // Ruler vertical line along excavation corner
      const rulerGeo = new t.BufferGeometry().setFromPoints([
        new t.Vector3(cx - cw / 2 - 4, 0, cz - cd / 2),
        new t.Vector3(cx - cw / 2 - 4, -depth, cz - cd / 2)
      ]);
      const rulerMat = new t.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
      const rulerLine = new t.Line(rulerGeo, rulerMat);
      this.scene.add(rulerLine);
      this.environmentMeshes.push(rulerLine);

      // Depth level badges from environment schema
      if (Array.isArray(env.levels)) {
        for (const lvl of env.levels) {
          if (lvl.elevation_m < 0) {
            const yPos = lvl.elevation_m * 4.0;
            const badgeText = `${lvl.name || 'Level'}: ${lvl.elevation_m}m`;
            const depthBadge = this.createDepthMarkerBadge(badgeText, '#f59e0b', t);
            depthBadge.position.set(cx - cw / 2 - 20, yPos + 3.0, cz - cd / 2);
            this.scene.add(depthBadge);
            this.environmentMeshes.push(depthBadge);
          }
        }
      } else {
        const depthBadge = this.createDepthMarkerBadge(`DEPTH: -${env.depth_m || 12}m`, '#f59e0b', t);
        depthBadge.position.set(cx - cw / 2 - 20, -depth + 4.0, cz - cd / 2);
        this.scene.add(depthBadge);
        this.environmentMeshes.push(depthBadge);
      }
    }
  }

  // 2D Line Segment Intersection Helper matching C++ engine rf_environment.hpp
  static segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const r_x = bx - ax;
    const r_y = by - ay;
    const s_x = dx - cx;
    const s_y = dy - cy;
    const rxs = r_x * s_y - r_y * s_x;
    if (Math.abs(rxs) < 1e-9) return false;
    const qp_x = cx - ax;
    const qp_y = cy - ay;
    const t = (qp_x * s_y - qp_y * s_x) / rxs;
    const u = (qp_x * r_y - qp_y * r_x) / rxs;
    return t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0;
  }

  createHopBadge(text, colorHex, t) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = typeof colorHex === 'string' ? colorHex : ('#' + colorHex.toString(16).padStart(6, '0'));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(2, 2, 156, 44, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 80, 24);

    const texture = new t.CanvasTexture(canvas);
    const spriteMat = new t.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new t.Sprite(spriteMat);
    sprite.scale.set(12, 3.6, 1);
    return sprite;
  }

  createMinusDbBadge(text, colorHex, t) {
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(220, 38, 38, 0.90)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(2, 2, 176, 44, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 90, 24);

    const texture = new t.CanvasTexture(canvas);
    const spriteMat = new t.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new t.Sprite(spriteMat);
    sprite.scale.set(16, 4.2, 1);
    return sprite;
  }

  createDropCauseBadge(text, colorHex, t) {
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 54;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(239, 68, 68, 0.92)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(2, 2, 276, 50, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 140, 27);

    const texture = new t.CanvasTexture(canvas);
    const spriteMat = new t.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new t.Sprite(spriteMat);
    sprite.scale.set(24, 4.6, 1);
    return sprite;
  }

  clearTransientRadioVisuals() {
    if (!this.scene) return;
    for (const p of this.activePulses) {
      if (p.mesh) {
        disposeThreeObject(p.mesh);
        this.scene.remove(p.mesh);
      }
      if (p.badge) {
        disposeThreeObject(p.badge);
        this.scene.remove(p.badge);
      }
    }
    this.activePulses = [];

    for (const r of this.airtimeRings) {
      if (r.mesh) {
        disposeThreeObject(r.mesh);
        this.scene.remove(r.mesh);
      }
    }
    this.airtimeRings = [];

    for (const f of this.dropFlashes) {
      if (f.mesh) {
        disposeThreeObject(f.mesh);
        this.scene.remove(f.mesh);
      }
      if (f.badge) {
        disposeThreeObject(f.badge);
        this.scene.remove(f.badge);
      }
    }
    this.dropFlashes = [];

    for (const wh of this.wallHighlights) {
      if (wh.wallMesh) {
        wh.wallMesh.traverse(child => {
          if (child.isMesh && child.material && child.material.emissive) {
            child.material.emissive.setHex(0x000000);
          }
        });
      }
      if (wh.badge) this.scene.remove(wh.badge);
    }
    this.wallHighlights = [];
  }

  triggerDropFlash(nodeId, reason = 'weak') {
    if (!this.scene || !this.T) return;
    const t = this.T;
    const n = this.nodes.get(nodeId);
    if (!n) return;
    const p = this.to3DCoords(n.x, n.y, (n.role === 'relay' ? 18 : 6));

    const flashGeo = new t.RingGeometry(2.0, 8.0, 32);
    const flashMat = new t.MeshBasicMaterial({
      color: 0xef4444,
      side: t.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    const flashMesh = new t.Mesh(flashGeo, flashMat);
    flashMesh.rotation.x = -Math.PI / 2;
    flashMesh.position.set(p.x, 0.6, p.z);
    this.scene.add(flashMesh);

    let causeText = 'DROP: WEAK SIGNAL';
    if (reason === 'collision') causeText = 'DROP: COLLISION';
    else if (reason === 'halfduplex') causeText = 'DROP: HALF-DUPLEX';
    else if (reason === 'blocked') causeText = 'DROP: BLOCKED';

    const causeBadge = this.createDropCauseBadge(causeText, '#ef4444', t);
    causeBadge.position.set(p.x, p.y + 10.0, p.z);
    this.scene.add(causeBadge);

    if (this.dropFlashes.length >= 3) {
      const oldest = this.dropFlashes.shift();
      if (oldest.mesh) this.scene.remove(oldest.mesh);
      if (oldest.badge) this.scene.remove(oldest.badge);
    }
    this.dropFlashes.push({
      mesh: flashMesh,
      badge: causeBadge,
      alpha: 1.0,
      radius: 4.0
    });
    this.requestRender();
  }

  checkAndHighlightObstacles(tx_x, tx_y, rx_x, rx_y) {
    if (!this.obstacles || this.obstacles.length === 0 || !this.T) return;
    const t = this.T;

    for (const obs of this.obstacles) {
      if (SetuTwin3DViewer.segmentsIntersect(tx_x, tx_y, rx_x, rx_y, obs.x1, obs.y1, obs.x2, obs.y2)) {
        const wallMesh = (Array.isArray(this.obstacleMeshes) ? this.obstacleMeshes.find(m => m.userData && m.userData.id === obs.id) : null) || this.scene.getObjectByName(`obs_${obs.id}`);
        if (wallMesh) {
          wallMesh.traverse(child => {
            if (child.isMesh && child.material && child.material.emissive) {
              child.material.emissive.setHex(0xf59e0b);
              child.material.emissiveIntensity = 1.0;
            }
          });
        }

        const midX = (obs.x1 + obs.x2) / 2;
        const midY = (obs.y1 + obs.y2) / 2;
        const mid3D = this.to3DCoords(midX, midY, obs.height_m ? obs.height_m * 3.5 : 12);
        const lossDb = Math.round(obs.attenuation_db || 22);

        const badge = this.createMinusDbBadge(`-${lossDb} dB`, '#f59e0b', t);
        badge.position.set(mid3D.x, mid3D.y + 6.0, mid3D.z);
        this.scene.add(badge);

        if (this.wallHighlights.length >= 4) {
          const oldest = this.wallHighlights.shift();
          if (oldest.wallMesh) {
            oldest.wallMesh.traverse(child => {
              if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissive.setHex(0x000000);
              }
            });
          }
          if (oldest.badge) this.scene.remove(oldest.badge);
        }
        this.wallHighlights.push({
          obsId: obs.id,
          wallMesh,
          badge,
          timer: 2.5
        });
        this.requestRender();
      }
    }
  }

  spawnAirtimeRing(x, z, colorHex, airtimeMs = 62) {
    if (!this.scene || !this.T) return;
    const t = this.T;
    const ringGeo = new t.RingGeometry(1.0, 3.5, 32);
    const ringMat = new t.MeshBasicMaterial({
      color: colorHex,
      side: t.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ringMesh = new t.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(x, 0.4, z);
    this.scene.add(ringMesh);

    this.airtimeRings.push({
      mesh: ringMesh,
      radius: 2.0,
      maxRadius: Math.max(50, Math.min(180, (airtimeMs || 62) * 1.6)),
      expansionSpeed: Math.max(70, (airtimeMs || 62) * 1.5),
      alpha: 0.85
    });
    this.requestRender();
  }

  triggerPacketPulse(fromId, toId = null, hazard = 0, hop = 1, airtimeMs = 62) {
    if (!this.scene || !this.T) return;
    const t = this.T;
    const n1 = this.nodes.get(fromId);
    if (!n1) return;
    const p1 = this.to3DCoords(n1.x, n1.y, (n1.role === 'relay' ? 18 : 6));

    let pulseColor = 0x00f0ff; // Hazard 0: Cyan General SOS
    if (hazard === 1) pulseColor = 0xf59e0b; // Medical: Amber
    else if (hazard === 2) pulseColor = 0xa855f7; // Trapped: Purple
    else if (hazard === 3 || toId === 0) pulseColor = 0x10b981; // ACK: Green

    this.spawnAirtimeRing(p1.x, p1.z, pulseColor, airtimeMs);

    // Target endpoints
    let targets = [];
    if (toId !== null && toId !== 65535 && this.nodes.has(toId)) {
      targets.push(toId);
    } else {
      // Prioritize primary relays and hub within decode range, max 3 targets
      for (const link of this.links) {
        const a = link.a !== undefined ? link.a : link.from;
        const b = link.b !== undefined ? link.b : link.to;
        const targetId = (a === fromId) ? b : (b === fromId) ? a : null;
        if (targetId !== null && this.nodes.has(targetId)) {
          const targetNode = this.nodes.get(targetId);
          if (targetNode.role === 'hub' || targetNode.role === 'relay') {
            if (!targets.includes(targetId)) targets.push(targetId);
            if (targets.length >= 3) break;
          }
        }
      }
      if (targets.length === 0) {
        let nearest = null;
        let minDist = 9999;
        for (const [id, n] of this.nodes) {
          if (id !== fromId) {
            const d = Math.hypot(n.x - n1.x, n.y - n1.y);
            if (d < minDist && d < 250) {
              minDist = d;
              nearest = id;
            }
          }
        }
        if (nearest !== null) targets.push(nearest);
      }
    }

    for (const tid of targets) {
      const n2 = this.nodes.get(tid);
      if (!n2) continue;
      const p2 = this.to3DCoords(n2.x, n2.y, (n2.role === 'relay' ? 18 : 6));

      this.checkAndHighlightObstacles(n1.x, n1.y, n2.x, n2.y);

      const pulseGeo = new t.SphereGeometry(2.2, 16, 16);
      const pulseMat = new t.MeshBasicMaterial({ color: pulseColor });
      const pulseMesh = new t.Mesh(pulseGeo, pulseMat);
      pulseMesh.position.set(p1.x, p1.y, p1.z);
      this.scene.add(pulseMesh);

      const hopBadge = this.createHopBadge(`HOP ${hop || 1}`, pulseColor, t);
      hopBadge.position.set(p1.x, p1.y + 4.5, p1.z);
      this.scene.add(hopBadge);

      if (this.activePulses.length >= 6) {
        const oldest = this.activePulses.shift();
        if (oldest.mesh) {
          disposeThreeObject(oldest.mesh);
          this.scene.remove(oldest.mesh);
        }
        if (oldest.badge) {
          disposeThreeObject(oldest.badge);
          this.scene.remove(oldest.badge);
        }
      }
      this.activePulses.push({
        fromId,
        toId: tid,
        p1,
        p2,
        progress: 0.0,
        speed: 0.45,
        mesh: pulseMesh,
        badge: hopBadge
      });
    }
    this.requestRender();
  }

  async toggleCoverageHeatmap() {
    this.showHeatmap = !this.showHeatmap;
    const btn = document.getElementById('stBtnHeatmap');
    if (btn) {
      btn.style.background = this.showHeatmap ? '#0284c7' : '#1e293b';
      btn.style.color = this.showHeatmap ? '#ffffff' : '#94a3b8';
      btn.style.fontWeight = this.showHeatmap ? 'bold' : 'normal';
    }

    if (!this.showHeatmap) {
      if (this.heatmapGroup) {
        this.scene.remove(this.heatmapGroup);
        this.heatmapGroup = null;
      }
      this.requestRender();
      return;
    }

    const txId = this.selectedNodeId !== null ? this.selectedNodeId : 1;
    await this.renderCoverageHeatmap(txId);
  }

  async renderCoverageHeatmap(txId) {
    if (!this.scene || !this.T) return;
    const t = this.T;

    if (this.heatmapGroup) {
      this.scene.remove(this.heatmapGroup);
      this.heatmapGroup = null;
    }

    const node = this.nodes.get(txId);
    if (!node) return;

    this.heatmapGroup = new t.Group();
    this.heatmapGroup.name = 'coverageHeatmap';

    let points = [];
    try {
      if (typeof SetuApi !== 'undefined' && SetuApi.getCoverage) {
        const res = await SetuApi.getCoverage(txId, 220, 20);
        if (res && res.points) points = res.points;
      }
    } catch (e) {
      console.warn('Native coverage API offline, computing from engine formula:', e.message);
    }

    if (points.length === 0) {
      const tx_x = node.x;
      const tx_y = node.y;
      const tx_power = 14.0;
      const sens = -123.0;
      const ref_loss = 31.2;
      const path_exp = 3.8;
      const extra_loss = 15.0;

      for (let dy = -200; dy <= 200; dy += 20) {
        for (let dx = -200; dx <= 200; dx += 20) {
          const dist = Math.hypot(dx, dy);
          if (dist > 200 || dist < 1.0) continue;
          const gx = tx_x + dx;
          const gy = tx_y + dy;
          const d_m = Math.max(1.0, dist);
          const pl = ref_loss + 10.0 * path_exp * Math.log10(d_m / 1.0);
          let obs_loss = 0.0;
          for (const obs of this.obstacles) {
            if (SetuTwin3DViewer.segmentsIntersect(tx_x, tx_y, gx, gy, obs.x1, obs.y1, obs.x2, obs.y2)) {
              obs_loss += (obs.attenuation_db || 22.0);
            }
          }
          const rx_dbm = tx_power - pl - obs_loss - extra_loss;
          const margin = rx_dbm - sens;
          points.push({ x: gx, y: gy, rx: rx_dbm, margin });
        }
      }
    }

    for (const pt of points) {
      const p = this.to3DCoords(pt.x, pt.y);
      let col = 0x38bdf8;
      let alpha = 0.35;
      if (pt.margin < 0.0) {
        col = 0xef4444;
        alpha = 0.40;
      } else if (pt.margin < 10.0) {
        col = 0xf59e0b;
        alpha = 0.35;
      }

      const tileGeo = new t.PlaneGeometry(18, 18);
      const tileMat = new t.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: alpha,
        side: t.DoubleSide
      });
      const tile = new t.Mesh(tileGeo, tileMat);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(p.x, 0.15, p.z);
      this.heatmapGroup.add(tile);
    }

    this.scene.add(this.heatmapGroup);
    this.requestRender();
  }

  syncLinkObjects() {
    if (!this.scene || !this.T) return;
    const t = this.T;

    for (const obj of this.linkObjects) {
      disposeThreeObject(obj);
      this.scene.remove(obj);
    }
    this.linkObjects = [];

    // Avoid scene hairball: compute best link per node
    const bestLinks = new Set();
    for (const [id, node] of this.nodes) {
      let best = null;
      let bestMargin = -999;
      for (const l of this.links) {
        const fromId = l.a !== undefined ? l.a : l.from;
        const toId = l.b !== undefined ? l.b : l.to;
        if (fromId === id || toId === id) {
          const m = typeof l.margin_db === 'number' ? l.margin_db : (typeof l.rssi === 'number' ? l.rssi - (-123.0) : 10.0);
          if (m > bestMargin) {
            bestMargin = m;
            best = l;
          }
        }
      }
      if (best) bestLinks.add(best);
    }

    for (const link of this.links) {
      const fromId = link.a !== undefined ? link.a : link.from;
      const toId = link.b !== undefined ? link.b : link.to;
      const n1 = this.nodes.get(fromId);
      const n2 = this.nodes.get(toId);
      if (!n1 || !n2) continue;

      let margin = 12.0;
      if (typeof link.margin_db === 'number') margin = link.margin_db;
      else if (typeof link.rssi === 'number') margin = link.rssi - (-123.0);

      // Only draw links where decode is possible
      if (margin < -6.0) continue;

      // Filter out redundant criss-crossing lines unless backbone, selected, best, or carrying packet
      const isBackbone = (fromId === 0 && n2.role === 'relay') || (toId === 0 && n1.role === 'relay') || (n1.role === 'relay' && n2.role === 'relay');
      const isSelected = this.selectedNodeId !== null && (fromId === this.selectedNodeId || toId === this.selectedNodeId);
      const isBest = bestLinks.has(link);
      const isCarryingPacket = this.activePulses.some(p => (p.fromId === fromId && p.toId === toId) || (p.fromId === toId && p.toId === fromId));

      if (!isBackbone && !isSelected && !isBest && !isCarryingPacket) {
        continue;
      }

      const p1 = this.to3DCoords(n1.x, n1.y, (n1.role === 'relay' ? 18 : 6));
      const p2 = this.to3DCoords(n2.x, n2.y, (n2.role === 'relay' ? 18 : 6));

      let colorHex = 0x38bdf8;
      let isWeak = false;
      if (margin < 5.0) {
        colorHex = 0xef4444;
        isWeak = true;
      } else if (margin < 15.0) {
        colorHex = 0xf59e0b;
      }

      const points = [
        new t.Vector3(p1.x, p1.y, p1.z),
        new t.Vector3(p2.x, p2.y, p2.z)
      ];
      const lineGeo = new t.BufferGeometry().setFromPoints(points);

      let line;
      if (isWeak) {
        const lineMat = new t.LineDashedMaterial({
          color: colorHex,
          dashSize: 6,
          gapSize: 4,
          transparent: true,
          opacity: 0.65
        });
        line = new t.Line(lineGeo, lineMat);
        line.computeLineDistances();
      } else {
        const lineMat = new t.LineBasicMaterial({
          color: colorHex,
          linewidth: margin >= 15.0 ? 3 : 2,
          transparent: true,
          opacity: margin >= 15.0 ? 0.85 : 0.70
        });
        line = new t.Line(lineGeo, lineMat);
      }
      this.scene.add(line);
      this.linkObjects.push(line);
    }
  }

  // --- Render Loop & LOD Updates ---

  setActive(active) {
    const prev = this.isActive;
    this.isActive = Boolean(active);
    if (this.isActive) {
      if (!prev) {
        this.requestRender();
      }
    } else {
      if (this.animId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }
      this._renderScheduled = false;
    }
  }

  requestRender() {
    if (this.destroyed || !this.isActive) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof this._boundRender !== 'function') return;
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      this.animId = requestAnimationFrame(this._boundRender);
    }
  }

  startRenderLoop() {
    if (this.destroyed) return;
    this.isActive = true;
    this._renderScheduled = false;
    let lastTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    let frameCount = 0;
    let lastFpsUpdate = lastTime;

    this._boundRender = (now) => {
      this._renderScheduled = false;
      this.animId = null;
      if (this.destroyed || !this.isActive) return;
      if (typeof document !== 'undefined' && document.hidden) return;

      const currentTime = now || ((typeof performance !== 'undefined') ? performance.now() : Date.now());
      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      frameCount++;
      if (currentTime - lastFpsUpdate >= 1000) {
        const fpsEl = (typeof document !== 'undefined') ? document.getElementById('stFpsCounter') : null;
        if (fpsEl) fpsEl.textContent = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsUpdate = currentTime;
      }

      let needMoreFrames = false;
      if (this.isWebGL && this.renderer && this.scene && this.camera) {
        needMoreFrames = this.updateThree(delta, currentTime);
      } else {
        this.drawFallback2D();
      }

      if (needMoreFrames && this.isActive && (typeof document === 'undefined' || !document.hidden)) {
        this.requestRender();
      }
    };

    this._onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        if (this.animId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.animId);
          this.animId = null;
        }
        this._renderScheduled = false;
      } else if (this.isActive) {
        this.requestRender();
      }
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    if (typeof IntersectionObserver !== 'undefined' && this.container) {
      try {
        this._observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) {
              this.setActive(false);
            } else {
              const viewParent = this.container.closest ? this.container.closest('.view-container') : null;
              const isViewVisible = !viewParent || viewParent.style.display !== 'none';
              if (isViewVisible) {
                this.setActive(true);
              }
            }
          }
        }, { threshold: 0.05 });
        this._observer.observe(this.container);
      } catch (e) {}
    }

    this.requestRender();
  }

  updateThree(delta, currentTime) {
    if (!this.renderer || !this.scene || !this.camera || !this.T) return false;
    const t = this.T;
    let needMore = false;

    // 1. Navigation controls update
    if (this.cameraMode === 'freefly') {
      const isAnyKeyDown = this.keys.w || this.keys.s || this.keys.a || this.keys.d || this.keys.e || this.keys.q;
      if (isAnyKeyDown) {
        needMore = true;
        const moveSpeed = 140 * delta;
        if (!this._reusableVec3A) this._reusableVec3A = new t.Vector3();
        const dir = this._reusableVec3A.set(0, 0, 0);
        if (this.keys.w) dir.z -= 1;
        if (this.keys.s) dir.z += 1;
        if (this.keys.a) dir.x -= 1;
        if (this.keys.d) dir.x += 1;
        if (this.keys.e) dir.y += 1;
        if (this.keys.q) dir.y -= 1;
        dir.normalize();

        dir.applyEuler(this.camera.rotation);
        this.camera.position.addScaledVector(dir, moveSpeed);
      }
    } else if ((this.cameraMode === 'follow_node' || this.cameraMode === 'follow_sos') && this.selectedNodeId !== null) {
      const node = this.nodes.get(this.selectedNodeId);
      if (node && this.controls) {
        needMore = true;
        const p = this.to3DCoords(node.x, node.y, node.elevation || 0);
        if (!this._reusableVec3B) this._reusableVec3B = new t.Vector3();
        this.controls.target.lerp(this._reusableVec3B.set(p.x, p.y + 6, p.z), 0.1);

        // Exterior bounds clamping: camera must stay outside building perimeter
        const relCamX = this.camera.position.x - p.x;
        const relCamZ = this.camera.position.z - p.z;
        const horizDist = Math.hypot(relCamX, relCamZ);
        const minExteriorDist = 65.0; // Horizontal standoff from building

        if (horizDist < minExteriorDist) {
          const factor = minExteriorDist / Math.max(0.1, horizDist);
          this.camera.position.x = p.x + relCamX * factor;
          this.camera.position.z = p.z + relCamZ * factor;
        }
        const minElevation = Math.max(38.0, p.y + 24.0);
        if (this.camera.position.y < minElevation) {
          this.camera.position.y = minElevation;
        }
      }
    }

    if (this.controls && this.controls.enabled) {
      const controlsMoved = this.controls.update();
      if (controlsMoved) needMore = true;
    }

    // 2. Pulse active SOS beacons and Topper rotation
    let hasSos = false;
    for (const [id, group] of this.nodeMeshes.entries()) {
      const node = this.nodes.get(id);
      const isSos = node && (node.sos_active || (node.hazard !== undefined && node.hazard > 0));
      if (isSos) hasSos = true;
    }

    if (hasSos) {
      needMore = true;
      const pulseFactor = (Math.sin(currentTime * 0.006) + 1.0) / 2.0;
      for (const [id, group] of this.nodeMeshes.entries()) {
        const node = this.nodes.get(id);
        const isSos = node && (node.sos_active || (node.hazard !== undefined && node.hazard > 0));
        const topper = group.getObjectByName('beaconTopper');
        if (topper && isSos) {
          topper.rotation.y += delta * 1.5;
          topper.scale.setScalar(1.0 + 0.35 * pulseFactor);
        }
      }
    }

    // LOD: Swap beacon pillar for detailed human avatar when within 45m
    for (const [id, group] of this.nodeMeshes.entries()) {
      const humanGroup = group.getObjectByName('humanGroup');
      const beaconGroup = group.getObjectByName('beaconGroup');
      if (humanGroup && beaconGroup) {
        const distToCam = this.camera.position.distanceTo(group.position);
        if (distToCam < 48) {
          humanGroup.visible = true;
          beaconGroup.visible = false;
        } else {
          humanGroup.visible = false;
          beaconGroup.visible = true;
        }
      }
    }

    // 3. Airtime rings expansion and propagation
    if (this.airtimeRings.length > 0) {
      needMore = true;
      for (let i = this.airtimeRings.length - 1; i >= 0; i--) {
        const ring = this.airtimeRings[i];
        ring.radius += (ring.expansionSpeed || 80) * delta;
        ring.alpha -= 0.55 * delta;
        if (ring.mesh) {
          const s = ring.radius / 3.5;
          ring.mesh.scale.set(s, s, 1);
          if (ring.mesh.material) {
            ring.mesh.material.opacity = Math.max(0, ring.alpha);
          }
        }
        if (ring.alpha <= 0 || ring.radius >= ring.maxRadius) {
          if (ring.mesh) this.scene.remove(ring.mesh);
          this.airtimeRings.splice(i, 1);
        }
      }
    }

    // 4. Active packet traveling pulses along links
    if (this.activePulses.length > 0) {
      needMore = true;
      for (let i = this.activePulses.length - 1; i >= 0; i--) {
        const p = this.activePulses[i];
        p.progress += (p.speed || 1.8) * delta;
        if (p.progress >= 1.0) {
          if (p.mesh) {
            disposeThreeObject(p.mesh);
            this.scene.remove(p.mesh);
          }
          if (p.badge) {
            disposeThreeObject(p.badge);
            this.scene.remove(p.badge);
          }
          this.activePulses.splice(i, 1);
        } else {
          const curX = p.p1.x + (p.p2.x - p.p1.x) * p.progress;
          const curY = p.p1.y + (p.p2.y - p.p1.y) * p.progress;
          const curZ = p.p1.z + (p.p2.z - p.p1.z) * p.progress;
          if (p.mesh) p.mesh.position.set(curX, curY, curZ);
          if (p.badge) p.badge.position.set(curX, curY + 4.5, curZ);
        }
      }
    }

    // 5. Receiver Drop and Collision Flashes
    if (this.dropFlashes.length > 0) {
      needMore = true;
      for (let i = this.dropFlashes.length - 1; i >= 0; i--) {
        const f = this.dropFlashes[i];
        f.radius += 12 * delta;
        f.alpha -= 0.65 * delta;
        if (f.mesh) {
          const s = f.radius / 6.0;
          f.mesh.scale.set(s, s, 1);
          if (f.mesh.material) f.mesh.material.opacity = Math.max(0, f.alpha);
        }
        if (f.badge && f.badge.material) {
          f.badge.material.opacity = Math.max(0, f.alpha);
        }
        if (f.alpha <= 0) {
          if (f.mesh) this.scene.remove(f.mesh);
          if (f.badge) this.scene.remove(f.badge);
          this.dropFlashes.splice(i, 1);
        }
      }
    }

    // 6. Wall crossing highlights and minus dB badges
    if (this.wallHighlights.length > 0) {
      needMore = true;
      for (let i = this.wallHighlights.length - 1; i >= 0; i--) {
        const wh = this.wallHighlights[i];
        wh.timer -= delta;
        if (wh.timer <= 0) {
          if (wh.wallMesh) {
            wh.wallMesh.traverse(child => {
              if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissive.setHex(0x000000);
              }
            });
          }
          if (wh.badge) this.scene.remove(wh.badge);
          this.wallHighlights.splice(i, 1);
        }
      }
    }

    this.updateLabelAvoidance(t);
    this.renderer.render(this.scene, this.camera);
    return needMore;
  }

  drawFallback2D() {
    if (!this.ctx2D || !this.canvas2D) return;
    const ctx = this.ctx2D;
    if (typeof ctx.clearRect !== 'function') return;
    ctx.clearRect(0, 0, this.canvas2D.width, this.canvas2D.height);

    const cx = this.canvas2D.width / 2 + this.panX2D;
    const cy = this.canvas2D.height / 2 + this.panY2D;
    const scale = (this.canvas2D.width / 1200) * this.zoom2D;

    // Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = -600; x <= 600; x += 60) {
      ctx.beginPath();
      ctx.moveTo(cx + x * scale, cy - 600 * scale * this.pitchAngle2D);
      ctx.lineTo(cx + x * scale, cy + 600 * scale * this.pitchAngle2D);
      ctx.stroke();
    }

    // Obstacles in 2D
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    for (const obs of this.obstacles) {
      const p1 = this.project(obs.x1, obs.y1);
      const p2 = this.project(obs.x2, obs.y2);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Nodes in 2D
    for (const [id, node] of this.nodes.entries()) {
      const p = this.project(node.x, node.y, node.elevation || 0);

      const isSos = Boolean(node.sos_active || (node.hazard !== undefined && node.hazard > 0));
      let fillCol = '#00f0ff';
      if (isSos) fillCol = '#ef4444';
      else if (node.role === 'hub') fillCol = '#10b981';
      else if (node.role === 'relay') fillCol = '#f59e0b';

      ctx.beginPath();
      ctx.arc(p.x, p.y, node.role === 'hub' ? 12 : node.role === 'relay' ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = fillCol;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(node.role === 'hub' ? 'HUB 0' : `Node ${id}`, p.x + 10, p.y - 6);
    }
  }

  clearScene() {
    if (!this.scene) return;
    for (const [id, meshGroup] of this.nodeMeshes.entries()) {
      disposeThreeObject(meshGroup);
      this.scene.remove(meshGroup);
    }
    this.nodeMeshes.clear();

    for (const mesh of this.obstacleMeshes) {
      disposeThreeObject(mesh);
      this.scene.remove(mesh);
    }
    this.obstacleMeshes = [];

    for (const obj of this.linkObjects) {
      disposeThreeObject(obj);
      this.scene.remove(obj);
    }
    this.linkObjects = [];

    if (this.waterMesh) {
      disposeThreeObject(this.waterMesh);
      this.scene.remove(this.waterMesh);
      this.waterMesh = null;
    }

    if (this.subterraneanCutaway) {
      disposeThreeObject(this.subterraneanCutaway);
      this.scene.remove(this.subterraneanCutaway);
      this.subterraneanCutaway = null;
    }

    if (this.heatmapMesh) {
      disposeThreeObject(this.heatmapMesh);
      this.scene.remove(this.heatmapMesh);
      this.heatmapMesh = null;
    }

    if (this.boundaryOutline) {
      disposeThreeObject(this.boundaryOutline);
      this.scene.remove(this.boundaryOutline);
      this.boundaryOutline = null;
    }

    for (const p of this.packetPulses) {
      if (p.mesh) {
        disposeThreeObject(p.mesh);
        this.scene.remove(p.mesh);
      }
    }
    this.packetPulses = [];

    for (const f of this.dropFlashes) {
      if (f.mesh) {
        disposeThreeObject(f.mesh);
        this.scene.remove(f.mesh);
      }
    }
    this.dropFlashes = [];

    for (const r of this.airtimeRings) {
      if (r.mesh) {
        disposeThreeObject(r.mesh);
        this.scene.remove(r.mesh);
      }
    }
    this.airtimeRings = [];

    for (const h of this.activeHighlights) {
      if (h.box) {
        disposeThreeObject(h.box);
        this.scene.remove(h.box);
      }
    }
    this.activeHighlights = [];
  }

  destroy() {
    this.destroyed = true;
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.onWindowResize && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onWindowResize);
      this.onWindowResize = null;
    }
    if (this._resizeRaf) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._resizeRaf);
      }
      this._resizeRaf = null;
    }
    if (this._onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    if (this.animId) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.animId);
      }
      this.animId = null;
    }
    this._renderScheduled = false;
    this.clearScene();
    for (const tex of this.labelTextureCache.values()) {
      if (tex && typeof tex.dispose === 'function') {
        tex.dispose();
      }
    }
    this.labelTextureCache.clear();
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
