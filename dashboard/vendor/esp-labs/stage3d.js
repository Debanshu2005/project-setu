// Adapted from esp-labs-web (https://github.com/agharsallah/esp-labs-web), MIT License,
// Copyright (c) 2026 Abderrehmen Gharsallah. Original file: src/ui/stage3d/stage3d.ts.
// Changes: TypeScript types removed, import paths rewritten. See THIRD_PARTY_NOTICE.txt.
import { definePalette } from "./palette.js";

/**
 * A framework-free interactive Three.js stage.
 *
 * @typedef {object} Stage3dOptions
 * @property {{x: number, y: number, z: number}} target Camera target.
 * @property {number} radius Opening camera radius.
 * @property {[number, number]} [zoom] Near and far zoom multipliers.
 * @property {boolean} [reduce] Disable motion for reduced-motion users.
 *
 * @typedef {object} Stage3dPublicApi
 * @property {(by: number) => void} rotate Turn the camera by radians.
 * @property {(factor: number) => void} zoom Change the camera radius.
 * @property {() => void} recenter Restore the opening camera position.
 * @property {(key: string | null) => void} focus Highlight one leader.
 * @property {(nowMs: number, dt: number) => void} tick Render one frame.
 * @property {() => void} dispose Release DOM and GPU resources.
 */
const SVG = "http://www.w3.org/2000/svg";
const modelColours = definePalette({ ink: "--model-ink", shadow: "--model-shadow" });
const OUTLINED = /* @__PURE__ */ new Set(["BoxGeometry", "CylinderGeometry", "ExtrudeGeometry", "ShapeGeometry"]);
/** @implements {Stage3dPublicApi} */
class Stage3d {
  scene;
  camera;
  renderer;
  /** Where the camera is heading; it eases there every frame. */
  view;
  reduce;
  #T;
  #box;
  #drag;
  #overlay;
  #svg;
  #labels = [];
  #leaders = /* @__PURE__ */ new Map();
  #target;
  #v;
  #ro;
  #home;
  #now;
  #zoom;
  #sway;
  #fitWidth;
  #touched = false;
  #px = 0;
  #py = 0;
  #moved = 0;
  #frame = () => {
  };
  constructor(T, box, canvas, overlay, o) {
    this.#T = T;
    this.#box = box;
    this.#drag = o.dragOn === "canvas" ? canvas : box;
    this.#overlay = overlay;
    this.#target = new T.Vector3(o.target.x, o.target.y, o.target.z);
    this.#v = new T.Vector3();
    this.#zoom = o.zoom ?? [0.6, 1.6];
    this.#sway = o.reduce ? 0 : o.sway ?? 0;
    this.#fitWidth = o.fitWidth;
    this.reduce = o.reduce;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(o.fov ?? 36, 1.6, 0.1, 200);
    this.scene.add(new T.HemisphereLight(16777215, 4478310, 1.7));
    const sun = new T.DirectionalLight(16777215, 1.7);
    sun.position.set(4, 9, 6);
    this.scene.add(sun);
    const rim = new T.DirectionalLight(12572927, 0.6);
    rim.position.set(-6, 4, -5);
    this.scene.add(rim);
    if (o.ground) this.scene.add(this.#shadow(o.ground));
    this.#home = { az: o.az ?? 0.7, el: o.el ?? 0.62, radius: o.radius };
    this.#now = { ...this.#home };
    this.view = { ...this.#home, spinning: (o.spin ?? true) && !o.reduce, dragging: false };
    this.#svg = document.createElementNS(SVG, "svg");
    this.#svg.setAttribute("class", "stage-leaders");
    overlay.appendChild(this.#svg);
    this.#ro = new ResizeObserver(this.#resize);
    this.#ro.observe(box);
    this.#resize();
    const d = this.#drag;
    d.addEventListener("pointerdown", this.#down);
    d.addEventListener("pointermove", this.#move);
    d.addEventListener("pointerup", this.#up);
    d.addEventListener("pointercancel", this.#up);
    d.addEventListener("wheel", this.#wheel, { passive: false });
  }
  /** A radial-gradient disc under the model: the contact shadow of an illustration. */
  #shadow(g) {
    const T = this.#T;
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, modelColours().shadow);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const mesh = new T.Mesh(
      new T.PlaneGeometry(g.w, g.d),
      new T.MeshBasicMaterial({
        map: new T.CanvasTexture(c),
        transparent: true,
        opacity: 0.38,
        depthWrite: false
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = g.y;
    mesh.renderOrder = -1;
    return mesh;
  }
  #resize = () => {
    const w = this.#box.clientWidth;
    const h = this.#box.clientHeight;
    if (!w || !h) return;
    const canvas = this.renderer.domElement;
    this.renderer.setSize(canvas.clientWidth || w, canvas.clientHeight || h, false);
    this.camera.aspect = (canvas.clientWidth || w) / (canvas.clientHeight || h);
    this.camera.updateProjectionMatrix();
    if (this.#fitWidth) {
      const half = Math.tan(this.camera.fov / 2 * Math.PI / 180) * this.camera.aspect;
      const fit = Math.max(this.#fitWidth / 2 / half, this.#fitWidth * 0.6);
      const zoomed = this.view.radius / this.#home.radius;
      this.#home.radius = fit;
      this.view.radius = fit * zoomed;
    }
    this.#svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  };
  #down = (e) => {
    this.view.dragging = true;
    this.#touched = true;
    this.#px = e.clientX;
    this.#py = e.clientY;
    this.#moved = 0;
    this.#drag.setPointerCapture?.(e.pointerId);
  };
  #move = (e) => {
    if (!this.view.dragging) return;
    const dx = e.clientX - this.#px;
    const dy = e.clientY - this.#py;
    this.#px = e.clientX;
    this.#py = e.clientY;
    this.#moved += Math.abs(dx) + Math.abs(dy);
    this.view.az += dx * 8e-3;
    this.view.el = Math.min(1.45, Math.max(0.08, this.view.el + dy * 6e-3));
  };
  #up = () => {
    this.view.dragging = false;
  };
  // Pinch on a trackpad (ctrl + wheel) zooms; a plain wheel keeps scrolling the page.
  #wheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    this.zoom(Math.exp(e.deltaY * 0.01));
  };
  /** True when the last pointer press barely moved: a click, not a drag. */
  wasClick = () => this.#moved < 6;
  /** Turn by an angle (radians), as the toolbar's rotate buttons do. */
  rotate(by) {
    this.#touched = true;
    this.view.az += by;
  }
  /** Move closer (< 1) or farther (> 1), within the stage's zoom range. */
  zoom(factor) {
    const [near, far] = this.#zoom;
    const r = this.#home.radius;
    this.#touched = true;
    this.view.radius = Math.min(r * far, Math.max(r * near, this.view.radius * factor));
  }
  /** Back to the opening view. */
  recenter() {
    Object.assign(this.view, this.#home);
  }
  /**
   * After the scene is built: ink outlines on its solid parts, as children, so they move, hide
   * and fade with their mesh. Transparent parts get a fainter line.
   */
  outline() {
    const T = this.#T;
    const ink = new T.Color(modelColours().ink);
    const meshes = [];
    this.scene.traverse((obj) => {
      const mesh = obj;
      if (mesh.isMesh && OUTLINED.has(mesh.geometry.type) && !mesh.userData.noOutline)
        meshes.push(mesh);
    });
    for (const mesh of meshes) {
      const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const faint = m?.transparent ?? false;
      const lines = new T.LineSegments(
        new T.EdgesGeometry(mesh.geometry, 35),
        new T.LineBasicMaterial({ color: ink, transparent: faint, opacity: faint ? 0.35 : 1 })
      );
      lines.raycast = () => {
      };
      mesh.add(lines);
    }
  }
  /** A label pinned to a 3D point (or a moving one). */
  label(text, at, show = () => true, className) {
    const node = document.createElement("span");
    node.textContent = text;
    if (className) node.className = className;
    this.#overlay.appendChild(node);
    this.#labels.push({ node, at, show });
    return node;
  }
  /** A dashed leader from an element on the page (a callout card) to a point on the model. */
  leader(key, at, anchor) {
    const path = document.createElementNS(SVG, "path");
    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("r", "5");
    this.#svg.append(path, dot);
    this.#leaders.set(key, { path, dot, at, anchor });
  }
  /** Lights one leader (or none): the callout you hover or focus. */
  focus(key) {
    for (const [k, l] of this.#leaders) {
      const on = k === key ? "true" : "false";
      l.path.setAttribute("data-on", on);
      l.dot.setAttribute("data-on", on);
    }
  }
  /** Scene animation, called every frame with seconds and the frame time. */
  onFrame(frame) {
    this.#frame = frame;
  }
  tick(nowMs, dt) {
    const v = this.view;
    const n = this.#now;
    const step = Math.min(0.05, dt);
    if (v.spinning && !v.dragging) v.az += step * 0.12;
    if (this.#sway && !this.#touched) v.az = this.#home.az + this.#sway * Math.sin(nowMs / 2600);
    const k = this.reduce ? 1 : 1 - Math.exp(-step * 9);
    n.az += (v.az - n.az) * k;
    n.el += (v.el - n.el) * k;
    n.radius += (v.radius - n.radius) * k;
    const t = this.#target;
    this.camera.position.set(
      t.x + n.radius * Math.cos(n.el) * Math.cos(n.az),
      t.y + n.radius * Math.sin(n.el),
      t.z + n.radius * Math.cos(n.el) * Math.sin(n.az)
    );
    this.camera.lookAt(t);
    this.#frame(nowMs / 1e3, step);
    this.renderer.render(this.scene, this.camera);
    this.#drawLabels();
    this.#drawLeaders();
  }
  /** Where the canvas sits inside the box this frame (layouts may put it anywhere). */
  #frameRect = { x: 0, y: 0, w: 0, h: 0 };
  #measure() {
    const box = this.#box.getBoundingClientRect();
    const c = this.renderer.domElement.getBoundingClientRect();
    this.#frameRect = { x: c.left - box.left, y: c.top - box.top, w: c.width, h: c.height };
  }
  /** A 3D point in the box's pixels. */
  #project(p) {
    const r = this.#frameRect;
    this.#v.copy(p).project(this.camera);
    return {
      x: r.x + (this.#v.x + 1) / 2 * r.w,
      y: r.y + (1 - this.#v.y) / 2 * r.h,
      front: this.#v.z < 1
    };
  }
  #drawLabels() {
    this.#measure();
    for (const l of this.#labels) {
      const p = this.#project(typeof l.at === "function" ? l.at() : l.at);
      l.node.style.opacity = l.show() && p.front ? "1" : "0";
      l.node.style.left = `${p.x}px`;
      l.node.style.top = `${p.y - 10}px`;
    }
  }
  #drawLeaders() {
    if (!this.#leaders.size || !this.#svg.getClientRects().length) return;
    const box = this.#box.getBoundingClientRect();
    for (const l of this.#leaders.values()) {
      const p = this.#project(l.at);
      const r = l.anchor.getBoundingClientRect();
      const left = r.left - box.left;
      const top = r.top - box.top;
      let ax = left + r.width / 2;
      let ay = p.y < top ? top : top + r.height;
      let ex = ax;
      let ey = ay + (p.y < top ? -18 : 18);
      if (p.x > left + r.width || p.x < left) {
        const toRight = p.x > left + r.width;
        ax = toRight ? left + r.width : left;
        ay = top + r.height / 2;
        ex = ax + (toRight ? 18 : -18);
        ey = ay;
      }
      l.path.setAttribute("d", `M${ax} ${ay}L${ex} ${ey}L${p.x} ${p.y}`);
      l.dot.setAttribute("cx", String(p.x));
      l.dot.setAttribute("cy", String(p.y));
    }
  }
  dispose() {
    this.#ro.disconnect();
    const d = this.#drag;
    d.removeEventListener("pointerdown", this.#down);
    d.removeEventListener("pointermove", this.#move);
    d.removeEventListener("pointerup", this.#up);
    d.removeEventListener("pointercancel", this.#up);
    d.removeEventListener("wheel", this.#wheel);
    this.#labels.forEach((l) => l.node.remove());
    this.#labels = [];
    this.#leaders.clear();
    this.#svg.remove();
    this.scene.traverse((o) => {
      const mesh = o;
      mesh.geometry?.dispose();
      const m = mesh.material;
      (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => {
        x.map?.dispose();
        x.dispose();
      });
    });
    this.renderer.dispose();
  }
}
function roundedRect(T, cx, y, cz, hw, hd, r, n = 10) {
  const pts = [];
  const corners = [
    [hw - r, hd - r, 0],
    [-(hw - r), hd - r, Math.PI / 2],
    [-(hw - r), -(hd - r), Math.PI],
    [hw - r, -(hd - r), Math.PI * 1.5]
  ];
  for (const [x, z, a0] of corners)
    for (let i = 0; i <= n; i++) {
      const a = a0 + i / n * (Math.PI / 2);
      pts.push(new T.Vector3(cx + x + r * Math.cos(a), y, cz + z + r * Math.sin(a)));
    }
  return pts;
}
export {
  Stage3d,
  roundedRect
};
