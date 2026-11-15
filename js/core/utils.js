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

  /* Merge several primitive geometries into one vertex-coloured geometry.
     parts: [{ geo, color, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z] }].
     One draw call per merged mesh keeps the town cheap to render.

     Shading: round shapes (cylinders, cones, spheres) keep their smooth
     normals; boxes and hand-made shapes stay crisp. Plain low-poly balls
     (leaves, bushes, fruit, blossoms) are swapped for a rounder, slightly
     lumpy ball shaded lighter on top and darker underneath, which is what
     gives foliage its soft painted look. */
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _n3 = new THREE.Matrix3();
  /* Surface kinds (part.tex): the painted pattern a part gets in the world shader (graphics/stylize.js).
     Parts that don't say are guessed from their colour and shape: browns are wood, greys are masonry
     (boxes, cylinders) or natural rock (anything irregular). Use tex: 'none' for a plain surface. */
  const KINDS = { none: 0, plaster: 1, shingle: 2, wood: 3, stone: 4, brick: 5, thatch: 6, rock: 7 };
  const _hsl = { h: 0, s: 0, l: 0 };
  function kindOf(part, mode) {
    if (part.tex != null) return KINDS[part.tex] || 0;
    if (mode === 'ball') return 0;
    _c.set(part.color).getHSL(_hsl);
    const t = part.geo.type;
    if (_hsl.h > 0.03 && _hsl.h < 0.125 && _hsl.s > 0.22 && _hsl.s < 0.8 && _hsl.l > 0.14 && _hsl.l < 0.6) return 3;
    if (_hsl.s < 0.13 && _hsl.l > 0.28 && _hsl.l < 0.8) return (t === 'BoxGeometry' || t === 'CylinderGeometry') ? 4 : (t === 'ConeGeometry' || t === 'SphereGeometry' ? 0 : 7);
    return 0;
  }
  U.SURFACE_KINDS = KINDS;
  const SMOOTH = { CylinderGeometry: 1, ConeGeometry: 1, SphereGeometry: 1, TorusGeometry: 1, CapsuleGeometry: 1, LatheGeometry: 1 };
  let BLOB = null;
  function blobGeometry() {
    if (BLOB) return BLOB;
    const g0 = new THREE.IcosahedronGeometry(1, 1), g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position, nor = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // The same bump for every copy of a corner, so the ball stays closed.
      const k = 0.9 + 0.2 * hash2(Math.round(x * 97) + Math.round(z * 131), Math.round(y * 113));
      p.setXYZ(i, x * k, y * k, z * k);
      nor[i * 3] = x; nor[i * 3 + 1] = y; nor[i * 3 + 2] = z;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return (BLOB = g);
  }
  // A plain, untouched low-poly ball?
  function isBall(geo) {
    if (geo.type !== 'IcosahedronGeometry' || !geo.parameters || geo.parameters.detail) return false;
    const p = geo.attributes.position, r = geo.parameters.radius || 1;
    for (let i = 0; i < p.count; i += 7) if (Math.abs(Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) - r) > r * 0.01) return false;
    return true;
  }
  U.mergeParts = function (parts) {
    let total = 0;
    const prepared = parts.map((part, pi) => {
      let g, mode = 'flat', shade = null;
      _s.set(...(part.scale || [1, 1, 1]));
      if (part.smooth !== false && isBall(part.geo)) {
        g = blobGeometry().clone(); mode = 'ball';
        _s.multiplyScalar(part.geo.parameters.radius || 1);
        // Top-to-bottom shading, baked into the vertex colours.
        const n = g.attributes.normal; shade = new Float32Array(n.count);
        for (let i = 0; i < n.count; i++) shade[i] = n.getY(i) * 0.5 + 0.5;
      } else {
        g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
        if (part.smooth !== false && SMOOTH[part.geo.type] && g.attributes.normal) mode = 'smooth';
      }
      _p.set(...(part.pos || [0, 0, 0]));
      _e.set(...(part.rot || [0, 0, 0]));
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      if (part.matrix) _m.premultiply(part.matrix);
      if (mode === 'flat') { g.applyMatrix4(_m); g.computeVertexNormals(); }
      else {
        // Keep the shape's own normals (turned with it).
        _n3.getNormalMatrix(_m);
        g.attributes.position.applyMatrix4(_m);
        g.attributes.normal.applyNormalMatrix(_n3);
      }
      total += g.attributes.position.count;
      return { g, color: part.color, jitter: part.jitter || 0, mode, shade, pi, kind: kindOf(part, mode) };
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), kinds = new Float32Array(total);
    let off = 0;
    prepared.forEach(({ g, color, jitter, mode, shade, pi, kind }) => {
      const n = g.attributes.position.count;
      if (kind) kinds.fill(kind, off, off + n);
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      _c.set(color);
      for (let i = 0; i < n; i++) {
        // Flat parts: per-face brightness jitter (a hand-painted low-poly look).
        // Round parts: one tone for the whole part, so smooth shading stays clean.
        let j = 1;
        if (jitter) j = mode === 'flat' ? 1 + (hash2(off + ((i / 3) | 0), 7) - 0.5) * jitter : 1 + (hash2(pi * 13 + 5, 7) - 0.5) * jitter * 0.7;
        let r = _c.r * j, gg = _c.g * j, b = _c.b * j;
        if (shade) { const t = shade[i], k = 0.66 + 0.5 * t; r = r * k + 0.05 * t; gg = gg * k + 0.045 * t; b = b * (k - 0.04 * t); }
        col[(off + i) * 3] = r;
        col[(off + i) * 3 + 1] = gg;
        col[(off + i) * 3 + 2] = b;
      }
      off += n;
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('wmKind', new THREE.BufferAttribute(kinds, 1));
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
