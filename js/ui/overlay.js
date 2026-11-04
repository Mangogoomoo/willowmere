/* Overlay: a 2D canvas over the 3D view for crisp text and bars that track
   world positions - damage numbers, monster HP bars, nameplates. */
(function (G) {
  'use strict';
  const U = G.Utils;
  const FONT = 'Fredoka, "Trebuchet MS", "Segoe UI", sans-serif';
  const _v = new THREE.Vector3();

  const STYLE = {
    dmg: { fill: '#ffffff', stroke: '#3b1d2c', size: 22, life: 0.95 },
    crit: { fill: '#ffd23f', stroke: '#6e1f00', size: 30, life: 1.15 },
    miss: { fill: '#bfe3ff', stroke: '#183452', size: 18, life: 0.9 },
    hurt: { fill: '#ff6f6f', stroke: '#3a0c0c', size: 22, life: 0.95 },
    exp: { fill: '#d6f58a', stroke: '#2b4210', size: 15, life: 1.3 },
    heal: { fill: '#7dff9a', stroke: '#0f3a1c', size: 21, life: 1.1 },
    spheal: { fill: '#8fc4ff', stroke: '#0f2346', size: 19, life: 1.1 },
    zeny: { fill: '#ffd85e', stroke: '#4a3200', size: 16, life: 1.2 },
    skill: { fill: '#fff2b0', stroke: '#5a2a00', size: 17, life: 1.0 },
    skilldmg: { fill: '#ffd0a0', stroke: '#5a1a00', size: 26, life: 1.05 },
    magic: { fill: '#c9b8ff', stroke: '#24104a', size: 24, life: 1.0 },
    debuff: { fill: '#ff8a8a', stroke: '#3a0c0c', size: 17, life: 1.2 },
    poison: { fill: '#9ee86a', stroke: '#1d3a0a', size: 18, life: 0.9 },
  };

  class Overlay {
    constructor(game, canvas) {
      this.game = game;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.texts = [];
      this.lvl = null;
      this.w = 1; this.h = 1; this.dpr = 1;
    }

    resize(w, h, dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }

    project(x, y, z) {
      _v.set(x, y, z).project(this.game.camera3);
      if (_v.z > 1 || _v.z < -1) return null;
      return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h };
    }

    addText(pos, text, kind) {
      if (this.texts.length > 70) this.texts.shift();
      const st = STYLE[kind] || STYLE.dmg;
      this.texts.push({
        x: pos.x, y: pos.y, z: pos.z, text, kind, st, t: 0,
        side: Math.random() < 0.5 ? -1 : 1, jx: (Math.random() - 0.5) * 10,
      });
    }

    levelUp(entity, text) { this.lvl = { ent: entity, t: 0, text: text || 'Level up!' }; }

    outlined(ctx, text, x, y, size, fill, stroke, weight) {
      ctx.font = `${weight || 600} ${size}px ${FONT}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size * 0.2);
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    }

    bar(ctx, x, y, w, h, frac, color) {
      ctx.fillStyle = 'rgba(20,16,30,0.75)';
      ctx.fillRect(x - w / 2 - 1.5, y - 1.5, w + 3, h + 3);
      ctx.fillStyle = 'rgba(70,60,80,0.9)';
      ctx.fillRect(x - w / 2, y, w, h);
      ctx.fillStyle = color;
      ctx.fillRect(x - w / 2, y, w * U.clamp(frac, 0, 1), h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x - w / 2, y, w * U.clamp(frac, 0, 1), Math.max(1, h * 0.35));
    }

    starburst(ctx, x, y, r, color) {
      ctx.beginPath();
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + 0.2, rr = i % 2 ? r * 0.55 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.75);
      }
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    }

    draw(dt) {
      const ctx = this.ctx, game = this.game;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const player = game.player, target = player.target, hover = game.input.hover;

      // Monster HP bars and names.
      for (const m of game.monsters.list) {
        if (!m.alive) continue;
        const recent = game.time - m.lastHurtTime < 6;
        const isT = m === target, isH = m === hover;
        if (!recent && !isT && !isH) continue;
        const p = m.position;
        const foot = this.project(p.x, p.y, p.z);
        if (!foot) continue;
        if (recent || isT) this.bar(ctx, foot.x, foot.y + 9, 46, 5, m.hp / m.def.hp, '#ff6a7f');
        if (isT || isH) {
          const head = this.project(p.x, p.y + m.def.height + 0.7, p.z);
          if (head) {
            this.outlined(ctx, m.name, head.x, head.y, 15, isT ? '#ffe9a3' : '#ffffff', 'rgba(25,18,40,0.9)', 600);
            this.outlined(ctx, `Lv ${m.level}`, head.x, head.y + 15, 11, '#cfe0ff', 'rgba(25,18,40,0.9)', 500);
          }
        }
      }

      // Player nameplate and HP under the feet, classic style.
      if (player.alive || true) {
        const p = player.position, foot = this.project(p.x, p.y, p.z);
        if (foot) {
          const frac = player.hp / player.maxHp;
          this.bar(ctx, foot.x, foot.y + 10, 52, 5, frac, frac < 0.3 ? '#ff5a5a' : '#5fd66e');
          this.bar(ctx, foot.x, foot.y + 17, 52, 3, player.sp / player.maxSp, '#5f9cff');
          if (G.Social && G.Net && G.Net.ws) G.Social.drawName(this, ctx, player.name, G.Social.myTags(), foot.x, foot.y + 32, '#ffffff', 'rgba(20,24,46,0.85)');
          else this.outlined(ctx, player.name, foot.x, foot.y + 32, 13, '#ffffff', 'rgba(20,24,46,0.85)', 600);
        }
      }

      // Other players online: name under the feet, chat bubbles above heads.
      if (G.Net && G.Net.players.size) for (const r of G.Net.players.values()) {
        if (r.distanceTo(player) > 45) continue;
        const f = this.project(r.position.x, r.position.y, r.position.z);
        if (f) G.Social.drawName(this, ctx, r.name, { party: r.party, guild: r.guild }, f.x, f.y + 16, '#d8ffd0', 'rgba(16,40,20,0.9)');
      }
      for (const who of [player, ...(G.Net ? G.Net.players.values() : [])]) {
        if (!who.bubble || game.time > who.bubble.until) continue;
        const q = this.project(who.position.x, who.position.y + 3.0, who.position.z);
        if (!q) continue;
        ctx.font = '600 13px Fredoka, sans-serif';
        const w = Math.min(260, ctx.measureText(who.bubble.text).width + 18);
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(40,60,110,0.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(q.x - w / 2, q.y - 26, w, 24, 8); else ctx.rect(q.x - w / 2, q.y - 26, w, 24); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1b2b4a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(who.bubble.text.length > 34 ? who.bubble.text.slice(0, 33) + '…' : who.bubble.text, q.x, q.y - 14);
      }

      // Other players' cast bars, with the spell name.
      if (G.Net) for (const r of G.Net.players.values()) {
        if (!r.cast) continue;
        const hq = this.project(r.position.x, r.position.y + 2.8, r.position.z);
        if (!hq) continue;
        const w = 84, hh = 9, x0 = hq.x - w / 2, y0 = hq.y, k = Math.min(1, r.cast.t / r.cast.dur);
        ctx.fillStyle = 'rgba(12,16,24,0.85)'; ctx.fillRect(x0 - 2, y0 - 2, w + 4, hh + 4);
        ctx.fillStyle = '#3fae3a'; ctx.fillRect(x0, y0, w * k, hh);
        ctx.strokeStyle = '#f2e6b8'; ctx.lineWidth = 1; ctx.strokeRect(x0 - 1.5, y0 - 1.5, w + 3, hh + 3);
        this.outlined(ctx, G.Skills.get(r.cast.id).name, hq.x, y0 - 10, 12.5, '#f3ffe8', 'rgba(10,20,10,0.9)', 600);
      }

      // NPC names (always shown, classic style) with a title line.
      for (const n of game.npcs.list) {
        if (n.distanceTo(player) > 40) continue;
        const q = this.project(n.position.x, n.position.y, n.position.z);
        if (!q) continue;
        const hov = game.input.hoverNpc === n;
        this.outlined(ctx, n.name, q.x, q.y + 14, 13.5, hov ? '#ffe9a3' : '#bfe6ff', 'rgba(16,22,48,0.9)', 600);
        if (n.title) this.outlined(ctx, n.title, q.x, q.y + 29, 11, '#e8eefc', 'rgba(16,22,48,0.85)', 500);
      }

      // Portal destinations.
      for (const pt of game.portals.list) {
        if (Math.hypot(pt.def.x - player.position.x, pt.def.z - player.position.z) > 45) continue;
        const q = this.project(pt.def.x, pt.y + 2.2, pt.def.z);
        if (q) this.outlined(ctx, `To ${pt.def.label}`, q.x, q.y, 14, '#cfe8ff', 'rgba(10,30,70,0.9)', 600);
      }

      // Cast bar above the player while a spell charges.
      const cast = player.skills && player.skills.casting;
      if (cast) {
        const head = this.project(player.position.x, player.position.y + 2.8, player.position.z);
        if (head) {
          // Classic cast bar: framed green bar above the head, filling up.
          const w = 84, hgt = 9, x0 = head.x - w / 2, y0 = head.y;
          const k = Math.min(1, cast.t / cast.dur);
          ctx.fillStyle = 'rgba(12,16,24,0.85)'; ctx.fillRect(x0 - 2, y0 - 2, w + 4, hgt + 4);
          ctx.fillStyle = '#2a3a2a'; ctx.fillRect(x0, y0, w, hgt);
          const g = ctx.createLinearGradient(0, y0, 0, y0 + hgt);
          g.addColorStop(0, '#b6ff8a'); g.addColorStop(1, '#3fae3a');
          ctx.fillStyle = g; ctx.fillRect(x0, y0, w * k, hgt);
          ctx.strokeStyle = '#f2e6b8'; ctx.lineWidth = 1; ctx.strokeRect(x0 - 1.5, y0 - 1.5, w + 3, hgt + 3);
          this.outlined(ctx, `${G.Skills.get(cast.id).name}  ${Math.max(0, cast.dur - cast.t).toFixed(1)}s`, head.x, y0 - 10, 12.5, '#f3ffe8', 'rgba(10,20,10,0.9)', 600);
        }
      }

      // Names of loot under the cursor or being walked to.
      for (const l of game.loot.items) {
        if (l !== game.input.hoverLoot && l !== player.pendingLoot) continue;
        const q = this.project(l.x, l.y + 0.85, l.z);
        if (!q) continue;
        const color = l.item ? G.Items.RARITY[l.item.rarity].color : '#ffd85e';
        ctx.font = `600 13px ${FONT}`;
        const w = ctx.measureText(l.name).width + 14;
        ctx.fillStyle = 'rgba(18,20,38,0.78)';
        ctx.fillRect(q.x - w / 2, q.y - 10, w, 20);
        this.outlined(ctx, l.name, q.x, q.y, 13, color, 'rgba(0,0,0,0.6)', 600);
      }

      // Floating numbers: hop up and to one side, fall back and fade.
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.t += dt;
        const k = t.t / t.st.life;
        if (k >= 1) { this.texts.splice(i, 1); continue; }
        const base = this.project(t.x, t.y, t.z);
        if (!base) continue;
        let x = base.x + t.jx, y = base.y, s = 1;
        if (t.kind === 'skill') {
          y -= 60 + 22 * k; x = base.x;
        } else if (t.kind === 'exp' || t.kind === 'heal' || t.kind === 'spheal' || t.kind === 'zeny') {
          y -= 18 + 46 * k;
        } else {
          x += t.side * k * 36;
          y += -150 * k + 135 * k * k - 10;
          s = k < 0.1 ? 1.7 - k * 7 : 1;
        }
        ctx.globalAlpha = k > 0.68 ? 1 - (k - 0.68) / 0.32 : 1;
        if (t.kind === 'crit') this.starburst(ctx, x, y, t.st.size * 1.15 * s, 'rgba(255,90,40,0.85)');
        this.outlined(ctx, t.text, x, y, t.st.size * s, t.st.fill, t.st.stroke, t.kind === 'exp' ? 600 : 700);
        ctx.globalAlpha = 1;
      }

      // Level-up banner above the player.
      if (this.lvl) {
        this.lvl.t += dt;
        const k = this.lvl.t / 2.4;
        if (k >= 1) this.lvl = null;
        else {
          const p = this.lvl.ent.position, head = this.project(p.x, p.y + 2.6, p.z);
          if (head) {
            ctx.globalAlpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : Math.min(1, k * 6);
            const s = k < 0.08 ? 0.6 + k * 5 : 1;
            this.outlined(ctx, this.lvl.text, head.x, head.y - k * 26, 28 * s, '#fff1a8', '#7a4a00', 700);
            ctx.globalAlpha = 1;
          }
        }
      }
    }
  }

  G.Overlay = Overlay;
})(window.G = window.G || {});
