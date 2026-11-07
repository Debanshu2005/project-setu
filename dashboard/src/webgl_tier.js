// Project Setu - Device-Adaptive WebGL Quality Tier Detection & Resource Lifecycle
// Dynamically adjusts pixel ratio, shadow mapping, and particle budgets based on hardware profile.

/**
 * Detects device hardware profile and WebGL GPU renderer to determine quality tier.
 * Tiers:
 * - low: Mobile devices, <= 4 cores, or software renderers (SwiftShader/llvmpipe).
 *        DPR cap 1.0, shadow map disabled, antialias off, max 100 particles.
 * - medium: Mid-range laptops (4 to 8 cores) or mobile GPUs with > 4 cores.
 *        DPR cap 1.5, simple shadows, max 300 particles.
 * - high: Desktop discrete GPU, > 8 cores.
 *        DPR cap 2.0 (never 3.0), PCF shadows, max 800 particles.
 *
 * @param {WebGLRenderingContext|null} gl Optional WebGL context to query
 * @param {Object} overrides Optional test overrides { isMobile, cores, rendererStr, dpr }
 * @returns {Object} Quality tier configuration
 */
export function getWebGLQualityTier(gl = null, overrides = {}) {
  let isMobile = false;
  let cores = 4;
  let dpr = 1;

  if (typeof navigator !== 'undefined') {
    isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '');
    cores = navigator.hardwareConcurrency || 4;
  }
  if (typeof window !== 'undefined') {
    dpr = window.devicePixelRatio || 1;
  }

  if (typeof overrides.isMobile === 'boolean') isMobile = overrides.isMobile;
  if (typeof overrides.cores === 'number') cores = overrides.cores;
  if (typeof overrides.dpr === 'number') dpr = overrides.dpr;

  let rendererStr = overrides.rendererStr || '';
  if (!rendererStr) {
    try {
      let targetGl = gl;
      let tempCanvas = null;
      if (!targetGl && typeof document !== 'undefined') {
        tempCanvas = document.createElement('canvas');
        targetGl = tempCanvas.getContext('webgl') || tempCanvas.getContext('experimental-webgl');
      }
      if (targetGl) {
        const dbg = targetGl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          rendererStr = targetGl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
        }
      }
      if (tempCanvas && typeof tempCanvas.remove === 'function') {
        tempCanvas.remove();
      }
    } catch (_) {
      // Ignored for headless environments without WebGL context
    }
  }

  const isSoftware = /swiftshader|llvmpipe|software/i.test(rendererStr);

  if (isMobile || cores <= 4 || isSoftware) {
    return {
      tier: 'low',
      dprCap: 1.0,
      effectiveDpr: Math.min(dpr, 1.0),
      shadows: false,
      shadowType: 'none',
      antialias: false,
      maxParticles: 100,
      postProcessing: false,
      isMobile,
      cores,
      renderer: rendererStr
    };
  }

  if (cores <= 8 || /intel|mali|adreno|apple m1\b|apple m2\b/i.test(rendererStr)) {
    return {
      tier: 'medium',
      dprCap: 1.5,
      effectiveDpr: Math.min(dpr, 1.5),
      shadows: true,
      shadowType: 'basic',
      antialias: true,
      maxParticles: 300,
      postProcessing: false,
      isMobile,
      cores,
      renderer: rendererStr
    };
  }

  return {
    tier: 'high',
    dprCap: 2.0,
    effectiveDpr: Math.min(dpr, 2.0),
    shadows: true,
    shadowType: 'pcf',
    antialias: true,
    maxParticles: 800,
    postProcessing: true,
    isMobile,
    cores,
    renderer: rendererStr
  };
}

/**
 * Cleanly disposes a Three.js scene object hierarchy (geometries, materials, textures)
 */
export function disposeThreeObject(obj) {
  if (!obj) return;
  if (obj.children && Array.isArray(obj.children)) {
    for (let i = obj.children.length - 1; i >= 0; i--) {
      disposeThreeObject(obj.children[i]);
    }
  }
  if (obj.geometry && typeof obj.geometry.dispose === 'function') {
    obj.geometry.dispose();
  }
  if (obj.material) {
    if (Array.isArray(obj.material)) {
      for (const m of obj.material) {
        disposeMaterial(m);
      }
    } else {
      disposeMaterial(obj.material);
    }
  }
}

function disposeMaterial(mat) {
  if (!mat) return;
  const textureKeys = [
    'map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap',
    'envMap', 'alphaMap', 'aoMap', 'displacementMap',
    'emissiveMap', 'gradientMap', 'metalnessMap', 'roughnessMap'
  ];
  for (const key of textureKeys) {
    if (mat[key] && typeof mat[key].dispose === 'function') {
      mat[key].dispose();
    }
  }
  if (typeof mat.dispose === 'function') {
    mat.dispose();
  }
}
