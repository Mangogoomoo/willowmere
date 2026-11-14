/* RigPainter: draws original 2D sprites from a tiny 3D "rig" of spheres,
   capsules, flat polygons and surface decals, as HD pixel art.

   Every frame is rasterised in software, one pixel at a time, so edges are
   crisp (no blur), shading comes in clean tone bands with hue-shifted
   shadows, and a one-pixel outline is drawn around the silhouette and
   between overlapping parts. Small details (eyes, emblems, buckles) are still
   drawn with the 2D canvas as decals on a sphere, then stamped into the frame.

   Rendering the rig from 8 facing angles produces true 8-direction artwork
   (nothing is mirrored), so asymmetric details like a knife in the right
   hand stay on the correct side. */
(function (G) {
  'use strict';
  const U = G.Utils;
  const HEADLESS = typeof navigator !== 'undefined' && navigator.userAgent === 'node';   // the server only needs animation lengths

  // Sprite resolution: how many sheet pixels per design pixel (1.5 = "HD").
  const res = () => (G.Config && G.Config.SPRITE_RES) || 1.5;

  /* ---------- colour helpers (display-space bytes) ---------- */
  const hexCache = {};
  function rgbOf(c) {
    if (typeof c === 'number') return c;
    let v = hexCache[c];
    if (v === undefined) {
      let s = String(c).trim();
      if (s[0] === '#') { if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]; v = parseInt(s.slice(1, 7), 16); }
      else { const m = s.match(/[\d.]+/g) || [0, 0, 0]; v = ((+m[0] & 255) << 16) | ((+m[1] & 255) << 8) | (+m[2] & 255); }
      hexCache[c] = v;
    }
    return v;
  }
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  const pack = (r, g, b) => (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);

  // Materials: how a surface takes the light.
  const MAT = { cloth: 0, skin: 1, hair: 2, metal: 3, jelly: 4, flat: 5, fur: 6, leather: 7, gem: 8 };
  // Light comes from the upper left, a little toward the viewer.
  const LX = -0.50, LY = 0.62, LZ = 0.60;
  const LN = Math.hypot(LX, LY, LZ);

  /* Tone bands: 0 deep shadow, 1 shadow, 2 base, 3 light, 4 highlight.
     Shadows shift toward violet and lights toward warm yellow, the way hand-
     painted sprites are coloured. */
  const toneCache = new Map();
  function tone(rgb, band, mat) {
    if (band === 2 || mat === MAT.flat) return rgb;
    const key = rgb * 64 + band * 8 + mat;
    let out = toneCache.get(key);
    if (out !== undefined) return out;
    let r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
    const mix = (tr, tg, tb, k) => { r += (tr - r) * k; g += (tg - g) * k; b += (tb - b) * k; };
    const mul = (kr, kg, kb) => { r *= kr; g *= kg; b *= kb; };
    const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
    if (mat === MAT.skin) {
      if (band === 0) { mul(0.74, 0.58, 0.60); mix(120, 60, 90, 0.10); }
      else if (band === 1) { mul(0.90, 0.77, 0.75); }
      else if (band === 3) mix(255, 246, 232, 0.22);
      else mix(255, 252, 244, 0.42);
    } else if (mat === MAT.metal) {
      if (band === 0) { mul(0.44, 0.45, 0.56); }
      else if (band === 1) { mul(0.68, 0.69, 0.78); }
      else if (band === 3) mix(255, 255, 255, 0.34);
      else mix(255, 255, 255, 0.78);
    } else if (mat === MAT.jelly) {
      if (band === 0) { mul(0.80, 0.70, 0.84); mix(255, 255, 255, 0.06); }
      else if (band === 1) { mul(0.90, 0.84, 0.92); }
      else if (band === 3) mix(255, 255, 255, 0.24);
      else mix(255, 255, 255, 0.62);
    } else if (mat === MAT.gem) {
      if (band === 0) mul(0.5, 0.5, 0.66);
      else if (band === 1) mul(0.74, 0.74, 0.86);
      else if (band === 3) mix(255, 255, 255, 0.4);
      else mix(255, 255, 255, 0.85);
    } else if (mat === MAT.hair) {
      if (band === 0) { mul(0.56, 0.52, 0.66); mix(50, 30, 90, 0.10); }
      else if (band === 1) { mul(0.78, 0.74, 0.84); }
      else if (band === 3) mix(255, 250, 235, lum > 0.75 ? 0.30 : 0.20);
      else mix(255, 252, 240, lum > 0.75 ? 0.6 : 0.46);
    } else {
      // Cloth, fur and leather. Bright colours get a stronger shadow so white clothes still read.
      const k = mat === MAT.leather ? 0.92 : 1, bright = lum > 0.72;
      if (band === 0) { mul(0.60 * k, 0.56 * k, 0.70 * k); mix(58, 38, 104, bright ? 0.16 : 0.10); }
      else if (band === 1) { mul(0.81 * k, 0.77 * k, 0.86 * k); mix(70, 50, 120, bright ? 0.08 : 0.03); }
      else if (band === 3) mix(255, 248, 226, mat === MAT.leather ? 0.10 : 0.15);
      else mix(255, 252, 236, mat === MAT.leather ? 0.2 : 0.30);
    }
    out = pack(r, g, b);
    if (toneCache.size > 60000) toneCache.clear();
    toneCache.set(key, out);
    return out;
  }
  // Outline colour: a dark, slightly violet version of the colour it surrounds.
  const lineCache = new Map();
  function lineOf(rgb, k) {
    const key = rgb * 4 + (k > 0.6 ? 1 : 0);
    let out = lineCache.get(key);
    if (out !== undefined) return out;
    const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
    const d = k > 0.6 ? 0.62 : 0.34;
    out = pack(r * d * 0.94 + 6, g * d * 0.86 + 2, b * d + 14);
    if (lineCache.size > 60000) lineCache.clear();
    lineCache.set(key, out);
    return out;
  }

  /* ---------- work buffers (shared, resized on demand) ---------- */
  const B = { w: 0, h: 0 };
  function buffers(w, h) {
    if (B.w === w && B.h === h) return B;
    const n = w * h;
    B.w = w; B.h = h;
    B.alb = new Uint32Array(n);      // colour (0xRRGGBB)
    B.id = new Uint16Array(n);       // which primitive (draw order, 0 = empty)
    B.reg = new Uint8Array(n);       // paint layer within the primitive
    B.mat = new Uint8Array(n);
    B.nx = new Int8Array(n); B.ny = new Int8Array(n);
    B.dep = new Float32Array(n);     // surface depth toward the viewer (rig units)
    B.flag = new Uint8Array(n);      // 1 = no outline between this and neighbours of the same colour, 2 = never outlined
    B.col = new Uint32Array(n);
    B.img = null;
    B.x0 = 0; B.y0 = 0; B.x1 = w - 1; B.y1 = h - 1;   // the area drawn on last time (cleared before the next frame)
    return B;
  }
  function grow(b, x0, y0, x1, y1) { if (x0 < b.x0) b.x0 = x0; if (y0 < b.y0) b.y0 = y0; if (x1 > b.x1) b.x1 = x1; if (y1 > b.y1) b.y1 = y1; }
  let stamp = null, stampCtx = null;
  function stampCanvas(w, h) {
    if (!stamp) { stamp = U.makeCanvas(w, h); stampCtx = stamp.getContext('2d', { willReadFrequently: true }); }
    if (stamp.width < w || stamp.height < h) { stamp.width = Math.max(stamp.width, w); stamp.height = Math.max(stamp.height, h); }
    return stampCtx;
  }
  let frameCanvas = null;

  class RigPainter {
    constructor(scale, pitch) {
      this.S = scale || 1.25;
      this.pitch = pitch || 0.32;
      this.cp = Math.cos(this.pitch);
      this.sp = Math.sin(this.pitch);
      this.prims = [];
      this._decalCache = new Map();
    }

    begin(theta, ox, oy) {
      this.prims = [];
      this.ct = Math.cos(theta); this.st = Math.sin(theta);
      this.ox = ox; this.oy = oy;
      this.pose = null;
    }

    // Whole-body transform (used for falls): rotation about a pivot + offset.
    setPose(rotX, rotZ, pivot, offset) {
      this.pose = {
        cx: Math.cos(rotX || 0), sx: Math.sin(rotX || 0),
        cz: Math.cos(rotZ || 0), sz: Math.sin(rotZ || 0),
        pivot: pivot || [0, 0, 0], offset: offset || [0, 0, 0],
      };
    }

    _poseDir(x, y, z) {
      const P = this.pose;
      if (!P) return [x, y, z];
      // rotate about X
      let y1 = y * P.cx - z * P.sx, z1 = y * P.sx + z * P.cx;
      // rotate about Z
      const x2 = x * P.cz - y1 * P.sz, y2 = x * P.sz + y1 * P.cz;
      return [x2, y2, z1];
    }
    _posePoint(p) {
      if (!this.pose) return p;
      const P = this.pose, pv = P.pivot;
      const r = this._poseDir(p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]);
      return [r[0] + pv[0] + P.offset[0], r[1] + pv[1] + P.offset[1], r[2] + pv[2] + P.offset[2]];
    }
    // Rig space -> view: facing rotation about Y then camera pitch.
    _view(x, y, z) {
      const x1 = x * this.ct + z * this.st;
      const z1 = -x * this.st + z * this.ct;
      return { x: x1, up: y * this.cp - z1 * this.sp, d: y * this.sp + z1 * this.cp, z1, y };
    }
    proj(p) {
      const q = this._posePoint(p);
      const v = this._view(q[0], q[1], q[2]);
      return { x: this.ox + v.x * this.S, y: this.oy - v.up * this.S, depth: v.z1 * this.cp + v.y * this.sp * 0.15 };
    }
    dir(n) {
      const q = this._poseDir(n[0], n[1], n[2]);
      return this._view(q[0], q[1], q[2]);
    }

    /* Primitives.
       Common options: bias (draw order), mat ('cloth', 'skin', 'hair', 'metal', 'jelly', 'fur', 'leather', 'gem', 'flat'),
       line: false (no outline against what it covers), merge: true (blend into same-coloured neighbours).
       sphere: sx, sy (squash), decals, paint(x, y, z) -> 0 | layer number, layers: [{ fill, mat }]
       capsule: r2 (radius at b, for tapered limbs and cones)
       poly: flat polygon from 3D points; n = its normal in rig space (for shading). */
    sphere(c, r, fill, opts) {
      this.prims.push(Object.assign({ type: 'sphere', c, r, fill, sx: 1, sy: 1, bias: 0, pose: this.pose }, opts || {}));
    }
    capsule(a, b, r, fill, opts) {
      this.prims.push(Object.assign({ type: 'capsule', a, b, r, fill, bias: 0, pose: this.pose }, opts || {}));
    }
    poly(pts, fill, opts) {
      this.prims.push(Object.assign({ type: 'poly', pts, fill, bias: 0, pose: this.pose }, opts || {}));
    }
    custom(at, draw, bias, radius) {
      this.prims.push({ type: 'custom', c: at, draw, bias: bias || 0, pose: this.pose, radius: radius || 26 });
    }

    /* Draw the frame into ctx. rect = { x, y, w, h } is the frame's area on the
       target canvas (default: all of it); the frame is composited over what is there. */
    render(ctx, rect) {
      rect = rect || { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height };
      const W = rect.w, H = rect.h, buf = buffers(W, H), S = this.S;
      // Only the area the last frame touched needs clearing.
      if (buf.x1 >= buf.x0) for (let y = buf.y0; y <= buf.y1; y++) buf.id.fill(0, y * W + buf.x0, y * W + buf.x1 + 1);
      if (buf.img && buf.x1 >= buf.x0) { const d = buf.img.data; for (let y = Math.max(0, buf.y0 - 1); y <= Math.min(H - 1, buf.y1 + 1); y++) d.fill(0, (y * W + Math.max(0, buf.x0 - 1)) * 4, (y * W + Math.min(W - 1, buf.x1 + 1) + 1) * 4); }
      buf.x0 = W; buf.y0 = H; buf.x1 = -1; buf.y1 = -1;
      const finalPose = this.pose, ox0 = this.ox, oy0 = this.oy;
      this.ox -= rect.x; this.oy -= rect.y;          // work in frame-local pixels

      for (const p of this.prims) {
        this.pose = p.pose === undefined ? finalPose : p.pose;
        if (p.type === 'capsule') {
          p.pa = this.proj(p.a); p.pb = this.proj(p.b);
          p.depth = (p.pa.depth + p.pb.depth) / 2 + p.bias;
        } else if (p.type === 'poly') {
          p.pp = p.pts.map((q) => this.proj(q));
          let d = 0; for (const q of p.pp) d += q.depth;
          p.depth = d / p.pp.length + p.bias;
        } else {
          p.pc = this.proj(p.c);
          p.depth = p.pc.depth + p.bias;
        }
      }
      const sorted = this.prims.map((p, i) => [p, i]).sort((a, b) => a[0].depth - b[0].depth || a[1] - b[1]);
      let order = 0;
      for (const [p] of sorted) {
        this.pose = p.pose === undefined ? finalPose : p.pose;
        order++;
        if (p.type === 'sphere') this._sphere(buf, p, order);
        else if (p.type === 'capsule') this._capsule(buf, p, order);
        else if (p.type === 'poly') this._poly(buf, p, order);
        else this._custom(buf, p);
      }
      this.pose = finalPose;
      this.ox = ox0; this.oy = oy0;
      this._finish(ctx, rect, buf);
    }

    /* ---- rasterisers ---- */
    _sphere(buf, p, order) {
      const W = buf.w, H = buf.h, S = this.S, c = p.pc;
      const rx = p.r * p.sx * S, ry = p.r * p.sy * S;
      if (rx < 0.3 || ry < 0.3) return;
      const x0 = Math.max(0, Math.floor(c.x - rx)), x1 = Math.min(W - 1, Math.ceil(c.x + rx));
      const y0 = Math.max(0, Math.floor(c.y - ry)), y1 = Math.min(H - 1, Math.ceil(c.y + ry));
      if (x1 < x0 || y1 < y0) return;
      grow(buf, x0, y0, x1, y1);
      const fill = rgbOf(p.fill), mat = MAT[p.mat] || 0, flag = (p.merge ? 1 : 0) | (p.line === false ? 2 : 0);
      const paint = p.paint, layers = p.layers;
      // View-space normal back to rig space (for paint functions): undo pitch, facing, pose.
      const cp = this.cp, sp = this.sp, ct = this.ct, st = this.st, P = this.pose;
      const lay = layers ? layers.map((l) => ({ fill: rgbOf(l.fill), mat: MAT[l.mat] || 0 })) : null;
      const dep = p.depth, R = p.r;
      for (let y = y0; y <= y1; y++) {
        const v = (y + 0.5 - c.y) / ry, v2 = v * v;
        if (v2 > 1) continue;
        for (let x = x0; x <= x1; x++) {
          const u = (x + 0.5 - c.x) / rx, d2 = u * u + v2;
          if (d2 > 1) continue;
          const nz = Math.sqrt(1 - d2), i = y * W + x;
          let col = fill, m = mat, reg = 0;
          if (paint) {
            const up = -v;                                   // screen up
            const yv = up * cp + nz * sp, z1 = -up * sp + nz * cp;
            let ax = u * ct - z1 * st, ay = yv, az = u * st + z1 * ct;
            if (P) {                                         // undo the pose: rotate back about Z, then X
              const bx = ax * P.cz + ay * P.sz, by = -ax * P.sz + ay * P.cz;
              ax = bx; ay = by * P.cx + az * P.sx; az = -by * P.sx + az * P.cx;
            }
            const k = paint(ax, ay, az);
            if (k < 0) continue;                             // a hole
            if (k > 0 && lay && lay[k - 1]) { col = lay[k - 1].fill; m = lay[k - 1].mat; reg = k; }
          }
          buf.alb[i] = col; buf.id[i] = order; buf.reg[i] = reg; buf.mat[i] = m; buf.flag[i] = flag;
          buf.nx[i] = u * 127; buf.ny[i] = -v * 127;
          buf.dep[i] = dep + nz * R;
        }
      }
      if (p.decals && p.decals.length && !HEADLESS) {
        /* Decals are drawn once per facing and size, centred on a whole pixel, then
           stamped wherever the sphere is: far fewer canvas read-backs, and details
           (eyes!) don't shimmer from frame to frame. */
        const hw = Math.ceil(rx) + 1, hh = Math.ceil(ry) + 1, bw = hw * 2 + 1, bh = hh * 2 + 1;
        const ps = this.pose, key = this.ct.toFixed(4) + '|' + this.st.toFixed(4) + '|' + rx.toFixed(2) + '|' + ry.toFixed(2) + (ps ? '|' + ps.cx.toFixed(3) + ',' + ps.sx.toFixed(3) + ',' + ps.cz.toFixed(3) + ',' + ps.sz.toFixed(3) : '');
        let per = this._decalCache.get(p.decals);
        if (!per) { per = new Map(); this._decalCache.set(p.decals, per); }
        let img = per.get(key);
        if (!img) {
          const sc = stampCanvas(bw, bh);
          sc.setTransform(1, 0, 0, 1, 0, 0);
          sc.clearRect(0, 0, bw, bh);
          const local = { x: hw + 0.5, y: hh + 0.5 };
          for (const d of p.decals) this._drawDecal(sc, p, d, rx, ry, local);
          sc.setTransform(1, 0, 0, 1, 0, 0);
          img = sc.getImageData(0, 0, bw, bh).data;
          per.set(key, img);
        }
        this._stamp(buf, img, Math.round(c.x - 0.5) - hw, Math.round(c.y - 0.5) - hh, bw, bh, order);
      }
    }

    // Blend what was drawn on the stamp canvas into the frame, only over the given primitive (or anywhere when order is 0).
    _stamp(buf, img, x0, y0, bw, bh, order) {
      const W = buf.w, H = buf.h;
      for (let y = 0; y < bh; y++) {
        const fy = y0 + y; if (fy < 0 || fy >= H) continue;
        for (let x = 0; x < bw; x++) {
          const o = (y * bw + x) * 4, a = img[o + 3];
          if (a < 24) continue;
          const fx = x0 + x; if (fx < 0 || fx >= W) continue;
          const i = fy * W + fx;
          if (order ? buf.id[i] !== order : !buf.id[i]) continue;
          const base = buf.alb[i], k = a / 255;
          const r = ((base >> 16) & 255) * (1 - k) + img[o] * k, g = ((base >> 8) & 255) * (1 - k) + img[o + 1] * k, b = (base & 255) * (1 - k) + img[o + 2] * k;
          buf.alb[i] = pack(r, g, b);
          if (k > 0.5) buf.reg[i] = 200;                    // a detail: keeps its own edges
        }
      }
    }

    _drawDecal(ctx, sp, d, rx, ry, c) {
      const n = d.n;
      const nn = this.dir(n);
      if (nn.d < (d.minD == null ? 0.04 : d.minD)) return;
      // tangent frame: u horizontal, v "up" along the surface
      let ux = n[2], uz = -n[0];
      let ul = Math.hypot(ux, uz);
      if (ul < 1e-4) { ux = 1; uz = 0; ul = 1; }
      ux /= ul; uz /= ul;
      const u = [ux, 0, uz];
      const v = [n[1] * uz - n[2] * 0, n[2] * ux - n[0] * uz, n[0] * 0 - n[1] * ux];
      const uu = this.dir(u), vv = this.dir(v);
      const kx = (rx / sp.r), ky = (ry / sp.r);
      const cx = c.x + nn.x * rx, cy = c.y - nn.up * ry;
      ctx.setTransform(uu.x * kx, -uu.up * ky, vv.x * kx, -vv.up * ky, cx, cy);
      d.draw(ctx, nn);
    }

    _capsule(buf, p, order) {
      const W = buf.w, H = buf.h, S = this.S, a = p.pa, b = p.pb;
      const r1 = p.r * S, r2 = (p.r2 == null ? p.r : p.r2) * S, rm = Math.max(r1, r2);
      if (rm < 0.25) return;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - rm)), x1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) + rm));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - rm)), y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) + rm));
      if (x1 < x0 || y1 < y0) return;
      grow(buf, x0, y0, x1, y1);
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const fill = rgbOf(p.fill), mat = MAT[p.mat] || 0, flag = (p.merge ? 1 : 0) | (p.line === false ? 2 : 0);
      const da = a.depth + p.bias, db = b.depth + p.bias;
      // Thin parts (strings, wires) keep at least one pixel.
      const thin = rm < 0.75, flat = !!p.flat;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - a.x, py = y + 0.5 - a.y;
        let t = l2 > 1e-6 ? (px * dx + py * dy) / l2 : 0;
        if (flat && (t < 0 || t > 1)) continue;             // cut straight across (skirts, hems)
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - dx * t, qy = py - dy * t, r = r1 + (r2 - r1) * t;
        const d2 = qx * qx + qy * qy, rr = thin ? 0.75 : r;
        if (d2 > rr * rr) continue;
        const i = y * W + x, k = Math.sqrt(d2) / Math.max(rr, 0.01);
        buf.alb[i] = fill; buf.id[i] = order; buf.reg[i] = 0; buf.mat[i] = mat; buf.flag[i] = flag;
        buf.nx[i] = (qx / Math.max(rr, 0.01)) * 127; buf.ny[i] = (-qy / Math.max(rr, 0.01)) * 127;
        buf.dep[i] = da + (db - da) * t + Math.sqrt(Math.max(0, 1 - k * k)) * (r / S);
      }
    }

    _poly(buf, p, order) {
      const W = buf.w, H = buf.h, pts = p.pp, n = pts.length;
      if (n < 3) return;
      let y0 = Infinity, y1 = -Infinity;
      for (const q of pts) { if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
      y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(H - 1, Math.ceil(y1));
      if (y1 < y0) return;
      grow(buf, 0, y0, W - 1, y1);
      const fill = rgbOf(p.fill), mat = MAT[p.mat] || 0, flag = (p.merge ? 1 : 0) | (p.line === false ? 2 : 0);
      // Shading normal: given in rig space, or facing the viewer.
      let nx = 0, ny = 0;
      if (p.n) { const d = this.dir(p.n), l = Math.hypot(d.x, d.up, d.d) || 1; const sgn = d.d < 0 ? -1 : 1; nx = (d.x / l) * sgn; ny = (d.up / l) * sgn; }
      let dsum = 0; for (const q of pts) dsum += q.depth;
      const dep = dsum / n + p.bias;
      const xs = [];
      for (let y = y0; y <= y1; y++) {
        const sy = y + 0.5; xs.length = 0;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const a = pts[i], b = pts[j];
          if ((a.y > sy) !== (b.y > sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
          for (let x = xa; x <= xb; x++) {
            const i = y * W + x;
            // An optional gradient across the polygon gives cloth some fold shading.
            buf.alb[i] = fill; buf.id[i] = order; buf.reg[i] = 0; buf.mat[i] = mat; buf.flag[i] = flag;
            buf.nx[i] = nx * 127; buf.ny[i] = ny * 127; buf.dep[i] = dep;
          }
        }
      }
    }

    _custom(buf, p) {
      if (HEADLESS) return;
      const r = Math.ceil(p.radius * this.S), W = buf.w, H = buf.h, c = p.pc;
      const x0 = Math.max(0, Math.floor(c.x - r)), y0 = Math.max(0, Math.floor(c.y - r));
      const x1 = Math.min(W - 1, Math.ceil(c.x + r)), y1 = Math.min(H - 1, Math.ceil(c.y + r));
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw <= 0 || bh <= 0) return;
      const sc = stampCanvas(bw, bh);
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, bw, bh);
      sc.save(); sc.translate(-x0, -y0);
      p.draw(sc, c, this);
      sc.restore();
      this._stamp(buf, sc.getImageData(0, 0, bw, bh).data, x0, y0, bw, bh, 0);
    }

    /* ---- shading, outlines, output ---- */
    _finish(ctx, rect, buf) {
      const W = buf.w, H = buf.h;
      const { alb, id, reg, mat, nx, ny, dep, flag, col } = buf;
      if (!buf.img) buf.img = ctx.createImageData(W, H);
      const img = buf.img, out = img.data;
      const X0 = buf.x0, X1 = buf.x1, Y0 = buf.y0, Y1 = buf.y1;
      // 1. Tone bands from the surface normal.
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const i = y * W + x;
        if (!id[i]) continue;
        const m = mat[i], ax = nx[i] / 127, ay = ny[i] / 127;
        const az = Math.sqrt(Math.max(0, 1 - ax * ax - ay * ay));
        const l = (ax * LX + ay * LY + az * LZ) / LN;
        let band;
        if (m === MAT.metal || m === MAT.gem) {
          band = l > 0.93 ? 4 : l > 0.62 ? 3 : l > 0.22 ? 2 : l > -0.18 ? 1 : l > -0.62 ? 0 : 1;   // a rim of bounced light
        } else if (m === MAT.jelly) {
          band = l > 0.9 ? 4 : l > 0.58 ? 3 : l > 0.02 ? 2 : l > -0.5 ? 1 : 2;                     // glows through at the far edge
        } else if (m === MAT.hair) {
          band = l > 0.72 ? 3 : l > 0.16 ? 2 : l > -0.3 ? 1 : 0;
          // The classic jagged band of shine round the crown.
          const ring = ay - 0.50 + 0.05 * Math.sin(ax * 19) + 0.03 * Math.sin(ax * 43 + 1);
          if (az > 0.25 && ring > 0 && ring < 0.11) band = Math.min(4, band + (ring > 0.03 && ring < 0.08 ? 2 : 1));
        } else if (m === MAT.skin) {
          band = l > 0.97 ? 4 : l > 0.80 ? 3 : l > 0.10 ? 2 : l > -0.42 ? 1 : 0;
        } else {
          band = l > 0.95 ? 4 : l > 0.66 ? 3 : l > 0.16 ? 2 : l > -0.3 ? 1 : 0;
        }
        col[i] = tone(alb[i], band, m);
      }
      // 2. Lines between overlapping parts: drawn on the part that lies behind.
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const i = y * W + x;
        if (!id[i]) continue;
        for (let s = 0; s < 2; s++) {
          if (s === 0 ? x + 1 >= W : y + 1 >= H) continue;
          const j = s === 0 ? i + 1 : i + W;
          if (!id[j]) continue;
          const a = id[i], b = id[j];
          if (a === b) {
            if (reg[i] === reg[j] || reg[i] === 200 || reg[j] === 200) continue;
            // Painted areas on one part (hairline, hems): a soft edge on the base layer.
            const k = reg[i] < reg[j] ? i : j;
            col[k] = lineOf(alb[k], 0.7);
            continue;
          }
          const back = a < b ? i : j, front = a < b ? j : i;
          if (flag[front] & 2) continue;
          const jump = Math.abs(dep[i] - dep[j]);
          if (alb[i] === alb[j]) {
            if (((flag[i] & 1) && (flag[j] & 1)) || jump < 3.2) continue;
            col[back] = lineOf(alb[back], 0.7);
          } else col[back] = lineOf(alb[back], jump > 1.2 ? 0.3 : 0.7);
        }
      }
      // 3. Output, with a one-pixel outline round the silhouette.
      const ya = Math.max(0, Y0 - 1), yb = Math.min(H - 1, Y1 + 1), xa = Math.max(0, X0 - 1), xb = Math.min(W - 1, X1 + 1);
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const i = y * W + x, o = i * 4;
        let c;
        if (id[i]) c = col[i];
        else {
          let nb = -1;
          if (x > 0 && id[i - 1]) nb = i - 1;
          else if (x + 1 < W && id[i + 1]) nb = i + 1;
          else if (y > 0 && id[i - W]) nb = i - W;
          else if (y + 1 < H && id[i + W]) nb = i + W;
          if (nb < 0) continue;
          c = lineOf(alb[nb], 0.3);
        }
        out[o] = (c >> 16) & 255; out[o + 1] = (c >> 8) & 255; out[o + 2] = c & 255; out[o + 3] = 255;
      }
      if (rect.direct) { ctx.putImageData(img, rect.x, rect.y); return; }
      // Composite over what's already on the canvas (the character preview draws a shadow first).
      if (!frameCanvas) frameCanvas = U.makeCanvas(W, H);
      if (frameCanvas.width !== W || frameCanvas.height !== H) { frameCanvas.width = W; frameCanvas.height = H; }
      frameCanvas.getContext('2d').putImageData(img, 0, 0);
      ctx.drawImage(frameCanvas, rect.x, rect.y);
    }
  }

  // Evenly distributed points on a unit sphere (for hair / fur decals).
  RigPainter.fibonacciSphere = function (count) {
    const pts = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2, r = Math.sqrt(1 - y * y), a = ga * i;
      pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return pts;
  };

  /* A sheet's atlas is baked at HD resolution. Older code (portraits in the UI,
     the database page) reads `canvas`, `frameW` and `frameH` in design pixels,
     so those stay in design pixels and `canvas` is a scaled copy made on demand. */
  function finishSheet(sheet) {
    let legacy = null;
    Object.defineProperty(sheet, 'canvas', {
      configurable: true, enumerable: false,
      get() {
        if (legacy) return legacy;
        const a = sheet.atlas;
        legacy = U.makeCanvas(sheet.cols * sheet.frameW, sheet.rows * sheet.frameH);
        const x = legacy.getContext('2d');
        if (x && x.drawImage) { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(a, 0, 0, legacy.width, legacy.height); }
        return legacy;
      },
    });
    return sheet;
  }
  RigPainter.finishSheet = finishSheet;
  // A copy of a sheet with some fields replaced (keeps the on-demand `canvas`).
  RigPainter.deriveSheet = (sheet, extra) => finishSheet(Object.assign({}, sheet, extra));

  RigPainter.makeTexture = function (canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    // Sprites are sampled with a pixel-art filter in the shader (see DirectionalSprite).
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 1;
    if (G.Config.SPRITE_16BIT !== false) {
      // 5-5-5-1: half the video memory; pixel art has hard alpha and few tones. Decoded in the shader.
      tex.type = THREE.UnsignedShort5551Type;
      tex.encoding = THREE.LinearEncoding;
      tex.userData.display = true;
    } else tex.encoding = THREE.sRGBEncoding;
    return tex;
  };

  /* Build a sprite-sheet atlas from a sprite definition.
     def: { frameW, frameH, originX, originY, scale, anims:[{name,frames,fps,loop}], draw(P, anim, t) }
     (sizes in design pixels; the atlas is baked `res` times larger) */
  RigPainter.buildSheet = function (def) {
    const k = res();
    const painter = new RigPainter((def.scale || 1.25) * k, def.pitch);
    const anims = {};
    let total = 0;
    for (const a of def.anims) {
      anims[a.name] = { start: total, count: a.frames, fps: a.fps, loop: a.loop !== false };
      total += a.frames;
    }
    const cols = 16, cells = total * 8, rows = Math.ceil(cells / cols);
    const fw = Math.round(def.frameW * k), fh = Math.round(def.frameH * k);
    const canvas = U.makeCanvas(cols * fw, rows * fh);
    const ctx = canvas.getContext('2d');
    if (!HEADLESS) for (let dir = 0; dir < 8; dir++) {
      const theta = dir * Math.PI / 4;
      for (const a of def.anims) {
        for (let f = 0; f < a.frames; f++) {
          const cell = dir * total + anims[a.name].start + f;
          const col = cell % cols, row = (cell / cols) | 0;
          const t = a.loop === false ? (a.frames > 1 ? f / (a.frames - 1) : 1) : f / a.frames;
          painter.begin(theta, col * fw + def.originX * k, row * fh + def.originY * k);
          def.draw(painter, a.name, t, f);
          painter.render(ctx, { x: col * fw, y: row * fh, w: fw, h: fh, direct: true });
        }
      }
    }
    return finishSheet({
      atlas: canvas, texture: RigPainter.makeTexture(canvas), cols, rows, frameW: def.frameW, frameH: def.frameH, res: k, framesPerDir: total, anims,
      originX: def.originX, originY: def.originY,
      worldW: def.frameW / G.Config.PX_PER_UNIT, worldH: def.frameH / G.Config.PX_PER_UNIT,
      footOffset: (def.frameH - def.originY) / G.Config.PX_PER_UNIT,
    });
  };

  RigPainter.MAT = MAT;
  G.RigPainter = RigPainter;
})(window.G = window.G || {});
