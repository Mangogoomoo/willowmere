/* Shared helpers: math, deterministic noise, RNG, geometry merging. */
(function (G) {
  'use strict';

  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Frame-rate independent exponential smoothing.
  U.damp = (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt));
  U.wrapAngle = (a) => {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  };
  U.dampAngle = (a, b, lambda, dt) => a + U.wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
  U.dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  U.randRange = (rng, a, b) => a + (b - a) * rng();
  U.randInt = (rng, a, b) => Math.floor(a + (b - a + 1) * rng());

  // Deterministic PRNG so the world layout is identical every load.
  U.mulberry32 = function (seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };

  function hash2(ix, iz) {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  U.noise2 = function (x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return U.lerp(U.lerp(a, b, ux), U.lerp(c, d, ux), uz);
  };
  U.fbm = function (x, z, oct) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < (oct || 4); i++) {
      sum += U.noise2(x * freq + i * 17.3, z * freq - i * 9.1) * amp;
      norm += amp; amp *= 0.5; freq *= 2.03;
    }
    return sum / norm;
  };

  U.distToSegment = function (px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = U.clamp(t, 0, 1);
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  };
  U.distToPolyline = function (px, pz, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = U.distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < best) best = d;
    }
    return best;
  };

  U.makeCanvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  U.canvasTexture = function (canvas, opts) {
    opts = opts || {};
    const t = new THREE.CanvasTexture(canvas);
    t.encoding = THREE.sRGBEncoding;
    if (opts.repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    if (opts.anisotropy) t.anisotropy = opts.anisotropy;
    return t;
  };

  // A colour whose stored values are the display (sRGB) values, for shaders
  // that write gl_FragColor directly and for fog, which three r149 blends
  // after output encoding.
  U.displayColor = function (hex) {
    const n = parseInt(hex.slice(1), 16);
    return new THREE.Color().setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };

  // Shade a CSS hex color: amt > 0 lightens, < 0 darkens.
  U.shade = function (hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    const h = (v) => ('0' + Math.round(U.clamp(v, 0, 255)).toString(16)).slice(-2);
    return '#' + h(r) + h(g) + h(b);
  };

  /* Merge several primitive geometries into one flat-shaded, vertex-coloured
     geometry. parts: [{ geo, color, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z] }].
     One draw call per merged mesh keeps the town cheap to render. */
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  U.mergeParts = function (parts) {
    let total = 0;
    const prepared = parts.map((part) => {
      let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
      _p.set(...(part.pos || [0, 0, 0]));
      _e.set(...(part.rot || [0, 0, 0]));
      _q.setFromEuler(_e);
      _s.set(...(part.scale || [1, 1, 1]));
      _m.compose(_p, _q, _s);
      if (part.matrix) _m.premultiply(part.matrix);
      g.applyMatrix4(_m);
      g.computeVertexNormals();
      total += g.attributes.position.count;
      return { g, color: part.color, jitter: part.jitter || 0 };
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let off = 0;
    prepared.forEach(({ g, color, jitter }) => {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      _c.set(color);
      for (let i = 0; i < n; i++) {
        // Optional per-face brightness jitter gives a hand-painted low-poly look.
        const j = jitter ? 1 + (hash2(off + ((i / 3) | 0), 7) - 0.5) * jitter : 1;
        col[(off + i) * 3] = _c.r * j;
        col[(off + i) * 3 + 1] = _c.g * j;
        col[(off + i) * 3 + 2] = _c.b * j;
      }
      off += n;
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  };

  // Triangular-prism roof: width along X, depth along Z, ridge along Z.
  U.prismGeometry = function (w, d, h) {
    const hw = w / 2, hd = d / 2;
    const v = [
      // left slope
      -hw, 0, hd, 0, h, hd, 0, h, -hd,
      -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,
      // right slope
      hw, 0, hd, hw, 0, -hd, 0, h, -hd,
      hw, 0, hd, 0, h, -hd, 0, h, hd,
      // front gable
      -hw, 0, hd, hw, 0, hd, 0, h, hd,
      // back gable
      hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
      // underside
      -hw, 0, hd, -hw, 0, -hd, hw, 0, -hd,
      -hw, 0, hd, hw, 0, -hd, hw, 0, hd,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  };

  // Radial soft blob texture used for shadows and particles.
  U.radialTexture = function (size, inner, outer, color) {
    const c = U.makeCanvas(size, size), x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color || 'rgba(255,255,255,1)');
    g.addColorStop(inner, color || 'rgba(255,255,255,1)');
    g.addColorStop(outer, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    return t;
  };

  G.Utils = U;
})(window.G = window.G || {});
