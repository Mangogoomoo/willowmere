/* SpriteFactory: original character designs drawn procedurally with the
   RigPainter. Each design defines its animations; the factory bakes them
   into 8-direction sprite-sheet atlases at startup. */
(function (G) {
  'use strict';
  const U = G.Utils, RP = G.RigPainter;
  const TAU = Math.PI * 2;

  function ell(ctx, x, y, rx, ry, fill) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill();
  }
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const add = (a, b, k) => [a[0] + b[0] * (k == null ? 1 : k), a[1] + b[1] * (k == null ? 1 : k), a[2] + b[2] * (k == null ? 1 : k)];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const lerp3 = (a, b, t) => [U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t), U.lerp(a[2], b[2], t)];
  function keyframes(keys, t) {
    for (let i = 0; i < keys.length - 1; i++) {
      if (t <= keys[i + 1][0]) {
        const k = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        const s = k * k * (3 - 2 * k);
        return lerp3(keys[i][1], keys[i + 1][1], s);
      }
    }
    return keys[keys.length - 1][1];
  }

  /* Shared face pieces */
  function eyeDecal(n, iris, opts) {
    opts = opts || {};
    return {
      n: norm(n), draw(ctx) {
        if (opts.closed) {
          ctx.beginPath(); ctx.arc(0, 1.2, 2.6, Math.PI * 1.15, Math.PI * 1.85);
          ctx.strokeStyle = '#3a2632'; ctx.lineWidth = 1.2; ctx.stroke(); return;
        }
        if (opts.squint) {
          ctx.beginPath(); ctx.moveTo(-2.2, 1.6); ctx.lineTo(1.6 * opts.squint, 0); ctx.lineTo(-2.2, -1.6);
          ctx.strokeStyle = '#2a1c25'; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.stroke(); return;
        }
        const w = opts.w || 2.7, h = opts.h || 4.0;
        ell(ctx, 0, 0, w, h, opts.outer || '#3a2632');
        if (iris) { ell(ctx, 0, -h * 0.18, w * 0.8, h * 0.74, iris); ell(ctx, 0, -h * 0.08, w * 0.42, h * 0.42, '#1f2645'); }
        ell(ctx, -w * 0.3, h * 0.38, w * 0.36, w * 0.36, '#ffffff');
        ell(ctx, w * 0.32, -h * 0.4, w * 0.18, w * 0.18, 'rgba(255,255,255,0.85)');
        if (opts.lash) {
          ctx.beginPath(); ctx.ellipse(0, 0.2, w * 1.15, h * 1.0, 0, Math.PI * 0.12, Math.PI * 0.88);
          ctx.strokeStyle = '#2a1c25'; ctx.lineWidth = 1.1; ctx.stroke();
        }
      },
    };
  }
  const blush = (n, r) => ({ n: norm(n), draw(ctx) { ell(ctx, 0, 0, r || 2.6, (r || 2.6) * 0.5, 'rgba(255,110,140,0.42)'); } });

  /* ===================================================== NOVICE (customisable) */
  const APPEARANCE = {
    hair: [
      { id: 'chestnut', name: 'Chestnut', color: '#c46b34' }, { id: 'honey', name: 'Honey', color: '#e3a83c' },
      { id: 'raven', name: 'Raven', color: '#3d3550' }, { id: 'rose', name: 'Rose', color: '#e2789a' },
      { id: 'mint', name: 'Mint', color: '#5cbfa0' }, { id: 'snow', name: 'Snow', color: '#ece8f2' },
    ],
    outfit: [
      { id: 'sky', name: 'Sky', color: '#7cb6e8' }, { id: 'leaf', name: 'Leaf', color: '#82c46a' },
      { id: 'berry', name: 'Berry', color: '#d9668a' }, { id: 'sun', name: 'Sun', color: '#f0b84a' },
      { id: 'lavender', name: 'Lavender', color: '#a68ee0' }, { id: 'slate', name: 'Slate', color: '#8a96a8' },
    ],
    eyes: [
      { id: 'blue', name: 'Blue', color: '#3f86cf' }, { id: 'green', name: 'Green', color: '#3fae6a' },
      { id: 'amber', name: 'Amber', color: '#d9902a' }, { id: 'violet', name: 'Violet', color: '#8a5ad6' },
    ],
    style: [
      { id: 'ponytail', name: 'Ponytail' }, { id: 'short', name: 'Short' }, { id: 'twintails', name: 'Twin tails' },
    ],
  };
  const pick = (list, id) => list.find((o) => o.id === id) || list[0];
  function normalizeAppearance(a) {
    a = a || {};
    return {
      hair: pick(APPEARANCE.hair, a.hair).id, outfit: pick(APPEARANCE.outfit, a.outfit).id,
      eyes: pick(APPEARANCE.eyes, a.eyes).id, style: pick(APPEARANCE.style, a.style).id,
    };
  }

  function isHair(n, style) {
    const [x, y, z] = n;
    if (y > 0.42) return true;
    if (z < -0.05 && y > (style === 'short' ? -0.55 : -0.8)) return true;
    if (Math.abs(x) > 0.74 && y > (style === 'short' ? -0.1 : -0.36)) return true;
    const a = Math.atan2(x, z);
    if (z >= -0.05 && y > 0.17 + 0.11 * Math.abs(Math.sin(a * 6.5))) return true;
    return false;
  }

  /* Job outfits (and NPC costumes). The player keeps their hair and eyes;
     the outfit colour and accessories come from the job. */
  const COSTUMES = {
    novice: {},
    swordsman: { outfit: '#5d84c4', pauldrons: '#c3ccd8', belt: '#4a3324' },
    mage: { outfit: '#7a59c9', robe: 'short', hat: { type: 'wizard', color: '#4b3796', band: '#e6c25a' } },
    archer: { outfit: '#5fa04a', quiver: true, hat: { type: 'headband', color: '#e6c25a' } },
    acolyte: { outfit: '#eceaf4', robe: 'long', trim: '#5c7fd1', hat: { type: 'cap', color: '#5c7fd1' } },
    thief: { outfit: '#4f4470', hat: { type: 'bandana', color: '#c0394a' }, scarf: '#c0394a' },
    merchant: { outfit: '#b47a3e', backpack: '#8a5a2c', apron: '#f2e6cc' },
    master: { outfit: '#3f5fa8', robe: 'long', trim: '#e6c25a', hat: { type: 'wizard', color: '#2e4680', band: '#e6c25a' }, beard: '#f4f2ee', skin: '#f2cfb3' },
    dealer: { outfit: '#d98a4a', apron: '#fbf3e3', hat: { type: 'cap', color: '#a0522d' }, beard: '#7a4a2a' },
    priestess: { outfit: '#f4f1fa', robe: 'long', trim: '#7fb8e8', hat: { type: 'cap', color: '#7fb8e8' } },
  };

  function makeNovice(app, look) {
    app = normalizeAppearance(app);
    look = look || {};
    const costume = COSTUMES[look.job] || COSTUMES.novice;
    const weapon = look.weapon || 'dagger';
    const hair = pick(APPEARANCE.hair, app.hair).color;
    const tunic = costume.outfit || pick(APPEARANCE.outfit, app.outfit).color;
    const iris = pick(APPEARANCE.eyes, app.eyes).color;
    const NV = {
      skin: costume.skin || '#ffdcc4', hair, hairDark: U.shade(hair, hair === '#ece8f2' ? -0.45 : -0.42), tunic, sleeve: U.shade(tunic, -0.1),
      pants: '#6e5641', boots: '#704325', belt: costume.belt || '#5a3a22', satchel: '#ab7642', iris,
    };
    const hairShades = {};
    for (let i = -5; i <= 5; i++) hairShades[i] = U.shade(NV.hair, i * 0.04);
    const HAIR_PTS = RP.fibonacciSphere(230).filter((n) => isHair(n, app.style));
    const HAIR_R = 4.3;
    const hairOutline = HAIR_PTS.map((n) => ({ n, minD: -0.12, draw(ctx) { ell(ctx, 0, 0, HAIR_R + 1.25, HAIR_R + 1.25, NV.hairDark); } }));
    const hairFill = HAIR_PTS.map((n) => ({
      n, minD: -0.12, draw(ctx, nn) {
        const k = U.clamp(Math.round(nn.up * 4 - 1 + nn.x * -1.2), -5, 5);
        ell(ctx, 0, 0, HAIR_R, HAIR_R, hairShades[k]);
      },
    }));
    const eyeOpts = { lash: true, w: 3.2, h: 4.7 };
    const faceOpen = [eyeDecal([0.36, -0.14, 0.92], NV.iris, eyeOpts), eyeDecal([-0.36, -0.14, 0.92], NV.iris, eyeOpts)];
    const faceClosed = [eyeDecal([0.36, -0.14, 0.92], null, { closed: true }), eyeDecal([-0.36, -0.14, 0.92], null, { closed: true })];
    const brow = (x) => ({ n: norm([x, 0.1, 0.92]), draw(ctx) { ctx.beginPath(); ctx.arc(0, -2.2, 3, Math.PI * 0.32, Math.PI * 0.68); ctx.strokeStyle = NV.hairDark; ctx.lineWidth = 1.1; ctx.stroke(); } });
    const faceCommon = [
      brow(0.37), brow(-0.37),
      { n: norm([0, -0.42, 0.9]), draw(ctx) { ctx.beginPath(); ctx.arc(0, 1.2, 1.9, Math.PI * 1.18, Math.PI * 1.82); ctx.strokeStyle = '#9b4a4a'; ctx.lineWidth = 1.0; ctx.stroke(); } },
      blush([0.56, -0.32, 0.76]), blush([-0.56, -0.32, 0.76]),
    ];
    const headDecalsOpen = [...hairOutline, ...hairFill, ...faceOpen, ...faceCommon];
    const headDecalsClosed = [...hairOutline, ...hairFill, ...faceClosed, ...faceCommon];

    const torsoDecals = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      torsoDecals.push({ n: norm([Math.sin(a) * 0.86, -0.5, Math.cos(a) * 0.86]), draw(ctx) { ctx.fillStyle = NV.belt; ctx.fillRect(-4.6, -1.5, 9.2, 3.0); } });
    }
    torsoDecals.push({ n: norm([0, -0.5, 0.86]), draw(ctx) { ctx.fillStyle = '#f2c94c'; ctx.fillRect(-1.6, -1.6, 3.2, 3.2); ctx.fillStyle = NV.belt; ctx.fillRect(-0.7, -0.7, 1.4, 1.4); } });
    torsoDecals.push({
      n: norm([0, 0.6, 0.8]), draw(ctx) {
        ctx.beginPath(); ctx.moveTo(-5, 2.5); ctx.lineTo(0, -3.5); ctx.lineTo(5, 2.5); ctx.lineTo(3, 3.5); ctx.lineTo(0, -0.5); ctx.lineTo(-3, 3.5); ctx.closePath();
        ctx.fillStyle = '#fbf6ec'; ctx.fill();
      },
    });
    for (const a of [-0.9, 0.9, Math.PI]) {
      torsoDecals.push({ n: norm([Math.sin(a) * 0.5, -0.86, Math.cos(a) * 0.5]), draw(ctx) { ctx.fillStyle = costume.trim || U.shade(NV.tunic, -0.18); ctx.fillRect(-6, -1, 12, 2); } });
    }
    if (costume.apron) torsoDecals.push({ n: norm([0, -0.3, 0.95]), draw(ctx) { ctx.fillStyle = costume.apron; ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(6, 6); ctx.lineTo(7.5, -10); ctx.lineTo(-7.5, -10); ctx.closePath(); ctx.fill(); } });
    if (costume.trim) torsoDecals.push({ n: norm([0, 0.1, 1]), draw(ctx) { ctx.fillStyle = costume.trim; ctx.fillRect(-1.2, -12, 2.4, 18); } });
    const metal = (c) => ({ light: '#ffffff', outline: U.shade(c, -0.55) });

    return function drawNovice(P, anim, t) {
      const C = NV;
      let bob = 0, swing = 0, liftL = 0, liftR = 0, lean = 0, handR = null, handL = null;
      let eyesClosed = false;
      if (anim === 'idle') {
        bob = Math.sin(t * TAU) * 0.7;
      } else if (anim === 'walk') {
        const ph = t * TAU;
        swing = Math.sin(ph);
        bob = (1 - Math.abs(swing)) * 1.8 - 0.3;
        liftL = Math.max(0, Math.cos(ph)) * 3.2;
        liftR = Math.max(0, -Math.cos(ph)) * 3.2;
      } else if (anim === 'attack' && weapon === 'bow') {
        // Draw the string back, release, recover.
        handL = keyframes([[0, [10, 36, 8]], [0.3, [6, 46, 16]], [0.75, [6, 46, 16]], [1, [10, 36, 8]]], t);
        handR = keyframes([[0, [-10, 36, 6]], [0.3, [2, 46, 12]], [0.55, [-4, 46, 2]], [0.62, [-8, 46, 4]], [1, [-10, 36, 6]]], t);
        lean = t > 0.55 && t < 0.75 ? -1.2 : 0;
      } else if (anim === 'attack') {
        handR = keyframes([[0, [-12.5, 32, 4]], [0.3, [-14.5, 58, -7]], [0.55, [-5, 35, 16]], [0.8, [-4, 29, 11]], [1, [-12.5, 32, 4]]], t);
        handL = [12, 34, -3];
        lean = t < 0.3 ? -t * 5 : t < 0.7 ? -1.5 + (t - 0.3) * 12 : 3.3 * (1 - (t - 0.7) / 0.3);
        bob = t > 0.45 && t < 0.8 ? -1 : 0;
      } else if (anim === 'cast') {
        // Both hands raised, gathering energy (used by skills in Stage 3).
        const k = Math.sin(t * TAU) * 0.5 + 0.5;
        handR = [-11, 50 + k * 4, 9]; handL = [11, 50 + k * 4, 9];
        bob = k * 0.8;
      } else if (anim === 'hit') {
        lean = -3.5; bob = -0.5;
        handR = [-14, 37, -3]; handL = [14, 37, -3];
        eyesClosed = true;
      } else if (anim === 'dead') {
        eyesClosed = t > 0.3;
        const e = t * t;
        P.setPose(-Math.PI / 2 * 0.96 * e, 0, [0, 23, 0], [0, -13 * e, 0]);
      } else if (anim === 'sit') {
        bob = -9; eyesClosed = false;
      }

      const hipY = 23 + bob, shY = 45 + bob, headY = 61 + bob;
      const tz = lean * 0.4, hz = 1 + lean;
      const sit = anim === 'sit';

      const footL = sit ? [6, 3, 10] : [5, 3.6 + liftL, swing * 7], footR = sit ? [-6, 3, 10] : [-5, 3.6 + liftR, -swing * 7];
      P.capsule([4.4, hipY, tz * 0.5], footL, 3.4, C.pants);
      P.capsule([-4.4, hipY, tz * 0.5], footR, 3.4, C.pants);
      P.sphere(add(footL, [0, -0.6, 1.6]), 4.4, C.boots, { sy: 0.72 });
      P.sphere(add(footR, [0, -0.6, 1.6]), 4.4, C.boots, { sy: 0.72 });

      P.sphere([0, 35 + bob, tz], 11.5, C.tunic, { sy: 1.12, decals: torsoDecals });
      if (costume.robe === 'long') P.sphere([0, 17 + bob * 0.5, tz], 12.5, C.tunic, { sy: 1.35, bias: 0.3, decals: costume.trim ? [{ n: [0, 0, 1], draw(ctx) { ctx.fillStyle = costume.trim; ctx.fillRect(-1.5, -14, 3, 28); } }] : null });
      else if (costume.robe === 'short') P.sphere([0, 22 + bob, tz], 11.2, C.tunic, { sy: 0.95, bias: 0.3 });
      if (!costume.backpack && !costume.robe) P.sphere([11.6, 25 + bob, -1 + tz], 4.4, C.satchel, { sy: 0.95 });
      if (!costume.robe) P.capsule([-7.5, 45 + bob, 6.8 + tz], [9.5, 28 + bob, 6.6 + tz], 1.05, '#7a4c2a', { bias: 0.4 });
      if (costume.pauldrons) for (const sx of [-1, 1]) P.sphere([sx * 11, 46 + bob, tz], 5.6, costume.pauldrons, Object.assign({ sy: 0.75, bias: 0.6 }, metal(costume.pauldrons)));
      if (costume.quiver) {
        P.capsule([5, 50 + bob, -11 + tz], [-5, 29 + bob, -11 + tz], 3.4, '#8a5a2c', { bias: -0.3 });
        for (const dx of [-1.5, 1.5]) P.sphere([6 + dx, 54 + bob, -12 + tz], 1.8, '#f4f4f4', { bias: -0.4 });
      }
      if (costume.backpack) {
        P.sphere([0, 38 + bob, -13 + tz], 9.5, costume.backpack, { sy: 1.1, bias: -0.2 });
        P.sphere([0, 47 + bob, -13 + tz], 6, U.shade(costume.backpack, 0.15), { sy: 0.6, bias: -0.1 });
      }
      if (costume.scarf) P.sphere([0, 47 + bob, 1 + tz], 9, costume.scarf, { sy: 0.45, bias: 0.5 });

      const shL = [10.5, shY, tz], shR = [-10.5, shY, tz];
      if (!handL && weapon === 'bow' && !sit) handL = [13, 33, 7 - swing * 2];
      handL = handL ? add(handL, [0, bob, 0]) : (sit ? [11, 27 + bob, 7] : [12.6, 31 + bob, 1.5 - swing * 6]);
      handR = handR ? add(handR, [0, bob, 0]) : (sit ? [-11, 27 + bob, 7] : [-12.6, 31 + bob, 1.5 + swing * 6]);
      P.capsule(shL, handL, 3.0, C.sleeve);
      P.capsule(shR, handR, 3.0, C.sleeve);
      P.sphere(handL, 3.2, C.skin, { bias: 0.2 });
      P.sphere(handR, 3.2, C.skin, { bias: 0.25 });

      if (!sit && !look.unarmed) {
        const kd = norm(add(sub(handR, shR), [0, 4, 9]));
        const steel = { outline: '#5f6878', light: '#ffffff' };
        if (weapon === 'dagger') {
          P.capsule(add(handR, kd, -1.6), add(handR, kd, 1.6), 1.25, '#6b4026', { bias: 0.1 });
          P.capsule(add(handR, kd, 2.6), add(handR, kd, 10.5), 1.25, '#e6edf5', Object.assign({ bias: 0.15 }, steel));
          P.capsule(add(add(handR, kd, 2.0), [1.8, 0, 0]), add(add(handR, kd, 2.0), [-1.8, 0, 0]), 0.75, '#c9a24a', { bias: 0.14 });
        } else if (weapon === 'sword') {
          P.capsule(add(handR, kd, -2), add(handR, kd, 2), 1.3, '#4a2d1a', { bias: 0.1 });
          P.capsule(add(handR, kd, 3), add(handR, kd, 20), 1.55, '#e6edf5', Object.assign({ bias: 0.15 }, steel));
          P.capsule(add(add(handR, kd, 2.4), [3, 0, 0]), add(add(handR, kd, 2.4), [-3, 0, 0]), 0.9, '#9a7a3a', { bias: 0.14 });
        } else if (weapon === 'mace') {
          P.capsule(add(handR, kd, -2), add(handR, kd, 10), 1.3, '#7a4c2a', { bias: 0.1 });
          P.sphere(add(handR, kd, 12), 3.6, '#9aa3ad', Object.assign({ bias: 0.15 }, metal('#9aa3ad')));
        } else if (weapon === 'rod') {
          const up = norm(add(kd, [0, 1.2, 0]));
          P.capsule(add(handR, up, -9), add(handR, up, 15), 1.1, '#8b5a33', { bias: 0.1 });
          P.sphere(add(handR, up, 17.5), 3.2, '#a77cf0', { bias: 0.16, light: '#efe2ff' });
        }
      }
      if (weapon === 'bow' && !sit) {
        // A curved bow in the left hand; limbs bend forward from the grip.
        const up = [0, 1, 0], fwd = [0, 0, 1];
        const g = handL;
        const pt = (u, f) => add(add(g, up, u), fwd, f);
        const limb = [pt(19, -4), pt(13, 1.5), pt(6, 2.5), g, pt(-6, 2.5), pt(-13, 1.5), pt(-19, -4)];
        const wood = { outline: '#4a2a12', light: '#d9a46a' };
        for (let i = 0; i < limb.length - 1; i++) P.capsule(limb[i], limb[i + 1], 1.7, '#a8743c', Object.assign({ bias: 0.3 }, wood));
        P.sphere(g, 2.2, '#5a3520', { bias: 0.35 });
        const pull = anim === 'attack' ? handR : pt(0, -5);
        P.capsule(limb[0], pull, 0.35, '#f4f0e0', { outline: '#bdb6a0', bias: 0.25 });
        P.capsule(pull, limb[6], 0.35, '#f4f0e0', { outline: '#bdb6a0', bias: 0.25 });
        if (anim === 'attack' && t > 0.2 && t < 0.56) P.capsule(pull, pt(0, 14), 0.5, '#e8e0c8', { outline: '#8a7a5a', bias: 0.4 });
      }

      P.sphere([0, headY + 1.6, hz - 3.2], app.style === 'short' ? 19.0 : 19.3, C.hair, { bias: -1.2, outline: C.hairDark });
      P.sphere([0, headY, hz], 18.5, C.skin, { decals: eyesClosed ? headDecalsClosed : headDecalsOpen, outline: '#a8664a' });
      const sway = anim === 'walk' ? -Math.cos(t * TAU) * 1.5 : 0;
      if (app.style === 'ponytail') {
        P.sphere([0, headY + 0.5, hz - 19], 5.2, C.hair, { outline: C.hairDark });
        P.sphere([sway * 0.6, headY - 4.5, hz - 21.8], 4.3, C.hair, { outline: C.hairDark });
        P.sphere([sway, headY - 9, hz - 22.6], 3.1, C.hair, { outline: C.hairDark });
        P.sphere([0, headY + 2.5, hz - 17.6], 2.4, '#e05a6b', { bias: 0.5 });
      } else if (app.style === 'twintails') {
        for (const sx of [-1, 1]) {
          P.sphere([sx * 17, headY + 4, hz - 6], 4.6, C.hair, { outline: C.hairDark });
          P.sphere([sx * 19 + sway * 0.4, headY - 3, hz - 8], 4.2, C.hair, { outline: C.hairDark });
          P.sphere([sx * 19.5 + sway * 0.7, headY - 10, hz - 9], 3.4, C.hair, { outline: C.hairDark });
          P.sphere([sx * 16, headY + 6.5, hz - 4.5], 2.2, '#e05a6b', { bias: 0.4 });
        }
      }
      const hat = costume.hat;
      if (!hat || hat.type === 'headband') P.capsule([0, headY + 18, hz + 1], [3.5, headY + 24, hz - 2], 1.6, C.hair, { outline: C.hairDark, bias: -0.3 });
      if (hat) {
        const hc = hat.color;
        if (hat.type === 'wizard') {
          P.sphere([0, headY + 12, hz - 1], 23, hc, { sy: 0.17, bias: 2 });
          P.sphere([0, headY + 13.5, hz - 1], 15, hat.band || hc, { sy: 0.3, bias: 2.05 });
          [[16, 12], [23, 9], [30, 6.2], [36, 3.8]].forEach(([dy, r], i) => P.sphere([i * 0.8, headY + dy, hz - 1 - i * 1.6], r, hc, { bias: 2.1 + i * 0.05 }));
        } else if (hat.type === 'cap') {
          P.sphere([0, headY + 10, hz - 1], 16.5, hc, { sy: 0.55, bias: 1.5 });
        } else if (hat.type === 'bandana') {
          P.sphere([0, headY + 8, hz - 0.5], 19.4, hc, { sy: 0.5, bias: 1.4 });
          P.capsule([0, headY + 7, hz - 19], [3 + sway, headY - 4, hz - 23], 2.2, hc, { bias: 0.2 });
        } else if (hat.type === 'headband') {
          P.sphere([0, headY + 6, hz], 19.1, hc, { sy: 0.14, bias: 1.3 });
        }
      }
      if (costume.beard) {
        [[-12, 10, 7.5], [-19, 9, 6], [-25, 7, 4.2]].forEach(([dy, dz, r]) => P.sphere([0, headY + dy, hz + dz], r, costume.beard, { bias: 0.8 }));
        P.sphere([0, headY - 6, hz + 15.5], 5, costume.beard, { sy: 0.45, sx: 1.4, bias: 0.9 });
      }
    };
  }

  /* ===================================================== PORING (original jelly slime) */
  const PR = { body: '#ff9cb8', light: '#ffe1ea', dark: '#e8678f', outline: '#b8476c' };
  function poringFace(squint) {
    return [
      eyeDecal([0.34, 0.12, 0.93], null, squint ? { squint: 1 } : { w: 2.4, h: 3.5, outer: '#2b1a24' }),
      eyeDecal([-0.34, 0.12, 0.93], null, squint ? { squint: -1 } : { w: 2.4, h: 3.5, outer: '#2b1a24' }),
      {
        n: norm([0, -0.12, 0.99]), draw(ctx) {
          ctx.beginPath(); ctx.moveTo(-2.4, 0.6); ctx.quadraticCurveTo(0, -3.2, 2.4, 0.6); ctx.closePath();
          ctx.fillStyle = '#8f2f4b'; ctx.fill();
          ell(ctx, 0, -1.4, 1.2, 0.7, '#ff7d9b');
        },
      },
      blush([0.6, -0.05, 0.8], 2.8), blush([-0.6, -0.05, 0.8], 2.8),
    ];
  }
  const PORING_FACE = poringFace(false), PORING_SQUINT = poringFace(true);

  const makePoring = (PR, leaf) => function drawJelly(P, anim, t) { drawPoringWith(P, anim, t, PR, leaf); };
  function drawPoring(P, anim, t) { drawPoringWith(P, anim, t, PR, false); }
  function drawPoringWith(P, anim, t, PR, leaf) {
    const r = 17;
    let y = 0, sx = 1, sy = 1, z = 0, squint = false, alpha = 1;
    if (anim === 'idle') {
      const s = Math.sin(t * TAU); sx = 1 + 0.045 * s; sy = 1 - 0.055 * s;
    } else if (anim === 'walk') {
      const h = Math.sin(t * Math.PI);
      y = h * 9;
      sx = 1.16 - 0.26 * h; sy = 0.84 + 0.28 * h;
    } else if (anim === 'attack') {
      if (t < 0.35) { const k = t / 0.35; sx = 1 + 0.22 * k; sy = 1 - 0.24 * k; }
      else if (t < 0.7) { const k = (t - 0.35) / 0.35; sx = 0.88; sy = 1.14; z = Math.sin(k * Math.PI) * 10; y = Math.sin(k * Math.PI) * 5; }
      else { const k = (t - 0.7) / 0.3; sx = 1 + 0.08 * (1 - k); sy = 1 - 0.08 * (1 - k); }
    } else if (anim === 'hit') {
      sx = 1.24; sy = 0.76; z = -3; squint = true;
    } else if (anim === 'die') {
      squint = true; sx = 1 + 0.85 * t; sy = 1 - 0.78 * t;
    }
    const cy = r * sy + y;
    P.capsule([0, cy + r * sy - 3, z - 2], [0, cy + r * sy + 3.5, z - 5.5], 4.4, PR.body, { outline: PR.outline, light: PR.light, bias: -0.5 });
    if (leaf) {
      P.capsule([0, cy + r * sy + 3, z - 5], [-5, cy + r * sy + 8, z - 3], 2.6, '#6fbf4a', { outline: '#2f6e1f', bias: -0.4 });
      P.capsule([0, cy + r * sy + 3, z - 5], [5, cy + r * sy + 9, z - 4], 2.6, '#7fd05a', { outline: '#2f6e1f', bias: -0.45 });
    }
    P.sphere([0, cy, z], r, PR.body, { sx, sy, light: PR.light, dark: PR.dark, outline: PR.outline, decals: squint ? PORING_SQUINT : PORING_FACE, alpha });
    P.custom([0, cy, z], (ctx, c) => {
      ctx.save(); ctx.translate(c.x - r * sx * 1.25 * 0.42, c.y - r * sy * 1.25 * 0.5); ctx.rotate(-0.6);
      ell(ctx, 0, 0, 5.5 * sx, 3 * sy, 'rgba(255,255,255,0.85)');
      ell(ctx, 7, 2.5, 1.6, 1.4, 'rgba(255,255,255,0.75)');
      ctx.restore();
    }, 0.05);
  }

  /* ===================================================== LUNATIC (original moon-bunny) */
  const LN = { fur: '#fbfbff', shadow: '#c9cbe6', outline: '#7c80aa', inner: '#ffb1c6', eye: '#e2364a' };
  function lunaticFace(squint) {
    return [
      eyeDecal([0.42, 0.08, 0.9], squint ? null : '#f04a5c', squint ? { squint: 1 } : { w: 2.3, h: 3.0, outer: '#5a1420' }),
      eyeDecal([-0.42, 0.08, 0.9], squint ? null : '#f04a5c', squint ? { squint: -1 } : { w: 2.3, h: 3.0, outer: '#5a1420' }),
      { n: norm([0, -0.1, 1]), draw(ctx) { ctx.beginPath(); ctx.moveTo(-1.4, 0.6); ctx.lineTo(1.4, 0.6); ctx.lineTo(0, -0.9); ctx.closePath(); ctx.fillStyle = '#ff7f9d'; ctx.fill(); } },
      {
        n: norm([0, -0.34, 0.94]), draw(ctx) {
          ctx.beginPath(); ctx.arc(-1.1, 0.6, 1.1, Math.PI * 1.1, Math.PI * 1.95); ctx.arc(1.1, 0.6, 1.1, Math.PI * 1.05, Math.PI * 1.9);
          ctx.strokeStyle = '#8a4a5e'; ctx.lineWidth = 0.8; ctx.stroke();
        },
      },
      blush([0.62, -0.22, 0.75], 2.4), blush([-0.62, -0.22, 0.75], 2.4),
    ];
  }
  const LUNA_FACE = lunaticFace(false), LUNA_SQUINT = lunaticFace(true);

  function drawLunatic(P, anim, t) {
    let y = 0, z = 0, sx = 1, sy = 1, ear = 0, earBack = 0, squint = false;
    if (anim === 'idle') {
      ear = Math.sin(t * TAU) * 1.4; sy = 1 + Math.sin(t * TAU) * 0.02;
    } else if (anim === 'walk') {
      const h = Math.sin(t * Math.PI);
      y = h * 8; earBack = h * 5; sx = 1.08 - 0.12 * h; sy = 0.92 + 0.14 * h;
    } else if (anim === 'attack') {
      if (t < 0.35) { sy = 1 - t * 0.4; earBack = -2; }
      else if (t < 0.7) { const k = Math.sin(((t - 0.35) / 0.35) * Math.PI); z = k * 11; y = k * 4; earBack = k * 6; }
    } else if (anim === 'hit') {
      z = -3; sx = 1.12; sy = 0.88; squint = true; earBack = -3;
    } else if (anim === 'die') {
      squint = true;
      const e = Math.min(1, t * 1.4);
      P.setPose(0, -Math.PI / 2 * 0.92 * e * e, [0, 12, 0], [0, -1.5 * e, 0]);
    }
    const by = 12 * sy + y;
    // hind feet, tail, body
    P.sphere([7.5, 2.8 + y * 0.35, -3 + z], 4.6, LN.fur, { sy: 0.65, dark: LN.shadow, outline: LN.outline });
    P.sphere([-7.5, 2.8 + y * 0.35, -3 + z], 4.6, LN.fur, { sy: 0.65, dark: LN.shadow, outline: LN.outline });
    P.sphere([0, by, -1 + z], 12.5, LN.fur, { sx, sy: sy * 0.96, dark: LN.shadow, outline: LN.outline });
    P.sphere([0, by + 1, -13.5 + z], 4.6, LN.fur, { dark: LN.shadow, outline: LN.outline });
    P.sphere([5, 3 + y * 0.5, 8 + z], 3.1, LN.fur, { sy: 0.8, dark: LN.shadow, outline: LN.outline, bias: 0.3 });
    P.sphere([-5, 3 + y * 0.5, 8 + z], 3.1, LN.fur, { sy: 0.8, dark: LN.shadow, outline: LN.outline, bias: 0.3 });
    // head and ears
    const hy = by + 15, hz = 4 + z;
    P.sphere([0, hy, hz], 11, LN.fur, { dark: LN.shadow, outline: LN.outline, decals: squint ? LUNA_SQUINT : LUNA_FACE, bias: 0.5 });
    for (const s of [1, -1]) {
      const base = [s * 4.4, hy + 8, hz - 2];
      const tip = [s * (7 + ear * (s > 0 ? 1 : -0.6)), hy + 30 - Math.abs(earBack) * 0.4, hz - 6 - earBack];
      P.capsule(base, tip, 3.7, LN.fur, { outline: LN.outline, light: '#ffffff', bias: 0.1 });
      P.capsule(add(base, [0, 2, 1.3]), add(tip, [0, -2.5, 1.2]), 1.55, LN.inner, { outline: LN.inner, light: '#ffd4e0', bias: 0.12 });
    }
  }


  /* ===================================================== FABRE (caterpillar) */
  const FB = { body: '#8fd14f', alt: '#b4e46e', outline: '#3f7a1f', head: '#9cdb5a' };
  const FABRE_FACE = [
    eyeDecal([0.4, 0.15, 0.9], null, { w: 2.2, h: 3.0, outer: '#203018' }), eyeDecal([-0.4, 0.15, 0.9], null, { w: 2.2, h: 3.0, outer: '#203018' }),
    { n: norm([0, -0.3, 0.95]), draw(ctx) { ctx.beginPath(); ctx.arc(0, 1, 2, Math.PI * 1.15, Math.PI * 1.85); ctx.strokeStyle = '#2b4a18'; ctx.lineWidth = 1; ctx.stroke(); } },
    blush([0.62, -0.15, 0.78], 2.2), blush([-0.62, -0.15, 0.78], 2.2),
  ];
  function drawFabre(P, anim, t) {
    let lunge = 0, squash = 1, wave = 0;
    if (anim === 'walk') wave = t * TAU;
    else if (anim === 'idle') wave = t * TAU * 0.5;
    else if (anim === 'attack') lunge = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 8;
    else if (anim === 'hit') squash = 0.75;
    else if (anim === 'die') { squash = 1 - t * 0.7; P.setPose(0, -t * 0.4, [0, 6, 0], [0, 0, 0]); }
    const segs = [[0, 7.5], [-6.5, 7], [-12.5, 6.2], [-17.5, 5]];
    segs.slice().reverse().forEach(([z, r], i) => {
      const k = segs.length - 1 - i, amp = anim === 'walk' ? 2.2 : 0.6;
      const y = r * squash + Math.max(0, Math.sin(wave + k * 1.4)) * amp;
      P.sphere([0, y, z + lunge * (1 - k * 0.25)], r, k % 2 ? FB.alt : FB.body, { sy: squash, outline: FB.outline });
      for (const sx of [-1, 1]) P.sphere([sx * r * 0.7, 1.6, z + lunge * (1 - k * 0.25)], 1.6, '#5a8f2f', { bias: -0.2, outline: FB.outline });
    });
    const hy = 9 * squash + (anim === 'walk' ? Math.max(0, Math.sin(wave - 1.4)) * 2 : 0), hz = 7 + lunge;
    P.sphere([0, hy, hz], 8.2, FB.head, { sy: squash, decals: FABRE_FACE, outline: FB.outline, bias: 0.5 });
    for (const sx of [-1, 1]) {
      P.capsule([sx * 3, hy + 6, hz - 1], [sx * 6, hy + 13, hz - 3], 0.8, '#3f7a1f', { bias: 0.3 });
      P.sphere([sx * 6, hy + 13.5, hz - 3], 2, '#ffd84a', { bias: 0.35 });
    }
  }

  /* ===================================================== PUPA (cocoon) */
  const PUPA_BANDS = [];
  for (let i = -2; i <= 2; i++) for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * TAU, y = i * 0.32;
    const r = Math.sqrt(1 - y * y);
    PUPA_BANDS.push({ n: norm([Math.sin(ang) * r, y, Math.cos(ang) * r]), minD: -0.1, draw(ctx) { ctx.fillStyle = 'rgba(120,90,40,0.55)'; ctx.fillRect(-4.6, -0.7, 9.2, 1.4); } });
  }
  function drawPupa(P, anim, t) {
    let rz = Math.sin(t * TAU) * 0.08, sy = 1.45;
    if (anim === 'hit') rz = 0.25 * (t < 0.5 ? 1 : -1);
    if (anim === 'die') { sy = 1.45 - t * 0.9; rz = t * 0.6; }
    P.setPose(0, rz, [0, 0, 0], [0, 0, 0]);
    P.sphere([0, 11 * sy, 0], 11, '#dcc58f', { sx: 0.85, sy, decals: PUPA_BANDS, outline: '#7a5a28', light: '#fff2cc' });
    P.capsule([0, 22 * sy, -1], [1.5, 22 * sy + 6, -2], 1.8, '#c9ae6e', { outline: '#7a5a28' });
  }

  /* ===================================================== ROCKER (grasshopper) */
  const RK = { body: '#7fbf3f', dark: '#4f8f26', outline: '#2f5e14', belly: '#d9ec9a' };
  const ROCKER_FACE = [
    eyeDecal([0.45, 0.2, 0.87], '#3a2a10', { w: 3.4, h: 3.8, outer: '#101808' }), eyeDecal([-0.45, 0.2, 0.87], '#3a2a10', { w: 3.4, h: 3.8, outer: '#101808' }),
    { n: norm([0, -0.35, 0.93]), draw(ctx) { ctx.beginPath(); ctx.moveTo(-2, 0.5); ctx.lineTo(2, 0.5); ctx.strokeStyle = '#2b4a18'; ctx.lineWidth = 1.1; ctx.stroke(); } },
  ];
  function drawRocker(P, anim, t) {
    let y = 0, kick = 0, crouch = 0;
    if (anim === 'walk') { const hop = Math.sin(t * Math.PI); y = hop * 9; crouch = 1 - hop; }
    else if (anim === 'idle') crouch = 0.3 + Math.sin(t * TAU) * 0.15;
    else if (anim === 'attack') kick = Math.sin(Math.min(1, t * 1.5) * Math.PI);
    else if (anim === 'hit') crouch = 1;
    else if (anim === 'die') P.setPose(0, -Math.PI / 2 * 0.9 * t, [0, 10, 0], [0, -2 * t, 0]);
    const by = 16 + y - crouch * 3;
    P.sphere([0, by, -1], 8.5, RK.body, { sy: 1.25, outline: RK.outline, decals: [{ n: [0, 0, 1], draw(ctx) { ctx.fillStyle = RK.belly; ctx.beginPath(); ctx.ellipse(0, -1, 4.5, 7, 0, 0, TAU); ctx.fill(); } }] });
    P.sphere([0, by + 2, -7], 6, RK.dark, { sx: 0.8, sy: 1.4, bias: -0.5, outline: RK.outline });   // folded wings
    const hy = by + 13, hz = 2 + kick * 5;
    P.sphere([0, hy, hz], 8, RK.body, { decals: ROCKER_FACE, outline: RK.outline, bias: 0.5 });
    for (const sx of [-1, 1]) {
      P.capsule([sx * 3, hy + 6, hz - 2], [sx * 9, hy + 17, hz - 9], 0.7, RK.dark, { bias: 0.2 });
      // big folded back legs
      const hip = [sx * 6, by - 3, -3], knee = [sx * 9, by + 6 - crouch * 2, -11], foot = [sx * 7, y * 0.2 + 1.5, -5 + kick * 6];
      P.capsule(hip, knee, 2.6, RK.body, { outline: RK.outline, bias: -0.2 });
      P.capsule(knee, foot, 1.8, RK.dark, { outline: RK.outline, bias: -0.15 });
      P.capsule([sx * 4, by + 3, 5], [sx * 5, by - 4 + kick * 3, 8 + kick * 4], 1.3, RK.dark, { bias: 0.4 });
    }
  }

  /* ===================================================== registry */
  const DEFS = {
    poring: {
      frameW: 112, frameH: 112, originX: 56, originY: 104, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 5 },
        { name: 'walk', frames: 6, fps: 9 },
        { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false },
        { name: 'die', frames: 5, fps: 10, loop: false },
      ],
      draw: drawPoring,
    },
    lunatic: {
      frameW: 144, frameH: 144, originX: 72, originY: 134, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 4 },
        { name: 'walk', frames: 6, fps: 10 },
        { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false },
        { name: 'die', frames: 5, fps: 9, loop: false },
      ],
      draw: drawLunatic,
    },
    drops: {
      frameW: 112, frameH: 112, originX: 56, originY: 104, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 5 }, { name: 'walk', frames: 6, fps: 9 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 10, loop: false },
      ],
      draw: makePoring({ body: '#ffb35c', light: '#ffe6c0', dark: '#f08a2c', outline: '#b35a10' }, false),
    },
    poporing: {
      frameW: 112, frameH: 120, originX: 56, originY: 112, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 5 }, { name: 'walk', frames: 6, fps: 9 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 10, loop: false },
      ],
      draw: makePoring({ body: '#93d66c', light: '#e4ffd2', dark: '#5aa83f', outline: '#2f6e1f' }, true),
    },
    fabre: {
      frameW: 128, frameH: 104, originX: 64, originY: 96, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 4 }, { name: 'walk', frames: 6, fps: 9 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 10, loop: false },
      ],
      draw: drawFabre,
    },
    pupa: {
      frameW: 96, frameH: 112, originX: 48, originY: 104, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 3 }, { name: 'walk', frames: 4, fps: 3 }, { name: 'attack', frames: 2, fps: 4, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 9, loop: false },
      ],
      draw: drawPupa,
    },
    rocker: {
      frameW: 128, frameH: 136, originX: 64, originY: 126, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 4 }, { name: 'walk', frames: 6, fps: 9 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 9, loop: false },
      ],
      draw: drawRocker,
    },
  };

  const NOVICE_ANIMS = [
    { name: 'idle', frames: 4, fps: 4 },
    { name: 'walk', frames: 8, fps: 12 },
    { name: 'attack', frames: 6, fps: 12, loop: false },
    { name: 'cast', frames: 4, fps: 8 },
    { name: 'hit', frames: 2, fps: 8, loop: false },
    { name: 'dead', frames: 4, fps: 8, loop: false },
    { name: 'sit', frames: 1, fps: 1 },
  ];
  const noviceDef = (app, look) => ({ frameW: 160, frameH: 176, originX: 80, originY: 166, scale: 1.25, anims: NOVICE_ANIMS, draw: makeNovice(app, look) });

  const cache = {};
  G.SpriteFactory = {
    get(name) {
      if (name === 'novice') return G.SpriteFactory.novice({});
      if (!cache[name]) cache[name] = RP.buildSheet(DEFS[name]);
      return cache[name];
    },
    // Sprite sheet for a player character with the given appearance.
    novice(app) { return G.SpriteFactory.humanoid(app, { job: 'novice', weapon: 'dagger' }); },
    // Sheet for any human character: appearance + job outfit + weapon in hand.
    humanoid(app, look) {
      app = normalizeAppearance(app);
      look = Object.assign({ job: 'novice', weapon: 'dagger' }, look || {});
      const key = ['h', app.hair, app.outfit, app.eyes, app.style, look.job, look.weapon, look.unarmed ? 'u' : ''].join(':');
      if (!cache[key]) cache[key] = RP.buildSheet(noviceDef(app, look));
      return cache[key];
    },
    // Draw function for live previews (character creation).
    noviceDraw(app, look) { return makeNovice(app, look); },
    COSTUMES,
    APPEARANCE, normalizeAppearance,
    names: Object.keys(DEFS),
  };
})(window.G = window.G || {});
