/* Grid navigation: obstacle rasterisation (inflated by the agent radius),
   A* with a binary heap, nearest-walkable search and path smoothing. */
(function (G) {
  'use strict';
  const C = G.Config;

  class NavGrid {
    constructor(size, cell) {
      this.size = size;
      this.cell = cell;
      this.n = Math.ceil(size / cell);
      this.origin = -size / 2;
      this.blocked = new Uint8Array(this.n * this.n);
      // A* scratch buffers, reused between searches
      const N = this.n * this.n;
      this.g = new Float32Array(N);
      this.parent = new Int32Array(N);
      this.stamp = new Uint32Array(N);
      this.closed = new Uint32Array(N);
      this.search = 0;
      this.heap = new Int32Array(N);
      this.heapF = new Float32Array(N);
    }
    toCell(v) { return Math.floor((v - this.origin) / this.cell); }
    center(i) { return this.origin + (i + 0.5) * this.cell; }
    idx(cx, cz) { return cz * this.n + cx; }
    inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.n && cz < this.n; }

    walkableCell(cx, cz) { return this.inBounds(cx, cz) && !this.blocked[this.idx(cx, cz)]; }
    walkable(x, z) { return this.walkableCell(this.toCell(x), this.toCell(z)); }

    markAll(fn) {
      for (let cz = 0; cz < this.n; cz++) for (let cx = 0; cx < this.n; cx++) {
        if (fn(this.center(cx), this.center(cz))) this.blocked[this.idx(cx, cz)] = 1;
      }
    }
    blockCircle(x, z, r) {
      r += C.AGENT_RADIUS;
      const c0 = this.toCell(x - r), c1 = this.toCell(x + r), r0 = this.toCell(z - r), r1 = this.toCell(z + r);
      for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
        if (!this.inBounds(cx, cz)) continue;
        const dx = this.center(cx) - x, dz = this.center(cz) - z;
        if (dx * dx + dz * dz <= r * r) this.blocked[this.idx(cx, cz)] = 1;
      }
    }
    // Oriented rectangle: half-extents hw (local x), hd (local z), rotation about Y.
    blockRect(x, z, hw, hd, rot) {
      hw += C.AGENT_RADIUS; hd += C.AGENT_RADIUS;
      const R = Math.hypot(hw, hd), cos = Math.cos(rot), sin = Math.sin(rot);
      const c0 = this.toCell(x - R), c1 = this.toCell(x + R), r0 = this.toCell(z - R), r1 = this.toCell(z + R);
      for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
        if (!this.inBounds(cx, cz)) continue;
        const dx = this.center(cx) - x, dz = this.center(cz) - z;
        const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) this.blocked[this.idx(cx, cz)] = 1;
      }
    }
    // Thin wall between two points.
    blockSegment(x1, z1, x2, z2, thickness) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      this.blockRect((x1 + x2) / 2, (z1 + z2) / 2, thickness / 2, len / 2, Math.atan2(x2 - x1, z2 - z1));
    }

    // Is the straight line between two world points free of blocked cells?
    lineClear(ax, az, bx, bz) {
      const d = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(d / (this.cell * 0.35));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
      }
      return true;
    }

    nearestWalkable(x, z, maxR) {
      const cx = this.toCell(x), cz = this.toCell(z);
      if (this.walkableCell(cx, cz)) return { x, z };
      const maxRing = Math.ceil((maxR || 12) / this.cell);
      for (let r = 1; r <= maxRing; r++) {
        let best = null, bestD = Infinity;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.walkableCell(cx + dx, cz + dz)) continue;
          const wx = this.center(cx + dx), wz = this.center(cz + dz);
          const dd = (wx - x) ** 2 + (wz - z) ** 2;
          if (dd < bestD) { bestD = dd; best = { x: wx, z: wz }; }
        }
        if (best) return best;
      }
      return null;
    }

    /* A* from (sx,sz) to (tx,tz). If the goal is unreachable within the node
       budget, returns a path to the closest explored cell instead. */
    findPath(sx, sz, tx, tz, maxNodes) {
      maxNodes = maxNodes || 40000;
      const n = this.n;
      let start = this.nearestWalkable(sx, sz, 3);
      let goal = this.nearestWalkable(tx, tz, 14);
      if (!start || !goal) return null;
      const s = this.idx(this.toCell(start.x), this.toCell(start.z));
      const gcx = this.toCell(goal.x), gcz = this.toCell(goal.z);
      const gIdx = this.idx(gcx, gcz);
      if (this.lineClear(sx, sz, goal.x, goal.z)) return [{ x: goal.x, z: goal.z }];

      const id = ++this.search;
      const g = this.g, parent = this.parent, stamp = this.stamp, closed = this.closed;
      const heap = this.heap, heapF = this.heapF;
      let size = 0;
      const H = (i) => {
        const dx = Math.abs((i % n) - gcx), dz = Math.abs(((i / n) | 0) - gcz);
        return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
      };
      const push = (i, f) => {
        let k = size++;
        while (k > 0) {
          const p = (k - 1) >> 1;
          if (heapF[p] <= f) break;
          heap[k] = heap[p]; heapF[k] = heapF[p]; k = p;
        }
        heap[k] = i; heapF[k] = f;
      };
      const pop = () => {
        const top = heap[0];
        const li = heap[--size], lf = heapF[size];
        let k = 0;
        while (true) {
          let c = 2 * k + 1;
          if (c >= size) break;
          if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
          if (heapF[c] >= lf) break;
          heap[k] = heap[c]; heapF[k] = heapF[c]; k = c;
        }
        heap[k] = li; heapF[k] = lf;
        return top;
      };

      g[s] = 0; parent[s] = -1; stamp[s] = id;
      push(s, H(s));
      let best = s, bestH = H(s), expanded = 0;
      const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
      while (size > 0) {
        const cur = pop();
        if (closed[cur] === id) continue;
        closed[cur] = id;
        if (cur === gIdx) { best = cur; break; }
        const h = H(cur);
        if (h < bestH) { bestH = h; best = cur; }
        if (++expanded > maxNodes) break;
        const cx = cur % n, cz = (cur / n) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = cx + DX[k], nz = cz + DZ[k];
          if (!this.walkableCell(nx, nz)) continue;
          if (k >= 4 && (!this.walkableCell(cx + DX[k], cz) || !this.walkableCell(cx, cz + DZ[k]))) continue; // no corner cutting
          const ni = nz * n + nx;
          if (closed[ni] === id) continue;
          const ng = g[cur] + (k >= 4 ? Math.SQRT2 : 1);
          if (stamp[ni] !== id || ng < g[ni]) {
            stamp[ni] = id; g[ni] = ng; parent[ni] = cur;
            push(ni, ng + H(ni) * 1.001);
          }
        }
      }
      // Reconstruct.
      const cells = [];
      for (let c = best; c !== -1; c = parent[c]) cells.push(c);
      cells.reverse();
      const pts = cells.map((c) => ({ x: this.center(c % n), z: this.center((c / n) | 0) }));
      if (best === gIdx) pts[pts.length - 1] = { x: goal.x, z: goal.z };
      return this.smooth(sx, sz, pts);
    }

    // String-pulling: skip any waypoints we can see past.
    smooth(sx, sz, pts) {
      if (pts.length <= 1) return pts;
      const out = [];
      let ax = sx, az = sz, i = 0;
      while (i < pts.length) {
        let j = pts.length - 1;
        while (j > i && !this.lineClear(ax, az, pts[j].x, pts[j].z)) j--;
        out.push(pts[j]);
        ax = pts[j].x; az = pts[j].z;
        i = j + 1;
      }
      return out;
    }
  }

  G.NavGrid = NavGrid;
})(window.G = window.G || {});
