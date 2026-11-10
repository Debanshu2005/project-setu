// Adapted from esp-labs-web (https://github.com/agharsallah/esp-labs-web), MIT License,
// Copyright (c) 2026 Abderrehmen Gharsallah. Original file: src/ui/stage3d/toon.ts.
// Changes: TypeScript types removed, import paths rewritten. See THIRD_PARTY_NOTICE.txt.
import { definePalette } from "./palette.js";
const light = definePalette({ white: "--test-w" });
const ramps = /* @__PURE__ */ new WeakMap();
function ramp(T) {
  let tex = ramps.get(T);
  if (!tex) {
    tex = new T.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, T.RedFormat);
    tex.minFilter = tex.magFilter = T.NearestFilter;
    tex.needsUpdate = true;
    ramps.set(T, tex);
  }
  return tex;
}
function toon(T, color, extra = {}) {
  return new T.MeshToonMaterial({ color: new T.Color(color), gradientMap: ramp(T), ...extra });
}
function glowTexture(T) {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, light().white);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new T.CanvasTexture(c);
}
export {
  glowTexture,
  toon
};
