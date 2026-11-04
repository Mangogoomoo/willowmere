/* Minimap (top-right, north-up) and the full world map window (M).
   Both are drawn from a picture of the current map baked from the real
   terrain colours, with obstacles (trees, rocks, buildings) shaded darker. */
(function (G) {
  'use strict';
  const h = G.h;
  const SIZE = G.Config.WORLD_SIZE, HALF = SIZE / 2;

  class Minimap {
    constructor(game) {
      this.game = game;
      this.el = document.getElementById('minimap');
      this.canvas = this.el.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.label = this.el.querySelector('.mm-name');
      this.zooms = [28, 45, 70];
      this.zoom = 1;
      this.el.querySelector('.mm-in').addEventListener('click', () => { this.zoom = Math.max(0, this.zoom - 1); });
      this.el.querySelector('.mm-out').addEventListener('click', () => { this.zoom = Math.min(this.zooms.length - 1, this.zoom + 1); });
      this.el.querySelector('.mm-map').addEventListener('click', () => game.windows.toggle('worldmap'));
      this.t = 0;
      this.mapId = null;

      // World map window
      this.win = game.windows.create('worldmap', 'World map', { width: 470, keyHint: 'M', pos: () => ({ x: window.innerWidth / 2 - 235, y: 70 }) });
      this.big = h('canvas.worldmap', { width: '440', height: '440', 'aria-label': 'Map of the current area' });
      this.win.body.append(this.big, h('p.hint.wm-legend', { html: '<span class="lg you"></span>You <span class="lg npc"></span>NPC <span class="lg mon"></span>Monster <span class="lg boss"></span>Boss <span class="lg portal"></span>Portal <span class="lg goal"></span>Objective' }));
      this.win.render = () => this.drawBig();
    }

    // Bake the current map into an image (1 pixel per world unit).
    bake() {
      const game = this.game, nav = game.nav;
      const img = document.createElement('canvas'); img.width = img.height = SIZE;
      const x = img.getContext('2d'), data = x.createImageData(SIZE, SIZE);
      for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
        const wx = -HALF + i + 0.5, wz = -HALF + j + 0.5;
        let [r, g, b] = G.Terrain.mapColor(wx, wz);
        if (!nav.walkable(wx, wz)) { r *= 0.62; g *= 0.62; b *= 0.62; }
        const o = (j * SIZE + i) * 4;
        data.data[o] = r; data.data[o + 1] = g; data.data[o + 2] = b; data.data[o + 3] = 255;
      }
      x.putImageData(data, 0, 0);
      this.image = img;
      this.mapId = game.mapId;
      this.label.textContent = game.map.name;
      if (game.windows.isOpen('worldmap')) this.drawBig();
    }

    markers(ctx, toX, toY, scale, opts) {
      const game = this.game, p = game.player;
      const dot = (x, y, r, fill, stroke) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.lineWidth = 1.2; ctx.strokeStyle = stroke; ctx.stroke(); } };
      for (const pt of game.portals.list) { ctx.beginPath(); ctx.arc(toX(pt.def.x), toY(pt.def.z), 4.5, 0, Math.PI * 2); ctx.lineWidth = 2.2; ctx.strokeStyle = '#6fc3ff'; ctx.stroke();
        if (opts.labels) this.label2(ctx, `To ${pt.def.label}`, toX(pt.def.x), toY(pt.def.z) - 9, '#cfe8ff'); }
      for (const m of game.monsters.list) {
        if (!m.alive) continue;
        if (m.def.boss) dot(toX(m.position.x), toY(m.position.z), 4.5, '#ffcc4d', '#5a3a00');
        else dot(toX(m.position.x), toY(m.position.z), m.aggro === p ? 2.8 : 2.2, m.def.aggressive ? '#ff4f6a' : '#ff8a8a');
      }
      for (const n of game.npcs.list) {
        dot(toX(n.position.x), toY(n.position.z), 3.2, '#ffe27a', '#6a4a00');
        if (opts.labels) this.label2(ctx, n.name, toX(n.position.x), toY(n.position.z) - 8, '#fff3c4');
      }
      const tgt = game.quests.target();
      if (tgt && (!tgt.map || tgt.map === game.mapId)) this.star(ctx, toX(tgt.x), toY(tgt.z), 6);
      // Camera view cone and the player arrow.
      const px = toX(p.position.x), py = toY(p.position.z), yaw = game.camera.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), len = 22 * (opts.coneScale || 1);
      ctx.beginPath(); ctx.moveTo(px, py);
      for (const a of [-0.5, 0.5]) { const c = Math.cos(a), s = Math.sin(a); ctx.lineTo(px + (fx * c - fz * s) * len, py + (fx * s + fz * c) * len); }
      ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill();
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI - p.facing);
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#1b2b4a'; ctx.stroke();
      ctx.restore();
    }
    star(ctx, x, y, r) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fillStyle = '#ffd24a'; ctx.fill(); ctx.strokeStyle = '#6a4a00'; ctx.lineWidth = 1; ctx.stroke();
    }
    label2(ctx, text, x, y, color) {
      ctx.font = '600 11px Fredoka, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,16,30,0.85)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
    }

    update(dt) {
      if (!this.game.player) return;
      if (this.mapId !== this.game.mapId) this.bake();
      this.t += dt;
      if (this.t < 0.08) return;
      this.t = 0;
      const ctx = this.ctx, W = this.canvas.width, R = this.zooms[this.zoom], p = this.game.player.position;
      const scale = W / (R * 2);
      ctx.clearRect(0, 0, W, W);
      ctx.save();
      ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#1b2233'; ctx.fillRect(0, 0, W, W);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.image, p.x + HALF - R, p.z + HALF - R, R * 2, R * 2, 0, 0, W, W);
      const toX = (x) => W / 2 + (x - p.x) * scale, toY = (z) => W / 2 + (z - p.z) * scale;
      this.markers(ctx, toX, toY, scale, { coneScale: 1 });
      ctx.restore();
      if (this.game.windows.isOpen('worldmap')) this.drawBig();
    }

    drawBig() {
      if (!this.image || !this.game.player) return;
      const ctx = this.big.getContext('2d'), W = this.big.width, scale = W / SIZE;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.image, 0, 0, W, W);
      const toX = (x) => (x + HALF) * scale, toY = (z) => (z + HALF) * scale;
      this.markers(ctx, toX, toY, scale, { labels: true, coneScale: 1.2 });
      this.label2(ctx, this.game.map.name, W / 2, 18, '#ffffff');
    }
  }

  G.Minimap = Minimap;
})(window.G = window.G || {});
