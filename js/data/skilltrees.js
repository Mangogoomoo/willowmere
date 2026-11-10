/* Pre-renewal skill trees for every class.
   1) defines the skills that were still missing (most effects are data for
      the generic engine; unique ones are named handlers in systems/skillsx.js)
   2) applies the classic tree to every job: max level, prerequisites,
      position [row, col] and quest-skill flags (quest skills cost no skill
      points and unlock at job level 15 of their job).
   Clones (e.g. the Crusader's Heal) reuse another skill's effect via `effect`. */
(function (G) {
  'use strict';
  const S = G.Skills.DB;
  const I = (shape, color, element) => ({ shape, color, element });
  const base = { type: 'active', target: 'enemy', max: 10, req: [], sp: () => 0, cd: () => 0.5, cast: () => 0, range: 'weapon' };
  const A = (id, job, name, icon, o) => { S[id] = Object.assign({ id, job, name, icon }, base, o); };
  const P = (id, job, name, icon, desc, bonus, o) => { S[id] = Object.assign({ id, job, name, icon }, base, { type: 'passive', desc, bonus: bonus || (() => ({})) }, o || {}); };
  const B = (id, job, name, icon, buffId, dur, sp, desc, o) => A(id, job, name, icon, Object.assign({ target: 'self', sp, cd: () => 1, fx: { kind: 'buff', id: buffId, dur, color: icon.color }, desc }, o || {}));
  const r = (n) => () => n;
  const pct = (n) => `${Math.round(n)}%`;
  const clone = (id, src, job, extra) => { S[id] = Object.assign({}, S[src], { id, job, effect: S[src].effect || src }, extra || {}); };
  const note = ' (No Willowmere monster does this yet, so it has no effect for now.)';

  /* ================= Swordsman ================= */
  P('two_hand_mastery', 'swordsman', 'Two-Handed Sword Mastery', I('s_sword', '#ffb347'), (l) => `+${4 * l} ATK with a two-handed sword.`,
    (l, p) => (p.equippedWeaponType() === 'twohand' ? { atk: 4 * l } : {}));
  P('moving_hp_recovery', 'swordsman', 'Moving HP Recovery', I('s_heart', '#ff8a8a'), () => 'Your HP keeps recovering while you walk.', () => ({ movingRegen: 1 }));
  P('fatal_blow', 'swordsman', 'Fatal Blow', I('s_bash', '#ffd84a'), () => 'Bash at level 6 or higher can stun (5% per level above 5).', () => ({ fatalBlow: 1 }));
  A('auto_berserk', 'swordsman', 'Auto Berserk', I('s_shout', '#ff3b3b'), { target: 'self', max: 1, sp: r(1), cd: r(1), effect: 'auto_berserk',
    desc: () => 'Toggle: while your HP is below 25%, you deal 32% more damage.' });

  /* ================= Mage ================= */
  A('napalm_beat', 'mage', 'Napalm Beat', I('s_soul', '#c79bff'), { range: r(9), element: 'ghost', sp: (l) => 5 + Math.ceil(l / 2), cd: r(0.6), cast: r(0.5),
    fx: { kind: 'magic', mult: (l) => 0.7 + 0.1 * l, area: 1.6, element: 'ghost', visual: 'impact', color: '#c79bff' },
    desc: (l) => `Ghostly force around the target: ${pct(70 + 10 * l)} MATK ghost damage to it and its neighbours.` });
  A('stone_curse', 'mage', 'Stone Curse', I('s_hand', '#9aa3ad'), { range: r(2), sp: (l) => 13 - Math.floor(l / 2), cd: r(1), catalyst: [['red_gemstone', 1]],
    fx: { kind: 'status', status: { id: 'stone', chance: (l) => 20 + 4 * l, dur: r(20) }, visual: 'impact', color: '#9aa3ad' },
    desc: (l) => `${20 + 4 * l}% chance to turn a monster to stone for 20 s. Uses a Red Gemstone.` });
  A('safety_wall', 'mage', 'Safety Wall', I('s_shield', '#ff9ec2'), { target: 'self', sp: (l) => 15 + 2 * Math.ceil(l / 3), cd: r(2), cast: (l) => 4 - 0.25 * l,
    catalyst: [['blue_gemstone', 1]], effect: 'safety_wall', desc: (l) => `A pink barrier at your feet blocks the next ${l + 1} melee hits while you stand in it. Uses a Blue Gemstone.` });
  A('fire_wall', 'mage', 'Fire Wall', I('s_burst', '#ff7a3d', 'fire'), { range: r(9), element: 'fire', sp: r(20), cd: r(1), cast: (l) => 2.15 - 0.15 * l, effect: 'fire_wall',
    desc: (l) => `A wall of fire at the target: ${l + 2} hits of 50% MATK fire damage to monsters touching it, pushing them back.` });
  B('sight', 'mage', 'Sight', I('s_eye', '#ff7a3d'), 'sight', r(10), r(5), () => 'A ring of fire circles you for 10 s, revealing hidden things.', { max: 1 });
  B('energy_coat', 'mage', 'Energy Coat', I('s_shield', '#9fd8ff'), 'energy_coat', r(300), r(15), () => 'For 5 minutes, SP absorbs part of every hit (up to 30% less damage when your SP is full).', { max: 1, cast: r(5) });

  /* ================= Archer ================= */
  A('arrow_crafting', 'archer', 'Arrow Crafting', I('s_arrow', '#c9a06b'), { target: 'self', max: 1, sp: r(5), effect: 'arrow_crafting',
    desc: () => 'Open the arrow bench: see every arrow your materials can make (Jellopy, Iron, Steel, Ember, elemental stones and more) and make one batch or all of them.' });

  /* ================= Acolyte ================= */
  P('demon_bane', 'acolyte', 'Demon Bane', I('s_halo', '#c79bff'), (l) => `+${3 * l} ATK against shadow, ghost and undead monsters.`, (l) => ({ demonBane: 3 * l }));
  A('ruwach', 'acolyte', 'Ruwach', I('s_halo', '#fff2a0'), { target: 'self', max: 1, sp: r(10), cd: r(1), fx: { kind: 'buff', id: 'ruwach', dur: r(10), color: '#fff2a0' },
    desc: () => 'A holy light circles you for 10 s. Any hidden monster or player that comes near is revealed, and hidden monsters take 145% MATK holy damage.' });
  A('pneuma', 'acolyte', 'Pneuma', I('s_swirl', '#bfe8ff'), { target: 'ground', range: r(9), max: 1, sp: r(10), cd: r(2), effect: 'pneuma',
    desc: () => 'Click the ground to raise a pillar of wind for 10 s. Anyone standing inside it (you or a monster) is immune to ranged physical attacks such as arrows.' });
  A('teleportation', 'acolyte', 'Teleportation', I('s_swirl', '#c79bff'), { target: 'self', max: 2, sp: (l) => (l === 1 ? 10 : 9), cd: r(1), effect: 'teleportation',
    desc: (l) => (l === 1 ? 'Teleport to a random spot on this map, like a Fly Wing.' : 'Return to your save point, like a Butterfly Wing.') });
  A('warp_portal', 'acolyte', 'Warp Portal', I('s_swirl', '#6fc3ff'), { target: 'self', max: 4, sp: (l) => 38 - 3 * l, cd: r(2), catalyst: [['blue_gemstone', 1]], effect: 'warp_portal',
    desc: (l) => `Open a portal to your save point${l > 1 ? ` or one of ${l - 1} memorised place${l > 2 ? 's' : ''}` : ''}. Uses a Blue Gemstone. Memorise places from the same menu.` });
  A('aqua_benedicta', 'acolyte', 'Aqua Benedicta', I('s_drop', '#9fd8ff'), { target: 'self', max: 1, sp: r(10), cd: r(1), cast: r(1), effect: 'aqua_benedicta',
    desc: () => 'Stand in water to bless an Empty Bottle into Holy Water.' });
  A('signum_crucis', 'acolyte', 'Signum Crucis', I('s_cross', '#c79bff'), { target: 'self', sp: r(35), cd: r(1), cast: r(0.5),
    fx: { kind: 'status', area: 8, at: 'self', status: { id: 'signum', chance: (l) => 23 + 4 * l, dur: r(300) }, visual: 'ring', color: '#c79bff' },
    desc: (l) => `A holy sign: shadow and undead monsters around you have a ${23 + 4 * l}% chance to lose ${10 + 4 * l}% DEF.` });
  A('cure', 'acolyte', 'Cure', I('s_cross', '#7dff9a'), { target: 'ally', range: r(9), max: 1, sp: r(15), cd: r(1), effect: 'cure',
    desc: () => 'Remove silence, blindness and confusion from a character.' + note });

  /* ================= Thief ================= */
  A('detoxify', 'thief', 'Detoxify', I('s_drop', '#7dff9a'), { target: 'ally', range: r(9), max: 1, sp: r(10), cd: r(1), effect: 'cure', desc: () => 'Cure poison on a character.' + note });
  A('sand_attack', 'thief', 'Sand Attack', I('s_rain', '#c9a06b'), { max: 1, sp: r(9), cd: r(0.8), fx: { kind: 'phys', mult: r(1.3), element: 'earth', visual: 'impact', color: '#c9a06b', status: { id: 'blinded', chance: r(20), dur: r(15) } },
    desc: () => 'Throw sand: 130% earth damage and a 20% chance to blind (blinded monsters hit you less).' });
  A('find_stone', 'thief', 'Find Stone', I('s_hand', '#9aa3ad'), { target: 'self', max: 1, sp: r(2), cd: r(0.5), effect: 'find_stone', desc: () => 'Pick up a Stone from the ground.' });
  A('throw_stone', 'thief', 'Throw Stone', I('s_bash', '#9aa3ad'), { max: 1, range: r(7), sp: r(2), cd: r(0.5), catalyst: [['stone', 1]], effect: 'throw_stone',
    desc: () => 'Throw a Stone for 50 damage, with a small chance to stun.' });

  /* ================= Merchant ================= */
  P('pushcart', 'merchant', 'Pushcart', I('s_bag', '#c9a06b'), (l) => `Pull a cart that holds 100 kinds of item (8,000 weight, Alt+W). Moving speed ${l < 10 ? `−${50 - 5 * l}%` : 'normal'} while pulling it.`,
    () => ({ cart: 1 }));
  A('vending', 'merchant', 'Vending', I('s_coin', '#ffd84a'), { target: 'self', sp: r(30), cd: r(2), effect: 'vending',
    desc: (l) => `Open a shop for other players: set out up to ${2 + l} kinds of items from your cart at your own price each. It stays open while you play another character. (Online only.)` });
  // Appraise a monster's loot from a safe distance (long range, so aggressive monsters don't notice you).
  A('item_appraisal', 'merchant', 'Item Appraisal', I('s_eye', '#ffd84a'), { target: 'enemy', max: 1, sp: r(10), cd: r(1), range: () => 14, effect: 'appraise',
    desc: () => 'Look a monster over from up to 14 steps away: see everything it can drop and the chance of each.' });
  A('change_cart', 'merchant', 'Change Cart', I('s_bag', '#ff9ec2'), { target: 'self', max: 1, sp: r(40), cd: r(1), effect: 'change_cart', desc: () => 'Repaint your cart in a new style.' });

  /* ================= Knight ================= */
  A('spear_stab', 'knight', 'Spear Stab', I('s_arrow', '#9fc8ff'), { needs: 'spear', sp: r(9), cd: r(0.6), fx: { kind: 'phys', mult: (l) => 1 + 0.2 * l, knock: 2.4, visual: 'impact', color: '#9fc8ff' },
    desc: (l) => `A driving thrust for ${pct(100 + 20 * l)} that knocks the target back.` });
  A('spear_boomerang', 'knight', 'Spear Boomerang', I('s_swirl', '#9fc8ff'), { needs: 'spear', max: 5, range: (l) => 3 + 2 * l, sp: r(10), cd: r(1),
    fx: { kind: 'phys', mult: (l) => 1 + 0.5 * l, ranged: true, visual: 'orb', color: '#cfd8e6' }, desc: (l) => `Throw your spear (range ${3 + 2 * l}) for ${pct(100 + 50 * l)}.` });
  B('auto_counter', 'knight', 'Auto Counter', I('s_shield', '#ffb347'), 'auto_counter', (l) => 0.4 * l, r(3), (l) => `For ${(0.4 * l).toFixed(1)} s, the next melee attack against you is blocked and countered with a guaranteed critical hit.`, { max: 5, cd: r(0.5) });
  A('riding', 'knight', 'Peco Peco Riding', I('s_wing', '#ffd84a'), { target: 'self', max: 1, sp: r(0), cd: r(1), effect: 'riding',
    desc: () => 'Mount or dismount your Peco Peco: 36% faster movement, but attacks are slower without Cavalier Mastery. Brandish Spear needs it.' });
  P('cavalier_mastery', 'knight', 'Cavalier Mastery', I('s_wing', '#ffb347'), (l) => `Recover ${10 * l}% of the attack speed lost while riding.`, (l) => ({ cavalier: l }));
  A('charge_attack', 'knight', 'Charge Attack', I('s_dash', '#ff7a3d'), { max: 1, range: r(14), sp: r(40), cd: r(1), effect: 'charge_attack',
    desc: () => 'Charge at a monster from afar; the longer the charge, the harder the hit (100% to 500%).' });

  /* ================= Crusader ================= */
  A('shield_charge', 'crusader', 'Shield Charge', I('s_shield', '#ffd77a'), { needsShield: true, max: 5, sp: r(10), cd: r(0.8),
    fx: { kind: 'phys', mult: (l) => 1.2 + 0.2 * l, knock: 1.5, visual: 'impact', color: '#ffd77a', status: { id: 'stunned', chance: (l) => 15 + 5 * l, dur: r(3) } },
    desc: (l) => `Ram with your shield: ${pct(120 + 20 * l)}, a ${15 + 5 * l}% chance to stun. Needs a shield.` });
  A('shield_boomerang', 'crusader', 'Shield Boomerang', I('s_swirl', '#ffd77a'), { needsShield: true, max: 5, range: (l) => 3 + 2 * l, sp: r(12), cd: r(0.8),
    fx: { kind: 'phys', mult: (l) => 1.3 + 0.3 * l, ranged: true, visual: 'orb', color: '#ffd77a' }, desc: (l) => `Hurl your shield for ${pct(130 + 30 * l)}. Needs a shield.` });
  B('reflect_shield', 'crusader', 'Reflect Shield', I('s_shield', '#bfe8ff'), 'reflect_shield', r(300), (l) => 17 + 2 * l, (l) => `For 5 minutes, ${10 + 3 * l}% of melee damage you take is reflected back. Needs a shield.`, { needsShield: true });
  B('defender', 'crusader', 'Defender', I('s_shield', '#9aa3ad'), 'defender', r(180), r(15), (l) => `Raise your shield against ranged attacks (−${5 + 15 * l}% ranged damage), moving slower.` + note, { max: 5, needsShield: true });
  B('devotion', 'crusader', 'Devotion', I('s_heart', '#ffd77a'), 'devotion', (l) => 15 + 15 * l, (l) => 25, () => 'Take hits for a party member.' + note.replace('monster does this', 'party exists'), { max: 5 });
  A('providence', 'crusader', 'Providence', I('s_halo', '#ffd77a'), { target: 'ally', range: r(9), max: 5, sp: r(30), cd: r(1), cast: r(3), fx: { kind: 'buff', id: 'providence', dur: r(180), color: '#ffd77a' },
    desc: (l) => `Bless a character with +${5 * l} MDEF for 3 minutes.` });
  B('spear_quicken', 'crusader', 'Spear Quicken', I('s_wing', '#ffb347'), 'spear_quicken', (l) => 30 * l, (l) => 14 + 2 * l, (l) => `Attack ${21 + l}% faster with a spear for ${30 * l} s.`, { needs: 'spear' });
  P('shrink', 'crusader', 'Shrink', I('s_shield', '#ffb347'), () => 'When Auto Guard blocks a hit, the attacker may be knocked back.', () => ({ shrink: 1 }));

  /* ================= Wizard ================= */
  A('fire_pillar', 'wizard', 'Fire Pillar', I('s_burst', '#ff7a3d', 'fire'), { range: r(9), element: 'fire', sp: r(40), cd: r(1), cast: (l) => 3.3 - 0.3 * l, catalyst: [], effect: 'fire_pillar',
    desc: (l) => `Plant a fire trap at the target's feet: ${l + 2} bursts of ${pct(50 + 10 * l)} MATK fire damage to everything near it when it erupts.` });
  A('sightrasher', 'wizard', 'Sightrasher', I('s_burst', '#ff7a3d', 'fire'), { target: 'self', sp: (l) => 33 + 2 * l, cd: r(1), effect: 'sightrasher',
    fx: { kind: 'magic', mult: (l) => 1 + 0.2 * l, area: 3.5, at: 'self', element: 'fire', knock: 2, visual: 'ring', color: '#ff7a3d' },
    desc: (l) => `While Sight is active, release it as a firestorm: ${pct(100 + 20 * l)} MATK fire damage around you, with knockback.` });
  A('water_ball', 'wizard', 'Water Ball', I('s_drop', '#6fc3ff', 'water'), { range: r(9), element: 'water', max: 5, sp: (l) => 15 + 5 * l, cd: r(1), cast: (l) => l,
    fx: { kind: 'magic', mult: (l) => 1 + 0.3 * l, hits: (l) => 2 + l, hitDelay: 0.15, element: 'water', visual: 'orb', color: '#6fc3ff' },
    desc: (l) => `Balls of water hit ${2 + l} times for ${pct(100 + 30 * l)} MATK water damage (more if you stand in water).` });
  A('ice_wall', 'wizard', 'Ice Wall', I('s_shield', '#bfe8ff', 'water'), { range: r(9), sp: r(20), cd: r(1), effect: 'ice_wall',
    desc: (l) => `Encase the target's surroundings in ice for ${5 + l} s: monsters there can't move.` });
  A('frost_nova', 'wizard', 'Frost Nova', I('s_burst', '#bfe8ff', 'water'), { target: 'self', sp: (l) => 45 - 2 * l, cd: r(1.5), cast: (l) => 6 - 0.4 * l, element: 'water',
    fx: { kind: 'magic', mult: (l) => 0.73 + 0.07 * l, area: 3.5, at: 'self', element: 'water', visual: 'ring', color: '#bfe8ff', status: { id: 'frozen', chance: (l) => 33 + 5 * l, dur: r(4) } },
    desc: (l) => `A ring of frost around you: ${pct(73 + 7 * l)} MATK water damage, ${33 + 5 * l}% chance to freeze.` });
  A('quagmire', 'wizard', 'Quagmire', I('s_swirl', '#7a5a3a'), { range: r(9), max: 5, sp: r(5), cd: r(1), effect: 'quagmire',
    desc: (l) => `Turn the ground around the target into mud for ${5 * l} s: monsters in it are slowed and easier to hit.` });
  A('sense', 'wizard', 'Sense', I('s_eye', '#9fd8ff'), { range: r(9), max: 1, sp: r(10), cd: r(0.5), effect: 'sense', desc: () => 'Study a monster: shows its level, HP, element and defences.' });
  B('sight_blaster', 'wizard', 'Sight Blaster', I('s_burst', '#ffb347', 'fire'), 'sight_blaster', r(120), r(40), () => 'A fireball circles you; the first monster to come close is blasted for 100% MATK fire damage and knocked back.', { max: 1, cast: r(2) });

  /* ================= Sage ================= */
  A('cast_cancel', 'sage', 'Cast Cancel', I('s_hand', '#9fd8ff'), { target: 'self', max: 5, sp: r(2), cd: r(0.2), effect: 'cast_cancel',
    desc: (l) => `Stop the spell you are casting and get ${10 + 15 * l}% of its SP back.` });
  B('magic_rod', 'sage', 'Magic Rod', I('s_bolt', '#c79bff'), 'magic_rod', (l) => 0.2 + 0.2 * l, r(2), (l) => 'Absorb the next spell cast at you and drink its SP.' + note, { max: 5 });
  A('spell_breaker', 'sage', 'Spell Breaker', I('s_hand', '#c79bff'), { max: 5, range: r(9), sp: r(10), cd: r(1), fx: { kind: 'magic', mult: (l) => 0.1 * l, visual: 'impact', color: '#c79bff' },
    desc: () => 'Interrupt a monster casting a spell and drain its magic.' + note });
  P('free_cast', 'sage', 'Free Cast', I('s_dash', '#7fd0a0'), (l) => `Walk while casting, at ${25 + 5 * l}% speed.`, (l) => ({ freeCast: l }));
  B('auto_spell', 'sage', 'Hindsight', I('s_book', '#ffd84a'), 'auto_spell', (l) => 120 + 30 * l, (l) => 30 + 5 * l, (l) => `For ${120 + 30 * l} s, your attacks have a ${Math.min(14, 5 + l)}% chance to cast a bolt for free.`, { cast: r(1) });
  B('endow_tsunami', 'sage', 'Endow Tsunami', I('s_bolt', '#6fc3ff', 'water'), 'endow_tsunami', (l) => 120 * l, r(18), (l) => `Your weapon becomes water element for ${2 * l} minutes.`, { max: 5, cast: r(3) });
  B('endow_quake', 'sage', 'Endow Quake', I('s_bolt', '#c9a06b', 'earth'), 'endow_quake', (l) => 120 * l, r(18), (l) => `Your weapon becomes earth element for ${2 * l} minutes.`, { max: 5, cast: r(3) });
  P('dragonology', 'sage', 'Dragonology', I('s_book', '#ff7a3d'), (l) => `+${Math.ceil(l / 2)} INT; more damage against dragons.`, (l) => ({ int: Math.ceil(l / 2) }));
  const zone = (id, name, color, el, desc) => A(id, 'sage', name, I('s_burst', color, el), { target: 'self', max: 5, sp: (l) => 48 - 2 * l, cd: r(3), cast: r(3), catalyst: [['yellow_gemstone', 1]], effect: 'sage_zone', zoneId: id, desc });
  zone('volcano', 'Volcano', '#ff7a3d', 'fire', (l) => `For ${60 * l} s, standing in this zone gives +${5 + 5 * l} ATK. Uses a Yellow Gemstone.`);
  zone('deluge', 'Deluge', '#6fc3ff', 'water', (l) => `For ${60 * l} s, standing in this zone gives +${[5, 9, 12, 14, 15][l - 1]}% Max HP. Uses a Yellow Gemstone.`);
  zone('whirlwind', 'Whirlwind', '#ffe066', 'wind', (l) => `For ${60 * l} s, standing in this zone gives +${3 * l} FLEE. Uses a Yellow Gemstone.`);
  A('land_protector', 'sage', 'Magnetic Earth', I('s_shield', '#c9a06b'), { target: 'self', max: 5, sp: (l) => 66 - 6 * l, cd: r(3), cast: r(5), catalyst: [['blue_gemstone', 1], ['yellow_gemstone', 1]], effect: 'land_protector',
    desc: (l) => `Clear every ground effect around you and keep new ones away for ${100 + 30 * l} s.` });
  A('dispell', 'sage', 'Dispell', I('s_hand', '#ff8a8a'), { max: 5, range: r(9), sp: r(1), cd: r(1), cast: r(2), catalyst: [['yellow_gemstone', 1]], effect: 'dispell',
    desc: (l) => `${50 + 10 * l}% chance to strip every effect from a monster (Provoke, poison, curses, everything).` });
  A('abracadabra', 'sage', 'Hocus-pocus', I('s_star', '#ff9ec2'), { range: r(9), sp: r(50), cd: r(1), catalyst: [['yellow_gemstone', 2]], effect: 'abracadabra',
    desc: (l) => `Cast a completely random attack skill at level ${Math.ceil(l / 2)}. Who knows what happens? Uses 2 Yellow Gemstones.` });
  A('create_converter', 'sage', 'Create Elemental Converter', I('s_book', '#ffd84a'), { target: 'self', max: 1, sp: r(30), effect: 'craft', craft: 'converter',
    desc: () => 'Make Elemental Converters, which endow a weapon with an element for 3 minutes.' });
  A('elemental_change', 'sage', 'Elemental Change', I('s_star', '#7fd0a0'), { max: 1, range: r(9), sp: r(30), cd: r(1), cast: r(2), effect: 'elemental_change',
    desc: () => 'Change a monster\'s element to earth, so it takes extra damage from fire.' });

  /* ================= Hunter (traps are placed at the clicked monster's feet) ================= */
  const trap = (id, name, color, el, desc, o) => A(id, 'hunter', name, I('s_trap', color, el), Object.assign({ max: 5, range: r(4), sp: r(10), cd: r(0.5), effect: 'trap', trapId: id, desc }, o || {}));
  trap('skid_trap', 'Skid Trap', '#9fd8ff', null, (l) => `A slippery trap: the monster that steps on it slides ${1 + l} units away.`);
  trap('land_mine', 'Land Mine', '#c9a06b', 'earth', (l) => `Explodes for ${pct(100 + 40 * l)} earth damage and may stun.`);
  trap('ankle_snare_trap', 'Ankle Snare', '#8fd16a', null, (l) => `Snares a monster for ${4 + 2 * l} s: it can't move.`);
  trap('shockwave_trap', 'Shockwave Trap', '#c79bff', null, (l) => `A shockwave that drains magic (${pct(50 + 15 * l)} damage, since monsters have no SP).`);
  trap('sandman', 'Sandman', '#ffe27a', null, (l) => `Puts monsters around it to sleep (${40 + 10 * l}% chance) for ${3 + l} s.`);
  trap('flasher', 'Flasher', '#ffffff', null, (l) => `A blinding flash: monsters around it are blinded for ${10 + 2 * l} s.`);
  trap('freezing_trap', 'Freezing Trap', '#bfe8ff', 'water', (l) => `${pct(100 + 20 * l)} water damage and freezes the monsters around it.`);
  trap('blast_mine', 'Blast Mine', '#ffe066', 'wind', (l) => `A wind explosion for ${pct(150 + 30 * l)} to everything around it.`);
  trap('claymore_trap', 'Claymore Trap', '#ff7a3d', 'fire', (l) => `A huge fire explosion for ${pct(200 + 50 * l)} to everything around it.`, { catalyst: [] });
  A('remove_trap', 'hunter', 'Remove Trap', I('s_hand', '#c9a06b'), { target: 'self', max: 1, sp: r(5), effect: 'remove_trap', desc: () => 'Pick up your nearest trap.' });
  trap('talkie_box', 'Talkie Box', '#ff9ec2', null, () => 'A box that shouts a message when a monster steps on it.', { max: 1 });
  A('spring_trap', 'hunter', 'Spring Trap', I('s_trap', '#c9a06b'), { target: 'self', max: 5, sp: r(10), effect: 'remove_trap', desc: (l) => `Your falcon destroys a trap up to ${3 + l} units away.` });
  P('falconry_mastery', 'hunter', 'Falconry Mastery', I('s_wing', '#c9a06b'), () => 'A falcon rides on your shoulder. Needed for Blitz Beat.', () => ({ falcon: 1 }));
  P('steel_crow', 'hunter', 'Steel Crow', I('s_wing', '#cfd8e6'), (l) => `Your falcon's Blitz Beat deals +${6 * l} damage per hit.`, (l) => ({ steelCrow: 6 * l }));
  A('detect', 'hunter', 'Detect', I('s_eye', '#c9a06b'), { target: 'self', max: 4, sp: r(8), cd: r(1), fx: { kind: 'phys', mult: r(0.5), area: 3, at: 'self', visual: 'ring', color: '#c9a06b' },
    desc: () => 'Your falcon reveals hidden enemies around you, pecking them as it goes.' });
  A('phantasmic_arrow', 'hunter', 'Phantasmic Arrow', I('s_arrow', '#c79bff'), { max: 1, needs: 'bow', range: r(9), sp: r(10), cd: r(0.6),
    fx: { kind: 'phys', mult: r(1.5), knock: 3, ranged: true, visual: 'arrow' }, desc: () => 'An arrow of pure force: 150% damage, strong knockback.' });

  /* ================= Bard & Dancer ================= */
  const lessons = (id, job, name, wt) => P(id, job, name, I('s_book', '#ff9ec2'), (l) => `+${3 * l} ATK with ${wt === 'instrument' ? 'an instrument' : 'a whip'}; songs and dances move faster.`,
    (l, p) => (p.equippedWeaponType() === wt ? { atk: 3 * l } : {}));
  lessons('music_lessons', 'bard', 'Music Lessons', 'instrument');
  lessons('dance_lessons', 'dancer', 'Dance Lessons', 'whip');
  for (const job of ['bard', 'dancer']) {
    const p = job === 'bard' ? '' : 'dc_';
    A(p + 'adaptation', job, 'Adaptation to Circumstances', I('s_hand', '#ff9ec2'), { target: 'self', max: 1, sp: r(1), effect: 'adaptation', desc: () => 'End your current performance.' });
    A(p + 'encore', job, 'Encore', I('s_star', '#ff9ec2'), { target: 'self', max: 1, sp: r(1), cd: r(1), effect: 'encore', desc: () => 'Repeat your last performance for half the SP.' });
    const ens = (id, name, icon, o, desc) => A(p + id, job, name, icon, Object.assign({ target: 'self', sp: r(20), cd: r(3), max: 5, desc: (l) => desc(l) + ' (Ensemble: performed solo at half strength.)' }, o));
    ens('lullaby', 'Lullaby', I('s_zzz', '#c79bff'), { max: 1, fx: { kind: 'status', area: 5, at: 'self', status: { id: 'asleep', chance: r(40), dur: r(8) }, visual: 'ring', color: '#c79bff' } }, () => 'Monsters around you may fall asleep.');
    ens('mr_kim', 'Mr. Kim A Rich Man', I('s_coin', '#ffd84a'), { fx: { kind: 'buff', id: 'mr_kim', dur: r(60), color: '#ffd84a' } }, (l) => `+${(25 + 5 * l) / 2}% base EXP for 60 s.`);
    ens('eternal_chaos', 'Eternal Chaos', I('s_swirl', '#ff5468'), { max: 1, fx: { kind: 'status', area: 5, at: 'self', status: { id: 'signum', chance: r(100), dur: r(30) }, visual: 'ring', color: '#ff5468' } }, () => 'Monsters around you lose much of their DEF.');
    ens('drum_battlefield', 'A Drum on the Battlefield', I('s_shield', '#ffb347'), { fx: { kind: 'buff', id: 'drum_battlefield', dur: r(60), color: '#ffb347' } }, (l) => `+${(25 + 25 * l) / 2} ATK and +${(2 + 2 * l) / 2} DEF for 60 s.`);
    ens('ring_nibelungen', 'The Ring of Nibelungen', I('s_halo', '#ffd84a'), { fx: { kind: 'buff', id: 'ring_nibelungen', dur: r(60), color: '#ffd84a' } }, (l) => `+${(50 + 25 * l) / 2} ATK with a level 4 weapon for 60 s.`);
    ens('lokis_veil', 'Loki\'s Veil', I('s_eye', '#9aa3ad'), { max: 1, fx: { kind: 'status', area: 5, at: 'self', status: { id: 'stunned', chance: r(30), dur: r(3) }, visual: 'ring', color: '#9aa3ad' } }, () => 'Monsters around you may be dazed (stunned).');
    ens('into_abyss', 'Into the Abyss', I('s_drop', '#2a3a7a'), { max: 1, fx: { kind: 'buff', id: 'into_abyss', dur: r(60), color: '#2a3a7a' } }, () => 'For 60 s, skills need no gemstones.');
    ens('invulnerable_siegfried', 'Invulnerable Siegfried', I('s_shield', '#ffd77a'), { fx: { kind: 'buff', id: 'siegfried', dur: r(60), color: '#ffd77a' } }, (l) => `+${(55 + 5 * l) / 2} MDEF for 60 s.`);
  }
  A('dissonance', 'bard', 'Unchained Serenade', I('s_burst', '#ff9ec2'), { target: 'self', max: 5, sp: (l) => 15 + 3 * l, cd: r(2), effect: 'pulse', pulse: { r: 3.5, n: 6, mult: (l) => 0.3 + 0.1 * l, color: '#ff9ec2' },
    desc: (l) => `A jarring melody hits everything around you every second for 6 s (${pct(30 + 10 * l)}).` });
  A('ugly_dance', 'dancer', 'Hip Shaker', I('s_burst', '#ff9ec2'), { target: 'self', max: 5, sp: (l) => 20 + 3 * l, cd: r(2), effect: 'pulse', pulse: { r: 3.5, n: 6, mult: (l) => 0.3 + 0.1 * l, color: '#ff9ec2' },
    desc: (l) => `A dizzying dance hits everything around you every second for 6 s (${pct(30 + 10 * l)}).` });
  A('frost_joke', 'bard', 'Unbarring Octave', I('s_zzz', '#bfe8ff'), { target: 'self', max: 5, sp: (l) => 10 + 2 * l, cd: r(2),
    fx: { kind: 'status', area: 12, at: 'self', status: { id: 'frozen', chance: (l) => 15 + 5 * l, dur: r(4) }, visual: 'ring', color: '#bfe8ff' }, desc: (l) => `A joke so bad it freezes monsters nearby (${15 + 5 * l}% chance).` });
  A('scream', 'dancer', 'Dazzler', I('s_shout', '#ffd84a'), { target: 'self', max: 5, sp: (l) => 10 + 2 * l, cd: r(2),
    fx: { kind: 'status', area: 12, at: 'self', status: { id: 'stunned', chance: (l) => 15 + 5 * l, dur: r(3) }, visual: 'ring', color: '#ffd84a' }, desc: (l) => `A piercing scream stuns monsters nearby (${15 + 5 * l}% chance).` });
  B('apple_of_idun', 'bard', 'The Apple of Idun', I('s_heart', '#ff6b8b'), 'apple_of_idun', r(180), (l) => 40 + 5 * l, (l) => `+${5 + 2 * l}% Max HP and HP recovery for 3 minutes.`);
  B('fortunes_kiss', 'dancer', 'Fortune\'s Kiss', I('s_star', '#ffd84a'), 'fortunes_kiss', r(180), (l) => 40 + 3 * l, (l) => `+${10 + l} CRIT for 3 minutes.`);
  A('pang_voice', 'bard', 'Pang Voice', I('s_shout', '#c79bff'), { max: 1, range: r(9), sp: r(20), cd: r(1), fx: { kind: 'status', status: { id: 'stunned', chance: r(70), dur: r(4) }, visual: 'impact', color: '#c79bff' }, desc: () => 'A painful note that may confuse (stun) a monster.' });
  A('charming_wink', 'dancer', 'Charming Wink', I('s_heart', '#ff9ec2'), { max: 1, range: r(9), sp: r(40), cd: r(1), fx: { kind: 'status', status: { id: 'stunned', chance: r(70), dur: r(4) }, visual: 'impact', color: '#ff9ec2' }, desc: () => 'A wink that leaves a monster charmed (stunned).' });

  /* ================= Priest ================= */
  P('mace_mastery', 'priest', 'Mace Mastery', I('s_bash', '#e6c25a'), (l) => `+${3 * l} ATK with a mace.`, (l, p) => (p.equippedWeaponType() === 'mace' ? { atk: 3 * l } : {}));
  A('suffragium', 'priest', 'Suffragium', I('s_halo', '#bfe8ff'), { target: 'ally', range: r(9), max: 3, sp: r(8), cd: r(1), fx: { kind: 'buff', id: 'suffragium', dur: r(30), color: '#bfe8ff' }, desc: (l) => `A character's next spell casts ${15 * l}% faster.` });
  A('aspersio', 'priest', 'Aspersio', I('s_drop', '#fff2a0', 'holy'), { target: 'ally', range: r(9), max: 5, sp: (l) => 10 + 4 * l, cd: r(1), cast: r(2), catalyst: [['holy_water', 1]],
    fx: { kind: 'buff', id: 'aspersio', dur: (l) => 30 + 30 * l, color: '#fff2a0' }, desc: (l) => `A character's weapon becomes holy for ${30 + 30 * l} s. Uses Holy Water.` });
  B('bs_sacramenti', 'priest', 'B.S. Sacramenti', I('s_shield', '#fff2a0'), 'bs_sacramenti', (l) => 40 * l, r(20), (l) => `Your armour is blessed for ${40 * l} s: +${5 + l} DEF.`, { max: 5, cast: r(3) });
  A('slow_poison', 'priest', 'Slow Poison', I('s_drop', '#9ee86a'), { target: 'ally', range: r(9), max: 4, sp: (l) => 4 + 2 * l, effect: 'cure', desc: () => 'Stop poison from hurting a character for a while.' + note });
  A('status_recovery', 'priest', 'Status Recovery', I('s_cross', '#bfe8ff'), { target: 'ally', range: r(9), max: 1, sp: r(5), effect: 'cure', desc: () => 'Cure freezing, stun and stone on a character.' + note });
  B('magnificat', 'priest', 'Magnificat', I('s_halo', '#9fd8ff'), 'magnificat', (l) => 30 * l, r(40), (l) => `SP recovers twice as fast for ${30 * l} s.`, { max: 5, cast: r(4) });
  A('resurrection', 'priest', 'Resurrection', I('s_cross', '#ffd84a'), { target: 'ally', range: r(9), max: 4, sp: r(60), catalyst: [['blue_gemstone', 1]], effect: 'cure', desc: () => 'Bring a fallen ally back to life. Uses a Blue Gemstone.' + note.replace('monster does this', 'party exists') });
  A('turn_undead', 'priest', 'Turn Undead', I('s_cross', '#fff2a0', 'holy'), { range: r(9), sp: r(20), cd: r(1), cast: r(1), effect: 'turn_undead',
    desc: (l) => `Against shadow, ghost or undead monsters: a chance to destroy them outright (${l * 2}%+), otherwise heavy holy damage.` });
  A('lex_divina', 'priest', 'Lex Divina', I('s_hand', '#c79bff'), { range: r(9), sp: (l) => 20 - Math.min(10, l), cd: r(1), fx: { kind: 'status', status: { id: 'disarmed', chance: r(100), dur: (l) => 10 + 2 * l }, visual: 'impact', color: '#c79bff' },
    desc: (l) => `Silence a monster for ${10 + 2 * l} s (its attacks weaken by 25%).` });
  A('lex_aeterna', 'priest', 'Lex Aeterna', I('s_cross', '#ff5468'), { max: 1, range: r(9), sp: r(10), cd: r(0.5), fx: { kind: 'status', status: { id: 'lex', chance: r(100), dur: r(60) }, visual: 'impact', color: '#ff5468' },
    desc: () => 'Mark a monster: the next damage it takes is doubled.' });
  A('redemptio', 'priest', 'Redemptio', I('s_cross', '#ffd84a'), { target: 'self', max: 1, sp: r(400), effect: 'cure', desc: () => 'Revive every fallen party member at the cost of your life.' + note.replace('monster does this', 'party exists') });

  /* ================= Monk ================= */
  A('call_spirits', 'monk', 'Summon Spirit Sphere', I('s_star', '#9fd8ff'), { target: 'self', max: 5, sp: r(8), cd: r(0.4), cast: r(1), effect: 'call_spirits', desc: (l) => `Summon a spirit sphere (up to ${l}). Each sphere gives +3 ATK.` });
  A('absorb_spirits', 'monk', 'Absorb Spirit Sphere', I('s_star', '#bfe8ff'), { target: 'self', max: 1, sp: r(5), cd: r(1), cast: r(2), effect: 'absorb_spirits', desc: () => 'Absorb all your spirit spheres: +7 SP each.' });
  P('spiritual_cadence', 'monk', 'Spiritual Cadence', I('s_heart', '#9fd8ff'), (l) => `+${4 * l} HP and +${2 * l} SP every 10 s while sitting still.`, (l) => ({ cadence: l }));
  P('dodge', 'monk', 'Flee', I('s_dash', '#ff9f43'), (l) => `+${Math.round(l * 1.5)} FLEE.`, (l) => ({ flee: Math.round(l * 1.5) }));
  A('chain_combo', 'monk', 'Raging Quadruple Blow', I('s_daggers', '#ffb347'), { target: 'self', max: 5, sp: (l) => 10 + l, cd: r(0.2), combo: 'trifecta', effect: 'combo',
    fx: { kind: 'phys', mult: (l) => (2 + l) / 4, hits: r(4), hitDelay: 0.06, visual: 'impact', color: '#ffb347' },
    desc: (l) => `Combo: press it right after Raging Trifecta Blow triggers. Four blows totalling ${pct(200 + 100 * l)} on the monster you're fighting (no targeting needed).` });
  A('combo_finish', 'monk', 'Raging Thrust', I('s_bash', '#ff5468'), { target: 'self', max: 5, sp: (l) => 10 + l, cd: r(0.2), combo: 'chain_combo', effect: 'combo', spheres: 1,
    fx: { kind: 'phys', mult: (l) => 3 + 1.5 * l, area: 1.6, visual: 'impact', color: '#ff5468' },
    desc: (l) => `Combo: press it right after Raging Quadruple Blow. ${pct(300 + 150 * l)} to the monster you're fighting and those beside it (no targeting needed). Uses a sphere.` });
  A('throw_spirit_sphere', 'monk', 'Throw Spirit Sphere', I('s_star', '#9fd8ff'), { max: 5, range: r(9), sp: r(10), cd: r(0.6), cast: r(1), effect: 'throw_spheres',
    desc: (l) => `Throw up to ${l} spirit spheres, each ${pct(150 + 50 * l)}, never missing.` });
  B('steel_body', 'monk', 'Mental Strength', I('s_shield', '#c9a24a'), 'steel_body', (l) => 30 * l, r(200), (l) => `Become nearly invulnerable (DEF and MDEF 90) for ${30 * l} s, but slower and unable to use skills. Uses 5 spheres.`, { max: 5, cast: r(5), spheres: 5 });
  B('blade_stop', 'monk', 'Root', I('s_hand', '#c9a24a'), 'blade_stop', (l) => 0.3 + 0.2 * l, r(10), () => 'Catch the next melee attack between your palms: no damage, and the attacker is held in place.', { max: 5, spheres: 1 });
  B('fury', 'monk', 'Fury', I('s_burst', '#ff3b3b'), 'fury', r(180), r(15), (l) => `Enter a fury for 3 minutes: +${7.5 + 2.5 * l} CRIT, no natural SP recovery. Needed for Asura Strike. Uses 5 spheres.`, { max: 5, spheres: 5 });
  A('body_relocation', 'monk', 'Snap', I('s_dash', '#9fd8ff'), { target: 'ground', max: 1, range: r(9), sp: r(14), cd: r(0.5), spheres: 1, effect: 'snap', desc: () => 'Click the ground to dash there instantly. Uses a sphere.' });
  B('ki_translation', 'monk', 'Ki Translation', I('s_star', '#7dff9a'), 'ki', r(10), r(40), () => 'Gather your ki: +5 ATK and +5 FLEE for 10 s.', { max: 1 });
  A('ki_explosion', 'monk', 'Ki Explosion', I('s_burst', '#7dff9a'), { max: 1, sp: r(20), cd: r(1), fx: { kind: 'phys', mult: r(3), area: 2, knock: 3, visual: 'ring', color: '#7dff9a', status: { id: 'stunned', chance: r(30), dur: r(2) } },
    desc: () => 'Blast the target and those around it for 300%, knocking them away.' });

  /* ================= Assassin ================= */
  P('righthand_mastery', 'assassin', 'Righthand Mastery', I('s_sword', '#c79bff'), (l) => `Right-hand weapon damage ${50 + 10 * l}% when dual-wielding (dual wielding isn't in Willowmere yet, so for now: +${l} ATK).`, (l) => ({ atk: l }));
  P('lefthand_mastery', 'assassin', 'Lefthand Mastery', I('s_sword', '#9fd8ff'), (l) => `Left-hand weapon damage ${30 + 10 * l}% when dual-wielding (for now: +${l} ATK).`, (l) => ({ atk: l }));
  B('cloaking', 'assassin', 'Cloaking', I('s_eye', '#3a2a4a'), 'cloaking', (l) => 10 + 5 * l, r(15), (l) => `Turn invisible for ${10 + 5 * l} s while still moving (slowly). Monsters lose track of you.`, { cd: r(1) });
  B('poison_react', 'assassin', 'Poison React', I('s_drop', '#6fd06a'), 'poison_react', (l) => 20 + 10 * l, (l) => 25 + 5 * l, (l) => `For ${20 + 10 * l} s, when a monster hits you, you may strike back with a poisoned counter (${pct(100 + 30 * l)}).`);
  A('venom_dust', 'assassin', 'Venom Dust', I('s_rain', '#6fd06a'), { range: r(9), sp: r(20), cd: r(1), catalyst: [['red_gemstone', 1]], effect: 'venom_dust', desc: (l) => `A poison cloud at the target for ${5 * l} s; monsters in it are poisoned. Uses a Red Gemstone.` });
  A('venom_splasher', 'assassin', 'Venom Splasher', I('s_burst', '#6fd06a'), { max: 10, range: r(2), sp: (l) => 10 + 2 * l, cd: r(2), catalyst: [['red_gemstone', 1]], effect: 'venom_splasher',
    desc: (l) => `Plant venom in a weakened monster (below 75% HP): after ${5.5 - 0.5 * Math.min(10, l)} s it bursts for ${pct(500 + 50 * l)} to everything around it.` });
  P('sonic_acceleration', 'assassin', 'Sonic Acceleration', I('s_daggers', '#ffd84a'), () => 'Sonic Blow deals 50% more damage and never misses.', () => ({ sonicAccel: 1 }));
  A('throw_venom_knife', 'assassin', 'Throw Venom Knife', I('s_arrow', '#6fd06a'), { max: 1, range: r(9), sp: r(35), cd: r(0.6), fx: { kind: 'phys', mult: r(1), ranged: true, visual: 'arrow', status: { id: 'poisoned', chance: r(60), dur: r(15) } },
    desc: () => 'Throw a poisoned knife; likely to poison.' });

  /* ================= Rogue ================= */
  A('steal_coin', 'rogue', 'Mug', I('s_coin', '#ffd84a'), { sp: r(15), cd: r(0.6), effect: 'steal_coin', desc: (l) => `Steal Zeny from a monster (${l}% + DEX/LUK based chance).` });
  B('tunnel_drive', 'rogue', 'Stalk', I('s_dash', '#3a5a3a'), 'cloaking', (l) => 10 + 5 * l, r(10), (l) => `Stay hidden while moving slowly for ${10 + 5 * l} s.`, { max: 5 });
  A('intimidate', 'rogue', 'Snatch', I('s_hand', '#ff8a8a'), { max: 5, sp: (l) => 9 + 4 * l, cd: r(1), effect: 'intimidate', desc: (l) => `Hit for ${pct(130 + 30 * l)} and teleport yourself and the monster to a random spot together.` });
  const strip = (id, name, color, statusId, desc) => A(id, 'rogue', name, I('s_hand', color), { max: 5, sp: (l) => 12 + 2 * l, cd: r(1),
    fx: { kind: 'status', status: { id: statusId, chance: (l) => 50 + 5 * l, dur: (l) => 15 + 5 * l }, visual: 'impact', color }, desc });
  strip('strip_helm', 'Divest Helm', '#9fd8ff', 'strip_helm', (l) => `${50 + 5 * l}% chance to knock off a monster's helm: less accuracy for ${15 + 5 * l} s.`);
  strip('strip_shield', 'Divest Shield', '#ffd77a', 'strip_shield', (l) => `${50 + 5 * l}% chance to knock off a monster's shield: −15% DEF for ${15 + 5 * l} s.`);
  strip('strip_armor', 'Divest Armor', '#c9a06b', 'strip_armor', (l) => `${50 + 5 * l}% chance to strip a monster's armour: −40% DEF for ${15 + 5 * l} s.`);
  P('gangsters_paradise', 'rogue', 'Gangster\'s Paradise', I('s_zzz', '#3a5a3a'), () => 'While you sit, non-boss monsters ignore you.', () => ({ gangster: 1 }));
  P('compulsion_discount', 'rogue', 'Haggle', I('s_coin', '#ffd84a'), (l) => `Buy from shops for ${5 + 4 * l}% less.`, (l) => ({ discount: 5 + 4 * l }));
  A('scribble', 'rogue', 'Scribble', I('s_tag', '#ff9ec2'), { target: 'self', max: 1, sp: r(15), catalyst: [['red_gemstone', 1]], effect: 'scribble', desc: () => 'Paint graffiti on the ground. Uses a Red Gemstone.' });
  P('plagiarism', 'rogue', 'Plagiarism', I('s_book', '#ff8a8a'), (l) => `Copy the last skill a monster uses on you, and +${l}% attack speed.` + note.replace('No Willowmere monster does this', 'Monsters in Willowmere don\'t use skills').replace('so it has no effect for now', 'so only the speed bonus works for now'), (l) => ({ aspd: l }));
  A('close_confine', 'rogue', 'Close Confine', I('s_hand', '#c9a06b'), { max: 1, sp: r(25), cd: r(1), fx: { kind: 'status', status: { id: 'rooted', chance: r(100), dur: r(10) }, visual: 'impact', color: '#c9a06b' },
    desc: () => 'Lock a monster in place with you for 10 s.' });

  /* ================= Blacksmith ================= */
  const craft = (id, name, icon, max, kind, desc, req) => A(id, 'blacksmith', name, icon, { target: 'self', max, sp: r(5), cd: r(0.3), effect: 'craft', craft: kind, desc });
  craft('iron_tempering', 'Iron Tempering', I('s_hammer', '#9aa3ad'), 5, 'tempering', (l) => `Smelt Iron Ore into Iron (${40 + 5 * l}% + DEX/LUK chance).`);
  craft('steel_tempering', 'Steel Tempering', I('s_hammer', '#cfd8e6'), 5, 'tempering', (l) => `Forge 5 Iron and Coal into Steel (${30 + 5 * l}% chance).`);
  craft('enchanted_stone_craft', 'Enchanted Stone Craft', I('s_star', '#ff7a3d'), 5, 'stones', (l) => `Craft elemental stones from loot (${10 + 5 * l}% chance).`);
  P('oridecon_research', 'blacksmith', 'Oridecon Research', I('s_book', '#c07aff'), (l) => `+${l}% forging success for level 3 weapons.`, (l) => ({ forgeBonus: l }));
  const smith = (id, name, wt) => craft(id, name, I('s_hammer', '#ffb347'), 3, 'forge:' + wt, (l) => `Forge ${name.replace('Smith ', '').toLowerCase()} weapons (+${10 * l}% success).`);
  smith('smith_dagger', 'Smith Dagger', 'dagger'); smith('smith_sword', 'Smith Sword', 'sword'); smith('smith_twohand', 'Smith Two-handed Sword', 'twohand');
  smith('smith_axe', 'Smith Axe', 'axe'); smith('smith_mace', 'Smith Mace', 'mace'); smith('smith_knuckle', 'Smith Knucklebrace', 'knuckle'); smith('smith_spear', 'Smith Spear', 'spear');
  P('hilt_binding', 'blacksmith', 'Hilt Binding', I('s_sword', '#c9a06b'), () => '+1 STR, +4 ATK, +1% forging success.', () => ({ str: 1, atk: 4, forgeBonus: 1 }));
  P('ore_discovery', 'blacksmith', 'Ore Discovery', I('s_eye', '#9aa3ad'), () => 'Monsters sometimes drop Iron Ore, Coal and elemental stones for you.', () => ({ oreDiscovery: 1 }));
  P('weaponry_research', 'blacksmith', 'Weaponry Research', I('s_book', '#ffb347'), (l) => `+${2 * l} ATK and +${2 * l} HIT; +${l}% forging success.`, (l) => ({ atk: 2 * l, hit: 2 * l, forgeBonus: l }));
  A('weapon_repair', 'blacksmith', 'Weapon Repair', I('s_hammer', '#9fd8ff'), { target: 'self', max: 1, sp: r(30), effect: 'cure', desc: () => 'Repair broken equipment.' + note.replace('monster does this', 'equipment breaks yet') });
  B('weapon_perfection', 'blacksmith', 'Weapon Perfection', I('s_sword', '#fff2a0'), 'weapon_perfection', (l) => 10 * l, (l) => 20 - 2 * l, (l) => `For ${10 * l} s, your weapon hits every size of monster at full strength (+10% damage).`, { max: 5 });
  B('maximize_power', 'blacksmith', 'Maximize Power', I('s_bash', '#ff3b3b'), 'maximize_power', r(60), r(10), () => 'Every hit lands at your maximum damage (+15%), but SP drains over time.', { max: 5 });
  A('greed', 'blacksmith', 'Greed', I('s_bag', '#ffd84a'), { target: 'self', max: 1, sp: r(10), cd: r(1), effect: 'greed', desc: () => 'Scoop up every item on the ground around you.' });
  // Unfair Trick (Dubious Salesmanship): a quest skill from job level 30.
  P('unfair_trick', 'blacksmith', 'Unfair Trick', I('s_coin', '#c9a24a'), () => 'Dubious Salesmanship: Mammonite costs 10% less Zeny.', () => ({ mammoniteDiscount: 10 }), { questJob: 30 });

  /* ================= Alchemist ================= */
  P('potion_research', 'alchemist', 'Potion Research', I('s_book', '#ff8a8a'), (l) => `+${l}% brewing success and +${5 * l}% healing from potions you make or throw.`, (l) => ({ potionBonus: l }));
  A('prepare_potion', 'alchemist', 'Prepare Potion', I('s_flask', '#ff8a8a'), { target: 'self', sp: r(5), cd: r(0.3), effect: 'craft', craft: 'potion', desc: (l) => `Brew potions, acid and fire bottles (+${2 * l}% success).` });
  A('summon_flora', 'alchemist', 'Bio Cannibalize', I('s_heart', '#8fd16a'), { range: r(4), max: 5, sp: r(20), cd: r(2), effect: 'summon_flora', desc: (l) => `Plant a carnivorous flower next to the target. It bites nearby monsters for ${30 + 10 * l} damage every second for 60 s.` });
  A('marine_sphere', 'alchemist', 'Sphere Mine', I('s_burst', '#ff7a3d'), { range: r(4), max: 5, sp: r(10), cd: r(2), effect: 'marine_sphere', desc: (l) => `Place a marine sphere that explodes after 3 s for ${150 + 50 * l} fire damage around it.` });
  const cp = (id, name, slot) => A(id, 'alchemist', name, I('s_shield', '#9ee86a'), { target: 'ally', range: r(9), max: 5, sp: r(30), cd: r(1), fx: { kind: 'buff', id: 'cp_' + slot, dur: (l) => 120 * l, color: '#9ee86a' },
    desc: (l) => `Coat a character's ${slot} for ${2 * l} minutes so it can't be stripped or broken (+3 DEF meanwhile).` });
  cp('cp_weapon', 'Chemical Protection Weapon', 'weapon'); cp('cp_shield', 'Chemical Protection Shield', 'shield'); cp('cp_armor', 'Chemical Protection Armor', 'armor'); cp('cp_helm', 'Chemical Protection Helm', 'helm');
  P('bioethics', 'alchemist', 'Bioethics', I('s_book', '#7fd0a0'), () => 'The study of artificial life: unlocks homunculus research. (Homunculi aren\'t in Willowmere yet.)');

  /* ---------- clones for skills shared between classes ---------- */
  for (const [id, src] of [['cr_divine_protection', 'divine_protection'], ['cr_demon_bane', 'demon_bane'], ['cr_heal', 'heal'], ['cr_cure', 'cure'], ['cr_spear_mastery', 'spear_mastery'],
    ['cr_riding', 'riding'], ['cr_cavalier_mastery', 'cavalier_mastery']]) clone(id, src, 'crusader');
  clone('pr_safety_wall', 'safety_wall', 'priest'); clone('pr_sp_recovery', 'sp_recovery', 'priest');
  clone('sg_earth_spike', 'earth_spike', 'sage'); clone('sg_heavens_drive', 'heavens_drive', 'sage');
  clone('rg_vultures_eye', 'vultures_eye', 'rogue'); clone('rg_double_strafe', 'double_strafe', 'rogue'); clone('rg_remove_trap', 'remove_trap', 'rogue');
  S.earth_spike.job = 'wizard'; S.heavens_drive.job = 'wizard';
  S.musical_strike.needs = 'instrument'; S.throw_arrow.needs = 'whip';
  S.two_hand_quicken.needs = 'twohand';
  S.ankle_snare.job = 'retired'; delete S.ankle_snare; delete S.sharp_shooting;
  S.ankle_snare = Object.assign({}, S.ankle_snare_trap, { id: 'ankle_snare' }); delete S.ankle_snare_trap;

  /* ---------- the classic trees: [id, row, col, max, reqs, quest] ---------- */
  const T = {
    novice: [['basic_training', 0, 0, 9], ['first_aid', 0, 1, 1, [], 'q'], ['play_dead', 0, 2, 1, [], 'q']],
    swordsman: [['sword_mastery', 0, 0], ['two_hand_mastery', 1, 0, 10, [['sword_mastery', 1]]], ['hp_recovery', 0, 1], ['bash', 0, 2], ['magnum_break', 1, 2, 10, [['bash', 5]]],
      ['provoke', 0, 3], ['endure', 1, 3, 10, [['provoke', 5]]], ['moving_hp_recovery', 2, 1, 1, [], 'q'], ['fatal_blow', 2, 2, 1, [['bash', 5]], 'q'], ['auto_berserk', 2, 3, 1, [], 'q']],
    mage: [['stone_curse', 0, 0], ['cold_bolt', 0, 1], ['frost_diver', 1, 1, 10, [['cold_bolt', 5]]], ['lightning_bolt', 0, 2], ['thunderstorm', 1, 2, 10, [['lightning_bolt', 4]]],
      ['napalm_beat', 0, 3], ['soul_strike', 1, 3, 10, [['napalm_beat', 4]]], ['safety_wall', 2, 3, 10, [['napalm_beat', 7], ['soul_strike', 5]]],
      ['fire_bolt', 0, 4], ['fire_ball', 1, 4, 10, [['fire_bolt', 4]]], ['fire_wall', 2, 4, 10, [['fire_ball', 5], ['sight', 1]]], ['sight', 0, 5, 1], ['sp_recovery', 1, 5], ['energy_coat', 2, 5, 1, [], 'q']],
    archer: [['owls_eye', 0, 0], ['vultures_eye', 1, 0, 10, [['owls_eye', 3]]], ['improve_concentration', 2, 0, 10, [['vultures_eye', 1]]], ['double_strafe', 0, 1],
      ['arrow_shower', 1, 1, 10, [['double_strafe', 5]]], ['arrow_crafting', 0, 2, 1, [], 'q'], ['arrow_repel', 1, 2, 1, [], 'q']],
    acolyte: [['divine_protection', 0, 0], ['demon_bane', 1, 0, 10, [['divine_protection', 3]]], ['signum_crucis', 2, 0, 10, [['demon_bane', 3]]],
      ['angelus', 1, 1, 10, [['divine_protection', 3]]], ['blessing', 2, 1, 10, [['divine_protection', 5]]],
      ['ruwach', 0, 2, 1], ['teleportation', 1, 2, 2, [['ruwach', 1]]], ['warp_portal', 2, 2, 4, [['teleportation', 2]]], ['pneuma', 3, 2, 1, [['warp_portal', 4]]],
      ['heal', 0, 3], ['increase_agi', 1, 3, 10, [['heal', 3]]], ['decrease_agi', 2, 3, 10, [['increase_agi', 1]]], ['cure', 1, 4, 1, [['heal', 2]]],
      ['aqua_benedicta', 0, 4, 1], ['holy_light', 0, 5, 1, [], 'q']],
    thief: [['double_attack', 0, 0], ['improve_dodge', 0, 1], ['steal', 0, 2], ['hiding', 1, 2, 10, [['steal', 5]]], ['envenom', 0, 3], ['detoxify', 1, 3, 1, [['envenom', 3]]],
      ['sand_attack', 0, 4, 1, [], 'q'], ['back_slide', 1, 4, 1, [], 'q'], ['find_stone', 2, 4, 1, [], 'q'], ['throw_stone', 3, 4, 1, [['find_stone', 1]], 'q']],
    merchant: [['enlarge_weight', 0, 0], ['discount', 1, 0, 10, [['enlarge_weight', 3]]], ['overcharge', 2, 0, 10, [['discount', 3]]], ['item_appraisal', 0, 1, 1],
      ['pushcart', 1, 1, 10, [['enlarge_weight', 5]]], ['vending', 2, 1, 10, [['pushcart', 3]]], ['mammonite', 0, 2],
      ['cart_revolution', 0, 3, 1, [], 'q'], ['change_cart', 1, 3, 1, [], 'q'], ['crazy_uproar', 2, 3, 1, [], 'q']],
    knight: [['spear_mastery', 0, 0], ['pierce', 1, 0, 10, [['spear_mastery', 1]]], ['spear_stab', 2, 0, 10, [['pierce', 5]]], ['spear_boomerang', 2, 1, 5, [['pierce', 3]]],
      ['brandish_spear', 3, 0, 10, [['riding', 1], ['spear_stab', 3]]], ['two_hand_quicken', 0, 2, 10, [['two_hand_mastery', 1]]], ['auto_counter', 1, 2, 5, [['two_hand_mastery', 1]]],
      ['bowling_bash', 2, 2, 10, [['bash', 10], ['magnum_break', 3], ['two_hand_mastery', 5], ['two_hand_quicken', 10], ['auto_counter', 5]]],
      ['riding', 0, 3, 1, [['endure', 1]]], ['cavalier_mastery', 1, 3, 5, [['riding', 1]]], ['charge_attack', 0, 4, 1, [], 'q']],
    crusader: [['faith', 0, 0], ['holy_cross', 1, 0, 10, [['faith', 7]]], ['grand_cross', 2, 0, 10, [['faith', 10], ['holy_cross', 6]]],
      ['auto_guard', 0, 1], ['shield_charge', 1, 1, 5, [['auto_guard', 5]]], ['shield_boomerang', 2, 1, 5, [['shield_charge', 3]]], ['reflect_shield', 3, 1, 10, [['shield_boomerang', 3]]],
      ['devotion', 4, 1, 5, [['grand_cross', 4], ['reflect_shield', 5]]], ['defender', 3, 2, 5, [['shield_boomerang', 1]]],
      ['cr_divine_protection', 0, 2, 10, [['faith', 3]]], ['cr_demon_bane', 1, 2, 10, [['faith', 5], ['cr_divine_protection', 3]]], ['cr_heal', 2, 2, 10, [['faith', 10], ['cr_demon_bane', 5]]],
      ['cr_cure', 0, 3, 1, [['faith', 5]]], ['providence', 3, 3, 5, [['cr_divine_protection', 5], ['cr_heal', 5]]],
      ['cr_spear_mastery', 0, 4], ['spear_quicken', 1, 4, 10, [['cr_spear_mastery', 10]]], ['cr_riding', 0, 5, 1, [['endure', 1]]], ['cr_cavalier_mastery', 1, 5, 5, [['cr_riding', 1]]],
      ['shrink', 2, 5, 1, [], 'q']],
    wizard: [['fire_pillar', 0, 0, 10, [['fire_wall', 1]]], ['sightrasher', 1, 0, 10, [['sight', 1], ['lightning_bolt', 1]]], ['meteor_storm', 2, 0, 10, [['thunderstorm', 1], ['sightrasher', 2]]],
      ['jupitel_thunder', 0, 1, 10, [['napalm_beat', 1], ['lightning_bolt', 1]]], ['lord_of_vermilion', 1, 1, 10, [['thunderstorm', 1], ['jupitel_thunder', 5]]],
      ['water_ball', 0, 2, 5, [['cold_bolt', 1], ['lightning_bolt', 1]]], ['ice_wall', 1, 2, 10, [['stone_curse', 1], ['frost_diver', 1]]], ['frost_nova', 2, 2, 10, [['ice_wall', 1]]],
      ['storm_gust', 3, 2, 10, [['frost_nova', 1], ['jupitel_thunder', 3]]], ['earth_spike', 0, 3, 5, [['stone_curse', 1]]], ['heavens_drive', 1, 3, 5, [['earth_spike', 3]]],
      ['quagmire', 2, 3, 5, [['heavens_drive', 1]]], ['sense', 0, 4, 1], ['sight_blaster', 1, 4, 1, [], 'q']],
    sage: [['advanced_book', 0, 0], ['cast_cancel', 1, 0, 5, [['advanced_book', 2]]], ['free_cast', 2, 0, 10, [['cast_cancel', 1]]], ['auto_spell', 3, 0, 10, [['free_cast', 4]]],
      ['abracadabra', 4, 0, 10, [['auto_spell', 5], ['land_protector', 1], ['dispell', 1]]],
      ['magic_rod', 1, 1, 5, [['advanced_book', 4]]], ['spell_breaker', 2, 1, 5, [['magic_rod', 1]]], ['dispell', 3, 1, 5, [['spell_breaker', 3]]],
      ['endow_blaze', 0, 2, 5, [['advanced_book', 5], ['fire_bolt', 1]]], ['endow_tsunami', 1, 2, 5, [['advanced_book', 5], ['cold_bolt', 1]]],
      ['endow_tornado', 2, 2, 5, [['advanced_book', 5], ['lightning_bolt', 1]]], ['endow_quake', 3, 2, 5, [['advanced_book', 5], ['stone_curse', 1]]],
      ['volcano', 0, 3, 5, [['endow_blaze', 2]]], ['deluge', 1, 3, 5, [['endow_tsunami', 2]]], ['whirlwind', 2, 3, 5, [['endow_tornado', 2]]],
      ['land_protector', 3, 3, 5, [['volcano', 3], ['deluge', 3], ['whirlwind', 3]]],
      ['dragonology', 0, 4, 5, [['advanced_book', 9]]], ['sg_earth_spike', 1, 4, 5, [['endow_quake', 1]]], ['sg_heavens_drive', 2, 4, 5, [['sg_earth_spike', 1]]],
      ['create_converter', 3, 4, 1, [], 'q'], ['elemental_change', 4, 4, 1, [['create_converter', 1]], 'q']],
    hunter: [['skid_trap', 0, 0, 5], ['ankle_snare', 1, 0, 5, [['skid_trap', 1]]], ['shockwave_trap', 2, 0, 5, [['ankle_snare', 1]]], ['talkie_box', 3, 0, 1, [['remove_trap', 1], ['shockwave_trap', 1]]],
      ['land_mine', 0, 1, 5], ['flasher', 1, 1, 5, [['skid_trap', 1]]], ['sandman', 2, 1, 5, [['flasher', 1]]], ['blast_mine', 3, 1, 5, [['land_mine', 1], ['sandman', 1], ['freezing_trap', 1]]],
      ['claymore_trap', 4, 1, 5, [['shockwave_trap', 1], ['blast_mine', 1]]], ['remove_trap', 1, 2, 1, [['land_mine', 1]]], ['freezing_trap', 2, 2, 5, [['flasher', 1]]],
      ['beast_bane', 0, 3], ['falconry_mastery', 1, 3, 1, [['beast_bane', 1]]], ['blitz_beat', 2, 3, 5, [['falconry_mastery', 1]]], ['spring_trap', 3, 3, 5, [['falconry_mastery', 1], ['remove_trap', 1]]],
      ['phantasmic_arrow', 0, 4, 1, [], 'q'], ['detect', 2, 4, 4, [['improve_concentration', 1], ['falconry_mastery', 1]]], ['steel_crow', 3, 4, 10, [['blitz_beat', 5]]]],
    bard: [['music_lessons', 0, 0], ['musical_strike', 1, 0, 5, [['music_lessons', 3]]], ['adaptation', 0, 1, 1], ['encore', 1, 1, 1, [['adaptation', 1]]], ['frost_joke', 2, 1, 5, [['encore', 1]]],
      ['dissonance', 1, 2, 5, [['adaptation', 1], ['music_lessons', 1]]], ['whistle', 2, 2, 10, [['dissonance', 3]]], ['assassin_cross', 2, 3, 10, [['dissonance', 3]]],
      ['poem_of_bragi', 3, 2, 10, [['dissonance', 3]]], ['apple_of_idun', 3, 3, 10, [['dissonance', 3]]],
      ['lullaby', 0, 4, 1, [['adaptation', 1]]], ['mr_kim', 1, 4, 5, [['lullaby', 1]]], ['eternal_chaos', 2, 4, 1, [['mr_kim', 3]]], ['drum_battlefield', 0, 5, 5, [['adaptation', 1]]],
      ['ring_nibelungen', 1, 5, 5, [['drum_battlefield', 3]]], ['lokis_veil', 2, 5, 1, [['ring_nibelungen', 3]]], ['into_abyss', 3, 4, 1, [['lokis_veil', 1]]], ['invulnerable_siegfried', 3, 5, 5, [['into_abyss', 1]]],
      ['pang_voice', 0, 3, 1, [], 'q']],
    dancer: [['dance_lessons', 0, 0], ['throw_arrow', 1, 0, 5, [['dance_lessons', 3]]], ['dc_adaptation', 0, 1, 1], ['dc_encore', 1, 1, 1, [['dc_adaptation', 1]]], ['scream', 2, 1, 5, [['dc_encore', 1]]],
      ['ugly_dance', 1, 2, 5, [['dc_adaptation', 1], ['dance_lessons', 1]]], ['humming', 2, 2, 10, [['ugly_dance', 3]]], ['dont_forget_me', 2, 3, 10, [['ugly_dance', 3]]],
      ['fortunes_kiss', 3, 2, 10, [['ugly_dance', 3]]], ['service_for_you', 3, 3, 10, [['ugly_dance', 3]]],
      ['dc_lullaby', 0, 4, 1, [['dc_adaptation', 1]]], ['dc_mr_kim', 1, 4, 5, [['dc_lullaby', 1]]], ['dc_eternal_chaos', 2, 4, 1, [['dc_mr_kim', 3]]], ['dc_drum_battlefield', 0, 5, 5, [['dc_adaptation', 1]]],
      ['dc_ring_nibelungen', 1, 5, 5, [['dc_drum_battlefield', 3]]], ['dc_lokis_veil', 2, 5, 1, [['dc_ring_nibelungen', 3]]], ['dc_into_abyss', 3, 4, 1, [['dc_lokis_veil', 1]]],
      ['dc_invulnerable_siegfried', 3, 5, 5, [['dc_into_abyss', 1]]], ['charming_wink', 0, 3, 1, [], 'q']],
    priest: [['mace_mastery', 0, 0], ['impositio_manus', 0, 1, 5], ['suffragium', 1, 1, 3, [['impositio_manus', 2]]], ['aspersio', 2, 1, 5, [['aqua_benedicta', 1], ['impositio_manus', 3]]],
      ['bs_sacramenti', 3, 1, 5, [['aspersio', 3], ['gloria', 3]]], ['sanctuary', 0, 2, 10, [['heal', 1]]], ['slow_poison', 1, 2, 4], ['status_recovery', 2, 2, 1],
      ['resurrection', 3, 2, 4, [['pr_sp_recovery', 4], ['status_recovery', 1]]], ['kyrie_eleison', 0, 3, 10, [['angelus', 2]]], ['magnificat', 1, 3, 5], ['gloria', 2, 3, 5, [['kyrie_eleison', 4], ['magnificat', 3]]],
      ['lex_divina', 0, 4, 10, [['ruwach', 1]]], ['lex_aeterna', 1, 4, 1, [['lex_divina', 5]]], ['turn_undead', 2, 4, 10, [['resurrection', 1], ['lex_divina', 3]]],
      ['magnus_exorcismus', 3, 4, 10, [['pr_safety_wall', 1], ['lex_aeterna', 1]]], ['pr_sp_recovery', 0, 5], ['pr_safety_wall', 1, 5, 10, [['sanctuary', 3]]], ['redemptio', 2, 5, 1, [], 'q']],
    monk: [['iron_hands', 0, 0, 10, [['divine_protection', 10], ['demon_bane', 10]]], ['call_spirits', 1, 0, 5, [['iron_hands', 2]]], ['absorb_spirits', 2, 0, 1, [['call_spirits', 5]]],
      ['fury', 3, 0, 5, [['absorb_spirits', 1]]], ['asura_strike', 5, 0, 5, [['steel_body', 3], ['fury', 3]]],
      ['dodge', 1, 1, 10, [['iron_hands', 5], ['call_spirits', 5]]], ['spiritual_cadence', 2, 1, 5, [['call_spirits', 5]]], ['blade_stop', 3, 1, 5, [['dodge', 5]]],
      ['triple_attack', 2, 2, 10, [['dodge', 5]]], ['chain_combo', 3, 2, 5, [['triple_attack', 5]]], ['combo_finish', 4, 2, 5, [['chain_combo', 3]]],
      ['body_relocation', 5, 2, 1, [['steel_body', 3], ['fury', 3], ['spiritual_cadence', 2]]],
      ['occult_impaction', 2, 3, 5, [['call_spirits', 5]]], ['throw_spirit_sphere', 3, 3, 5, [['occult_impaction', 3]]], ['steel_body', 4, 3, 5, [['occult_impaction', 3], ['fury', 3]]],
      ['ki_translation', 0, 4, 1, [], 'q'], ['ki_explosion', 1, 4, 1, [], 'q']],
    assassin: [['katar_mastery', 0, 0], ['sonic_blow', 1, 0, 10, [['katar_mastery', 4]]], ['grimtooth', 2, 0, 5, [['cloaking', 2], ['sonic_blow', 5]]],
      ['righthand_mastery', 0, 1, 5], ['lefthand_mastery', 1, 1, 5, [['righthand_mastery', 2]]], ['cloaking', 0, 2, 10, [['hiding', 2]]],
      ['enchant_poison', 0, 3, 10, [['envenom', 1]]], ['poison_react', 1, 3, 10, [['enchant_poison', 3]]], ['venom_dust', 1, 4, 10, [['enchant_poison', 5]]],
      ['venom_splasher', 2, 3, 10, [['poison_react', 5], ['venom_dust', 5]]], ['sonic_acceleration', 2, 1, 1, [], 'q'], ['throw_venom_knife', 2, 2, 1, [], 'q']],
    rogue: [['snatcher', 0, 0, 10, [['steal', 1]]], ['steal_coin', 1, 0, 10, [['snatcher', 4]]], ['back_stab', 2, 0, 10, [['steal_coin', 4]]], ['raid', 3, 0, 5, [['back_stab', 2], ['tunnel_drive', 2]]],
      ['intimidate', 4, 0, 5, [['back_stab', 4], ['raid', 5]]], ['plagiarism', 5, 0, 10, [['intimidate', 5]]], ['tunnel_drive', 0, 1, 5, [['hiding', 1]]],
      ['strip_helm', 1, 1, 5, [['steal_coin', 2]]], ['strip_shield', 2, 1, 5, [['strip_helm', 5]]], ['strip_armor', 3, 1, 5, [['strip_shield', 5]]], ['strip_weapon', 4, 1, 5, [['strip_armor', 5]]],
      ['rg_vultures_eye', 0, 2], ['rg_double_strafe', 1, 2, 10, [['rg_vultures_eye', 10]]], ['rg_remove_trap', 2, 2, 1, [['rg_double_strafe', 5]]],
      ['gangsters_paradise', 3, 2, 1, [['strip_shield', 3]]], ['compulsion_discount', 4, 2, 5, [['gangsters_paradise', 1]]], ['scribble', 5, 2, 1, [['compulsion_discount', 1]]],
      ['close_confine', 0, 3, 1, [], 'q']],
    blacksmith: [['iron_tempering', 0, 0, 5], ['steel_tempering', 1, 0, 5, [['iron_tempering', 1]]], ['enchanted_stone_craft', 2, 0, 5, [['iron_tempering', 1]]], ['oridecon_research', 3, 0, 5, [['enchanted_stone_craft', 1]]],
      ['smith_dagger', 0, 1, 3, [['iron_tempering', 1]]], ['smith_sword', 1, 1, 3, [['smith_dagger', 1]]], ['smith_twohand', 2, 1, 3, [['smith_sword', 1]]], ['smith_axe', 3, 1, 3, [['smith_sword', 2]]],
      ['smith_knuckle', 1, 2, 3, [['smith_dagger', 1]]], ['smith_mace', 2, 2, 3, [['smith_knuckle', 1]]], ['smith_spear', 3, 2, 3, [['smith_dagger', 2]]],
      ['hilt_binding', 0, 3, 1], ['ore_discovery', 1, 3, 1, [['hilt_binding', 1]]], ['weaponry_research', 2, 3, 10, [['hilt_binding', 1]]], ['weapon_repair', 3, 3, 1, [['weaponry_research', 1]]],
      ['skin_tempering', 0, 4, 5], ['hammer_fall', 1, 4, 5], ['adrenaline_rush', 2, 4, 5, [['hammer_fall', 2]]], ['weapon_perfection', 3, 4, 5, [['weaponry_research', 2], ['adrenaline_rush', 2]]],
      ['power_thrust', 4, 4, 5, [['adrenaline_rush', 3]]], ['maximize_power', 5, 4, 5, [['weapon_perfection', 3], ['power_thrust', 2]]], ['greed', 0, 5, 1, [], 'q'], ['unfair_trick', 1, 5, 1, [], 'q']],
    alchemist: [['axe_mastery', 0, 0], ['potion_research', 0, 1], ['prepare_potion', 1, 1, 10, [['potion_research', 5]]], ['potion_pitcher', 2, 0, 5, [['prepare_potion', 3]]],
      ['acid_terror', 2, 1, 5, [['prepare_potion', 5]]], ['demonstration', 2, 2, 5, [['prepare_potion', 4]]], ['summon_flora', 3, 1, 5, [['prepare_potion', 6]]], ['marine_sphere', 3, 2, 5, [['prepare_potion', 2]]],
      ['cp_weapon', 0, 3, 5, [['prepare_potion', 2]]], ['cp_shield', 1, 3, 5, [['cp_weapon', 3]]], ['cp_armor', 2, 3, 5, [['cp_shield', 3]]], ['cp_helm', 3, 3, 5, [['prepare_potion', 2]]],
      ['bioethics', 0, 4, 1, [], 'q']],
  };
  const keep = new Set();
  for (const job in T) for (const [id, row, col, max, req, q] of T[job]) {
    const s = S[id];
    if (!s) { console.warn('skill tree: missing', id); continue; }
    s.job = job; s.pos = [row, col]; if (max) s.max = max; s.req = req || []; s.quest = q === 'q'; s.granted = job === 'novice' && q === 'q';
    keep.add(id);
  }
  for (const id in S) if (!keep.has(id)) delete S[id];
  // Quest skills: Arrow Repel, Back Slide, Cart Revolution, Crazy Uproar, Holy Light are single-level like the classics.
  for (const id of ['arrow_repel', 'back_slide', 'cart_revolution', 'crazy_uproar', 'holy_light']) S[id].max = 1;
  // Skills placed on the ground, like the classics (click a spot instead of a monster).
  for (const id of ['thunderstorm', 'fire_wall', 'safety_wall', 'pr_safety_wall', 'storm_gust', 'meteor_storm', 'lord_of_vermilion', 'heavens_drive', 'sg_heavens_drive',
    'quagmire', 'ice_wall', 'fire_pillar', 'volcano', 'deluge', 'whirlwind', 'land_protector', 'sanctuary', 'magnus_exorcismus', 'venom_dust', 'demonstration',
    'summon_flora', 'marine_sphere', 'hammer_fall', 'scribble', 'warp_portal', 'skid_trap', 'land_mine', 'ankle_snare', 'shockwave_trap', 'sandman', 'flasher',
    'freezing_trap', 'blast_mine', 'claymore_trap', 'talkie_box']) {
    const s = S[id]; if (!s) continue;
    s.target = 'ground';
    if (!s.range || s.range === 'weapon') s.range = () => 9;
  }
  S.sanctuary.effect = 'sanctuary_field'; delete S.sanctuary.fx;
  G.Skills.TREES = T;
})(window.G = window.G || {});
