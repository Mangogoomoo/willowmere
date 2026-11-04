/* Skill database. Each skill is data plus a named effect implemented in
   systems/skills.js, so new skills are mostly a matter of adding entries.

   type     'active' (used from the hotbar) | 'passive' (always on)
   target   'enemy' | 'self' | 'ally' (click a character, yourself included)
   max      max skill level;  pos [row, col] in the skill-tree window
   req      prerequisites [[skillId, level], ...]
   sp/cd/cast/hp/zeny   per-level functions (seconds for cd/cast)
   range    world units, or 'weapon' to use the weapon's reach
   granted  learned automatically (no skill point cost)
   bonus    passive stat bonus: (level, player) => { stat: value } */
(function (G) {
  'use strict';
  const S = {};
  const def = (id, o) => { S[id] = Object.assign({ id, type: 'active', target: 'enemy', max: 10, req: [], sp: () => 0, cd: () => 0.4, cast: () => 0, range: 'weapon' }, o); };
  const pct = (n) => `${Math.round(n)}%`;
  const range9 = () => 9;

  /* ---------------- Novice ---------------- */
  def('basic_training', { name: 'Basic Training', job: 'novice', type: 'passive', max: 9, pos: [0, 0], icon: { shape: 's_book', color: '#c9a24a' },
    desc: (l) => `The fundamentals every adventurer learns. Level 9 is required to change jobs. +${l * 3} Max HP.`,
    bonus: (l) => ({ maxHp: l * 3 }) });
  def('first_aid', { name: 'First Aid', job: 'novice', target: 'self', max: 1, granted: true, pos: [0, 1], icon: { shape: 's_cross', color: '#ff6b6b' },
    sp: () => 3, cd: () => 1, desc: () => 'Patch yourself up, restoring a little HP (8 + base level).' });
  def('play_dead', { name: 'Play Dead', job: 'novice', target: 'self', max: 1, granted: true, noviceOnly: true, pos: [0, 2], icon: { shape: 's_zzz', color: '#9fb0d4' },
    sp: () => 5, cd: () => 2,
    desc: () => 'Collapse and lie perfectly still. Monsters lose interest in you. Use again, or click the ground, to get up. Novice only: forgotten when you change jobs.' });

  /* ---------------- Swordsman ---------------- */
  def('bash', { name: 'Bash', job: 'swordsman', pos: [0, 0], icon: { shape: 's_bash', color: '#ffb347' },
    sp: (l) => (l <= 5 ? 8 : 15), cd: () => 0.5,
    desc: (l) => `A heavy blow dealing ${pct(100 + 30 * l)} damage with +${5 * l}% accuracy.` });
  def('magnum_break', { name: 'Magnum Break', job: 'swordsman', target: 'self', pos: [1, 0], req: [['bash', 5]], icon: { shape: 's_burst', color: '#ff7a3d' },
    sp: () => 30, hp: () => 15, cd: () => 2,
    desc: (l) => `Explode with fire, hitting every nearby enemy for ${pct(100 + 20 * l)} fire damage and knocking them back. Costs 15 HP.` });
  def('provoke', { name: 'Provoke', job: 'swordsman', pos: [0, 1], range: range9, icon: { shape: 's_shout', color: '#ff5468' },
    sp: (l) => 3 + l, cd: () => 1, cast: () => 0.3,
    desc: (l) => `Taunt a monster: ${50 + 3 * l}% success. It comes at you with ${2 + 3 * l}% more ATK but ${5 + 5 * l}% less DEF for 30 seconds.` });
  def('endure', { name: 'Endure', job: 'swordsman', target: 'self', pos: [1, 1], req: [['provoke', 5]], icon: { shape: 's_shield', color: '#7fb8ff' },
    sp: () => 10, cd: () => 10,
    desc: (l) => `Steel yourself for ${7 + 3 * l} seconds: you don’t flinch when hit and gain +${l} soft DEF and +${l} MDEF.` });
  def('sword_mastery', { name: 'Sword Mastery', job: 'swordsman', type: 'passive', pos: [0, 2], icon: { shape: 's_sword', color: '#cfd8e6' },
    desc: (l) => `+${4 * l} ATK while wielding a dagger or one-handed sword.`,
    bonus: (l, p) => (p.derived && /dagger|sword/.test(p.equippedWeaponType()) ? { atk: 4 * l } : {}) });
  def('hp_recovery', { name: 'Increase HP Recovery', job: 'swordsman', type: 'passive', pos: [1, 2], icon: { shape: 's_heart', color: '#ff7a8a' },
    desc: (l) => `Recover HP ${20 * l}% faster.`, bonus: (l) => ({ hpRegenPct: 20 * l }) });

  /* ---------------- Mage ---------------- */
  const bolt = (name, element, color, row) => ({
    name, job: 'mage', pos: [row, 0], range: range9, icon: { shape: 's_bolt', color, element },
    sp: (l) => 10 + 2 * l, cd: () => 0.6, cast: (l) => 0.7 * l, element,
    desc: (l) => `Call down ${l} ${element === 'water' ? 'ice' : element === 'wind' ? 'lightning' : 'fire'} bolt${l > 1 ? 's' : ''}, each dealing 100% MATK as ${element} damage. Magic never misses.`,
  });
  def('fire_bolt', bolt('Fire Bolt', 'fire', '#ff7a3d', 0));
  def('cold_bolt', bolt('Cold Bolt', 'water', '#7fd6ff', 1));
  def('lightning_bolt', bolt('Lightning Bolt', 'wind', '#ffe066', 2));
  def('soul_strike', { name: 'Soul Strike', job: 'mage', pos: [0, 1], range: range9, icon: { shape: 's_soul', color: '#b9a4ff' },
    sp: (l) => 12 + Math.floor(l / 2) * 2, cd: () => 0.8, cast: () => 0.5, element: 'ghost',
    desc: (l) => `Launch ${Math.ceil(l / 2)} spirit orb${l > 1 ? 's' : ''} of ghost magic, each dealing 100% MATK. Fast to cast.` });
  def('frost_diver', { name: 'Frost Diver', job: 'mage', pos: [1, 1], req: [['cold_bolt', 5]], range: range9, icon: { shape: 's_bolt', color: '#5fb8ff', element: 'water' },
    sp: (l) => 26 - l, cd: () => 1, cast: () => 0.8, element: 'water',
    desc: (l) => `A wave of ice dealing ${pct(100 + 10 * l)} MATK as water damage, with a ${35 + 3 * l}% chance to freeze the target for ${3 * l} seconds.` });
  def('sp_recovery', { name: 'Increase SP Recovery', job: 'mage', type: 'passive', pos: [2, 1], icon: { shape: 's_drop', color: '#5f9cff' },
    desc: (l) => `Recover SP ${15 * l}% faster.`, bonus: (l) => ({ spRegenPct: 15 * l }) });
  def('fire_ball', { name: 'Fire Ball', job: 'mage', pos: [0, 2], req: [['fire_bolt', 4]], range: range9, icon: { shape: 's_burst', color: '#ff5a2a' },
    sp: () => 25, cd: () => 1, cast: () => 1.5, element: 'fire',
    desc: (l) => `Hurl a fireball that bursts on impact, hitting everything near the target for ${pct(70 + 10 * l)} MATK as fire damage.` });
  def('thunderstorm', { name: 'Thunder Storm', job: 'mage', pos: [2, 2], req: [['lightning_bolt', 4]], range: range9, icon: { shape: 's_storm', color: '#ffd84a' },
    sp: (l) => 24 + 5 * l, cd: () => 1.5, cast: (l) => 1.0 * l, element: 'wind',
    desc: (l) => `Call a storm onto the target area: ${l} lightning strike${l > 1 ? 's' : ''}, each hitting every enemy nearby for 80% MATK as wind damage.` });

  /* ---------------- Archer ---------------- */
  def('double_strafe', { name: 'Double Strafe', job: 'archer', pos: [0, 0], icon: { shape: 's_arrows', color: '#8fd16a' },
    sp: () => 12, cd: () => 0.45, needs: 'bow',
    desc: (l) => `Fire two arrows at once, each dealing ${pct(100 + 10 * l)} damage. Requires a bow.` });
  def('arrow_shower', { name: 'Arrow Shower', job: 'archer', pos: [1, 0], req: [['double_strafe', 5]], icon: { shape: 's_rain', color: '#6fc2a0' },
    sp: () => 15, cd: () => 0.8, needs: 'bow',
    desc: (l) => `Rain arrows on the target area, hitting every enemy nearby for ${pct(75 + 5 * l)} damage and pushing them back. Requires a bow.` });
  def('arrow_repel', { name: 'Arrow Repel', job: 'archer', type: 'active', max: 1, pos: [2, 0], req: [['double_strafe', 3]], icon: { shape: 's_arrow', color: '#4f9f8a' },
    sp: () => 15, cd: () => 1, cast: () => 1.5, needs: 'bow',
    desc: () => 'A heavy shot dealing 150% damage that knocks the target far back. Requires a bow.' });
  def('owls_eye', { name: 'Owl’s Eye', job: 'archer', type: 'passive', pos: [0, 1], icon: { shape: 's_eye', color: '#e3b55a' },
    desc: (l) => `+${l} DEX.`, bonus: (l) => ({ dex: l }) });
  def('vultures_eye', { name: 'Vulture’s Eye', job: 'archer', type: 'passive', pos: [1, 1], req: [['owls_eye', 3]], icon: { shape: 's_eye', color: '#7fb8ff' },
    desc: (l) => `+${(l * 0.5).toFixed(1)} bow range and +${l} HIT.`, bonus: (l) => ({ hit: l, bowRange: l * 0.5 }) });
  def('improve_concentration', { name: 'Improve Concentration', job: 'archer', target: 'self', pos: [2, 1], req: [['vultures_eye', 1]], icon: { shape: 's_eye', color: '#ffb347' },
    sp: (l) => 20 + 5 * l, cd: () => 2, cast: () => 0.5,
    desc: (l) => `Focus for ${40 + 20 * l} seconds: +${1 + Math.ceil(l / 2)} AGI and DEX.` });

  /* ---------------- Acolyte ---------------- */
  def('heal', { name: 'Heal', job: 'acolyte', target: 'ally', range: range9, pos: [0, 0], icon: { shape: 's_cross', color: '#7dff9a' },
    sp: (l) => 10 + 3 * l, cd: () => 0.8, cast: () => 0.4, element: 'holy',
    desc: (l) => `Target a character: restore ${l * 8 + 4}× (base level + INT) ÷ 8 HP.` });
  def('increase_agi', { name: 'Increase AGI', job: 'acolyte', target: 'ally', range: range9, pos: [1, 0], req: [['heal', 3]], icon: { shape: 's_wing', color: '#8fe0d0' },
    sp: (l) => 15 + 3 * l, hp: () => 15, cd: () => 1, cast: () => 1.0, element: 'holy',
    desc: (l) => `Target a character: +${2 + l} AGI and 25% faster movement for ${40 + 20 * l} seconds. Costs 15 HP.` });
  def('decrease_agi', { name: 'Decrease AGI', job: 'acolyte', pos: [2, 0], req: [['increase_agi', 1]], range: range9, icon: { shape: 's_wing', color: '#b07fd6' },
    sp: (l) => 13 + 2 * l, cd: () => 1, cast: () => 1.0, element: 'holy',
    desc: (l) => `Slow a monster for ${20 + 5 * l} seconds: it moves and attacks much more slowly. ${40 + 2 * l}% success.` });
  def('divine_protection', { name: 'Divine Protection', job: 'acolyte', type: 'passive', pos: [0, 1], icon: { shape: 's_shield', color: '#f3e3a0' },
    desc: (l) => `+${2 * l} soft DEF.`, bonus: (l) => ({ softDef: 2 * l }) });
  def('blessing', { name: 'Blessing', job: 'acolyte', target: 'ally', range: range9, pos: [1, 1], req: [['divine_protection', 5]], icon: { shape: 's_halo', color: '#ffe27a' },
    sp: (l) => 24 + 4 * l, cd: () => 1, cast: () => 0.8, element: 'holy',
    desc: (l) => `Target a character: +${l} STR, DEX and INT for ${40 + 20 * l} seconds.` });
  def('angelus', { name: 'Angelus', job: 'acolyte', target: 'self', pos: [2, 1], req: [['divine_protection', 3]], icon: { shape: 's_halo', color: '#ffd0f0' },
    sp: (l) => 20 + 3 * l, cd: () => 2, cast: () => 0.5, element: 'holy',
    desc: (l) => `A guardian light: +${3 * l} soft DEF for ${30 * l} seconds.` });
  def('holy_light', { name: 'Holy Light', job: 'acolyte', max: 1, pos: [0, 2], range: range9, icon: { shape: 's_star', color: '#fff2a0' },
    sp: () => 15, cd: () => 0.6, cast: () => 2.0, element: 'holy',
    desc: () => 'A spear of light dealing 125% MATK as holy damage.' });

  /* ---------------- Thief ---------------- */
  def('double_attack', { name: 'Double Attack', job: 'thief', type: 'passive', pos: [0, 0], icon: { shape: 's_daggers', color: '#d7dee8' },
    desc: (l) => `${5 * l}% chance to hit twice with a dagger. +${l} HIT.`, bonus: (l) => ({ hit: l, doubleAttack: 5 * l }) });
  def('envenom', { name: 'Envenom', job: 'thief', pos: [1, 0], icon: { shape: 's_drop', color: '#6fd06a' },
    sp: () => 12, cd: () => 0.5, element: 'poison',
    desc: (l) => `A poisoned strike adding ${15 * l} damage, with a ${10 + 4 * l}% chance to poison the target for 12 seconds.` });
  def('improve_dodge', { name: 'Improve Dodge', job: 'thief', type: 'passive', pos: [0, 1], icon: { shape: 's_swirl', color: '#8fe0d0' },
    desc: (l) => `+${3 * l} FLEE.`, bonus: (l) => ({ flee: 3 * l }) });
  def('back_slide', { name: 'Back Slide', job: 'thief', target: 'self', max: 1, pos: [1, 1], req: [['improve_dodge', 2]], icon: { shape: 's_dash', color: '#9fd0ff' },
    sp: () => 7, cd: () => 1.5, desc: () => 'Leap 5 steps backwards, out of harm’s way.' });
  def('steal', { name: 'Steal', job: 'thief', pos: [0, 2], icon: { shape: 's_hand', color: '#c79bff' },
    sp: () => 10, cd: () => 1,
    desc: (l) => `Try to swipe an item a monster would drop. Base chance ${4 + 6 * l}%, better with DEX. Once per monster.` });
  def('hiding', { name: 'Hiding', job: 'thief', target: 'self', pos: [1, 2], req: [['steal', 5]], icon: { shape: 's_zzz', color: '#5f5a8a' },
    sp: () => 10, cd: () => 1,
    desc: (l) => `Vanish from sight. Monsters lose track of you. Drains 1 SP every ${4 + l} seconds. Use again, or click the ground, to reappear.` });

  /* ---------------- Merchant ---------------- */
  def('mammonite', { name: 'Mammonite', job: 'merchant', pos: [0, 0], icon: { shape: 's_coin', color: '#f5c542' },
    sp: () => 5, zeny: (l) => 100 * l, cd: () => 0.5,
    desc: (l) => `Strike with the weight of your wallet for ${pct(100 + 50 * l)} damage. Costs ${100 * l} Zeny.` });
  def('cart_revolution', { name: 'Cart Revolution', job: 'merchant', max: 1, pos: [1, 0], req: [['mammonite', 3]], icon: { shape: 's_bag', color: '#d98a4a' },
    sp: () => 12, cd: () => 1,
    desc: () => 'Swing your heavy pack in a wide arc: 150% damage to everything around the target, knocking them back.' });
  def('discount', { name: 'Discount', job: 'merchant', type: 'passive', pos: [0, 1], icon: { shape: 's_tag', color: '#7fe08a' },
    desc: (l) => `Buy from NPC shops ${5 + 2 * l}% cheaper.`, bonus: (l) => ({ discount: 5 + 2 * l }) });
  def('overcharge', { name: 'Overcharge', job: 'merchant', type: 'passive', pos: [1, 1], req: [['discount', 3]], icon: { shape: 's_bag', color: '#f5c542' },
    desc: (l) => `Sell to NPC shops for ${5 + 2 * l}% more.`, bonus: (l) => ({ overcharge: 5 + 2 * l }) });
  def('enlarge_weight', { name: 'Enlarge Weight Limit', job: 'merchant', type: 'passive', pos: [0, 2], icon: { shape: 's_bag', color: '#a8743c' },
    desc: (l) => `Carry ${200 * l} more weight.`, bonus: (l) => ({ weightLimit: 200 * l }) });
  def('crazy_uproar', { name: 'Crazy Uproar', job: 'merchant', target: 'self', max: 1, pos: [1, 2], req: [['enlarge_weight', 3]], icon: { shape: 's_shout', color: '#ff9f43' },
    sp: () => 8, cd: () => 2, desc: () => 'A rousing shout: +4 STR and +30 ATK for 5 minutes.' });

  // SP costs are kept low so skills can be used freely (about 45% of classic values).
  for (const s of Object.values(S)) {
    const raw = s.sp;
    s.sp = (l) => (raw(l) > 0 ? Math.max(1, Math.round(raw(l) * 0.45)) : 0);
  }

  G.Skills = {
    DB: S,
    get(id) { return S[id] || null; },
    forJob(job) { return Object.values(S).filter((s) => s.job === job); },
    // Skills a character of this job can have (Novice-only ones vanish after a job change).
    allowed(id, job) { const s = S[id]; return !!s && (!s.noviceOnly || job === 'novice'); },
  };
})(window.G = window.G || {});
