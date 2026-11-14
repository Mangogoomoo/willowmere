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
      { id: 'spiky', name: 'Spiky' }, { id: 'swept', name: 'Swept' }, { id: 'messy', name: 'Messy' }, { id: 'slick', name: 'Slick' }, { id: 'buzz', name: 'Buzz cut' },
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

  /* Job outfits (and NPC and monster costumes), designed from scratch for the
     new figure. The player keeps their hair and eyes; everything they wear
     comes from the job. Each outfit is a short description put together from
     a wardrobe of parts:

       main, under        colours of the main garment and the shirt beneath it
       torso              'shirt' | 'coat' (open front) | 'closed' (buttoned) | 'wrap' (crossed, like a gi)
                          | 'plate' (breastplate) | 'crop' (bare midriff) | 'bare' (bare chest, strap and apron)
       vest               a leather jerkin over the main garment
       skirt              { to, flare, color, hem, open }  the lower garment: `to` is how low it hangs
                          (6 ankles .. 24 thighs); `open` = a coat split at the front
       underSkirt         a closed robe worn beneath an open coat
       legs               'pants' | 'shorts' | 'tights' | 'bare'  (+ pants, tights, stripes colours)
       boots, bootTall, greaves, barefoot
       sleeves            'long' | 'short' | 'none' | 'wide' | 'puff'  (+ sleeveCol, cuffs, gloves, bracers, wraps, armArmor)
       pauldrons, fur, mantle, cape, collar, scarf, stole, tabard, tassets, sash, belt
       quiver, backpack, shield, satchel, pouch, bottles, beads, mask, goggles, glasses, beard, skin
       hat                { type, color, ... }  see the hat shells in makeNovice */
  const GOLD = '#f0c040', STEEL = '#c9d2de', LINEN = '#f6efe0';
  const COSTUMES = {
    // Novice: a traveller's waistcoat (in the colour the player chose) over a linen shirt, with a red kerchief.
    novice: { torso: 'coat', sleeveCol: LINEN, cuffs: '#e2d6bd', pants: '#7a6450', boots: '#7a4e2c', scarf: { color: '#d9534f' }, satchel: true },

    // First jobs.
    swordsman: { main: '#b23a48', torso: 'plate', plate: STEEL, plateTrim: '#8791a6', sleeveCol: '#8f2c3a', bracers: STEEL, pauldrons: { color: STEEL, side: 1, r: 5.8, trim: '#8791a6' },
      tabard: { color: '#b23a48', trim: LINEN }, pants: '#4a3a36', boots: '#5a4030', bootTall: true, belt: '#4a3324', hat: { type: 'headband', color: '#b23a48' } },
    mage: { main: '#3f3d91', torso: 'closed', trim: GOLD, skirt: { to: 20, flare: 12.6, hem: GOLD }, sleeves: 'wide', cuffs: GOLD, mantle: { color: '#2b2a68', trim: GOLD },
      legs: 'tights', tights: LINEN, stripes: '#7c6fd6', boots: '#2b2a68', hat: { type: 'wizard', color: '#2b2a68', band: GOLD } },
    archer: { main: '#6aa84f', vest: '#7a5234', sleeves: 'short', bracers: '#7a5234', bracersMat: 'leather', legs: 'shorts', pants: '#7a5234', boots: '#6b4428', bootTall: true,
      quiver: true, scarf: { color: '#f4d35e' }, hat: { type: 'feather', color: '#4e8a3a', feather: '#f4d35e' } },
    acolyte: { main: '#f6f3ee', torso: 'closed', trim: '#6c9bd8', skirt: { to: 14, flare: 11, hem: '#6c9bd8' }, stole: '#6c9bd8', sleeves: 'wide', cuffs: '#6c9bd8',
      mantle: { color: '#f6f3ee', trim: GOLD }, boots: '#7a5a44', emblem: GOLD, hat: { type: 'veil', color: '#f6f3ee', band: '#6c9bd8' } },
    thief: { main: '#3e4a5c', torso: 'wrap', trim: '#252d3a', sleeves: 'none', wraps: '#d8cdb8', scarf: { color: '#d1483e', tails: 2, long: true }, sash: { color: '#d1483e' },
      pants: '#565046', boots: '#2f2a2a', pouch: true, hat: { type: 'bandana', color: '#252d3a' } },
    merchant: { main: '#d9a441', torso: 'coat', trim: '#8a5a2c', fur: '#f2e6cc', skirt: { to: 21, flare: 10.8, open: true }, cuffs: '#f2e6cc', pants: '#6b4a36', boots: '#5a3a22',
      backpack: { color: '#8a5a2c', roll: '#c0563e' }, pouch: true, hat: { type: 'flatcap', color: '#8a5a2c' } },

    // Second jobs.
    knight: { main: '#2f4f9e', torso: 'plate', plate: '#b9c6da', plateTrim: GOLD, armArmor: '#b9c6da', pauldrons: { color: '#b9c6da', r: 5.5, trim: GOLD }, tassets: '#b9c6da',
      greaves: '#b9c6da', cape: { color: '#2f4f9e', to: 12, lining: GOLD }, pants: '#26386e', belt: '#26386e', hat: { type: 'wings', color: GOLD } },
    crusader: { main: '#f4efe4', torso: 'plate', plate: '#f4efe4', plateTrim: GOLD, armArmor: '#e8e2d2', tabard: { color: '#f4efe4', trim: GOLD, emblem: '#c0394a' }, pauldrons: { color: GOLD, r: 5.6 },
      greaves: '#e8e2d2', cape: { color: '#c0394a', to: 12, lining: '#f4efe4' }, shield: '#e8e2d2', pants: '#8a8478', hat: { type: 'helm', color: '#f4efe4', plume: '#c0394a' } },
    wizard: { main: '#5b2d8e', torso: 'closed', trim: GOLD, skirt: { to: 7, flare: 11.6, hem: GOLD }, sleeves: 'wide', cuffs: GOLD, collar: '#34195c', mantle: { color: '#34195c', trim: GOLD },
      cape: { color: '#34195c', to: 10, lining: '#8a3ab8' }, boots: '#34195c', hat: { type: 'wizard', color: '#34195c', band: GOLD, tall: true } },
    sage: { main: '#2f7f7a', torso: 'coat', under: '#f2e9d6', trim: GOLD, skirt: { to: 10, flare: 11.2, open: true, hem: GOLD }, underSkirt: { to: 7.5, flare: 9.8, color: '#f2e9d6' },
      sleeves: 'wide', cuffs: GOLD, glasses: true, boots: '#5a4030', hat: { type: 'hood', color: '#256560' } },
    hunter: { main: '#4a6b3a', vest: '#6b4a2c', fur: '#c9b08a', cape: { color: '#3a5a30', to: 22, lining: '#2c4526' }, bracers: '#6b4a2c', bracersMat: 'leather', pants: '#5a4632',
      boots: '#4a3424', bootTall: true, quiver: true, hat: { type: 'hood', color: '#3a5a30' } },
    bard: { main: '#a8324a', torso: 'closed', trim: GOLD, sleeves: 'puff', sleeveCol: LINEN, cuffs: '#a8324a', skirt: { to: 24, flare: 10.2, hem: GOLD }, cape: { color: '#2c3e7a', to: 27, lining: GOLD, side: 3.5 },
      legs: 'tights', tights: LINEN, stripes: '#a8324a', boots: '#4a2a22', hat: { type: 'cavalier', color: '#2c3e7a', feather: LINEN, band: GOLD } },
    dancer: { main: '#e0567f', torso: 'crop', trim: GOLD, sleeves: 'none', bracers: GOLD, skirt: { to: 9, flare: 11.6, open: true, hem: GOLD }, sash: { color: '#7b4fc9', both: true },
      legs: 'bare', boots: GOLD, sandals: true, hat: { type: 'tiara', color: GOLD, veil: '#f7a8c4' } },
    priest: { main: '#f7f4ee', torso: 'closed', trim: GOLD, skirt: { to: 6.5, flare: 11.4, hem: GOLD }, stole: '#d9b24a', mantle: { color: '#3f5fc0', trim: GOLD }, sleeves: 'wide', cuffs: GOLD,
      emblem: '#3f5fc0', boots: '#7a5a44', hat: { type: 'mitre', color: '#f7f4ee', band: GOLD } },
    monk: { main: '#d9772e', torso: 'wrap', trim: '#3a2a1a', sleeves: 'none', wraps: '#efe4cf', beads: '#7a3a2a', sash: { color: '#2e2a2a' }, skirt: { to: 23, flare: 10 }, pants: '#efe4cf',
      barefoot: true, hat: { type: 'headband', color: '#2e2a2a' } },
    assassin: { main: '#3a2d52', torso: 'wrap', trim: '#7a58b0', sleeves: 'none', bracers: '#8a8fa0', pauldrons: { color: '#55407a', side: -1, r: 4.8 }, mask: '#2a2040',
      scarf: { color: '#c0394a', tails: 2, long: true }, sash: { color: '#c0394a' }, tabard: { color: '#55407a', trim: '#7a58b0', short: true }, pants: '#2a2040', boots: '#221a33', bootTall: true,
      hat: { type: 'bandana', color: '#2a2040' } },
    rogue: { main: '#7a3e3a', torso: 'coat', under: '#e9dfc8', trim: '#3a2622', skirt: { to: 16, flare: 11, open: true }, fur: '#b89a78', cuffs: '#3a2622', scarf: { color: '#3f6a5a', tails: 1 },
      pants: '#3d3a3a', boots: '#2a2222', bootTall: true, pouch: true, hat: { type: 'bandana', color: '#3f6a5a' } },
    blacksmith: { main: '#8a5a36', torso: 'bare', apron: '#5a3a26', sleeves: 'none', gloves: '#6b4a2c', goggles: '#c9a24a', pants: '#5a5560', boots: '#3a2e2a', bootTall: true,
      sash: { color: '#c0394a' }, hat: { type: 'bandana', color: '#c0394a' } },
    alchemist: { main: '#f2efe6', torso: 'coat', under: '#3a8a8a', trim: '#3a8a8a', skirt: { to: 12, flare: 10.8, open: true, hem: '#3a8a8a' }, cuffs: '#3a8a8a', gloves: '#5a3a22', glasses: true,
      bottles: true, backpack: { color: '#6b4a2c', flask: '#7fe0c0' }, pants: '#4a4a5a', boots: '#3a3038' },

    // Monsters built on the character painter.
    orc_zombie: { main: '#5a4a3a', torso: 'wrap', trim: '#3a2a1a', sleeves: 'none', skirt: { to: 22, flare: 10 }, belt: '#3a2a1a', barefoot: true },
    orc_skeleton: { main: '#4a4038', sleeves: 'none', pauldrons: { color: '#9aa3ad' }, hat: { type: 'helm', color: '#7a7a6a', plume: '#6a2a2a' } },
    zenorc: { main: '#6a3a2a', torso: 'wrap', trim: '#2a1a10', sleeves: 'none', wraps: '#2a1a10', belt: '#2a1a10', hat: { type: 'bandana', color: '#c0394a' } },
    orc_lord: { main: '#7a5a2a', torso: 'plate', plate: '#c9a24a', plateTrim: '#8a6a1a', pauldrons: { color: '#c9a24a', r: 6 }, tassets: '#c9a24a', cape: { color: '#8a1a1a', to: 13 }, hat: { type: 'helm', color: '#c9a24a', plume: '#c0394a' } },
    raydric: { main: '#2a2a3a', torso: 'plate', plate: '#4a4a5a', plateTrim: '#2a2a34', armArmor: '#4a4a5a', pauldrons: { color: '#5a5a6a', r: 5.8 }, greaves: '#4a4a5a', cape: { color: '#3a1a2a', to: 12 }, hat: { type: 'helm', color: '#3a3a4a', plume: '#5a2a3a' } },
    evil_druid: { main: '#2f4a2f', torso: 'closed', skirt: { to: 7, flare: 11 }, sleeves: 'wide', beads: '#6a6a4a', hat: { type: 'hood', color: '#1f3a1f' } },
    khalitzburg: { main: '#3a3a40', torso: 'plate', plate: '#9aa3ad', plateTrim: '#6a737d', armArmor: '#9aa3ad', pauldrons: { color: '#cfd8e6', r: 5.8 }, greaves: '#9aa3ad', hat: { type: 'helm', color: '#9aa3ad', plume: '#2a2a2a' } },
    abysmal_knight: { main: '#141420', torso: 'plate', plate: '#2a2a3a', plateTrim: '#6a0a1a', armArmor: '#2a2a3a', pauldrons: { color: '#3a3a4a', r: 6.2 }, tassets: '#2a2a3a', greaves: '#2a2a3a', cape: { color: '#6a0a1a', to: 11 }, hat: { type: 'helm', color: '#1a1a24', plume: '#8a0a1a' } },
    bloody_knight: { main: '#3a0a14', torso: 'plate', plate: '#8a1a2a', plateTrim: '#3a0a14', armArmor: '#8a1a2a', pauldrons: { color: '#a8283a', r: 6.2 }, tassets: '#8a1a2a', greaves: '#8a1a2a', cape: { color: '#1a0a0a', to: 11 }, hat: { type: 'helm', color: '#7a1a2a', plume: '#1a0a0a' } },
    dark_lord: { main: '#1a1424', torso: 'closed', trim: '#c9a24a', skirt: { to: 6.5, flare: 11.6, hem: '#c9a24a' }, sleeves: 'wide', collar: '#2a1a3a', cape: { color: '#3a0a2a', to: 9 } },
    lord_of_death: { main: '#0e0e16', torso: 'closed', skirt: { to: 6.5, flare: 11.6 }, sleeves: 'wide', cape: { color: '#1a1a24', to: 9 }, mask: '#000000', hat: { type: 'hood', color: '#0a0a12' } },
    giearth: { main: '#7a5a3a', skirt: { to: 22, flare: 10.4 }, belt: '#3a2a1a', hat: { type: 'wizard', color: '#5a4630', band: '#c9a24a' }, beard: '#efe6d2' },

    // Townsfolk.
    master: { main: '#3f5fa8', torso: 'closed', trim: GOLD, skirt: { to: 7, flare: 11.4, hem: GOLD }, sleeves: 'wide', cuffs: GOLD, mantle: { color: '#2e4680', trim: GOLD }, hat: { type: 'wizard', color: '#2e4680', band: GOLD }, beard: '#f4f2ee', skin: '#f2cfb3' },
    dealer: { main: '#d98a4a', apron: '#fbf3e3', sleeves: 'short', pants: '#6b4a36', hat: { type: 'flatcap', color: '#a0522d' }, beard: '#7a4a2a' },
    priestess: { main: '#f4f1fa', torso: 'closed', trim: '#7fb8e8', skirt: { to: 7, flare: 11, hem: '#7fb8e8' }, stole: '#7fb8e8', sleeves: 'wide', hat: { type: 'veil', color: '#f4f1fa', band: '#7fb8e8' } },
    smith: { main: '#5a4a44', torso: 'bare', apron: '#8a5a36', sleeves: 'none', gloves: '#4a3a30', pauldrons: { color: '#9aa3ad', side: 1 }, pants: '#4a4248', beard: '#2d2433' },
    tailor: { main: '#c96a9a', torso: 'closed', trim: LINEN, skirt: { to: 18, flare: 12, hem: LINEN }, sleeves: 'puff', legs: 'tights', tights: LINEN, hat: { type: 'cap', color: '#7a3a5a' } },
    clerk: { main: '#3f8a9a', torso: 'coat', trim: '#f2e6cc', cuffs: '#f2e6cc', pants: '#3a4a5a', hat: { type: 'headband', color: '#f2e6cc' } },
    inn: { main: '#a8743c', apron: '#fbf3e3', sleeves: 'short', skirt: { to: 15, flare: 11.4 } },
    scholar: { main: '#6a7ac9', torso: 'coat', under: LINEN, trim: GOLD, skirt: { to: 8, flare: 11, open: true, hem: GOLD }, underSkirt: { to: 7, flare: 9.6, color: LINEN }, sleeves: 'wide', hat: { type: 'wizard', color: '#4a5aa8', band: GOLD } },
    captain: { main: '#8a3a3a', torso: 'plate', plate: '#c9b27a', plateTrim: '#8a7440', pauldrons: { color: '#c9b27a', r: 5.6 }, tabard: { color: '#8a3a3a', trim: GOLD }, scarf: { color: GOLD }, bootTall: true, boots: '#4a3020' },
  };

  /* ---- the human figure ----
     About three heads tall: slim limbs built from tapered capsules, a torso
     whose belts, collars, plates and trims are painted straight onto its
     surface, and a head whose hairline is painted the same way. Hats and
     headgear are fitted shells around the head (see `shell` below), so they
     hug it from every angle instead of floating on top. */
  const HIP = 30, SH = 50, HEADY = 67, HR = 14.5, HSX = 1.04, HSY = 0.98;
  const SHORTISH = ['short', 'spiky', 'swept', 'messy', 'slick', 'buzz'];
  // Is this spot on the head covered by hair? (x right, y up, z toward the face; unit sphere)
  function isHair(x, y, z, style) {
    if (style === 'buzz') return y > 0.52 - (z < 0 ? 0.75 : 0) || (z < 0.1 && y > -0.18 && Math.abs(x) > 0.5 && y > 0.2);
    const a = Math.atan2(x, z);
    if (y > 0.5) return true;
    if (style === 'slick') {
      if (z < -0.02 && y > -0.5) return true;
      if (Math.abs(x) > 0.8 && y > -0.05) return true;
      return z >= -0.02 && y > 0.4 + 0.05 * Math.cos(a * 2);
    }
    const short = SHORTISH.includes(style);
    if (z < -0.05 && y > (short ? -0.58 : -0.86)) return true;                 // back of the head
    if (Math.abs(x) > 0.8 && z < 0.28 && y > (short ? 0.0 : -0.5) - (Math.abs(x) - 0.8) * 0.5) return true;   // side locks
    if (z < 0) return false;
    if (style === 'swept') return y > 0.1 + 0.34 * (0.5 - x * 0.62) + 0.05 * Math.abs(Math.sin(a * 5));
    if (style === 'spiky' || style === 'messy') return y > 0.2 + 0.17 * Math.abs(Math.sin(a * 4.2 + (style === 'messy' ? 0.6 : 0)));
    return y > 0.23 + 0.13 * Math.abs(Math.sin(a * 5.5));                       // a zig-zag fringe
  }

  function makeNovice(app, look) {
    app = normalizeAppearance(app);
    look = look || {};
    const O = COSTUMES[look.job] || COSTUMES.novice, costume = O;
    const weapon = look.weapon || 'dagger';
    const hair = pick(APPEARANCE.hair, app.hair).color;
    const tunic = O.main || pick(APPEARANCE.outfit, app.outfit).color;
    const iris = pick(APPEARANCE.eyes, app.eyes).color;
    const NV = {
      skin: look.skin || O.skin || '#ffdcc4', hair, hairDark: U.shade(hair, -0.42), tunic, sleeve: O.sleeveCol || U.shade(tunic, -0.08), under: O.under || LINEN,
      pants: O.pants || '#5f4c40', boots: O.greaves || O.boots || '#6b4428', belt: (O.sash && O.sash.color) || O.belt || '#5a3a22', satchel: '#ab7642', iris,
    };
    const skirt = O.skirt || null;
    const longSkirt = !!(skirt && skirt.to <= 9 && !skirt.open) || !!O.underSkirt;       // hides the legs
    const style = app.style;
    const head = look.head || {};
    // An equipped upper headgear replaces the job's hat.
    const hat = head.top ? null : O.hat;
    const gold = GOLD;

    /* ---- face ---- */
    function eye(x, closed) {
      const w = 2.55, h = 3.9;
      return {
        n: norm([x, -0.17, 0.9]), draw(ctx) {
          if (closed) {
            ctx.beginPath(); ctx.moveTo(-w, 0.4); ctx.quadraticCurveTo(0, -1.6, w, 0.4);
            ctx.strokeStyle = '#3a2430'; ctx.lineWidth = 0.95; ctx.lineCap = 'round'; ctx.stroke(); return;
          }
          ell(ctx, 0, 0, w, h, '#33202c');
          const g = ctx.createLinearGradient(0, h, 0, -h);
          g.addColorStop(0, U.shade(iris, -0.5)); g.addColorStop(0.45, iris); g.addColorStop(1, U.shade(iris, 0.45));
          ell(ctx, 0, -0.25, w * 0.8, h * 0.82, g);
          ell(ctx, 0, 0.3, w * 0.4, h * 0.42, '#1a1830');
          ell(ctx, 0, -h * 0.55, w * 0.5, h * 0.16, U.shade(iris, 0.7));
          ell(ctx, -w * 0.34, h * 0.42, w * 0.36, w * 0.4, '#ffffff');
          ell(ctx, w * 0.36, -h * 0.3, w * 0.17, w * 0.17, '#ffffff');
          // upper lash
          ctx.beginPath(); ctx.moveTo(-w * 1.2, h * 0.3); ctx.quadraticCurveTo(-w * 0.5, h * 1.12, w * 0.4, h * 1.02); ctx.quadraticCurveTo(w * 1.05, h * 0.8, w * 1.25, h * 0.38);
          ctx.strokeStyle = '#2a1a24'; ctx.lineWidth = 0.95; ctx.lineCap = 'round'; ctx.stroke();
        },
      };
    }
    const brow = (x) => ({ n: norm([x, 0.13, 0.92]), draw(ctx) { ctx.beginPath(); ctx.moveTo(-2.2, -0.3); ctx.quadraticCurveTo(0, 0.7, 2.2, -0.1); ctx.strokeStyle = NV.hairDark; ctx.lineWidth = 0.8; ctx.lineCap = 'round'; ctx.stroke(); } });
    const mouth = { n: norm([0, -0.5, 0.87]), draw(ctx) { ctx.beginPath(); ctx.moveTo(-1.3, 0.3); ctx.quadraticCurveTo(0, -0.7, 1.3, 0.3); ctx.strokeStyle = '#a04a4a'; ctx.lineWidth = 0.75; ctx.lineCap = 'round'; ctx.stroke(); } };
    const cheeks = [0.62, -0.62].map((x) => ({ n: norm([x, -0.4, 0.7]), draw(ctx) { ell(ctx, 0, 0, 2.3, 1.2, 'rgba(255,110,130,0.34)'); } }));
    const glasses = (head.mid === 'glasses' || costume.glasses) ? [
      ...[0.4, -0.4].map((x) => ({ n: norm([x, -0.17, 0.9]), draw(ctx) { ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.fillStyle = 'rgba(200,236,255,0.28)'; ctx.fill(); ctx.lineWidth = 1.0; ctx.strokeStyle = '#3b3346'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-2.6, 2.2); ctx.lineTo(-0.6, 3.4); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.8; ctx.stroke(); } })),
      { n: norm([0, -0.12, 1]), draw(ctx) { ctx.beginPath(); ctx.moveTo(-1.6, 0); ctx.quadraticCurveTo(0, 1.2, 1.6, 0); ctx.lineWidth = 0.9; ctx.strokeStyle = '#3b3346'; ctx.stroke(); } },
    ] : [];
    const faceOpen = [brow(0.4), brow(-0.4), eye(0.4), eye(-0.4), mouth, ...cheeks, ...glasses];
    const faceClosed = [brow(0.4), brow(-0.4), eye(0.4, true), eye(-0.4, true), mouth, ...cheeks, ...glasses];
    // Head surface: skin, hair (layer 1), and a face mask or beard shadow (layer 2).
    const headLayers = [{ fill: NV.hair, mat: 'hair' }, { fill: costume.mask || '#000', mat: 'cloth' }];
    const headPaint = (x, y, z) => {
      if (isHair(x, y, z, style)) return 1;
      if (costume.mask && z > 0 && y < -0.3) return 2;
      return 0;
    };

    /* ---- torso surface ---- */
    const TL = [];
    const layer = (fill, mat) => { TL.push({ fill, mat: mat || 'cloth' }); return TL.length; };
    const tstyle = O.torso || 'shirt';
    const dark = U.shade(tunic, -0.24);
    const L = {
      belt: layer(NV.belt, O.sash ? 'cloth' : 'leather'), under: layer(NV.under), trim: layer(O.trim || dark), dark: layer(dark), skin: layer(NV.skin, 'skin'),
      plate: O.plate ? layer(O.plate, 'metal') : 0, plateTrim: O.plate ? layer(O.plateTrim || U.shade(O.plate, -0.28), 'metal') : 0, plateDark: O.plate ? layer(U.shade(O.plate, -0.18), 'metal') : 0,
      apron: O.apron ? layer(O.apron, tstyle === 'bare' ? 'leather' : 'cloth') : 0, strap: layer('#3a2a1a', 'leather'), stole: O.stole ? layer(O.stole) : 0, vest: O.vest ? layer(O.vest, 'leather') : 0,
      vestDark: O.vest ? layer(U.shade(O.vest, -0.3), 'leather') : 0,
    };
    // x: the figure's left (+) to right, y: hips (-1) to shoulders (+1), z: back (-) to front.
    const torsoPaint = (x, y, z) => {
      const ax = Math.abs(x);
      if (O.belt !== false && y > -0.82 && y < -0.62) return L.belt;
      if (tstyle === 'plate') {
        if (y > -0.5) {
          if (y < -0.41 || (y > 0.66 && z > -0.3)) return L.plateTrim;                 // lower rim and gorget
          if (z > 0 && (ax < 0.04 || Math.abs(y - 0.05 - ax * 0.35) < 0.035)) return L.plateDark;   // ridge and chest line
          return L.plate;
        }
        return 0;
      }
      if (tstyle === 'bare') {
        if (L.apron && z > 0.2 && y < 0.42 && ax < 0.6) return L.apron;
        if (Math.abs(x * 0.72 + y * 0.66 - 0.3) < 0.085 || (L.apron && z > 0.2 && ax > 0.34 && ax < 0.48 && y >= 0.42)) return L.strap;
        return y < -0.5 ? 0 : L.skin;
      }
      if (tstyle === 'crop') {
        if (y < -0.1) return L.skin;
        if (y < 0.02) return L.trim;
        if (z > 0.15 && y > 0.5 && ax < (y - 0.44) * 0.9) return L.skin;
        return y > 0.82 && ax > 0.3 ? L.trim : 0;
      }
      if (tstyle === 'wrap') {
        const d = x * 0.78 + y * 0.62;
        if (z > 0) {
          if (d > 0.44 && y > 0.22) return L.skin;                                   // the open neck
          if (Math.abs(d - 0.38) < 0.065) return L.trim;                             // the crossed-over edge
        }
        return 0;
      }
      if (L.apron && z > 0.3 && y < 0.34 && ax < 0.66) return L.apron;
      if (L.stole && z > 0 && Math.abs(ax - 0.36) < 0.11) return L.stole;
      if (L.vest) {
        if (y < 0.5 || ax > 0.5) return (z > 0 && ax < 0.045 && y < 0.5) ? L.vestDark : L.vest;   // laced down the front
        if (z > 0.2 && ax < (y - 0.46) * 0.75) return L.under;
        return 0;
      }
      if (tstyle === 'coat') {
        if (z > 0) { const e = 0.14 + Math.max(0, y - 0.15) * 0.42; if (ax < e) return L.under; if (ax < e + 0.075) return L.trim; }
        return 0;
      }
      if (tstyle === 'closed') {
        if (y > 0.74) return L.trim;                                                 // a standing collar
        if (z > 0 && ax < 0.085) return L.trim;
        return 0;
      }
      if (z > 0.2 && y > 0.5 && ax < (y - 0.46) * 0.75) return L.under;              // open collar
      return 0;
    };
    const torsoDecals = [];
    if (O.belt !== false && !O.sash) torsoDecals.push({ n: norm([0, -0.72, 0.69]), draw(ctx) { ctx.fillStyle = gold; ctx.fillRect(-1.6, -1.4, 3.2, 2.8); ctx.fillStyle = NV.belt; ctx.fillRect(-0.7, -0.6, 1.4, 1.2); } });
    if (tstyle === 'closed') for (const by of [0.45, 0.12, -0.22]) torsoDecals.push({ n: norm([0, by, 1]), draw(ctx) { ell(ctx, 0, 0, 0.75, 0.75, U.shade(O.trim || dark, -0.35)); } });
    if (O.emblem && !O.tabard) torsoDecals.push({ n: norm([0, 0.16, 0.99]), draw(ctx) { ctx.fillStyle = O.emblem; ctx.fillRect(-1, -3.8, 2, 7.6); ctx.fillRect(-3, 0.4, 6, 2); } });

    const LIFT = look.mount ? 21 : 0;
    // The Peco Peco (Knight) or Grand Peco (Crusader), drawn under the rider.
    function drawPeco(P, anim, t) {
      const body = look.mount === 'grandpeco' ? '#f2efe6' : '#ffd84a', dark = U.shade(body, -0.3), beak = '#ff9f43', F = { mat: 'fur', merge: true };
      const walk = anim === 'walk' ? Math.sin(t * TAU) : 0, bob = anim === 'walk' ? Math.abs(Math.sin(t * TAU)) * 2 : Math.sin(t * TAU) * 0.6;
      P.setPose(0, 0, [0, 0, 0], [0, 0, 0]);
      P.sphere([0, 24 + bob, -2], 15, body, Object.assign({ sx: 0.85, sy: 0.8, bias: -0.05 }, F));
      P.sphere([0, 20 + bob, -1], 12, U.shade(body, 0.3), { sx: 0.8, sy: 0.7, bias: -0.04, mat: 'fur', line: false });
      P.capsule([0, 32 + bob, 9], [0, 48 + bob, 18], 5.2, body, Object.assign({ r2: 4, bias: 0.4 }, F));
      P.sphere([0, 52 + bob, 20], 6.5, body, Object.assign({ bias: 0.5 }, F));
      P.capsule([0, 51 + bob, 25.5], [0, 49 + bob, 31.5], 2.6, beak, { r2: 0.8, bias: 0.55 });
      for (const sx of [-1, 1]) { P.sphere([sx * 3.6, 54 + bob, 24.5], 1.3, '#1b1b2a', { bias: 0.6, mat: 'gem' }); P.capsule([sx * 1.5, 57 + bob, 18], [sx * 3, 63 + bob, 13], 1.6, dark, { r2: 0.5, bias: 0.45 }); }
      for (const sx of [-1, 1]) {
        const k = sx * walk;
        P.capsule([sx * 5.5, 15 + bob, -1], [sx * 5.5, 3, -1 + k * 7], 2.2, beak, { r2: 1.5, bias: 0.1 });
        P.capsule([sx * 5.5, 2.4, -1 + k * 7], [sx * 5.5, 1.4, 5 + k * 7], 1.7, beak, { r2: 1, bias: 0.12 });
        P.sphere([sx * 12, 26 + bob, -3], 8, dark, { sx: 0.45, sy: 0.9, bias: sx * 0.1, mat: 'fur' });                       // wing
      }
      for (const [dy, dz] of [[4, -6], [8, -3], [0, -8]]) P.capsule([0, 26 + bob, -14], [0, 30 + dy + bob, -24 + dz], 3.2, dark, { r2: 1.2, bias: -0.4, mat: 'fur' });
      P.capsule([0, 40 + bob, 12], [0, 34 + bob, -2], 1, '#8a2a2a', { bias: 0.6 });                                          // reins
      P.setPose(0, 0, [0, 0, 0], [0, LIFT, 0]);
    }

    return function drawNovice(P, anim, t) {
      if (look.mount) drawPeco(P, anim, t);
      const C = NV;
      let bob = 0, swing = 0, liftL = 0, liftR = 0, lean = 0, handR = null, handL = null, drop = 0, twist = 0;
      let eyesClosed = false;
      if (anim === 'idle') {
        bob = Math.sin(t * TAU) * 0.6;
        eyesClosed = t >= 0.87;          // a blink at the end of each idle cycle
      } else if (anim === 'walk') {
        const ph = t * TAU;
        swing = Math.sin(ph);
        bob = (1 - Math.abs(swing)) * 1.6 - 0.3;
        liftL = Math.max(0, Math.cos(ph)) * 3.6;
        liftR = Math.max(0, -Math.cos(ph)) * 3.6;
        lean = 0.8;
      } else if (anim === 'attack' && weapon === 'bow') {
        // Draw the string back, release, recover.
        handL = keyframes([[0, [10, 38, 8]], [0.3, [6, 51, 17]], [0.75, [6, 51, 17]], [1, [10, 38, 8]]], t);
        handR = keyframes([[0, [-10, 38, 6]], [0.3, [2, 51, 12]], [0.55, [-5, 51, 1]], [0.62, [-8, 51, 3]], [1, [-10, 38, 6]]], t);
        lean = t > 0.55 && t < 0.75 ? -1.2 : 0;
      } else if (anim === 'attack') {
        handR = keyframes([[0, [-12, 33, 4]], [0.3, [-14, 66, -8]], [0.55, [-4, 40, 17]], [0.8, [-3, 31, 12]], [1, [-12, 33, 4]]], t);
        handL = [11.5, 36, -3];
        lean = t < 0.3 ? -t * 5 : t < 0.7 ? -1.5 + (t - 0.3) * 12 : 3.3 * (1 - (t - 0.7) / 0.3);
        bob = t > 0.45 && t < 0.8 ? -1.2 : 0;
        twist = t > 0.3 && t < 0.8 ? 1 : 0;
      } else if (anim === 'cast') {
        // Both hands raised, gathering energy.
        const k = Math.sin(t * TAU) * 0.5 + 0.5;
        handR = [-10, 57 + k * 4, 9]; handL = [10, 57 + k * 4, 9];
        bob = k * 0.8;
      } else if (anim === 'hit') {
        lean = -3.5; bob = -0.6;
        handR = [-13.5, 40, -3]; handL = [13.5, 40, -3];
        eyesClosed = true;
      } else if (anim === 'dead') {
        eyesClosed = t > 0.3;
        const e = t * t;
        P.setPose(-Math.PI / 2 * 0.96 * e, 0, [0, 26, 0], [0, -17 * e + LIFT * (1 - e), 0]);
      } else if (anim === 'sit') {
        drop = 20;
      }
      const sit = anim === 'sit';
      const dy = bob - drop;                       // how far the upper body is moved
      const hipY = HIP + dy, shY = SH + dy, headY = HEADY + dy;
      const tz = lean * 0.4, hz = 1 + lean;
      const sway = anim === 'walk' ? -Math.cos(t * TAU) * 1.5 : anim === 'idle' ? Math.sin(t * TAU) * 0.4 : 0;

      /* ---- legs ---- */
      const showLegs = !longSkirt || sit;
      const openSkirt = !!(skirt && skirt.open);
      const legStyle = O.legs || 'pants';
      const bareLeg = legStyle === 'bare' || legStyle === 'shorts';
      const thighCol = bareLeg ? C.skin : legStyle === 'tights' ? O.tights : C.pants, legMat = bareLeg ? 'skin' : 'cloth';
      const bootMat = O.greaves ? 'metal' : 'leather', tall = !!(O.bootTall || O.greaves);
      const hipL = [3.7, hipY + 1, tz * 0.5], hipR = [-3.7, hipY + 1, tz * 0.5];
      const footL = sit ? [5.5, 2.6, 15] : [4.1, 2.6 + liftL, swing * 8], footR = sit ? [-5.5, 2.6, 15] : [-4.1, 2.6 + liftR, -swing * 8];
      const knee = (hip, foot, lift) => sit ? [hip[0] * 1.3, hipY + 2, 9.5] : [(hip[0] + foot[0]) / 2, (hip[1] + foot[1]) / 2 + 0.6, (hip[2] + foot[2]) / 2 + 1.3 + lift * 0.9];
      const kL = knee(hipL, footL, liftL), kR = knee(hipR, footR, liftR);
      const legBias = sit || openSkirt ? 0 : -3;                  // thighs tuck under the hem
      for (const [hip, k, f] of [[hipL, kL, footL], [hipR, kR, footR]]) {
        if (showLegs) {
          P.capsule(hip, k, 3.7, thighCol, { r2: 3.1, mat: legMat, merge: true, bias: legBias });
          if (legStyle === 'shorts') P.capsule(hip, lerp3(hip, k, 0.6), 4, C.pants, { r2: 3.7, merge: true, flat: true, bias: legBias + 0.05 });
          const bt = lerp3(k, f, tall ? 0.04 : 0.4);               // where the boot begins
          if (!tall) {
            if (O.stripes) for (let i = 0; i < 4; i++) P.capsule(lerp3(k, bt, i / 4), lerp3(k, bt, (i + 1) / 4), 3.1 - i * 0.07, i % 2 ? O.stripes : thighCol, { r2: 3.03 - i * 0.07, flat: i > 0, merge: true });
            else P.capsule(k, bt, 3.1, thighCol, { r2: 2.85, mat: legMat, merge: true });
          }
          if (O.barefoot) {
            P.capsule(bt, add(f, [0, 0.8, 0]), 2.9, bareLeg ? C.skin : C.pants, { r2: 2.5, mat: legMat, merge: true });
            P.capsule(lerp3(bt, f, 0.55), add(f, [0, 1, 0]), 2.75, '#efe4cf', { r2: 2.6, bias: 0.05 });           // ankle wraps
          } else if (O.sandals) {
            P.capsule(bt, add(f, [0, 0.8, 0]), 2.9, C.skin, { r2: 2.4, mat: 'skin', merge: true });
            P.capsule(lerp3(bt, f, 0.5), lerp3(bt, f, 0.72), 2.75, C.boots, { r2: 2.65, mat: 'metal', bias: 0.05 });   // an anklet
          } else {
            P.capsule(bt, add(f, [0, 0.8, 0]), tall ? 3.4 : 3.2, C.boots, { r2: 2.75, mat: bootMat, merge: true });
            if (tall) P.capsule(bt, lerp3(bt, f, 0.12), 3.75, O.greaves ? U.shade(O.greaves, -0.2) : U.shade(C.boots, 0.22), { r2: 3.6, mat: bootMat, flat: true, bias: 0.05 });   // cuff
            if (O.greaves) P.sphere(add(k, [0, 0, 1.4]), 3.3, O.greaves, { sy: 1.1, mat: 'metal', bias: 0.1 });       // knee guard
          }
        }
        const footCol = O.barefoot || O.sandals ? C.skin : C.boots;
        P.sphere(add(f, [0, -0.1, 1.9]), 3.6, footCol, { sy: 0.7, sx: 0.92, mat: O.barefoot || O.sandals ? 'skin' : bootMat, merge: true, bias: showLegs ? 0 : -4 });
        if (O.sandals) P.capsule(add(f, [-2.2, 1.2, 2.4]), add(f, [2.2, 1.2, 2.4]), 0.7, C.boots, { mat: 'metal', bias: 0.3 });
      }

      /* ---- body ---- */
      P.sphere([0, 41 + dy, tz], 9.2, C.tunic, { sx: 0.93, sy: 1.22, paint: torsoPaint, layers: TL, decals: torsoDecals, merge: true });
      // The lower garment. `to` is how low it hangs; an open one is a coat split at the front.
      const cone = (g, bias, zs) => {
        const to = Math.min(g.to, hipY - 4), col = g.color || C.tunic, zf = sit ? 5 : 0;
        P.capsule([0, hipY + 3, tz + zs], [sway * 0.3, to, tz + zs + zf], 8.6, col, { r2: g.flare || 10.5, bias, merge: true, flat: true });
        P.capsule([sway * 0.3, to, tz + zs + zf], [sway * 0.3, to - 1.7, tz + zs + zf], g.flare || 10.5, g.hem || U.shade(col, -0.2), { r2: (g.flare || 10.5) + 0.3, bias: bias + 0.01, flat: true });
      };
      if (O.underSkirt) cone(O.underSkirt, 0.3, 0);
      if (skirt) cone(skirt, openSkirt ? (O.underSkirt ? -0.2 : -1) : 0.3, openSkirt ? -2.8 : 0);
      else {
        // No skirt: the garment just ends in a short flared hem over the hips.
        P.capsule([0, hipY + 4, tz], [0, hipY - 2.5, tz], 8.5, tstyle === 'bare' || tstyle === 'crop' ? C.pants : C.tunic, { r2: 9.3, bias: 0.25, merge: true, flat: true });
        if (tstyle !== 'bare' && tstyle !== 'crop') P.capsule([0, hipY - 2.5, tz], [0, hipY - 3.6, tz], 9.3, U.shade(C.tunic, -0.2), { r2: 9.45, bias: 0.26, flat: true });
      }
      P.capsule([0, shY - 0.5, tz], [0, headY - HR + 3, hz - 0.5], 2.7, C.skin, { mat: 'skin', bias: 0.1 });       // neck

      if (O.tabard) {
        // A cloth panel hanging front and back from the belt.
        const tb = O.tabard, low = Math.min(tb.short ? 21 : 15, hipY - 5), sw = sway * 0.4;
        for (const s of (O.cape ? [1] : [1, -1])) {
          const z0 = tz + s * 8.5, z1 = tz + s * 9.6;
          P.poly([[-4.3, hipY + 1.5, z0], [4.3, hipY + 1.5, z0], [5 + sw, low, z1], [sw, low - (tb.short ? 2.5 : 0), z1], [-5 + sw, low, z1]], tb.color, { bias: s > 0 ? 0.62 : 0.1, n: [0, 0.2, s] });
          if (tb.trim) P.poly([[-5 + sw, low + 2, z1 + s * 0.2], [5 + sw, low + 2, z1 + s * 0.2], [5 + sw, low + 0.3, z1 + s * 0.2], [-5 + sw, low + 0.3, z1 + s * 0.2]], tb.trim, { bias: s > 0 ? 0.64 : 0.12, n: [0, 0.2, s], line: false });
        }
        if (tb.emblem) {
          const ey = (hipY + low) / 2 + 1.4, ez = tz + 9.3;
          P.poly([[-0.9, ey + 3.4, ez], [0.9, ey + 3.4, ez], [0.9, ey - 3.4, ez], [-0.9, ey - 3.4, ez]], tb.emblem, { bias: 0.66, n: [0, 0.2, 1], line: false });
          P.poly([[-2.8, ey + 1.7, ez], [2.8, ey + 1.7, ez], [2.8, ey - 0.1, ez], [-2.8, ey - 0.1, ez]], tb.emblem, { bias: 0.66, n: [0, 0.2, 1], line: false });
        }
      }
      if (O.tassets) for (let k = 0; k < 6; k++) {
        // Armour plates round the hips.
        const a = (k / 6) * TAU + TAU / 12, sx = Math.sin(a), cz = Math.cos(a);
        P.capsule([sx * 7.6, hipY + 1.5, tz + cz * 7.6], [sx * 10.4, hipY - 7.5, tz + cz * 10.4], 3.6, O.tassets, { r2: 2.6, mat: 'metal', bias: cz * 0.4 + 0.2 });
      }
      if (O.stole) for (const sx of [-1, 1]) {
        // The ends of the stole hang below the belt.
        P.capsule([sx * 3.6, hipY + 1, tz + 8.6], [sx * 3.8 + sway * 0.3, Math.min(17, hipY - 4), tz + 9.4], 2, O.stole, { r2: 2.2, flat: true, bias: 0.6 });
        P.capsule([sx * 3.8 + sway * 0.3, Math.min(17, hipY - 4), tz + 9.4], [sx * 3.8 + sway * 0.3, Math.min(17, hipY - 4) - 1.6, tz + 9.4], 2.2, gold, { r2: 2.3, flat: true, bias: 0.61 });
      }
      if (O.sash) for (const sx of (O.sash.both ? [-1, 1] : [1])) {
        // A knotted sash with a tail (or two) down the hip.
        P.sphere([sx * 7.6, hipY + 1, tz + 3.5], 2.5, O.sash.color, { bias: 0.7, merge: true });
        P.capsule([sx * 7.8, hipY + 0.5, tz + 3.5], [sx * 9.6 + sway * 0.9, Math.min(hipY - 12, 16), tz + 4.2], 2.3, O.sash.color, { r2: 1.3, bias: 0.66, merge: true });
      }
      if (O.satchel) {
        P.sphere([10.6, hipY - 2, -1 + tz], 4.1, C.satchel, { sy: 0.92, mat: 'leather' });
        P.capsule([10.6, hipY - 0.6, 2.6 + tz], [10.6, hipY - 1.4, 2.9 + tz], 1, gold, { bias: 0.3, mat: 'metal' });
        P.capsule([-6.5, shY - 2, 6.6 + tz], [9, hipY + 1, 6.4 + tz], 0.9, '#7a4c2a', { bias: 0.6, mat: 'leather' });
      }
      if (O.pouch) {
        P.sphere([-9.4, hipY - 1.5, tz + 2], 3.2, '#8a5a2c', { sy: 0.95, mat: 'leather', bias: 0.5 });
        P.sphere([-9.4, hipY - 0.2, tz + 2.6], 2.6, '#6b4428', { sy: 0.5, mat: 'leather', bias: 0.55 });
      }
      if (O.quiver) {
        P.capsule([5, shY + 4, -9.5 + tz], [-4.5, hipY + 2, -9.5 + tz], 3.2, '#8a5a2c', { r2: 2.6, bias: -0.3, mat: 'leather' });
        P.capsule([5.4, shY + 4.6, -9.5 + tz], [4.6, shY + 3.2, -9.5 + tz], 3.4, '#5e3c1c', { bias: -0.28, mat: 'leather', flat: true });
        for (const dx of [-1.6, 0, 1.6]) P.capsule([5.6 + dx, shY + 6, -10 + tz], [6.4 + dx, shY + 11, -10.5 + tz], 1.1, '#f4f4f4', { r2: 0.4, bias: -0.4 });
        P.capsule([6.5, shY - 1, 6.4 + tz], [-7, hipY + 4, 6.6 + tz], 0.9, '#5e3c1c', { bias: 0.6, mat: 'leather' });
      }
      if (O.backpack) {
        const bp = O.backpack;
        P.sphere([0, 41 + dy, -11.5 + tz], 8.6, bp.color, { sy: 1.1, bias: -0.2, mat: 'leather' });
        P.sphere([0, 48 + dy, -12 + tz], 6.4, U.shade(bp.color, 0.18), { sy: 0.5, bias: -0.1, mat: 'leather' });
        P.capsule([-4, 37 + dy, -19 + tz], [4, 37 + dy, -19 + tz], 1.1, gold, { bias: -0.15, mat: 'metal' });
        if (bp.roll) P.capsule([-8.5, 53 + dy, -11 + tz], [8.5, 53 + dy, -11 + tz], 3.3, bp.roll, { bias: -0.05 });           // a bedroll on top
        if (bp.flask) { P.capsule([7.5, 44 + dy, -15 + tz], [7.5, 50 + dy, -15 + tz], 2.4, bp.flask, { bias: -0.12, mat: 'gem' }); P.capsule([7.5, 51 + dy, -15 + tz], [7.5, 53 + dy, -15 + tz], 1.1, '#8a5a2c', { bias: -0.11 }); }
        for (const sx of [-1, 1]) P.capsule([sx * 5.5, shY - 0.5, tz + 6.2], [sx * 6.5, hipY + 5, tz + 5.4], 0.9, U.shade(bp.color, -0.3), { bias: 0.6, mat: 'leather' });
      }
      if (O.cape) {
        const cp = O.cape, cx = cp.side || 0, low = Math.max(cp.to, 6) - (sit ? 6 : 0), cz = tz - 6.5 - Math.abs(sway) * 0.4;
        P.capsule([cx, shY - 1, tz - 5], [cx + sway * 0.5, low, cz], 8.6, cp.color, { r2: 11.8, bias: -0.7, flat: true });
        P.capsule([cx + sway * 0.5, low, cz], [cx + sway * 0.5, low - 1.6, cz], 11.8, cp.lining || U.shade(cp.color, -0.22), { r2: 12, bias: -0.69, flat: true });
        P.capsule([-8.5 + cx, shY + 1, tz - 1.5], [8.5 + cx * 0.4, shY + 1, tz - 1.5], 3.1, cp.color, { bias: -0.2, merge: true });
        if (cp.lining) P.sphere([cx > 0 ? 6 : 0, shY + 0.6, tz + 5.4], 1.7, cp.lining, { bias: 0.9, mat: 'metal' });                   // the clasp
      }
      if (O.collar) {
        for (const sx of [-1, 1]) P.capsule([sx * 6, shY - 1, tz - 1], [sx * 13, shY + 13, tz - 6], 4.6, O.collar, { r2: 2.2, bias: -0.25, merge: true });
        P.sphere([0, shY + 5, tz - 6.5], 10.5, O.collar, { sx: 1.2, sy: 1.0, bias: -0.45, merge: true });
      }
      if (O.mantle) {
        // A short cape that sits on the shoulders.
        P.capsule([0, shY + 2.5, tz], [0, shY - 7.5, tz], 5.6, O.mantle.color, { r2: 12.2, flat: true, bias: 1.6, merge: true });
        P.capsule([0, shY - 7.5, tz], [0, shY - 9, tz], 12.2, O.mantle.trim || U.shade(O.mantle.color, -0.2), { r2: 12.5, flat: true, bias: 1.61 });
        P.sphere([0, shY + 0.4, tz + 6.4], 1.6, O.mantle.trim || gold, { bias: 1.7, mat: 'metal' });
      }
      if (O.fur) for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU;
        P.sphere([Math.sin(a) * 8.4, shY + 1.4, tz - 0.5 + Math.cos(a) * 6.2], 3.5, O.fur, { mat: 'fur', merge: true, bias: 0.9 });
      }
      if (O.scarf) {
        const sc = O.scarf, n = sc.tails || 0, len = sc.long ? 19 : 11;
        P.sphere([0, shY + 1.2, 0.6 + tz], 7.2, sc.color, { sy: 0.5, bias: 0.95 });
        for (let i = 0; i < n; i++) {
          const ox = i ? 3.5 : -3, mid = [ox + sway * 0.8, shY - len * 0.5, tz - 8 - i * 1.5];
          P.capsule([ox, shY, tz - 5], mid, 2.4, sc.color, { r2: 1.9, bias: -0.15, merge: true });
          P.capsule(mid, [ox + sway * 2 + (i ? 2 : -2), shY - len, tz - 9.5 - i * 1.5], 1.9, sc.color, { r2: 0.8, bias: -0.15, merge: true });
        }
        if (!n) P.sphere([2.6, shY - 0.6, tz + 6.6], 2.2, sc.color, { bias: 1, merge: true });                              // a knot at the front
      }
      if (O.pauldrons) for (const sx of [-1, 1]) {
        const pd = O.pauldrons, r = pd.r || 5;
        if (pd.side && pd.side !== sx) continue;
        P.sphere([sx * 10, shY + 1.2, tz], r, pd.color, { sy: 0.8, bias: 1.75, mat: 'metal' });
        P.sphere([sx * 11.5, shY - 1.9, tz], r * 0.78, pd.trim || U.shade(pd.color, -0.15), { sy: 0.6, bias: 1.7, mat: 'metal' });
      }
      if (O.beads) for (let k = 0; k <= 8; k++) { const u = k / 8 * 2 - 1; P.sphere([u * 6.5, shY - 1 - (1 - u * u) * 7, tz + 7.6 - (1 - u * u) * 0.5], 1.45, O.beads, { bias: 0.8, mat: 'gem', merge: true }); }
      if (O.shield) {
        P.sphere([-13.5, 36 + dy, tz + 3.5], 8.6, O.shield, { sx: 0.45, sy: 1.1, bias: 0.9, mat: 'metal' });
        P.sphere([-14.5, 36 + dy, tz + 4], 3, '#c0394a', { sx: 0.5, bias: 0.95, mat: 'gem' });
      }
      if (O.bottles) {
        P.capsule([-7, shY - 1, tz + 6.4], [7.5, hipY + 3, tz + 6.6], 1.1, '#5a3a22', { bias: 0.6, mat: 'leather' });      // bandolier
        [['#e8364a', -4.5, 0.25], ['#6fc3ff', 0, 0.5], ['#9ee86a', 4.5, 0.75]].forEach(([c, x, k]) => P.capsule([x, U.lerp(shY - 1, hipY + 3, k) + 1.4, tz + 7.8], [x, U.lerp(shY - 1, hipY + 3, k) - 1.6, tz + 8], 1.5, c, { bias: 0.8, mat: 'gem' }));
      }

      /* ---- arms ---- */
      const shL = [8.4, shY - 1.4, tz], shR = [-8.4, shY - 1.4, tz];
      if (!handL && weapon === 'bow' && !sit) handL = [12.5, 36, 7 - swing * 2];
      handL = handL ? add(handL, [0, dy, 0]) : (sit ? [9.5, hipY + 4, 9] : [11.6, 32 + dy, 1.5 - swing * 6.5]);
      handR = handR ? add(handR, [0, dy, 0]) : (sit ? [-9.5, hipY + 4, 9] : [-11.6, 32 + dy, 1.5 + swing * 6.5]);
      const elbow = (s, hnd, sx) => { const m = lerp3(s, hnd, 0.5), up = hnd[1] > s[1] ? 1 : 0; return [m[0] + sx * (1.6 + up * 2.5), m[1] - 1.2 - up * 2.5, m[2] - 2.2 + up]; };
      const sl = O.sleeves || 'long', armor = O.armArmor;
      const upCol = armor || (sl === 'none' ? C.skin : C.sleeve), upMat = armor ? 'metal' : sl === 'none' ? 'skin' : 'cloth';
      const loCol = armor || (sl === 'none' || sl === 'short' ? C.skin : C.sleeve), loMat = armor ? 'metal' : sl === 'none' || sl === 'short' ? 'skin' : 'cloth';
      for (const [s, hnd, sx] of [[shL, handL, 1], [shR, handR, -1]]) {
        const e = elbow(s, hnd, sx), puff = sl === 'puff', wide = sl === 'wide';
        P.sphere(s, puff ? 4.8 : 3.15, upCol, { mat: upMat, merge: true });
        P.capsule(s, e, puff ? 4 : 3.1, upCol, { r2: puff ? 2.9 : 2.7, mat: upMat, merge: true });
        if (sl === 'short') P.capsule(lerp3(s, e, 0.75), e, 3.05, U.shade(C.sleeve, -0.18), { r2: 3.1, flat: true, bias: 0.04 });   // sleeve hem
        P.capsule(e, hnd, 2.7, loCol, { r2: wide ? 4.4 : 2.4, mat: loMat, merge: true, flat: wide });
        if (wide) P.capsule(lerp3(e, hnd, 0.8), hnd, 4.06, O.cuffs || U.shade(C.sleeve, -0.2), { r2: 4.5, flat: true, bias: 0.04 });
        else if (O.cuffs && sl !== 'none' && sl !== 'short' && !armor) P.capsule(lerp3(e, hnd, 0.68), lerp3(e, hnd, 0.94), 2.85, O.cuffs, { r2: 2.75, bias: 0.04 });
        if (O.wraps) P.capsule(lerp3(e, hnd, 0.28), lerp3(e, hnd, 0.9), 2.75, O.wraps, { r2: 2.6, bias: 0.05 });
        if (O.bracers) P.capsule(lerp3(e, hnd, 0.28), lerp3(e, hnd, 0.9), 3.05, O.bracers, { r2: 2.8, mat: O.bracersMat || 'metal', bias: 0.05 });
        if (armor) P.sphere(e, 3.1, U.shade(armor, -0.12), { mat: 'metal', bias: 0.05 });                                      // elbow cop
        if (O.gloves) P.capsule(lerp3(e, hnd, 0.45), hnd, 3.2, O.gloves, { r2: 3, mat: 'leather', bias: 0.05 });
        P.sphere(hnd, O.gloves ? 3.2 : 2.8, O.gloves || C.skin, { bias: sx > 0 ? 0.2 : 0.25, mat: O.gloves ? 'leather' : 'skin' });
      }

      /* ---- weapon ---- */
      if (!sit && !look.unarmed) {
        const kd = norm(add(sub(handR, shR), [0, 4, 9]));
        const steel = { mat: 'metal' }, blade = '#dfe7f0', wood = { mat: 'leather' };
        const side = norm([kd[2], 0, -kd[0]]);
        if (weapon === 'dagger') {
          P.capsule(add(handR, kd, -1.6), add(handR, kd, 1.6), 1.2, '#6b4026', Object.assign({ bias: 0.1 }, wood));
          P.capsule(add(handR, kd, 2.6), add(handR, kd, 10.5), 1.5, blade, Object.assign({ r2: 0.4, bias: 0.15 }, steel));
          P.capsule(add(add(handR, kd, 2.0), side, 2), add(add(handR, kd, 2.0), side, -2), 0.8, gold, { bias: 0.14, mat: 'metal' });
        } else if (weapon === 'sword') {
          P.capsule(add(handR, kd, -2.4), add(handR, kd, 2), 1.2, '#4a2d1a', Object.assign({ bias: 0.1 }, wood));
          P.sphere(add(handR, kd, -3), 1.5, gold, { bias: 0.1, mat: 'metal' });
          P.capsule(add(handR, kd, 3), add(handR, kd, 21), 1.9, blade, Object.assign({ r2: 0.5, bias: 0.15 }, steel));
          P.capsule(add(add(handR, kd, 2.4), side, 3.4), add(add(handR, kd, 2.4), side, -3.4), 1, gold, { bias: 0.14, mat: 'metal' });
        } else if (weapon === 'mace') {
          P.capsule(add(handR, kd, -2), add(handR, kd, 10), 1.2, '#7a4c2a', Object.assign({ bias: 0.1 }, wood));
          P.sphere(add(handR, kd, 12), 3.8, '#9aa3ad', { bias: 0.15, mat: 'metal' });
          for (const s2 of [-1, 1]) P.capsule(add(handR, kd, 12), add(add(handR, kd, 12), side, s2 * 5), 1.4, '#9aa3ad', { r2: 0.3, bias: 0.14, mat: 'metal', merge: true });
        } else if (weapon === 'twohand') {
          P.capsule(add(handR, kd, -6), add(handR, kd, 1), 1.3, '#5a3a22', Object.assign({ bias: 0.1 }, wood));
          P.capsule(add(add(handR, kd, 1.6), side, 4.6), add(add(handR, kd, 1.6), side, -4.6), 1.3, gold, { bias: 0.12, mat: 'metal' });
          P.capsule(add(handR, kd, 3), add(handR, kd, 31), 2.7, blade, Object.assign({ r2: 0.6, bias: 0.16 }, steel));
        } else if (weapon === 'instrument') {
          P.sphere(add(handL, [1, 4, 5]), 5.6, '#b9803f', { sx: 0.9, sy: 1.25, bias: 1.2, mat: 'leather' });
          P.sphere(add(handL, [1, 4, 7]), 1.8, '#3a2412', { bias: 1.22, line: false });
          P.capsule(add(handL, [1, 9, 5]), add(handL, [3, 22, 3]), 1.2, '#5a3a22', { bias: 1.25, mat: 'leather' });
        } else if (weapon === 'whip') {
          const a = add(handR, kd, 4), b2 = add(a, [6, -6, 4]), c2 = add(b2, [4, -9, -2]);
          P.capsule(handR, a, 1.3, '#7a4c2a', { bias: 0.1, mat: 'leather' }); P.capsule(a, b2, 1.0, '#c9a06b', { bias: 0.1, merge: true }); P.capsule(b2, c2, 0.8, '#c9a06b', { r2: 0.4, bias: 0.1, merge: true });
        } else if (weapon === 'spear') {
          // Held upright, butt near the ground, head well above the shoulder.
          const up = norm([kd[0] * 0.15, 1, kd[2] * 0.15 + 0.12]);
          P.capsule(add(handR, up, -22), add(handR, up, 32), 1.1, '#7a4c2a', Object.assign({ bias: 0.1 }, wood));
          P.capsule(add(handR, up, 32), add(handR, up, 43), 2.4, blade, Object.assign({ r2: 0.3, bias: 0.16 }, steel));
          P.sphere(add(handR, up, 31.5), 1.7, '#c0394a', { bias: 0.15 });
        } else if (weapon === 'katar') {
          P.capsule(add(handR, kd, -1), add(handR, kd, 2), 2.2, '#5a3a22', { bias: 0.12, mat: 'leather' });
          for (const s2 of [-1, 1]) P.capsule(add(add(handR, kd, 2), side, s2 * 1.3), add(add(handR, kd, 14), side, s2 * 0.5), 1.1, blade, Object.assign({ r2: 0.3, bias: 0.16 }, steel));
        } else if (weapon === 'knuckle') {
          for (const hd of [handR, handL]) P.sphere(hd, 3.5, '#c9a24a', { bias: 0.3, mat: 'metal' });
        } else if (weapon === 'axe') {
          P.capsule(add(handR, kd, -3), add(handR, kd, 15), 1.2, '#7a4c2a', Object.assign({ bias: 0.1 }, wood));
          const hd = add(handR, kd, 13);
          // A double-bitted head: two crescent blades either side of the haft.
          for (const s2 of [-1, 1]) P.poly([add(hd, side, s2 * 0.8), add(add(hd, kd, 4.2), side, s2 * 5.6), add(hd, side, s2 * 7.4), add(add(hd, kd, -4.2), side, s2 * 5.6)], '#cfd8e6', { bias: 0.16, mat: 'metal' });
          P.sphere(hd, 1.8, '#8a94a6', { bias: 0.18, mat: 'metal' });
        } else if (weapon === 'book') {
          P.sphere(add(handL, [1, 3, 5]), 5.2, '#7a3a3a', { sx: 0.9, sy: 1.15, bias: 1.2, mat: 'leather' });
          P.sphere(add(handL, [1, 3, 6.5]), 2.2, gold, { sy: 0.5, bias: 1.3, mat: 'metal' });
        } else if (weapon === 'rod') {
          const up = norm(add(kd, [0, 1.4, 0]));
          P.capsule(add(handR, up, -11), add(handR, up, 16), 1.05, '#8b5a33', Object.assign({ bias: 0.1 }, wood));
          P.sphere(add(handR, up, 16.5), 2.2, gold, { bias: 0.14, mat: 'metal' });
          P.sphere(add(handR, up, 19.5), 3.1, '#a77cf0', { bias: 0.16, mat: 'gem' });
        }
      }
      if (weapon === 'bow' && !sit) {
        // A curved bow in the left hand; limbs bend forward from the grip.
        const up = [0, 1, 0], fwd = [0, 0, 1];
        const g = handL;
        const pt = (u, f) => add(add(g, up, u), fwd, f);
        const limb = [pt(20, -4), pt(14, 1.5), pt(6.5, 2.6), g, pt(-6.5, 2.6), pt(-14, 1.5), pt(-20, -4)];
        for (let i = 0; i < limb.length - 1; i++) P.capsule(limb[i], limb[i + 1], i === 0 || i === 5 ? 1.1 : 1.6, '#a8743c', { bias: 0.3, mat: 'leather', merge: true });
        P.sphere(g, 2.1, '#5a3520', { bias: 0.35, mat: 'leather' });
        const pull = anim === 'attack' ? handR : pt(0, -5);
        P.capsule(limb[0], pull, 0.3, '#f4f0e0', { bias: 0.25, line: false, merge: true });
        P.capsule(pull, limb[6], 0.3, '#f4f0e0', { bias: 0.25, line: false, merge: true });
        if (anim === 'attack' && t > 0.2 && t < 0.56) { P.capsule(pull, pt(0, 13), 0.5, '#e8e0c8', { bias: 0.4 }); P.capsule(pt(0, 13), pt(0, 16), 1.2, blade0(), { r2: 0.2, bias: 0.42, mat: 'metal' }); }
      }
      function blade0() { return '#dfe7f0'; }

      /* ---- head and hair ---- */
      const hc = [0, headY, hz];
      const H = { mat: 'hair', merge: true };
      // Hats that cover the crown flatten whatever hair would stick up through them.
      const crownCovered = (hat && !['headband', 'tiara', 'wings'].includes(hat.type)) || ['leafcap', 'crown', 'warhelm', 'bunny'].includes(head.top);
      if (style !== 'buzz') P.sphere([0, headY + 0.9, hz - 2.2], HR + 1.5, C.hair, Object.assign({ sx: HSX, bias: -1.2 }, H));
      P.sphere(hc, HR, C.skin, { sx: HSX, sy: HSY, mat: 'skin', paint: headPaint, layers: headLayers, decals: eyesClosed ? faceClosed : faceOpen });
      if (style === 'ponytail') {
        P.sphere([0, headY + 3.5, hz - HR - 0.5], 3, '#e05a6b', { bias: 0.3 });
        P.capsule([0, headY + 3, hz - HR - 2], [sway * 0.5, headY - 5, hz - HR - 6.5], 4.6, C.hair, Object.assign({ r2: 3.8 }, H));
        P.capsule([sway * 0.5, headY - 5, hz - HR - 6.5], [sway * 1.3, headY - 15, hz - HR - 6], 3.8, C.hair, Object.assign({ r2: 1.2 }, H));
      } else if (style === 'twintails') {
        for (const sx of [-1, 1]) {
          P.sphere([sx * (HR + 0.5), headY + 4, hz - 4], 2.6, '#e05a6b', { bias: 0.4 });
          P.capsule([sx * (HR + 1.5), headY + 3, hz - 5], [sx * (HR + 4) + sway * 0.4, headY - 7, hz - 7], 4.2, C.hair, Object.assign({ r2: 3.6 }, H));
          P.capsule([sx * (HR + 4) + sway * 0.4, headY - 7, hz - 7], [sx * (HR + 4.5) + sway * 1.1, headY - 19, hz - 7.5], 3.6, C.hair, Object.assign({ r2: 1.1 }, H));
        }
      } else if (crownCovered) {
        // (no tufts under a hat)
      } else if (style === 'spiky') {
        // Spikes fanning up and back from the crown.
        for (const [a, up, len] of [[-1.0, 0.45, 8], [-0.5, 0.8, 10], [0, 1, 11], [0.5, 0.8, 10], [1.0, 0.45, 8], [-0.6, 0.25, 9], [0.6, 0.25, 9], [0, 0.4, 10]]) {
          const bx = Math.sin(a) * 9.5, bz = hz - 3 + Math.cos(a) * 4 - (up < 0.5 ? 7 : 0);
          P.capsule([bx, headY + HR - 3.5, bz], [bx * 1.4, headY + HR - 3.5 + len * up, bz - len * (1 - up) * 0.9], 3.4, C.hair, Object.assign({ r2: 0.5, bias: -0.3 }, H));
        }
      } else if (style === 'swept') {
        // A big fringe swept to one side.
        P.capsule([-7, headY + HR - 3, hz + 6], [10.5, headY + 5, hz + 10], 4, C.hair, Object.assign({ r2: 1.2, bias: 0.7 }, H));
        P.capsule([-9, headY + HR - 5, hz + 2], [-13, headY + 3, hz + 5], 3.4, C.hair, Object.assign({ r2: 1, bias: 0.6 }, H));
      } else if (style === 'messy') {
        for (const [x, y, z, r] of [[-7, HR - 2, -2, 5], [6, HR - 1, 0, 5.4], [0, HR + 0.5, -5, 5], [-10, 7, -8, 4.4], [10, 8, -7, 4.4], [3, HR - 4, 8, 4.2], [-5, HR - 3.5, 7, 4]])
          P.sphere([x, headY + y, hz + z], r, C.hair, Object.assign({ bias: z > 4 ? 0.5 : -0.2 }, H));
        for (const sx of [-1, 1]) P.capsule([sx * 9, headY + HR - 5, hz - 2], [sx * 14.5, headY + HR + 1, hz - 5], 2.6, C.hair, Object.assign({ r2: 0.5, bias: -0.2 }, H));
      } else if (style === 'short') {
        P.capsule([2, headY + HR - 1, hz - 1], [5, headY + HR + 4, hz - 3], 1.6, C.hair, Object.assign({ r2: 0.4, bias: 0.4 }, H));   // one stray tuft
      }

      /* ---- hats and headgear: shells fitted round the head ---- */
      // test(x, y, z) says which part of the head the shell covers (unit sphere; y up, z to the face).
      const shell = (fill, test, o) => P.sphere(hc, HR + ((o && o.t) || 1.25), fill, Object.assign({ sx: HSX, sy: HSY, bias: 1.5, paint: (x, y, z) => test(x, y, z) }, o || {}));
      const top = headY + HR * HSY;                       // the crown of the head
      const band = (fill, at, w, o) => shell(fill, (x, y, z) => (Math.abs(y - at + z * 0.07) < w ? 0 : -1), Object.assign({ t: 0.9 }, o || {}));
      if (hat) {
        const c1 = hat.color;
        if (hat.type === 'wizard') {
          shell(c1, (x, y, z) => (y > 0.44 ? 0 : -1));
          P.sphere([0, headY + HR * 0.5, hz - 0.5], HR * 1.75, c1, { sy: 0.2, bias: 1.55, merge: true });                       // wide brim
          P.capsule([0, headY + HR * 0.55, hz - 0.5], [0.6, headY + HR * 0.55 + 4, hz - 1.2], 10.6, hat.band || c1, { r2: 9.2, bias: 1.6, flat: true });
          const th = hat.tall ? 17 : 12;
          P.capsule([0.6, headY + HR * 0.55 + 4, hz - 1.2], [2.5, top + th, hz - 4.5], 9.2, c1, { r2: 3.6, bias: 1.62, merge: true });
          P.capsule([2.5, top + th, hz - 4.5], [8 + sway, top + th + 4, hz - 8.5], 3.6, c1, { r2: 0.7, bias: 1.64, merge: true });       // the bent tip
          P.sphere([0, headY + HR * 0.55 + 2, hz + 9.6], 1.7, gold, { bias: 1.7, mat: 'metal' });                                  // buckle
        } else if (hat.type === 'cap') {
          shell(c1, (x, y, z) => (y + z * 0.1 > 0.36 ? (Math.abs(y + z * 0.1 - 0.42) < 0.06 ? 1 : 0) : -1), { layers: [{ fill: U.shade(c1, -0.25) }] });
          P.sphere([0, headY + HR * 0.36, hz + HR * 0.78], 6.4, U.shade(c1, -0.12), { sx: 1.15, sy: 0.24, bias: 1.55 });         // peak
          P.sphere([0, top + 0.9, hz - 0.5], 1.6, U.shade(c1, 0.25), { bias: 1.6 });
        } else if (hat.type === 'bandana') {
          shell(c1, (x, y, z) => (y - z * 0.2 > 0.26 ? 0 : -1));
          P.sphere([0, headY + 4.5, hz - HR - 1.2], 2.4, c1, { bias: 0.2, merge: true });
          for (const sx of [-1, 1]) P.capsule([0, headY + 4, hz - HR - 1.5], [sx * 3 + sway * 1.4, headY - 6, hz - HR - 5], 2, c1, { r2: 0.7, bias: 0.15, merge: true });
        } else if (hat.type === 'headband') {
          band(c1, 0.38, 0.085);
          P.sphere([0, headY + 5.5, hz - HR - 1], 1.9, c1, { bias: 0.2, merge: true });
          for (const sx of [-1, 1]) P.capsule([0, headY + 5, hz - HR - 1.3], [sx * 2.4 + sway * 1.6, headY - 3.5, hz - HR - 5], 1.5, c1, { r2: 0.6, bias: 0.15, merge: true });
        } else if (hat.type === 'helm') {
          shell(c1, (x, y, z) => ((y > 0.02 || (z < 0.05 && y > -0.52)) ? (Math.abs(y - 0.08) < 0.055 || (z > 0 && Math.abs(x) < 0.07 && y < 0.45) ? 1 : 0) : -1), { mat: 'metal', layers: [{ fill: U.shade(c1, -0.3), mat: 'metal' }] });
          P.capsule([0, headY + 1, hz + HR + 0.6], [0, headY - 5, hz + HR + 0.3], 1.3, U.shade(c1, -0.2), { r2: 0.9, bias: 1.6, mat: 'metal' });   // nose guard
          if (hat.plume) {
            const pl = [[0, top + 1, hz + 4], [0, top + 7, hz - 1], [0, top + 6.5, hz - 9], [sway * 0.6, top + 1, hz - 15]];
            for (let i = 0; i < 3; i++) P.capsule(pl[i], pl[i + 1], [3.2, 4, 3.2][i], hat.plume, { r2: [4, 3.2, 1][i], bias: 1.62, mat: 'hair', merge: true });
          }
        } else if (hat.type === 'mitre') {
          shell(hat.band, (x, y, z) => (y > 0.4 ? 0 : -1));
          P.capsule([0, headY + HR * 0.62, hz - 0.5], [0, top + 12, hz - 1], 9.6, c1, { r2: 5.2, bias: 1.6 });
          P.capsule([0, top + 12, hz - 1], [0, top + 15, hz - 1], 5.2, c1, { r2: 1, bias: 1.6, merge: true });
          P.capsule([0, headY + HR * 0.62, hz - 0.5], [0, headY + HR * 0.62 + 2.4, hz - 0.5], 9.8, hat.band, { r2: 9.3, bias: 1.62 });
          P.capsule([0, top + 2, hz + 7], [0, top + 9.5, hz + 4.8], 0.8, hat.band, { bias: 1.7 });
          P.capsule([-2.2, top + 6.6, hz + 6], [2.2, top + 6.6, hz + 6], 0.8, hat.band, { bias: 1.7 });
        } else if (hat.type === 'beret') {
          band(U.shade(c1, -0.25), 0.5, 0.07);
          P.sphere([3.5, top - 1.2, hz - 1.5], HR * 1.02, c1, { sx: 1.16, sy: 0.4, bias: 1.6 });
          P.sphere([4, top + 4.6, hz - 1.5], 1.3, c1, { bias: 1.62, merge: true });
          if (hat.feather) { P.capsule([9, top + 1, hz - 3], [15, top + 10, hz - 8], 2, hat.feather, { r2: 1.4, bias: 1.64, mat: 'fur' }); P.capsule([15, top + 10, hz - 8], [18 + sway, top + 15, hz - 11], 1.4, hat.feather, { r2: 0.3, bias: 1.64, mat: 'fur', merge: true }); }
        } else if (hat.type === 'feather') {
          shell(c1, (x, y, z) => (y > 0.42 ? (y < 0.52 ? 1 : 0) : -1), { layers: [{ fill: U.shade(c1, -0.3) }] });
          P.sphere([0, headY + HR * 0.46, hz + 3.5], HR * 1.2, c1, { sx: 0.95, sy: 0.17, bias: 1.55, merge: true });            // brim, longer at the front
          P.capsule([0, headY + HR * 0.5, hz + HR * 1.0], [0, headY + HR * 0.4, hz + HR * 1.55], 5, c1, { r2: 0.8, bias: 1.56, merge: true });
          P.capsule([0, top - 1, hz - 1], [0, top + 4, hz - 3], 7.5, c1, { r2: 3, bias: 1.6, merge: true });
          if (hat.feather) { P.capsule([8, top - 3, hz - 4], [12, top + 9, hz - 10], 1.9, hat.feather, { r2: 1.3, bias: 1.64, mat: 'fur' }); P.capsule([12, top + 9, hz - 10], [13 + sway, top + 15, hz - 14], 1.3, hat.feather, { r2: 0.3, bias: 1.64, mat: 'fur', merge: true }); }
        } else if (hat.type === 'hood') {
          shell(c1, (x, y, z) => ((z > 0.3 && y < 0.56 - Math.abs(x) * 0.25 && Math.abs(x) < 0.84) ? -1 : (z > 0.2 && (y > 0.48 - Math.abs(x) * 0.25 || Math.abs(x) > 0.76) ? 1 : 0)), { t: 1.9, layers: [{ fill: U.shade(c1, -0.28) }] });
          P.capsule([0, top - 2, hz - 5], [0, top + 3, hz - 12], 5, c1, { r2: 1, bias: 1.45, merge: true });                    // the peak
          P.sphere([0, shY + 1.5, tz - 1], 9.4, c1, { sy: 0.5, bias: 0.5, merge: true });                                       // cowl on the shoulders
        } else if (hat.type === 'veil') {
          // A cloth veil over the hair, falling to the shoulders, with a coloured band.
          shell(c1, (x, y, z) => ((z > 0.12 && y < 0.5) ? -1 : (z > 0.12 && y < 0.62 ? 1 : 0)), { t: 1.7, layers: [{ fill: hat.band || U.shade(c1, -0.2) }] });
          P.capsule([0, headY - 2, hz - HR * 0.55], [sway * 0.5, shY - 9, tz - 7.5], 11, c1, { r2: 9.4, flat: true, bias: -1.3, merge: true });
          P.capsule([sway * 0.5, shY - 9, tz - 7.5], [sway * 0.5, shY - 10.6, tz - 7.5], 9.4, hat.band || U.shade(c1, -0.2), { r2: 9.6, flat: true, bias: -1.29 });
        } else if (hat.type === 'flatcap') {
          shell(c1, (x, y, z) => (y + z * 0.12 > 0.4 ? (y + z * 0.12 < 0.5 ? 1 : 0) : -1), { layers: [{ fill: U.shade(c1, -0.28) }] });
          P.sphere([0, top - 0.6, hz + 2.5], HR * 1.08, c1, { sx: 1.1, sy: 0.3, bias: 1.6, merge: true });
          P.sphere([0, headY + HR * 0.44, hz + HR * 0.86], 5.6, U.shade(c1, -0.15), { sx: 1.2, sy: 0.2, bias: 1.62 });           // peak
          P.sphere([0, top + 2.6, hz + 1], 1.2, U.shade(c1, 0.2), { bias: 1.64 });
        } else if (hat.type === 'cavalier') {
          // A wide-brimmed hat, one side pinned up, with a sweeping plume.
          shell(c1, (x, y, z) => (y > 0.46 ? 0 : -1));
          P.sphere([1, headY + HR * 0.52, hz - 0.5], HR * 1.72, c1, { sx: 1.08, sy: 0.17, bias: 1.55, merge: true });
          P.capsule([0, headY + HR * 0.56, hz - 0.5], [0, headY + HR * 0.56 + 2.6, hz - 0.8], 9.8, hat.band || c1, { r2: 9.3, bias: 1.6, flat: true });
          P.capsule([0, headY + HR * 0.56 + 2.6, hz - 0.8], [0, top + 3.6, hz - 1], 9.3, c1, { r2: 7.6, bias: 1.62, merge: true });
          if (hat.feather) {
            const f0 = [-9, top + 1, hz - 2], f1 = [-13, top + 9, hz - 8], f2 = [-10 + sway, top + 15, hz - 15], f3 = [-4 + sway * 1.5, top + 15, hz - 21];
            P.capsule(f0, f1, 2, hat.feather, { r2: 3.2, bias: 1.66, mat: 'fur', merge: true });
            P.capsule(f1, f2, 3.2, hat.feather, { r2: 2.8, bias: 1.66, mat: 'fur', merge: true });
            P.capsule(f2, f3, 2.8, hat.feather, { r2: 0.6, bias: 1.66, mat: 'fur', merge: true });
          }
        } else if (hat.type === 'wings') {
          // A circlet with a small wing at each temple.
          shell(c1, (x, y, z) => (Math.abs(y - 0.4 - (z > 0 ? Math.max(0, 0.28 - Math.abs(x)) * 0.4 : 0)) < 0.055 ? 0 : -1), { t: 0.9, mat: 'metal' });
          P.sphere([0, headY + HR * 0.5, hz + HR * 0.88], 1.6, '#5ab4ff', { bias: 1.6, mat: 'gem' });
          for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
            const b0 = [sx * (HR + 0.6), headY + HR * 0.38, hz - 1 - i * 1.2];
            P.capsule(b0, [sx * (HR + 3.5 + i), headY + HR * 0.38 + 6.5 - i * 2.6, hz - 7 - i * 2.4], 1.9, '#fbfbff', { r2: 0.5, bias: 1.62, mat: 'fur', merge: true });
          }
        } else if (hat.type === 'tiara') {
          shell(c1, (x, y, z) => (z > -0.25 && Math.abs(y - 0.46 - Math.max(0, 0.25 - Math.abs(x)) * 0.5) < 0.055 ? 0 : -1), { t: 0.9, mat: 'metal' });
          P.sphere([0, headY + HR * 0.56, hz + HR * 0.84], 1.7, '#ff6b8b', { bias: 1.6, mat: 'gem' });
          if (hat.veil) {
            P.capsule([0, headY + 3, hz - HR * 0.7], [sway * 0.8, shY - 12, tz - 9], 7, hat.veil, { r2: 5.4, flat: true, bias: -1.3 });
            P.capsule([sway * 0.8, shY - 12, tz - 9], [sway * 0.8, shY - 13.5, tz - 9], 5.4, gold, { r2: 5.5, flat: true, bias: -1.29 });
          }
        }
      }
      if (costume.goggles) {
        band('#5a3a22', 0.36, 0.06, { mat: 'leather' });
        for (const sx of [-1, 1]) { P.sphere([sx * 4.6, headY + HR * 0.38, hz + HR * 0.9], 3.3, costume.goggles, { bias: 1.6, mat: 'metal' }); P.sphere([sx * 4.6, headY + HR * 0.38, hz + HR * 0.9 + 1.6], 2.1, '#9fe0ff', { bias: 1.65, mat: 'gem' }); }
      }
      if (look.falcon) {
        const fx = -11.5, fy = shY + 8, fz = tz - 1;
        P.sphere([fx, fy, fz], 4.4, '#8a5a2c', { sy: 1.2, bias: 1.0, mat: 'fur' });
        P.sphere([fx, fy - 1, fz + 2.6], 2.8, '#f2e6cc', { sy: 1.1, bias: 1.02, mat: 'fur', line: false });
        P.sphere([fx, fy + 6, fz + 1.5], 3.1, '#f2e6cc', { bias: 1.05, mat: 'fur' });
        P.sphere([fx - 1.2, fy + 6.6, fz + 4], 0.7, '#1b1b2a', { bias: 1.12, line: false }); P.sphere([fx + 1.2, fy + 6.6, fz + 4], 0.7, '#1b1b2a', { bias: 1.12, line: false });
        P.capsule([fx, fy + 5.6, fz + 4.2], [fx, fy + 4.4, fz + 6.6], 1.1, '#e6c25a', { r2: 0.3, bias: 1.1 });
        P.capsule([fx - 1, fy + 1, fz - 3], [fx - 3, fy - 8, fz - 6], 2.4, '#6a4a2a', { r2: 0.8, bias: 0.95, mat: 'fur' });
      }

      /* ---- equipped headgear ---- */
      if (head.top === 'ribbon') {
        const k = [0, top - 0.5, hz - 4];
        for (const sx of [-1, 1]) {
          P.capsule(k, [sx * 8.5, top + 4.5, hz - 5], 1.6, '#ff6b8b', { r2: 4.2, bias: 1.6, merge: true });
          P.capsule(k, [sx * 4 + sway, top - 7.5, hz - 9], 1.5, '#f0557c', { r2: 1.9, bias: 1.4 });
        }
        P.sphere(k, 2.5, '#e0486e', { bias: 1.7 });
      } else if (head.top === 'bunny') {
        band('#fbfbff', 0.6, 0.075, { mat: 'fur' });
        for (const sx of [-1, 1]) {
          const b0 = [sx * 5, top - 3, hz - 2], b1 = [sx * 7.5, top + 10, hz - 4], b2 = sx > 0 ? [sx * 12.5 + sway, top + 16, hz - 2] : [sx * 8.5 + sway * 0.5, top + 21, hz - 5.5];
          P.capsule(b0, b1, 3, '#fbfbff', { r2: 3.3, bias: 1.55, mat: 'fur', merge: true });
          P.capsule(b1, b2, 3.3, '#fbfbff', { r2: 2, bias: 1.56, mat: 'fur', merge: true });           // one ear flops over
          P.capsule(add(b0, [0, 3, 1.6]), add(b1, [0, -0.5, 1.8]), 1.3, '#ffb1c6', { r2: 1.6, bias: 1.6, line: false });
        }
      } else if (head.top === 'leafcap') {
        shell('#6fbf4a', (x, y, z) => (y + z * 0.08 > 0.34 ? (Math.abs(x) < 0.035 ? 1 : 0) : -1), { layers: [{ fill: '#4f9e36' }] });
        P.capsule([0, top + 0.5, hz - 1], [1.5, top + 5, hz - 2], 1, '#7a4a2a', { bias: 1.6 });
        P.poly([[1.5, top + 5, hz - 2], [5, top + 9.5, hz - 2], [11, top + 9, hz - 3], [14, top + 5.5, hz - 3.5], [9, top + 3.4, hz - 3], [4.5, top + 3.6, hz - 2.2]], '#7fd05a', { bias: 1.65, n: [0.2, 0.8, 0.6] });
        P.capsule([2.5, top + 5.4, hz - 2], [13, top + 6, hz - 3.4], 0.35, '#4f9e36', { bias: 1.7, line: false });
      } else if (head.top === 'crown') {
        const cy = top - 1.6, rr = 6.6;
        P.sphere([0, cy + 1, hz - 0.5], rr + 0.9, gold, { sy: 0.38, bias: 1.55, mat: 'metal', merge: true });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 0.5, bx = Math.sin(a) * rr, bz = Math.cos(a) * rr - 0.5;
          P.capsule([bx, cy + 1, hz + bz], [bx * 1.12, cy + 7.5, hz + bz * 1.12], 2.3, gold, { r2: 0.7, bias: 1.6, mat: 'metal', merge: true });
          P.sphere([bx * 1.12, cy + 8.4, hz + bz * 1.12], 1.25, ['#ff6b8b', '#7fc8ff', '#7dff9a'][i % 3], { bias: 1.65, mat: 'gem' });
        }
        P.sphere([0, cy + 1.2, hz + rr + 0.4], 1.5, '#ff6b8b', { bias: 1.66, mat: 'gem' });
      } else if (head.top === 'circlet') {
        shell('#e6c25a', (x, y, z) => (Math.abs(y - 0.42 - (z > 0 ? Math.max(0, 0.3 - Math.abs(x)) * 0.35 : 0)) < 0.05 ? 0 : -1), { t: 0.9, mat: 'metal' });
        P.sphere([0, headY + HR * 0.5, hz + HR * 0.88], 2, '#5ab4ff', { sy: 1.25, bias: 1.6, mat: 'gem' });
      } else if (head.top === 'halo') {
        for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; P.sphere([Math.sin(a) * 8.6, top + 6.5 + Math.sin(t * TAU) * 0.5, hz - 1 + Math.cos(a) * 8.6], 1.5, '#fff6c2', { bias: 1.7, mat: 'flat', merge: true }); }
      } else if (head.top === 'warhelm') {
        shell('#aab3be', (x, y, z) => ((y > -0.02 || (z < 0.3 && y > -0.6)) ? ((Math.abs(y - 0.05) < 0.05 && z > -0.3) || (z > 0 && Math.abs(x) < 0.07 && y < 0.5 && y > -0.02) || (y < -0.5) ? 1 : 0) : -1), { mat: 'metal', layers: [{ fill: '#6f7884', mat: 'metal' }] });
        P.capsule([0, headY + 1, hz + HR + 0.7], [0, headY - 6, hz + HR + 0.2], 1.4, '#7a838d', { r2: 1, bias: 1.6, mat: 'metal' });
        const pl = [[0, top + 0.5, hz + 5], [0, top + 6.5, hz], [0, top + 6, hz - 8], [sway * 0.6, top, hz - 14]];
        for (let i = 0; i < 3; i++) P.capsule(pl[i], pl[i + 1], [3, 3.8, 3][i], '#c0394a', { r2: [3.8, 3, 0.9][i], bias: 1.62, mat: 'hair', merge: true });
      } else if (head.top === 'headband') {
        band('#c0394a', 0.38, 0.085);
        P.sphere([0, headY + 5.5, hz - HR - 1], 2, '#c0394a', { bias: 0.2, merge: true });
        for (const sx of [-1, 1]) P.capsule([0, headY + 5, hz - HR - 1.3], [sx * 3 + sway * 2, headY - 8, hz - HR - 6.5], 1.6, '#c0394a', { r2: 0.6, bias: 0.15, merge: true });
      }
      if (head.mid === 'lamp') {
        band('#5a3a22', 0.34, 0.06, { mat: 'leather' });
        P.sphere([0, headY + HR * 0.4, hz + HR * 0.95], 3.2, '#c9a24a', { bias: 1.6, mat: 'metal' });
        P.sphere([0, headY + HR * 0.4, hz + HR * 0.95 + 1.9], 2, '#fff3a0', { bias: 1.65, mat: 'flat' });
      }
      if (head.low === 'pipe') {
        const m0 = [2.4, headY - HR * 0.5, hz + HR * 0.86];
        P.capsule(m0, add(m0, [4.5, -1.5, 4.5]), 0.8, '#8bc34a', { bias: 1.6 });
        P.sphere(add(m0, [5.6, 0.2, 5.4]), 2.2, '#6a9f3a', { sy: 1.15, bias: 1.62 });
      }

      if (costume.beard) {
        [[-HR * 0.62, HR * 0.6, 6], [-HR * 1.05, HR * 0.52, 5], [-HR * 1.42, HR * 0.4, 3.4]].forEach(([by, bz, r]) => P.sphere([0, headY + by, hz + bz], r, costume.beard, { bias: 0.8, mat: 'hair', merge: true }));
        P.sphere([0, headY - HR * 0.38, hz + HR * 0.86], 3.6, costume.beard, { sy: 0.42, sx: 1.5, bias: 0.9, mat: 'hair', merge: true });
      }
    };
  }

  /* ===================================================== PORING (original jelly slime) */
  const PR = { body: '#ff9cb8', light: '#ffe1ea', dark: '#e8678f', outline: '#b8476c' };
  function poringFace(squint, closed) {
    return [
      eyeDecal([0.34, 0.12, 0.93], null, closed ? { closed: true } : squint ? { squint: 1 } : { w: 2.4, h: 3.5, outer: '#2b1a24' }),
      eyeDecal([-0.34, 0.12, 0.93], null, closed ? { closed: true } : squint ? { squint: -1 } : { w: 2.4, h: 3.5, outer: '#2b1a24' }),
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
  const PORING_FACE = poringFace(false), PORING_SQUINT = poringFace(true), PORING_BLINK = poringFace(false, true);

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
    P.capsule([0, cy + r * sy - 3, z - 2], [0, cy + r * sy + 3.5, z - 5.5], 4.4, PR.body, { r2: 2.4, mat: 'jelly', merge: true, bias: -0.5 });
    if (leaf) {
      P.capsule([0, cy + r * sy + 3, z - 5], [-5, cy + r * sy + 8, z - 3], 2.6, '#6fbf4a', { outline: '#2f6e1f', bias: -0.4 });
      P.capsule([0, cy + r * sy + 3, z - 5], [5, cy + r * sy + 9, z - 4], 2.6, '#7fd05a', { outline: '#2f6e1f', bias: -0.45 });
    }
    const blink = anim === 'idle' && t >= 0.8;
    P.sphere([0, cy, z], r, PR.body, { sx, sy, mat: 'jelly', merge: true, decals: squint ? PORING_SQUINT : blink ? PORING_BLINK : PORING_FACE, alpha });
    P.custom([0, cy, z], (ctx, c) => {
      ctx.save(); ctx.translate(c.x - r * sx * P.S * 0.42, c.y - r * sy * P.S * 0.5); ctx.scale(P.S / 1.25, P.S / 1.25); ctx.rotate(-0.6);
      ell(ctx, 0, 0, 5.5 * sx, 3 * sy, 'rgba(255,255,255,0.85)');
      ell(ctx, 7, 2.5, 1.6, 1.4, 'rgba(255,255,255,0.75)');
      ctx.restore();
    }, 0.05);
  }

  /* ===================================================== LUNATIC (original moon-bunny) */
  const LN = { fur: '#fbfbff', shadow: '#c9cbe6', outline: '#7c80aa', inner: '#ffb1c6', eye: '#e2364a' };
  function lunaticFace(squint, closed) {
    return [
      eyeDecal([0.42, 0.08, 0.9], squint || closed ? null : '#f04a5c', closed ? { closed: true } : squint ? { squint: 1 } : { w: 2.3, h: 3.0, outer: '#5a1420' }),
      eyeDecal([-0.42, 0.08, 0.9], squint || closed ? null : '#f04a5c', closed ? { closed: true } : squint ? { squint: -1 } : { w: 2.3, h: 3.0, outer: '#5a1420' }),
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
  const LUNA_FACE = lunaticFace(false), LUNA_SQUINT = lunaticFace(true), LUNA_BLINK = lunaticFace(false, true);

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
    P.sphere([7.5, 2.8 + y * 0.35, -3 + z], 4.6, LN.fur, { sy: 0.65, mat: 'fur', merge: true });
    P.sphere([-7.5, 2.8 + y * 0.35, -3 + z], 4.6, LN.fur, { sy: 0.65, mat: 'fur', merge: true });
    P.sphere([0, by, -1 + z], 12.5, LN.fur, { sx, sy: sy * 0.96, mat: 'fur', merge: true });
    P.sphere([0, by + 1, -13.5 + z], 4.6, LN.fur, { mat: 'fur', merge: true });
    P.sphere([5, 3 + y * 0.5, 8 + z], 3.1, LN.fur, { sy: 0.8, mat: 'fur', merge: true, bias: 0.3 });
    P.sphere([-5, 3 + y * 0.5, 8 + z], 3.1, LN.fur, { sy: 0.8, mat: 'fur', merge: true, bias: 0.3 });
    // head and ears
    const hy = by + 15, hz = 4 + z;
    P.sphere([0, hy, hz], 11, LN.fur, { dark: LN.shadow, outline: LN.outline, decals: squint ? LUNA_SQUINT : (anim === 'idle' && t >= 0.8) ? LUNA_BLINK : LUNA_FACE, bias: 0.5 });
    for (const s of [1, -1]) {
      const base = [s * 4.4, hy + 8, hz - 2];
      const tip = [s * (7 + ear * (s > 0 ? 1 : -0.6)), hy + 30 - Math.abs(earBack) * 0.4, hz - 6 - earBack];
      P.capsule(base, tip, 3.7, LN.fur, { r2: 2.6, mat: 'fur', merge: true, bias: 0.1 });
      P.capsule(add(base, [0, 2, 1.3]), add(tip, [0, -2.5, 1.2]), 1.55, LN.inner, { r2: 1.1, line: false, bias: 0.12 });
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

  /* ===================================================== GEOGRAPHER (man-eating sunflower) */
  const GEO_FACE = [
    eyeDecal([0.36, 0.3, 0.86], '#2a1a08', { w: 2.4, h: 3, outer: '#120a02' }), eyeDecal([-0.36, 0.3, 0.86], '#2a1a08', { w: 2.4, h: 3, outer: '#120a02' }),
    { n: norm([0, -0.28, 0.96]), draw(ctx) {
      ctx.beginPath(); ctx.ellipse(0, 0, 6, 3.4, 0, 0, TAU); ctx.fillStyle = '#3a0a10'; ctx.fill();
      ctx.fillStyle = '#fff8e8';
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 2.2 - 0.9, -2.6); ctx.lineTo(i * 2.2 + 0.9, -2.6); ctx.lineTo(i * 2.2, -0.6); ctx.closePath(); ctx.fill(); }
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 2.6 - 0.9, 2.6); ctx.lineTo(i * 2.6 + 0.9, 2.6); ctx.lineTo(i * 2.6, 0.7); ctx.closePath(); ctx.fill(); }
    } },
  ];
  const GEO_SEEDS = [];
  for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 0.25 + (i % 4) * 0.12; GEO_SEEDS.push({ n: norm([Math.cos(a) * r, Math.sin(a) * r + 0.45, 0.8]), minD: 0.2, draw(ctx) { ell(ctx, 0, 0, 0.9, 0.9, '#4a2e10'); } }); }
  function drawGeographer(P, anim, t) {
    let sway = Math.sin(t * TAU) * 2.5, lunge = 0, dip = 0, tilt = 0;
    if (anim === 'attack') { const k = Math.sin(Math.min(1, t * 1.4) * Math.PI); lunge = k * 14; dip = k * 8; }
    else if (anim === 'hit') { lunge = -4; tilt = 3; }
    else if (anim === 'die') P.setPose(0, t * 1.1, [0, 0, 0], [0, -3 * t, 0]);
    const G1 = '#4f9a32', G2 = '#2f6a1e', OUT = '#1f4a12';
    // Leaves round the foot, and two on the stem.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      P.sphere([Math.sin(a) * 11, 3, Math.cos(a) * 9 - 2], 7, i % 2 ? G1 : G2, { sx: 1.5, sy: 0.32, outline: OUT, bias: i % 2 ? 0.3 : -0.2 });
    }
    const top = [sway, 52 - dip, lunge];
    P.capsule([0, 2, 0], [sway * 0.5, 28 - dip * 0.5, lunge * 0.4], 3.4, G1, { outline: OUT });
    P.capsule([sway * 0.5, 28 - dip * 0.5, lunge * 0.4], [top[0], top[1] - 8, top[2] - 1], 3, G1, { outline: OUT });
    for (const sx of [-1, 1]) P.sphere([sx * 9 + sway * 0.4, 26 - dip * 0.5, lunge * 0.3 + 1], 6, G2, { sx: 1.6, sy: 0.45, outline: OUT, bias: 0.4 });
    // Petals round the face, then the face itself (a seed disc with a toothy mouth).
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + tilt * 0.05, ix = Math.cos(a), iy = Math.sin(a);
      P.capsule([top[0] + ix * 12, top[1] + iy * 12, top[2] - 2], [top[0] + ix * 21, top[1] + iy * 21, top[2] - 3.5], 3.6, i % 2 ? '#ffd23a' : '#ffc21a', { outline: '#b8780a', bias: 0.6 });
    }
    P.sphere([top[0], top[1], top[2] - tilt], 13, '#7a5222', { decals: GEO_FACE.concat(GEO_SEEDS), outline: '#3a220a', light: '#a8783a', bias: 0.9 });
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


  /* ===================================================== FAMILIAR (bat) */
  const FM = { body: '#6a5a8a', wing: '#4b3e66', outline: '#241b33', ear: '#8a74b0' };
  const FAM_FACE = [
    eyeDecal([0.38, 0.12, 0.92], '#ff4a5a', { w: 2.2, h: 2.6, outer: '#1a0d14' }), eyeDecal([-0.38, 0.12, 0.92], '#ff4a5a', { w: 2.2, h: 2.6, outer: '#1a0d14' }),
    { n: norm([0, -0.35, 0.94]), draw(ctx) { ctx.fillStyle = '#fff'; for (const x of [-1.3, 1.3]) { ctx.beginPath(); ctx.moveTo(x - 0.8, 0.5); ctx.lineTo(x + 0.8, 0.5); ctx.lineTo(x, -1.6); ctx.closePath(); ctx.fill(); } } },
  ];
  function drawFamiliar(P, anim, t) {
    let flap = Math.sin(t * TAU * (anim === 'walk' ? 2 : 1.5)), y = 26 + Math.sin(t * TAU) * 2, z = 0, rz = 0;
    if (anim === 'attack') { z = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 9; y -= z * 0.4; }
    if (anim === 'hit') { y -= 2; flap = 1; }
    if (anim === 'die') { y = 26 * (1 - t) + 4; rz = t * 1.2; P.setPose(0, rz, [0, 0, 0], [0, 0, 0]); }
    P.sphere([0, y, z], 9, FM.body, { decals: FAM_FACE, outline: FM.outline });
    for (const sx of [-1, 1]) {
      P.capsule([sx * 4, y + 7, z], [sx * 6, y + 15, z - 1], 2.4, FM.ear, { outline: FM.outline, bias: -0.2 });
      const tip = [sx * 22, y + 4 + flap * 8, z - 4], mid = [sx * 13, y + 6 + flap * 4, z - 2];
      P.capsule([sx * 7, y + 2, z - 2], mid, 3.4, FM.wing, { outline: FM.outline, bias: -0.5 });
      P.capsule(mid, tip, 2.4, FM.wing, { outline: FM.outline, bias: -0.55 });
      P.capsule(mid, [sx * 15, y - 4 + flap * 5, z - 3], 2, FM.wing, { outline: FM.outline, bias: -0.56 });
    }
  }

  /* ===================================================== SPORE (mushroom) */
  const SPORE_SPOTS = [[0.3, 0.8, 0.5], [-0.5, 0.75, 0.3], [0.1, 0.95, -0.2], [0.75, 0.55, -0.3], [-0.7, 0.55, -0.35], [0, 0.6, -0.8], [0.55, 0.6, 0.6], [-0.45, 0.6, 0.7]]
    .map((n) => ({ n: norm(n), minD: -0.05, draw(ctx) { ell(ctx, 0, 0, 2.6, 2.6, '#fff6ec'); } }));
  const SPORE_FACE = [
    eyeDecal([0.35, 0.15, 0.92], null, { w: 2, h: 2.8, outer: '#2b1a10' }), eyeDecal([-0.35, 0.15, 0.92], null, { w: 2, h: 2.8, outer: '#2b1a10' }),
    { n: norm([0, -0.25, 0.97]), draw(ctx) { ctx.beginPath(); ctx.arc(0, 1, 1.8, Math.PI * 1.15, Math.PI * 1.85); ctx.strokeStyle = '#6a3a2a'; ctx.lineWidth = 1; ctx.stroke(); } },
    blush([0.6, -0.1, 0.78], 2.2), blush([-0.6, -0.1, 0.78], 2.2),
  ];
  function drawSpore(P, anim, t) {
    let y = 0, sy = 1, z = 0;
    if (anim === 'walk') { const hop = Math.sin(t * Math.PI); y = hop * 6; sy = 1 + hop * 0.1; }
    else if (anim === 'idle') sy = 1 + Math.sin(t * TAU) * 0.04;
    else if (anim === 'attack') { z = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 7; sy = 0.9; }
    else if (anim === 'hit') sy = 0.8;
    else if (anim === 'die') { sy = 1 - t * 0.6; P.setPose(0, t * 0.8, [0, 0, 0], [0, 0, 0]); }
    P.sphere([0, 10 * sy + y, z], 8.5, '#f1e6cf', { sy: 1.15 * sy, decals: SPORE_FACE, outline: '#8a6a4a', bias: 0.2 });
    P.sphere([0, 22 * sy + y, z - 1], 15, '#c9583a', { sy: 0.62 * sy, decals: SPORE_SPOTS, outline: '#6a2414', light: '#ff9a7a', bias: 0.5 });
    for (const sx of [-1, 1]) P.sphere([sx * 5, 2 + y * 0.3, z + 2], 3, '#e8dcc0', { sy: 0.7, outline: '#8a6a4a' });
  }

  /* ===================================================== WHISPER (ghost) */
  const WHISPER_FACE = [
    eyeDecal([0.38, 0.1, 0.92], null, { w: 2.6, h: 4, outer: '#1a1a2e' }), eyeDecal([-0.38, 0.1, 0.92], null, { w: 2.6, h: 4, outer: '#1a1a2e' }),
    { n: norm([0, -0.35, 0.94]), draw(ctx) { ell(ctx, 0, 0, 2, 2.6, '#1a1a2e'); } },
  ];
  function drawWhisper(P, anim, t) {
    let y = 30 + Math.sin(t * TAU) * 2.5, z = 0, sway = Math.sin(t * TAU) * 3;
    if (anim === 'attack') z = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 9;
    if (anim === 'hit') { z = -3; y += 2; }
    if (anim === 'die') { y += t * 14; P.setPose(0, t * 0.5, [0, 30, 0], [0, 0, 0]); }
    const W = { fill: '#eef3ff', dark: '#b7c3e6', outline: '#6f7ba8' };
    P.sphere([0, y, z], 12, W.fill, { mat: 'jelly', merge: true, decals: WHISPER_FACE, bias: 0.5 });
    [[-9, 10, 0.4], [-16, 8, 0.8], [-22, 6, 1.2], [-27, 4.2, 1.6]].forEach(([dy, r, k]) =>
      P.sphere([sway * k, y + dy, z - 3 - k * 3], r, W.fill, { mat: 'jelly', merge: true, bias: -0.2 * k }));
    for (const sx of [-1, 1]) P.capsule([sx * 10, y - 2, z + 2], [sx * 15, y - 7 + sway * 0.5, z + 5], 2.6, W.fill, { r2: 1.4, mat: 'jelly', merge: true, bias: 0.3 });
  }

  // King Poring: the jelly boss, wearing a golden crown.
  const KING = { body: '#ff9cb8', light: '#ffe1ea', dark: '#e8678f', outline: '#b8476c' };
  function drawKingPoring(P, anim, t) {
    drawPoringWith(P, anim, t, KING, false);
    let sy = 1, y = 0;
    if (anim === 'idle') sy = 1 - 0.055 * Math.sin(t * TAU);
    else if (anim === 'walk') { const h = Math.sin(t * Math.PI); y = h * 9; sy = 0.84 + 0.28 * h; }
    else if (anim === 'hit') sy = 0.76;
    else if (anim === 'die') sy = 1 - 0.78 * t;
    const top = 17 * sy * 2 + y;
    const gold = { light: '#fff6c0', outline: '#8a5a00' };
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU, bx = Math.sin(a) * 7, bz = Math.cos(a) * 7 - 2;
      P.capsule([bx, top - 1, bz], [bx, top + 6, bz], 1.6, '#f5c542', { bias: 0.8, mat: 'metal', merge: true });
      P.sphere([bx, top + 6.5, bz], 1.4, ['#ff6b8b', '#7fc8ff', '#7dff9a', '#ffd84a', '#c79bff'][i], { bias: 0.85 });
    }
    P.sphere([0, top, -2], 8, '#f5c542', { sy: 0.3, bias: 0.75, mat: 'metal', merge: true });
  }

  /* ===================================================== TRAINING DUMMY */
  const DUMMY_FACE = [{ n: norm([0, 0, 1]), draw(ctx) {
    for (const [r, c] of [[7, '#c0394a'], [5, '#fbf6ec'], [3, '#c0394a'], [1.2, '#fbf6ec']]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = c; ctx.fill(); }
  } }];
  const DUMMY_HEAD = [{ n: norm([0, -0.1, 1]), draw(ctx) { ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 1.2; for (const x of [-2.5, 2.5]) { ctx.beginPath(); ctx.moveTo(x - 1.2, -1.2); ctx.lineTo(x + 1.2, 1.2); ctx.moveTo(x + 1.2, -1.2); ctx.lineTo(x - 1.2, 1.2); ctx.stroke(); } } }];
  function drawDummy(P, anim, t) {
    const wob = anim === 'hit' ? Math.sin(t * Math.PI * 4) * 0.18 * (1 - t) : 0;
    P.setPose(0, wob, [0, 0, 0], [0, 0, 0]);
    const wood = '#8a5a33', sack = '#d9b98a', o = { outline: '#4a2e18' };
    for (const a of [0.5, 2.1, 3.7, 5.3]) P.capsule([0, 2, 0], [Math.sin(a) * 9, 0, Math.cos(a) * 9], 1.6, wood, o);
    P.capsule([0, 0, 0], [0, 54, 0], 2.2, wood, Object.assign({ bias: -0.2 }, o));
    P.sphere([0, 32, 0], 11, sack, Object.assign({ sy: 1.25, decals: DUMMY_FACE, bias: 0.2 }, { outline: '#8a6a3a' }));
    P.capsule([-16, 38, 0], [16, 38, 0], 2, wood, Object.assign({ bias: 0.1 }, o));
    for (const sx of [-1, 1]) P.sphere([sx * 17, 38, 0], 3.2, sack, { outline: '#8a6a3a', bias: 0.15 });
    P.sphere([0, 53, 0], 7, sack, { decals: DUMMY_HEAD, outline: '#8a6a3a', bias: 0.3 });
    P.capsule([-5, 41, 6], [5, 41, 6], 0.9, '#c9a24a', { bias: 0.4 });
  }

  /* ===================================================== registry */
  const DEFS = {
    poring: {
      frameW: 112, frameH: 112, originX: 56, originY: 104, scale: 1.25,
      anims: [
        { name: 'idle', frames: 6, fps: 5 },
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
        { name: 'idle', frames: 6, fps: 5 },
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
        { name: 'idle', frames: 6, fps: 5 }, { name: 'walk', frames: 6, fps: 9 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 10, loop: false },
      ],
      draw: makePoring({ body: '#ffb35c', light: '#ffe6c0', dark: '#f08a2c', outline: '#b35a10' }, false),
    },
    poporing: {
      frameW: 112, frameH: 120, originX: 56, originY: 112, scale: 1.25,
      anims: [
        { name: 'idle', frames: 6, fps: 5 }, { name: 'walk', frames: 6, fps: 9 }, { name: 'attack', frames: 6, fps: 12, loop: false },
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
    training_dummy: {
      frameW: 112, frameH: 128, originX: 56, originY: 120, scale: 1.25,
      anims: [
        { name: 'idle', frames: 1, fps: 1 }, { name: 'walk', frames: 1, fps: 1 }, { name: 'attack', frames: 1, fps: 1, loop: false },
        { name: 'hit', frames: 6, fps: 14, loop: false }, { name: 'die', frames: 1, fps: 1, loop: false },
      ],
      draw: drawDummy,
    },
    familiar: {
      frameW: 144, frameH: 120, originX: 72, originY: 112, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 8 }, { name: 'walk', frames: 6, fps: 12 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 9, loop: false },
      ],
      draw: drawFamiliar,
    },
    spore: {
      frameW: 112, frameH: 112, originX: 56, originY: 104, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 4 }, { name: 'walk', frames: 6, fps: 9 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 9, loop: false },
      ],
      draw: drawSpore,
    },
    whisper: {
      frameW: 128, frameH: 136, originX: 64, originY: 128, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 5 }, { name: 'walk', frames: 6, fps: 8 }, { name: 'attack', frames: 6, fps: 12, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 8, loop: false },
      ],
      draw: drawWhisper,
    },
    geographer: {
      frameW: 160, frameH: 176, originX: 80, originY: 166, scale: 1.25,
      anims: [
        { name: 'idle', frames: 6, fps: 4 }, { name: 'walk', frames: 6, fps: 4 }, { name: 'attack', frames: 6, fps: 10, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 8, loop: false },
      ],
      draw: drawGeographer,
    },
    king_poring: {
      frameW: 112, frameH: 128, originX: 56, originY: 120, scale: 1.25,
      anims: [
        { name: 'idle', frames: 4, fps: 4 }, { name: 'walk', frames: 6, fps: 8 }, { name: 'attack', frames: 6, fps: 10, loop: false },
        { name: 'hit', frames: 2, fps: 8, loop: false }, { name: 'die', frames: 5, fps: 8, loop: false },
      ],
      draw: drawKingPoring,
    },
  };

  const NOVICE_ANIMS = [
    { name: 'idle', frames: 8, fps: 4 },
    { name: 'walk', frames: 8, fps: 12 },
    { name: 'attack', frames: 6, fps: 12, loop: false },
    { name: 'cast', frames: 4, fps: 8 },
    { name: 'hit', frames: 2, fps: 8, loop: false },
    { name: 'dead', frames: 4, fps: 8, loop: false },
    { name: 'sit', frames: 1, fps: 1 },
  ];
  const noviceDef = (app, look) => (look && look.mount
    ? { frameW: 176, frameH: 204, originX: 88, originY: 194, scale: 1.25, anims: NOVICE_ANIMS, draw: makeNovice(app, look) }
    : { frameW: 160, frameH: 176, originX: 80, originY: 166, scale: 1.25, anims: NOVICE_ANIMS, draw: makeNovice(app, look) });

  const cache = {};
  /* New monsters: recoloured variants of existing ones, or humanoids. */
  function recolor(sheet, hueDeg, sat, light) {
    const src = sheet.atlas, c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0);
    const img = x.getImageData(0, 0, c.width, c.height), d = img.data, dh = (hueDeg || 0) / 360;
    // Pixel art has few colours: convert each one once.
    const memo = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      let out = memo.get(key);
      if (out === undefined) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), l0 = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
          const k = max - min; s = l0 > 0.5 ? k / (2 - max - min) : k / (max + min);
          h = max === r ? (g - b) / k + (g < b ? 6 : 0) : max === g ? (b - r) / k + 2 : (r - g) / k + 4; h /= 6;
        }
        h = (h + dh + 1) % 1; s = Math.min(1, s * (sat || 1)); const l = Math.min(1, l0 * (light || 1));
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
        out = ((f(h + 1 / 3) * 255) << 16) | ((f(h) * 255) << 8) | (f(h - 1 / 3) * 255);
        memo.set(key, out);
      }
      d[i] = (out >> 16) & 255; d[i + 1] = (out >> 8) & 255; d[i + 2] = out & 255;
    }
    x.putImageData(img, 0, 0);
    // Its own texture, so the recoloured monster shows in the world too.
    return RP.deriveSheet(sheet, { atlas: c, texture: RP.makeTexture(c) });
  }
  function monsterSheet(spec) {
    if (spec.base) return recolor(G.SpriteFactory.get(spec.base), spec.hue, spec.sat, spec.light);
    const hm = spec.humanoid;
    const sheet = G.SpriteFactory.humanoid({ hair: hm.hair || 'raven', style: hm.style || 'buzz', eyes: hm.eyes || 'amber', outfit: 'sky' },
      { job: hm.costume, weapon: hm.weapon === 'none' ? 'dagger' : hm.weapon, unarmed: hm.weapon === 'none', skin: hm.skin });
    // Monsters play "die"; characters call it "dead".
    return RP.deriveSheet(sheet, { anims: Object.assign({}, sheet.anims, { die: sheet.anims.die || sheet.anims.dead }) });
  }

  G.SpriteFactory = {
    get(name) {
      if (name === 'novice') return G.SpriteFactory.novice({});
      if (!cache[name]) {
        const def = !DEFS[name] && G.Config && G.Config.MONSTERS[name];
        cache[name] = def && def.sprite ? monsterSheet(def.sprite) : RP.buildSheet(DEFS[name]);
      }
      return cache[name];
    },
    // Sprite sheet for a player character with the given appearance.
    novice(app) { return G.SpriteFactory.humanoid(app, { job: 'novice', weapon: 'dagger' }); },
    // Sheet for any human character: appearance + job outfit + weapon in hand.
    humanoid(app, look) {
      app = normalizeAppearance(app);
      look = Object.assign({ job: 'novice', weapon: 'dagger' }, look || {});
      const hd = look.head || {};
      const key = ['h', app.hair, app.outfit, app.eyes, app.style, look.job, look.weapon, look.unarmed ? 'u' : '', hd.top || '', hd.mid || '', hd.low || '', look.mount || '', look.falcon ? 'f' : '', look.skin || ''].join(':');
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
