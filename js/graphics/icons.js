/* Icons: original item icons painted on canvas from small recipes, cached
   as data URLs (for the UI) and textures (for loot lying on the ground). */
(function (G) {
  'use strict';
  const U = G.Utils;
  const S = 64;
  const cache = {}, texCache = {};

  function outlineFill(x, path, fill, stroke, lw) {
    x.beginPath(); path(x);
    x.lineJoin = 'round'; x.lineCap = 'round';
    x.lineWidth = lw || 4; x.strokeStyle = stroke || U.shade(fill, -0.55); x.stroke();
    x.fillStyle = fill; x.fill();
  }
  function shine(x, cx, cy, rx, ry, a) {
    x.save(); x.globalAlpha = a || 0.7; x.fillStyle = '#fff';
    x.beginPath(); x.ellipse(cx, cy, rx, ry, -0.6, 0, Math.PI * 2); x.fill(); x.restore();
  }
  function grad(x, c, y0, y1) {
    const g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, U.shade(c, 0.35)); g.addColorStop(1, U.shade(c, -0.15));
    return g;
  }

  const SHAPES = {
    potion(x, o) {
      const c = o.color;
      outlineFill(x, (p) => { p.moveTo(26, 10); p.lineTo(38, 10); p.lineTo(38, 22); p.bezierCurveTo(54, 28, 54, 56, 32, 56); p.bezierCurveTo(10, 56, 10, 28, 26, 22); p.closePath(); }, '#e8f4ff');
      outlineFill(x, (p) => { p.moveTo(15, 36); p.bezierCurveTo(14, 52, 22, 54, 32, 54); p.bezierCurveTo(42, 54, 50, 52, 49, 36); p.closePath(); }, c, U.shade(c, -0.5), 0.01);
      outlineFill(x, (p) => p.rect(24, 5, 16, 8), '#b07a46');
      shine(x, 24, 32, 3, 7, 0.8);
    },
    apple(x) {
      outlineFill(x, (p) => { p.moveTo(32, 20); p.bezierCurveTo(48, 10, 60, 30, 50, 46); p.bezierCurveTo(42, 60, 34, 54, 32, 54); p.bezierCurveTo(30, 54, 22, 60, 14, 46); p.bezierCurveTo(4, 30, 16, 10, 32, 20); }, '#e3343f');
      outlineFill(x, (p) => { p.moveTo(32, 20); p.quadraticCurveTo(30, 12, 34, 6); }, '#6b4026', '#4a2a16', 4);
      outlineFill(x, (p) => p.ellipse(42, 12, 8, 4, -0.5, 0, Math.PI * 2), '#6fbf4a');
      shine(x, 22, 30, 4, 7, 0.75);
    },
    carrot(x) {
      outlineFill(x, (p) => { p.moveTo(18, 22); p.lineTo(46, 22); p.quadraticCurveTo(36, 52, 30, 60); p.quadraticCurveTo(24, 40, 18, 22); }, '#f08a2c');
      x.strokeStyle = '#b8601a'; x.lineWidth = 2;
      for (const y of [30, 38, 46]) { x.beginPath(); x.moveTo(24, y); x.lineTo(32, y + 2); x.stroke(); }
      for (const a of [-0.5, 0, 0.5]) outlineFill(x, (p) => p.ellipse(32 + a * 14, 13, 5, 10, a, 0, Math.PI * 2), '#5fb548');
    },
    jellopy(x) {
      outlineFill(x, (p) => { p.moveTo(32, 8); p.lineTo(52, 26); p.lineTo(46, 52); p.lineTo(20, 54); p.lineTo(12, 28); p.closePath(); }, '#ffb3c9');
      x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(32, 8); x.lineTo(30, 32); x.lineTo(12, 28); x.moveTo(30, 32); x.lineTo(46, 52); x.stroke();
      shine(x, 24, 22, 3, 6, 0.8);
    },
    mucus(x) {
      outlineFill(x, (p) => { p.moveTo(32, 8); p.bezierCurveTo(38, 22, 54, 34, 50, 46); p.bezierCurveTo(46, 58, 18, 58, 14, 46); p.bezierCurveTo(10, 34, 26, 22, 32, 8); }, '#8fd96a');
      shine(x, 24, 38, 3, 6, 0.8);
    },
    bottle(x) {
      outlineFill(x, (p) => { p.moveTo(26, 10); p.lineTo(38, 10); p.lineTo(38, 22); p.bezierCurveTo(54, 28, 54, 56, 32, 56); p.bezierCurveTo(10, 56, 10, 28, 26, 22); p.closePath(); }, '#dff1fb');
      shine(x, 24, 34, 3, 8, 0.9);
    },
    clover(x, o) {
      const c = o.color || '#6fc24f';
      const n = o.four ? 4 : 3;
      outlineFill(x, (p) => { p.moveTo(32, 34); p.quadraticCurveTo(34, 48, 26, 58); }, '#4c8f36', '#2f5c20', 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2 + (o.four ? Math.PI / 4 : 0);
        outlineFill(x, (p) => p.ellipse(32 + Math.cos(a) * 11, 30 + Math.sin(a) * 11, 10, 9, a, 0, Math.PI * 2), c);
      }
      if (o.four) { x.fillStyle = '#ffe680'; x.beginPath(); x.arc(32, 30, 4, 0, Math.PI * 2); x.fill(); }
    },
    fluff(x) {
      for (const [cx, cy, r] of [[24, 34, 13], [40, 32, 14], [32, 24, 13], [32, 42, 12]]) outlineFill(x, (p) => p.arc(cx, cy, r, 0, Math.PI * 2), '#fbfbff', '#9a9cc4');
      shine(x, 26, 22, 4, 3, 0.9);
    },
    wing(x, o) {
      const c = o.color;
      outlineFill(x, (p) => { p.moveTo(32, 32); p.bezierCurveTo(20, 6, 2, 12, 8, 28); p.bezierCurveTo(12, 38, 26, 36, 32, 32); }, c);
      outlineFill(x, (p) => { p.moveTo(32, 32); p.bezierCurveTo(44, 6, 62, 12, 56, 28); p.bezierCurveTo(52, 38, 38, 36, 32, 32); }, c);
      outlineFill(x, (p) => { p.moveTo(32, 32); p.bezierCurveTo(22, 40, 14, 56, 24, 56); p.bezierCurveTo(30, 54, 32, 40, 32, 32); }, U.shade(c, -0.15));
      outlineFill(x, (p) => { p.moveTo(32, 32); p.bezierCurveTo(42, 40, 50, 56, 40, 56); p.bezierCurveTo(34, 54, 32, 40, 32, 32); }, U.shade(c, -0.15));
      outlineFill(x, (p) => p.ellipse(32, 34, 3, 12, 0, 0, Math.PI * 2), '#5a4030');
    },
    dagger(x, o) {
      x.save(); x.translate(32, 32); x.rotate(-Math.PI / 4);
      outlineFill(x, (p) => { p.moveTo(-5, -4); p.lineTo(0, -28); p.lineTo(5, -4); p.closePath(); }, o.color);
      outlineFill(x, (p) => p.rect(-11, -5, 22, 6), '#c9a24a');
      outlineFill(x, (p) => p.rect(-4, 1, 8, 16), '#6b4026');
      outlineFill(x, (p) => p.arc(0, 20, 4, 0, Math.PI * 2), '#c9a24a');
      x.restore();
    },
    sword(x, o) {
      x.save(); x.translate(32, 32); x.rotate(-Math.PI / 4);
      outlineFill(x, (p) => { p.moveTo(-5, -2); p.lineTo(-5, -26); p.lineTo(0, -32); p.lineTo(5, -26); p.lineTo(5, -2); p.closePath(); }, o.color);
      outlineFill(x, (p) => p.rect(-13, -4, 26, 6), '#9a7a3a');
      outlineFill(x, (p) => p.rect(-3.5, 2, 7, 15), '#5a3520');
      outlineFill(x, (p) => p.arc(0, 20, 4, 0, Math.PI * 2), '#9a7a3a');
      x.restore();
    },
    club(x, o) {
      x.save(); x.translate(32, 32); x.rotate(-Math.PI / 4);
      outlineFill(x, (p) => { p.moveTo(-4, 20); p.lineTo(-9, -18); p.quadraticCurveTo(0, -32, 9, -18); p.lineTo(4, 20); p.closePath(); }, o.color);
      x.restore();
    },
    rod(x, o) {
      x.save(); x.translate(32, 32); x.rotate(-Math.PI / 4);
      outlineFill(x, (p) => p.rect(-3, -18, 6, 44), '#8b5a33');
      outlineFill(x, (p) => p.arc(0, -22, 8, 0, Math.PI * 2), o.color);
      shine(x, -3, -25, 2, 3, 0.9);
      x.restore();
    },
    bow(x) {
      outlineFill(x, (p) => { p.moveTo(18, 8); p.quadraticCurveTo(56, 32, 18, 56); }, 'rgba(0,0,0,0)', '#6b4026', 6);
      x.strokeStyle = '#eee'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(18, 8); x.lineTo(18, 56); x.stroke();
    },
    shirt(x, o) {
      outlineFill(x, (p) => { p.moveTo(22, 10); p.lineTo(42, 10); p.lineTo(56, 22); p.lineTo(48, 30); p.lineTo(44, 26); p.lineTo(44, 54); p.lineTo(20, 54); p.lineTo(20, 26); p.lineTo(16, 30); p.lineTo(8, 22); p.closePath(); }, o.color);
      outlineFill(x, (p) => { p.moveTo(26, 10); p.lineTo(32, 18); p.lineTo(38, 10); }, U.shade(o.color, -0.2), U.shade(o.color, -0.5), 2);
    },
    boots(x, o) {
      outlineFill(x, (p) => { p.moveTo(14, 14); p.lineTo(30, 14); p.lineTo(30, 40); p.lineTo(50, 44); p.quadraticCurveTo(56, 54, 46, 54); p.lineTo(14, 54); p.closePath(); }, o.color);
      outlineFill(x, (p) => p.rect(14, 48, 40, 6), U.shade(o.color, -0.35));
    },
    cape(x, o) {
      outlineFill(x, (p) => { p.moveTo(24, 8); p.lineTo(40, 8); p.quadraticCurveTo(56, 34, 52, 56); p.lineTo(12, 56); p.quadraticCurveTo(8, 34, 24, 8); }, o.color);
      outlineFill(x, (p) => p.arc(32, 12, 4, 0, Math.PI * 2), '#e3c35a');
    },
    shield(x, o) {
      outlineFill(x, (p) => p.arc(32, 32, 24, 0, Math.PI * 2), o.color);
      outlineFill(x, (p) => p.arc(32, 32, 15, 0, Math.PI * 2), U.shade(o.color, 0.15));
      outlineFill(x, (p) => p.arc(32, 32, 6, 0, Math.PI * 2), '#c9c9c9');
    },
    ribbon(x, o) {
      outlineFill(x, (p) => { p.moveTo(32, 30); p.bezierCurveTo(16, 10, 4, 24, 12, 38); p.bezierCurveTo(18, 46, 28, 36, 32, 30); }, o.color);
      outlineFill(x, (p) => { p.moveTo(32, 30); p.bezierCurveTo(48, 10, 60, 24, 52, 38); p.bezierCurveTo(46, 46, 36, 36, 32, 30); }, o.color);
      outlineFill(x, (p) => { p.moveTo(28, 32); p.lineTo(20, 56); p.lineTo(28, 52); p.lineTo(32, 34); p.lineTo(36, 52); p.lineTo(44, 56); p.lineTo(36, 32); }, U.shade(o.color, -0.1));
      outlineFill(x, (p) => p.arc(32, 30, 5, 0, Math.PI * 2), U.shade(o.color, -0.2));
    },
    ears(x) {
      for (const s of [-1, 1]) {
        outlineFill(x, (p) => p.ellipse(32 + s * 10, 26, 7, 20, s * 0.25, 0, Math.PI * 2), '#fbfbff', '#8d8fb8');
        outlineFill(x, (p) => p.ellipse(32 + s * 10, 27, 3, 14, s * 0.25, 0, Math.PI * 2), '#ffb1c6', '#ffb1c6', 1);
      }
      outlineFill(x, (p) => { p.moveTo(12, 52); p.quadraticCurveTo(32, 40, 52, 52); }, 'rgba(0,0,0,0)', '#8d8fb8', 5);
    },
    glasses(x) {
      for (const cx of [20, 44]) outlineFill(x, (p) => p.arc(cx, 34, 11, 0, Math.PI * 2), 'rgba(190,230,255,0.75)', '#3b3346', 4);
      x.strokeStyle = '#3b3346'; x.lineWidth = 4; x.beginPath(); x.moveTo(30, 32); x.quadraticCurveTo(32, 28, 34, 32); x.stroke();
    },
    pipe(x) {
      outlineFill(x, (p) => { p.moveTo(8, 30); p.lineTo(36, 38); p.lineTo(34, 44); p.lineTo(8, 36); p.closePath(); }, '#8bc34a');
      outlineFill(x, (p) => { p.moveTo(34, 26); p.lineTo(52, 26); p.lineTo(50, 50); p.lineTo(36, 50); p.closePath(); }, '#6a9f3a');
      x.fillStyle = 'rgba(255,255,255,0.6)'; for (const [cx, cy] of [[46, 18], [50, 10]]) { x.beginPath(); x.arc(cx, cy, 3, 0, Math.PI * 2); x.fill(); }
    },
    brooch(x, o) {
      outlineFill(x, (p) => { for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, r = i % 2 ? 18 : 24; p.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } p.closePath(); }, '#e6c25a');
      outlineFill(x, (p) => p.arc(32, 32, 12, 0, Math.PI * 2), o.color);
      shine(x, 28, 27, 3, 4, 0.9);
    },
    herb(x, o) {
      outlineFill(x, (p) => { p.moveTo(32, 56); p.lineTo(32, 26); }, 'rgba(0,0,0,0)', '#3f7a2a', 4);
      for (const [a, cy] of [[-0.6, 22], [0.6, 30], [-0.5, 38], [0.7, 14]]) outlineFill(x, (p) => p.ellipse(32 + Math.sin(a) * 12, cy, 11, 5.5, a, 0, Math.PI * 2), o.color);
    },
    cocoon(x) {
      outlineFill(x, (p) => p.ellipse(32, 34, 15, 23, 0.2, 0, Math.PI * 2), '#dcc58f', '#7a5a28');
      x.strokeStyle = 'rgba(120,90,40,0.6)'; x.lineWidth = 2;
      for (const y of [22, 30, 38, 46]) { x.beginPath(); x.moveTo(20, y); x.quadraticCurveTo(32, y + 4, 44, y - 2); x.stroke(); }
    },
    leg(x) {
      outlineFill(x, (p) => { p.moveTo(14, 50); p.lineTo(26, 14); p.lineTo(34, 16); p.lineTo(24, 50); p.closePath(); }, '#7fbf3f', '#2f5e14');
      outlineFill(x, (p) => { p.moveTo(26, 16); p.lineTo(52, 40); p.lineTo(48, 46); p.lineTo(24, 24); p.closePath(); }, '#5a9a2c', '#2f5e14');
    },
    leafcap(x) {
      outlineFill(x, (p) => { p.moveTo(10, 44); p.quadraticCurveTo(32, 4, 54, 44); p.closePath(); }, '#6fbf4a', '#2f6e1f');
      x.strokeStyle = '#2f6e1f'; x.lineWidth = 2; x.beginPath(); x.moveTo(32, 12); x.lineTo(32, 44); x.stroke();
      outlineFill(x, (p) => p.ellipse(32, 46, 24, 5, 0, 0, Math.PI * 2), '#8a5a2c');
    },
    card(x, o) {
      outlineFill(x, (p) => { if (p.roundRect) p.roundRect(14, 6, 36, 52, 5); else p.rect(14, 6, 36, 52); }, '#f6edd2', '#8a6a2a');
      outlineFill(x, (p) => p.rect(19, 12, 26, 26), o.color, U.shade(o.color, -0.5), 2);
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.font = 'bold 16px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(o.letter || '?', 32, 26);
      // Slot label on the card, so you can tell where it goes at a glance.
      x.fillStyle = '#5a3a10'; x.font = `bold ${o.slot && o.slot.length > 6 ? 6 : 7.5}px sans-serif`; x.textBaseline = 'middle';
      x.fillText(o.slot || '', 32, 47);
      x.strokeStyle = '#e6c25a'; x.lineWidth = 2; x.strokeRect(16.5, 8.5, 31, 47);
    },
    ore(x, o) {
      outlineFill(x, (p) => { p.moveTo(14, 40); p.lineTo(20, 20); p.lineTo(34, 12); p.lineTo(50, 22); p.lineTo(52, 40); p.lineTo(38, 52); p.lineTo(22, 50); p.closePath(); }, o.color);
      x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(20, 20); x.lineTo(30, 32); x.lineTo(34, 12); x.moveTo(30, 32); x.lineTo(38, 52); x.moveTo(30, 32); x.lineTo(50, 22); x.stroke();
      shine(x, 26, 24, 3, 5, 0.85);
    },
    // A bundle of three arrows; the heads take the arrow's colour.
    arrow(x, o) {
      for (const [dx, dy] of [[-7, 4], [0, 0], [7, 4]]) {
        x.save(); x.translate(32 + dx, 32 + dy); x.rotate(-Math.PI / 4 + dx * 0.02);
        outlineFill(x, (p) => p.rect(-1.5, -14, 3, 38), '#a8743c');
        outlineFill(x, (p) => { p.moveTo(-5, 18); p.lineTo(0, 12); p.lineTo(5, 18); p.lineTo(5, 25); p.lineTo(0, 21); p.lineTo(-5, 25); p.closePath(); }, '#f4f2ee');
        outlineFill(x, (p) => { p.moveTo(0, -26); p.lineTo(5, -14); p.lineTo(-5, -14); p.closePath(); }, o.color);
        x.restore();
      }
    },
    spear(x, o) {
      x.save(); x.translate(32, 32); x.rotate(-Math.PI / 4);
      outlineFill(x, (p) => p.rect(-2, -16, 4, 44), '#8b5a33');
      outlineFill(x, (p) => { p.moveTo(0, -30); p.lineTo(6, -18); p.lineTo(0, -14); p.lineTo(-6, -18); p.closePath(); }, o.color);
      x.restore();
    },
    katar(x, o) {
      outlineFill(x, (p) => p.rect(20, 40, 24, 12), '#5a3a22');
      for (const dx of [-5, 5]) outlineFill(x, (p) => { p.moveTo(32 + dx - 3, 40); p.lineTo(32 + dx, 6); p.lineTo(32 + dx + 3, 40); p.closePath(); }, o.color);
    },
    knuckle(x, o) {
      outlineFill(x, (p) => { if (p.roundRect) p.roundRect(10, 22, 44, 22, 8); else p.rect(10, 22, 44, 22); }, o.color);
      x.fillStyle = 'rgba(0,0,0,0.35)'; for (const cx of [20, 30, 40, 50]) { x.beginPath(); x.arc(cx - 2, 33, 4, 0, Math.PI * 2); x.fill(); }
    },
    axe(x, o) {
      x.save(); x.translate(32, 32); x.rotate(-Math.PI / 4);
      outlineFill(x, (p) => p.rect(-2.5, -14, 5, 40), '#8b5a33');
      outlineFill(x, (p) => { p.moveTo(2, -16); p.quadraticCurveTo(20, -18, 18, -4); p.quadraticCurveTo(10, -8, 2, -6); p.closePath(); }, o.color);
      outlineFill(x, (p) => { p.moveTo(-2, -16); p.quadraticCurveTo(-20, -18, -18, -4); p.quadraticCurveTo(-10, -8, -2, -6); p.closePath(); }, o.color);
      x.restore();
    },
    book(x, o) {
      outlineFill(x, (p) => p.rect(14, 10, 36, 44), o.color);
      outlineFill(x, (p) => p.rect(18, 12, 30, 40), U.shade(o.color, 0.15), U.shade(o.color, -0.4), 1);
      outlineFill(x, (p) => { p.moveTo(32, 20); p.lineTo(32, 42); p.moveTo(24, 28); p.lineTo(40, 28); }, 'rgba(0,0,0,0)', '#e6c25a', 3);
    },
    crown(x) {
      outlineFill(x, (p) => { p.moveTo(10, 46); p.lineTo(12, 18); p.lineTo(22, 32); p.lineTo(32, 12); p.lineTo(42, 32); p.lineTo(52, 18); p.lineTo(54, 46); p.closePath(); }, '#f5c542', '#8a5a00');
      for (const [cx, c] of [[22, '#ff6b8b'], [32, '#7fc8ff'], [42, '#7dff9a']]) outlineFill(x, (p) => p.arc(cx, 38, 4, 0, Math.PI * 2), c);
    },
    lamp(x) {
      outlineFill(x, (p) => p.rect(14, 34, 36, 8), '#7a4a2a');
      outlineFill(x, (p) => { p.moveTo(22, 34); p.lineTo(24, 18); p.lineTo(40, 18); p.lineTo(42, 34); p.closePath(); }, '#c9a24a');
      outlineFill(x, (p) => p.arc(32, 26, 5, 0, Math.PI * 2), '#fff3a0');
    },
    mushcap(x) {
      outlineFill(x, (p) => { p.moveTo(8, 40); p.quadraticCurveTo(32, 2, 56, 40); p.closePath(); }, '#c9583a');
      for (const [cx, cy] of [[22, 28], [38, 22], [44, 34]]) { x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, 3.5, 0, Math.PI * 2); x.fill(); }
      outlineFill(x, (p) => p.rect(26, 40, 12, 14), '#f1e6cf');
    },
    zeny(x) {
      for (const [cx, cy] of [[22, 42], [42, 44], [32, 30]]) {
        outlineFill(x, (p) => p.ellipse(cx, cy, 13, 9, 0, 0, Math.PI * 2), '#f5c542', '#8a5a00');
        x.fillStyle = '#b8860b'; x.font = 'bold 12px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Z', cx, cy + 1);
      }
    },
  };

  /* ---------- skill icons: a coloured tile with a white symbol ---------- */
  function tile(x, color) {
    const g = x.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, U.shade(color, 0.25)); g.addColorStop(1, U.shade(color, -0.35));
    x.fillStyle = g;
    x.beginPath(); if (x.roundRect) x.roundRect(3, 3, 58, 58, 12); else x.rect(3, 3, 58, 58); x.fill();
    x.lineWidth = 3; x.strokeStyle = U.shade(color, -0.55); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(8, 8, 48, 10);
  }
  const W = '#ffffff', D = 'rgba(30,20,40,0.55)';
  function sym(x, path, fill, lw) {
    x.save(); x.lineJoin = 'round'; x.lineCap = 'round';
    x.beginPath(); path(x);
    x.lineWidth = lw || 5; x.strokeStyle = D; x.stroke();
    if (fill === false) { x.lineWidth = (lw || 5) - 2.5; x.strokeStyle = W; x.stroke(); }
    else { x.fillStyle = fill || W; x.fill(); }
    x.restore();
  }
  const SKILL_SYMBOLS = {
    s_trap(x, o) { outlineFill(x, (p) => p.rect(14, 30, 36, 14), '#8a6a4a'); for (const cx of [20, 32, 44]) outlineFill(x, (p) => { p.moveTo(cx - 5, 30); p.lineTo(cx, 16); p.lineTo(cx + 5, 30); p.closePath(); }, o.color); },
    s_hammer(x, o) { x.save(); x.translate(32, 32); x.rotate(-0.6); outlineFill(x, (p) => p.rect(-3, -6, 6, 34), '#8b5a33'); outlineFill(x, (p) => p.rect(-14, -18, 28, 14), o.color); x.restore(); },
    s_flask(x, o) { outlineFill(x, (p) => { p.moveTo(26, 10); p.lineTo(38, 10); p.lineTo(38, 24); p.lineTo(50, 50); p.lineTo(14, 50); p.lineTo(26, 24); p.closePath(); }, '#eef6ff'); outlineFill(x, (p) => { p.moveTo(20, 38); p.lineTo(44, 38); p.lineTo(50, 50); p.lineTo(14, 50); p.closePath(); }, o.color); },
    s_book(x) { sym(x, (p) => { p.moveTo(14, 18); p.lineTo(32, 22); p.lineTo(50, 18); p.lineTo(50, 46); p.lineTo(32, 50); p.lineTo(14, 46); p.closePath(); }); sym(x, (p) => { p.moveTo(32, 22); p.lineTo(32, 50); }, false, 4); },
    s_cross(x) { sym(x, (p) => { p.moveTo(26, 12); p.lineTo(38, 12); p.lineTo(38, 26); p.lineTo(52, 26); p.lineTo(52, 38); p.lineTo(38, 38); p.lineTo(38, 52); p.lineTo(26, 52); p.lineTo(26, 38); p.lineTo(12, 38); p.lineTo(12, 26); p.lineTo(26, 26); p.closePath(); }); },
    s_zzz(x) { x.save(); x.font = 'bold 24px sans-serif'; x.fillStyle = W; x.strokeStyle = D; x.lineWidth = 4; [['Z', 14, 46], ['z', 30, 34], ['z', 42, 24]].forEach(([t, a, b]) => { x.strokeText(t, a, b); x.fillText(t, a, b); }); x.restore(); },
    s_bash(x) { sym(x, (p) => { for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 9 : 22; p.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r); } p.closePath(); }); sym(x, (p) => { p.moveTo(44, 12); p.lineTo(24, 32); }, false, 7); },
    s_burst(x) { sym(x, (p) => { for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, r = i % 2 ? 12 : 25; p.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r); } p.closePath(); }, '#fff2c4'); sym(x, (p) => p.arc(32, 33, 7, 0, Math.PI * 2)); },
    s_shout(x) { sym(x, (p) => { p.moveTo(14, 26); p.lineTo(26, 26); p.lineTo(40, 14); p.lineTo(40, 50); p.lineTo(26, 38); p.lineTo(14, 38); p.closePath(); }); sym(x, (p) => { p.moveTo(46, 22); p.quadraticCurveTo(54, 32, 46, 42); }, false, 5); },
    s_shield(x) { sym(x, (p) => { p.moveTo(32, 10); p.lineTo(50, 18); p.quadraticCurveTo(50, 44, 32, 54); p.quadraticCurveTo(14, 44, 14, 18); p.closePath(); }); },
    s_bolt(x, o) {
      if (o.element === 'wind') sym(x, (p) => { p.moveTo(36, 8); p.lineTo(18, 36); p.lineTo(30, 36); p.lineTo(26, 56); p.lineTo(46, 26); p.lineTo(34, 26); p.closePath(); });
      else if (o.element === 'water') sym(x, (p) => { p.moveTo(32, 8); p.lineTo(42, 30); p.lineTo(32, 56); p.lineTo(22, 30); p.closePath(); }, '#eafaff');
      else sym(x, (p) => { p.moveTo(32, 8); p.bezierCurveTo(46, 24, 50, 34, 44, 46); p.bezierCurveTo(40, 54, 24, 54, 20, 46); p.bezierCurveTo(14, 34, 24, 28, 26, 18); p.bezierCurveTo(30, 26, 32, 22, 32, 8); }, '#fff2c4');
    },
    s_drop(x) { sym(x, (p) => { p.moveTo(32, 10); p.bezierCurveTo(44, 28, 48, 34, 46, 42); p.bezierCurveTo(42, 56, 22, 56, 18, 42); p.bezierCurveTo(16, 34, 20, 28, 32, 10); }); },
    s_arrows(x) { for (const dy of [-7, 7]) sym(x, (p) => { p.moveTo(12, 40 + dy); p.lineTo(46, 22 + dy); p.moveTo(46, 22 + dy); p.lineTo(38, 20 + dy); p.moveTo(46, 22 + dy); p.lineTo(42, 30 + dy); }, false, 6); },
    s_eye(x) { sym(x, (p) => { p.moveTo(10, 32); p.quadraticCurveTo(32, 10, 54, 32); p.quadraticCurveTo(32, 54, 10, 32); }); x.fillStyle = D; x.beginPath(); x.arc(32, 32, 8, 0, Math.PI * 2); x.fill(); },
    s_wing(x) { sym(x, (p) => { p.moveTo(14, 46); p.bezierCurveTo(14, 20, 34, 12, 52, 14); p.bezierCurveTo(46, 22, 44, 26, 48, 30); p.bezierCurveTo(40, 32, 38, 36, 42, 40); p.bezierCurveTo(32, 44, 24, 44, 14, 46); }); },
    s_halo(x) { sym(x, (p) => p.ellipse(32, 20, 16, 6, 0, 0, Math.PI * 2), false, 6); sym(x, (p) => { p.moveTo(32, 30); p.lineTo(36, 40); p.lineTo(47, 41); p.lineTo(38, 47); p.lineTo(41, 57); p.lineTo(32, 51); p.lineTo(23, 57); p.lineTo(26, 47); p.lineTo(17, 41); p.lineTo(28, 40); p.closePath(); }); },
    s_daggers(x) { for (const s of [-1, 1]) sym(x, (p) => { p.moveTo(32 + s * 16, 12); p.lineTo(32 - s * 10, 46); p.moveTo(32 - s * 14, 40); p.lineTo(32 - s * 4, 48); }, false, 6); },
    s_swirl(x) { sym(x, (p) => { for (let i = 0; i < 60; i++) { const a = i * 0.22, r = 3 + i * 0.36; p.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } }, false, 6); },
    s_hand(x) { sym(x, (p) => { p.moveTo(20, 52); p.lineTo(18, 30); p.lineTo(22, 28); p.lineTo(25, 40); p.lineTo(25, 16); p.lineTo(30, 15); p.lineTo(31, 36); p.lineTo(33, 13); p.lineTo(38, 14); p.lineTo(37, 36); p.lineTo(41, 18); p.lineTo(46, 20); p.lineTo(43, 44); p.quadraticCurveTo(40, 54, 30, 54); p.closePath(); }); },
    s_coin(x) { sym(x, (p) => p.arc(32, 32, 20, 0, Math.PI * 2), '#ffe27a'); x.save(); x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#8a5a00'; x.fillText('Z', 32, 33); x.restore(); },
    s_tag(x) { sym(x, (p) => { p.moveTo(12, 30); p.lineTo(30, 12); p.lineTo(52, 12); p.lineTo(52, 34); p.lineTo(34, 52); p.closePath(); }); x.fillStyle = D; x.beginPath(); x.arc(44, 20, 4, 0, Math.PI * 2); x.fill(); },
    s_sword(x) { sym(x, (p) => { p.moveTo(46, 10); p.lineTo(52, 12); p.lineTo(26, 40); p.lineTo(22, 36); p.closePath(); }); sym(x, (p) => { p.moveTo(16, 34); p.lineTo(28, 46); p.moveTo(22, 40); p.lineTo(12, 50); }, false, 6); },
    s_heart(x) { sym(x, (p) => { p.moveTo(32, 52); p.bezierCurveTo(8, 36, 10, 14, 24, 14); p.bezierCurveTo(30, 14, 32, 20, 32, 22); p.bezierCurveTo(32, 20, 34, 14, 40, 14); p.bezierCurveTo(54, 14, 56, 36, 32, 52); }); },
    s_soul(x) { for (const [cx, cy, r] of [[24, 38, 9], [40, 28, 7], [30, 20, 5]]) sym(x, (p) => p.arc(cx, cy, r, 0, Math.PI * 2), '#f4eeff'); },
    s_storm(x) { sym(x, (p) => { p.ellipse(32, 20, 18, 9, 0, 0, Math.PI * 2); }, '#eef2ff'); sym(x, (p) => { p.moveTo(30, 26); p.lineTo(22, 42); p.lineTo(30, 42); p.lineTo(26, 56); p.lineTo(40, 36); p.lineTo(32, 36); p.lineTo(38, 26); p.closePath(); }); },
    s_rain(x) { for (const dx of [-12, 0, 12]) sym(x, (p) => { p.moveTo(32 + dx + 6, 12); p.lineTo(32 + dx - 4, 48); p.moveTo(32 + dx - 4, 48); p.lineTo(32 + dx - 8, 40); p.moveTo(32 + dx - 4, 48); p.lineTo(32 + dx + 2, 42); }, false, 5); },
    s_arrow(x) { sym(x, (p) => { p.moveTo(10, 50); p.lineTo(50, 14); p.moveTo(50, 14); p.lineTo(38, 16); p.moveTo(50, 14); p.lineTo(48, 26); }, false, 7); sym(x, (p) => { p.moveTo(44, 44); p.lineTo(54, 54); }, false, 5); },
    s_star(x) { sym(x, (p) => { for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 9 : 22; p.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r); } p.closePath(); }); },
    s_dash(x) { sym(x, (p) => { p.moveTo(46, 14); p.lineTo(22, 32); p.lineTo(46, 50); }, false, 8); for (const y of [22, 32, 42]) sym(x, (p) => { p.moveTo(52, y); p.lineTo(58, y); }, false, 4); },
    s_bag(x) { sym(x, (p) => { p.moveTo(24, 18); p.lineTo(40, 18); p.lineTo(36, 24); p.bezierCurveTo(54, 30, 54, 54, 32, 54); p.bezierCurveTo(10, 54, 10, 30, 28, 24); p.closePath(); }); },
  };
  const skillCache = {};

  function draw(recipe) {
    const c = U.makeCanvas(S, S), x = c.getContext('2d');
    (SHAPES[recipe.shape] || SHAPES.jellopy)(x, recipe);
    return c;
  }

  G.Icons = {
    skillUrl(skillId) {
      if (!skillCache[skillId]) {
        const sk = G.Skills.get(skillId), c = U.makeCanvas(S, S), x = c.getContext('2d');
        tile(x, sk.icon.color);
        (SKILL_SYMBOLS[sk.icon.shape] || SKILL_SYMBOLS.s_book)(x, sk.icon);
        skillCache[skillId] = c.toDataURL();
      }
      return skillCache[skillId];
    },
    // Data URL for <img> use in the UI.
    url(itemId) {
      if (!cache[itemId]) {
        const recipe = itemId === 'zeny' ? { shape: 'zeny' } : G.Items.get(itemId).icon;
        cache[itemId] = draw(recipe).toDataURL();
      }
      return cache[itemId];
    },
    // Texture for loot sprites in the world.
    texture(itemId) {
      if (!texCache[itemId]) {
        const recipe = itemId === 'zeny' ? { shape: 'zeny' } : G.Items.get(itemId).icon;
        const t = new THREE.CanvasTexture(draw(recipe));
        t.encoding = THREE.sRGBEncoding;
        texCache[itemId] = t;
      }
      return texCache[itemId];
    },
  };
})(window.G = window.G || {});
