/* RigPainter: draws original chibi-style 2D sprites from a tiny 3D "rig" of
   spheres, capsules and surface decals. Rendering the rig from 8 facing angles
   produces true 8-direction artwork (nothing is mirrored), so asymmetric
   details like a knife in the right hand stay on the correct side. */
(function (G) {
  'use strict';
  const U = G.Utils;
  const OUT = 1.7; // outline width in px

  class RigPainter {
    constructor(scale, pitch) {
      this.S = scale || 1.25;
      this.pitch = pitch || 0.32;
      this.cp = Math.cos(this.pitch);
      this.sp = Math.sin(this.pitch);
      this.prims = [];
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

    sphere(c, r, fill, opts) {
      this.prims.push(Object.assign({ type: 'sphere', c, r, fill, sx: 1, sy: 1, bias: 0 }, opts || {}));
    }
    capsule(a, b, r, fill, opts) {
      this.prims.push(Object.assign({ type: 'capsule', a, b, r, fill, bias: 0 }, opts || {}));
    }
    custom(at, draw, bias) {
      this.prims.push({ type: 'custom', c: at, draw, bias: bias || 0 });
    }

    render(ctx) {
      for (const p of this.prims) {
        if (p.type === 'capsule') {
          p.pa = this.proj(p.a); p.pb = this.proj(p.b);
          p.depth = (p.pa.depth + p.pb.depth) / 2 + p.bias;
        } else {
          p.pc = this.proj(p.c);
          p.depth = p.pc.depth + p.bias;
        }
      }
      const sorted = this.prims.map((p, i) => [p, i]).sort((a, b) => a[0].depth - b[0].depth || a[1] - b[1]);
      for (const [p] of sorted) {
        ctx.globalAlpha = p.alpha == null ? 1 : p.alpha;
        if (p.type === 'sphere') this._drawSphere(ctx, p);
        else if (p.type === 'capsule') this._drawCapsule(ctx, p);
        else p.draw(ctx, p.pc, this);
      }
      ctx.globalAlpha = 1;
    }

    _drawSphere(ctx, p) {
      const S = this.S, c = p.pc;
      const rx = p.r * p.sx * S, ry = p.r * p.sy * S;
      const outline = p.outline || U.shade(p.fill, -0.5);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.lineWidth = OUT * 2; ctx.strokeStyle = outline; ctx.stroke();
      const g = ctx.createRadialGradient(c.x - rx * 0.35, c.y - ry * 0.42, Math.max(rx, ry) * 0.08, c.x, c.y, Math.max(rx, ry) * 1.04);
      g.addColorStop(0, p.light || U.shade(p.fill, 0.35));
      g.addColorStop(0.5, p.fill);
      g.addColorStop(1, p.dark || U.shade(p.fill, -0.22));
      ctx.fillStyle = g;
      ctx.fill();
      if (p.decals && p.decals.length) {
        ctx.clip();
        for (const d of p.decals) this._drawDecal(ctx, p, d, rx, ry);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.restore();
    }

    _drawDecal(ctx, sp, d, rx, ry) {
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
      const cx = sp.pc.x + nn.x * rx, cy = sp.pc.y - nn.up * ry;
      ctx.setTransform(uu.x * kx, -uu.up * ky, vv.x * kx, -vv.up * ky, cx, cy);
      d.draw(ctx, nn);
    }

    _drawCapsule(ctx, p) {
      const S = this.S, a = p.pa, b = p.pb, w = p.r * 2 * S;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + 0.01, b.y);
      ctx.strokeStyle = p.outline || U.shade(p.fill, -0.5);
      ctx.lineWidth = w + OUT * 2; ctx.stroke();
      ctx.strokeStyle = p.fill; ctx.lineWidth = w; ctx.stroke();
      if (w > 3) {
        ctx.beginPath(); ctx.moveTo(a.x - w * 0.16, a.y - w * 0.16); ctx.lineTo(b.x - w * 0.16 + 0.01, b.y - w * 0.16);
        ctx.strokeStyle = p.light || U.shade(p.fill, 0.28); ctx.lineWidth = w * 0.32; ctx.stroke();
      }
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

  /* Build a sprite-sheet atlas from a sprite definition.
     def: { frameW, frameH, originX, originY, scale, anims:[{name,frames,fps,loop}], draw(P, anim, t) } */
  RigPainter.buildSheet = function (def) {
    const painter = new RigPainter(def.scale, def.pitch);
    const anims = {};
    let total = 0;
    for (const a of def.anims) {
      anims[a.name] = { start: total, count: a.frames, fps: a.fps, loop: a.loop !== false };
      total += a.frames;
    }
    const cols = 16, cells = total * 8, rows = Math.ceil(cells / cols);
    const fw = def.frameW, fh = def.frameH;
    const canvas = U.makeCanvas(cols * fw, rows * fh);
    const ctx = canvas.getContext('2d');
    for (let dir = 0; dir < 8; dir++) {
      const theta = dir * Math.PI / 4;
      for (const a of def.anims) {
        for (let f = 0; f < a.frames; f++) {
          const cell = dir * total + anims[a.name].start + f;
          const col = cell % cols, row = (cell / cols) | 0;
          const t = a.loop === false ? (a.frames > 1 ? f / (a.frames - 1) : 1) : f / a.frames;
          ctx.save();
          ctx.beginPath(); ctx.rect(col * fw, row * fh, fw, fh); ctx.clip();
          painter.begin(theta, col * fw + def.originX, row * fh + def.originY);
          def.draw(painter, a.name, t, f);
          painter.render(ctx);
          ctx.restore();
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return {
      canvas, texture: tex, cols, rows, frameW: fw, frameH: fh, framesPerDir: total, anims,
      originX: def.originX, originY: def.originY,
      worldW: fw / G.Config.PX_PER_UNIT, worldH: fh / G.Config.PX_PER_UNIT,
      footOffset: (fh - def.originY) / G.Config.PX_PER_UNIT,
    };
  };

  G.RigPainter = RigPainter;
})(window.G = window.G || {});
