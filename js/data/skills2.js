/* Second-job skills. Most are described with a generic "fx" block run by the
   skill engine (systems/skills.js):
     kind  'phys' | 'magic' | 'buff' | 'heal' | 'special'
     mult  damage multiplier per hit (level => x);  hits (level => n)
     area  radius (0 = single target); at 'target' | 'self'
     element, knock, noMiss, ignoreDef, ranged, flat (level => +damage)
     status { id, chance (level => %), dur (level => s) }
     visual 'impact' | 'bolt' | 'orb' | 'arrow' | 'meteor' | 'beam' (+ color)
   Buffs reference SkillSystem.BUFFS by id. SP costs are scaled down like the
   first-job skills. */
(function (G) {
  'use strict';
  const S = G.Skills.DB;
  const r9 = () => 9;
  const add = (id, o) => {
    S[id] = Object.assign({ id, type: 'active', target: 'enemy', max: 10, req: [], sp: () => 0, cd: () => 0.5, cast: () => 0, range: 'weapon' }, o);
    const raw = S[id].sp;
    S[id].sp = (l) => (raw(l) > 0 ? Math.max(1, Math.round(raw(l) * 0.45)) : 0);
  };
  const pct = (n) => `${Math.round(n)}%`;
  const passive = (id, job, name, pos, icon, desc, bonus, extra) => add(id, Object.assign({ name, job, type: 'passive', pos, icon, desc, bonus }, extra || {}));
  const buff = (id, job, name, pos, icon, o) => add(id, Object.assign({ name, job, target: 'self', pos, icon }, o));

  /* ---------------- Knight ---------------- */
  passive('spear_mastery', 'knight', 'Spear Mastery', [0, 0], { shape: 's_sword', color: '#9fb6e8' },
    (l) => `+${4 * l} ATK while wielding a spear.`, (l, p) => (p.equippedWeaponType() === 'spear' ? { atk: 4 * l } : {}));
  add('pierce', { name: 'Pierce', job: 'knight', pos: [1, 0], req: [['spear_mastery', 1]], needs: 'spear', icon: { shape: 's_arrow', color: '#7fa6ff' },
    sp: () => 7, cd: () => 0.4, fx: { kind: 'phys', mult: (l) => 1 + 0.1 * l, hits: () => 2, visual: 'impact', color: '#9fc8ff' },
    desc: (l) => `Thrust twice with a spear, each hit ${pct(100 + 10 * l)}. Requires a spear.` });
  add('brandish_spear', { name: 'Brandish Spear', job: 'knight', pos: [2, 0], req: [['pierce', 3]], needs: 'spear', icon: { shape: 's_burst', color: '#7fa6ff' },
    sp: () => 12, cd: () => 1, cast: () => 0.7, fx: { kind: 'phys', mult: (l) => 1 + 0.2 * l, area: 2.6, knock: 1.5, visual: 'ring', color: '#9fc8ff' },
    desc: (l) => `Sweep your spear in a wide arc: ${pct(100 + 20 * l)} to everything near the target, knocking them back.` });
  buff('two_hand_quicken', 'knight', 'Two-Hand Quicken', [0, 1], { shape: 's_wing', color: '#ffb347' },
    { sp: (l) => 10 + 4 * l, cd: () => 2, fx: { kind: 'buff', id: 'two_hand_quicken', dur: (l) => 30 * l, color: '#ffb347' },
      desc: (l) => `Attack 30% faster for ${30 * l} seconds.` });
  add('bowling_bash', { name: 'Bowling Bash', job: 'knight', pos: [1, 1], req: [['two_hand_quicken', 1]], icon: { shape: 's_bash', color: '#ff9f43' },
    sp: (l) => 13 + l, cd: () => 1, cast: () => 0.7, fx: { kind: 'phys', mult: (l) => 1 + 0.4 * l, hits: () => 2, area: 2, knock: 2, visual: 'ring', color: '#ffb347' },
    desc: (l) => `Smash the target into its friends: two hits of ${pct(100 + 40 * l)} to everything nearby, with knockback.` });

  /* ---------------- Crusader ---------------- */
  passive('faith', 'crusader', 'Faith', [0, 0], { shape: 's_heart', color: '#fff2a0' },
    (l) => `+${40 * l} Max HP.`, (l) => ({ maxHp: 40 * l }));
  add('holy_cross', { name: 'Holy Cross', job: 'crusader', pos: [1, 0], req: [['faith', 3]], icon: { shape: 's_cross', color: '#fff2a0' },
    sp: (l) => 11 + l, cd: () => 0.5, fx: { kind: 'phys', mult: (l) => 1 + 0.35 * l, hits: () => 2, element: 'holy', visual: 'impact', color: '#fff2a0' },
    desc: (l) => `Carve a cross of light: two holy hits of ${pct(100 + 35 * l)}.` });
  add('grand_cross', { name: 'Grand Cross', job: 'crusader', target: 'self', pos: [2, 0], req: [['holy_cross', 6]], icon: { shape: 's_star', color: '#fff2a0' },
    sp: (l) => 37 + 3 * l, hp: (l) => 20 + 3 * l, cd: () => 2, cast: () => 3, element: 'holy',
    fx: { kind: 'magic', mult: (l) => 1.5 + 0.3 * l, area: 3.2, at: 'self', element: 'holy', visual: 'ring', color: '#fff2a0' },
    desc: (l) => `A blazing cross around you: ${pct(150 + 30 * l)} MATK holy damage to every nearby enemy. Costs a little HP.` });
  buff('auto_guard', 'crusader', 'Auto Guard', [0, 1], { shape: 's_shield', color: '#ffd77a' },
    { sp: (l) => 10 + 2 * l, cd: () => 2, fx: { kind: 'buff', id: 'auto_guard', dur: () => 300, color: '#ffd77a' },
      desc: (l) => `For 5 minutes, ${5 + 3 * l}% of monster attacks are blocked outright.` });

  /* ---------------- Wizard ---------------- */
  add('storm_gust', { name: 'Storm Gust', job: 'wizard', pos: [0, 0], range: r9, element: 'water', icon: { shape: 's_bolt', color: '#bfe8ff', element: 'water' },
    sp: (l) => 40 + 4 * l, cd: () => 2, cast: (l) => 0.8 + 0.6 * l,
    fx: { kind: 'magic', mult: (l) => 1 + 0.4 * l, hits: () => 3, hitDelay: 0.3, area: 3.5, element: 'water', visual: 'bolt', status: { id: 'frozen', chance: (l) => 15 + 5 * l, dur: () => 4 } },
    desc: (l) => `A blizzard on the target area: 3 waves of ${pct(100 + 40 * l)} MATK water damage, with a ${15 + 5 * l}% chance per wave to freeze.` });
  add('meteor_storm', { name: 'Meteor Storm', job: 'wizard', pos: [1, 0], range: r9, element: 'fire', icon: { shape: 's_burst', color: '#ff5a2a' },
    sp: (l) => 20 + 4 * l, cd: () => 2, cast: (l) => 1.5 + 0.5 * l,
    fx: { kind: 'magic', mult: () => 1.25, hits: (l) => Math.ceil(l / 2) + 1, hitDelay: 0.35, area: 3, element: 'fire', visual: 'meteor', status: { id: 'stunned', chance: (l) => 3 * l, dur: () => 2 } },
    desc: (l) => `Call ${Math.ceil(l / 2) + 1} meteors onto the target area, each 125% MATK fire damage to everything there, which may stun.` });
  add('jupitel_thunder', { name: 'Jupitel Thunder', job: 'wizard', pos: [0, 1], range: r9, element: 'wind', icon: { shape: 's_storm', color: '#ffe066' },
    sp: (l) => 18 + 2 * l, cd: () => 0.8, cast: (l) => 0.5 + 0.4 * l,
    fx: { kind: 'magic', mult: () => 1, hits: (l) => 2 + l, hitDelay: 0.09, element: 'wind', knock: 0.25, visual: 'orb', color: '#ffe066' },
    desc: (l) => `A ball of lightning that strikes ${2 + l} times for 100% MATK each, pushing the target back.` });
  add('lord_of_vermilion', { name: 'Lord of Vermilion', job: 'wizard', pos: [1, 1], req: [['jupitel_thunder', 5]], range: r9, element: 'wind', icon: { shape: 's_storm', color: '#ff7ad9' },
    sp: (l) => 40 + 5 * l, cd: () => 2, cast: (l) => 2 + 0.5 * l,
    fx: { kind: 'magic', mult: (l) => 0.8 + 0.2 * l, hits: () => 4, hitDelay: 0.25, area: 4, element: 'wind', visual: 'bolt' },
    desc: (l) => `Thunder rains on a wide area: 4 waves of ${pct(80 + 20 * l)} MATK wind damage.` });

  /* ---------------- Sage ---------------- */
  passive('advanced_book', 'sage', 'Advanced Book', [0, 0], { shape: 's_book', color: '#7fd0a0' },
    (l) => `+${3 * l} ATK and ${l * 0.5}% attack speed while holding a book.`, (l, p) => (p.equippedWeaponType() === 'book' ? { atk: 3 * l, aspd: 0.5 * l } : {}));
  add('earth_spike', { name: 'Earth Spike', job: 'sage', max: 5, pos: [1, 0], range: r9, element: 'earth', icon: { shape: 's_bolt', color: '#c9a06b', element: 'earth' },
    sp: (l) => 10 + 2 * l, cd: () => 0.6, cast: (l) => 0.7 * l,
    fx: { kind: 'magic', mult: () => 1, hits: (l) => l, hitDelay: 0.13, element: 'earth', visual: 'impact', color: '#c9a06b' },
    desc: (l) => `Spikes of stone burst up ${l} time${l > 1 ? 's' : ''}, each 100% MATK earth damage.` });
  add('heavens_drive', { name: 'Heaven’s Drive', job: 'sage', max: 5, pos: [2, 0], req: [['earth_spike', 1]], range: r9, element: 'earth', icon: { shape: 's_burst', color: '#c9a06b' },
    sp: (l) => 24 + 4 * l, cd: () => 1, cast: (l) => 1 * l,
    fx: { kind: 'magic', mult: () => 1, hits: (l) => l, hitDelay: 0.2, area: 3, element: 'earth', visual: 'ring', color: '#c9a06b' },
    desc: (l) => `The ground erupts around the target ${l} time${l > 1 ? 's' : ''}, 100% MATK earth damage to everything there.` });
  buff('endow_blaze', 'sage', 'Endow Blaze', [0, 1], { shape: 's_bolt', color: '#ff7a3d', element: 'fire' },
    { max: 5, sp: () => 40, cd: () => 2, cast: () => 3, fx: { kind: 'buff', id: 'endow_blaze', dur: (l) => 120 * l, color: '#ff7a3d' },
      desc: (l) => `Your weapon burns with fire for ${2 * l} minutes: normal attacks become fire element.` });
  buff('endow_tornado', 'sage', 'Endow Tornado', [1, 1], { shape: 's_bolt', color: '#ffe066', element: 'wind' },
    { max: 5, sp: () => 40, cd: () => 2, cast: () => 3, fx: { kind: 'buff', id: 'endow_tornado', dur: (l) => 120 * l, color: '#ffe066' },
      desc: (l) => `Your weapon crackles with wind for ${2 * l} minutes: normal attacks become wind element (great against water).` });

  /* ---------------- Hunter ---------------- */
  passive('beast_bane', 'hunter', 'Beast Bane', [0, 0], { shape: 's_eye', color: '#c9a06b' },
    (l) => `+${4 * l} ATK.`, (l) => ({ atk: 4 * l }));
  add('blitz_beat', { name: 'Blitz Beat', job: 'hunter', max: 5, pos: [1, 0], range: r9, icon: { shape: 's_wing', color: '#c9a06b' },
    sp: (l) => 7 + 3 * l, cd: () => 0.8,
    fx: { kind: 'phys', mult: (l) => 0.8 + 0.2 * l, hits: (l) => l, hitDelay: 0.1, noMiss: true, ranged: true, visual: 'orb', color: '#e3b55a' },
    desc: (l) => `Your falcon dives ${l} time${l > 1 ? 's' : ''}: ${pct(80 + 20 * l)} each, never missing.` });
  add('ankle_snare', { name: 'Ankle Snare', job: 'hunter', max: 5, pos: [0, 1], range: r9, icon: { shape: 's_hand', color: '#8fd16a' },
    sp: () => 12, cd: () => 1,
    fx: { kind: 'status', status: { id: 'rooted', chance: () => 100, dur: (l) => 4 + 2 * l }, visual: 'impact', color: '#8fd16a' },
    desc: (l) => `Snare a monster for ${4 + 2 * l} seconds: it can’t move (it can still attack if you’re close).` });
  add('sharp_shooting', { name: 'Sharp Shooting', job: 'hunter', pos: [2, 0], req: [['beast_bane', 3]], needs: 'bow', icon: { shape: 's_arrow', color: '#ff7a3d' },
    sp: (l) => 18 + 2 * l, cd: () => 1, cast: () => 1.5,
    fx: { kind: 'phys', mult: (l) => 2 + 0.5 * l, ranged: true, hitBonus: 20, visual: 'arrow' },
    desc: (l) => `A carefully aimed shot for ${pct(200 + 50 * l)}. Requires a bow.` });

  /* ---------------- Bard & Dancer ---------------- */
  add('musical_strike', { name: 'Musical Strike', job: 'bard', pos: [0, 0], needs: 'bow', icon: { shape: 's_arrows', color: '#ff6b8b' },
    sp: (l) => 12 + l, cd: () => 0.5, fx: { kind: 'phys', mult: (l) => 1.5 + 0.4 * l, ranged: true, visual: 'orb', color: '#ff9ec2' },
    desc: (l) => `Fire a singing arrow for ${pct(150 + 40 * l)}. Requires a bow.` });
  buff('poem_of_bragi', 'bard', 'A Poem of Bragi', [0, 1], { shape: 's_book', color: '#ff9ec2' },
    { sp: (l) => 40 + 5 * l, cd: () => 3, fx: { kind: 'buff', id: 'poem_of_bragi', dur: () => 180, color: '#ff9ec2' },
      desc: (l) => `For 3 minutes, your spells cast ${3 * l}% faster.` });
  buff('assassin_cross', 'bard', 'Assassin Cross of Sunset', [1, 1], { shape: 's_daggers', color: '#ff9f43' },
    { sp: (l) => 38 + 2 * l, cd: () => 3, fx: { kind: 'buff', id: 'assassin_cross', dur: () => 180, color: '#ff9f43' },
      desc: (l) => `For 3 minutes, attack ${10 + 2 * l}% faster.` });
  buff('whistle', 'bard', 'Whistle', [2, 1], { shape: 's_shout', color: '#8fe0d0' },
    { sp: (l) => 24 + 4 * l, cd: () => 3, fx: { kind: 'buff', id: 'whistle', dur: () => 180, color: '#8fe0d0' },
      desc: (l) => `For 3 minutes, +${2 * l} FLEE and +${l} LUK.` });
  add('throw_arrow', { name: 'Throw Arrow', job: 'dancer', pos: [0, 0], needs: 'bow', icon: { shape: 's_arrows', color: '#ff9ec2' },
    sp: (l) => 12 + l, cd: () => 0.5, fx: { kind: 'phys', mult: (l) => 1.5 + 0.4 * l, ranged: true, visual: 'arrow' },
    desc: (l) => `A spinning throw for ${pct(150 + 40 * l)}. Requires a bow.` });
  buff('service_for_you', 'dancer', 'Service for You', [0, 1], { shape: 's_drop', color: '#ff9ec2' },
    { sp: (l) => 40 + 5 * l, cd: () => 3, fx: { kind: 'buff', id: 'service_for_you', dur: () => 180, color: '#ff9ec2' },
      desc: (l) => `For 3 minutes, +${15 + l}% Max SP.` });
  buff('humming', 'dancer', 'Humming', [1, 1], { shape: 's_eye', color: '#ffd84a' },
    { sp: (l) => 20 + 2 * l, cd: () => 3, fx: { kind: 'buff', id: 'humming', dur: () => 180, color: '#ffd84a' },
      desc: (l) => `For 3 minutes, +${2 * l} HIT.` });
  add('dont_forget_me', { name: 'Please Don’t Forget Me', job: 'dancer', target: 'self', pos: [2, 0], icon: { shape: 's_swirl', color: '#c79bff' },
    sp: (l) => 28 + 2 * l, cd: () => 2, cast: () => 1,
    fx: { kind: 'status', area: 4, at: 'self', status: { id: 'slowed', chance: (l) => 50 + 5 * l, dur: () => 10 }, visual: 'ring', color: '#c79bff' },
    desc: (l) => `A haunting dance: monsters around you have a ${50 + 5 * l}% chance to be slowed for 10 seconds.` });

  /* ---------------- Priest ---------------- */
  add('sanctuary', { name: 'Sanctuary', job: 'priest', target: 'self', pos: [0, 0], icon: { shape: 's_cross', color: '#bff2c0' },
    sp: (l) => 15 + 3 * l, cd: () => 3, cast: () => 1.5, element: 'holy', fx: { kind: 'buff', id: 'sanctuary', dur: () => 8, color: '#bff2c0' },
    desc: (l) => `Holy ground beneath you heals ${20 + 15 * l} HP every second for 8 seconds.` });
  add('magnus_exorcismus', { name: 'Magnus Exorcismus', job: 'priest', pos: [1, 0], req: [['sanctuary', 3]], range: r9, element: 'holy', icon: { shape: 's_star', color: '#fff2a0' },
    sp: (l) => 40 + 5 * l, cd: () => 3, cast: () => 3,
    fx: { kind: 'magic', mult: (l) => 0.8 + 0.1 * l, hits: () => 3, hitDelay: 0.35, area: 3, element: 'holy', visual: 'beam', color: '#fff2a0' },
    desc: (l) => `A great holy cross on the target area: 3 waves of ${pct(80 + 10 * l)} MATK holy damage (devastating to ghosts and shadow creatures).` });
  buff('kyrie_eleison', 'priest', 'Kyrie Eleison', [0, 1], { shape: 's_shield', color: '#bfe8ff' },
    { sp: (l) => 20 + l, cd: () => 3, cast: () => 2, element: 'holy', fx: { kind: 'buff', id: 'kyrie_eleison', dur: () => 120, color: '#bfe8ff' },
      desc: (l) => `A holy barrier absorbs damage worth ${10 + 2 * l}% of your Max HP, for up to 2 minutes.` });
  buff('impositio_manus', 'priest', 'Impositio Manus', [1, 1], { shape: 's_halo', color: '#ffb347' },
    { max: 5, sp: (l) => 13 + 3 * l, cd: () => 2, element: 'holy', fx: { kind: 'buff', id: 'impositio_manus', dur: () => 60, color: '#ffb347' },
      desc: (l) => `+${5 * l} ATK for 60 seconds.` });
  buff('gloria', 'priest', 'Gloria', [2, 1], { shape: 's_halo', color: '#fff2a0' },
    { max: 5, sp: () => 20, cd: () => 3, element: 'holy', fx: { kind: 'buff', id: 'gloria', dur: (l) => 10 + 5 * l, color: '#fff2a0' },
      desc: (l) => `+30 LUK for ${10 + 5 * l} seconds.` });

  /* ---------------- Monk ---------------- */
  passive('iron_hands', 'monk', 'Iron Hands', [0, 0], { shape: 's_hand', color: '#c9783a' },
    (l) => `+${3 * l} ATK and +${2 * l} HIT with knuckles or bare hands.`, (l, p) => (/knuckle|none/.test(p.equippedWeaponType()) ? { atk: 3 * l, hit: 2 * l } : {}));
  passive('triple_attack', 'monk', 'Raging Trifecta Blow', [1, 0], { shape: 's_daggers', color: '#ff9f43' },
    (l) => `20% chance for a normal attack to become a 3-hit combo of ${pct(100 + 20 * l)} each.`, (l) => ({ tripleAttack: l }), { req: [['iron_hands', 3]] });
  add('occult_impaction', { name: 'Occult Impaction', job: 'monk', pos: [0, 1], icon: { shape: 's_bash', color: '#c79bff' },
    sp: () => 10, cd: () => 0.6, cast: () => 0.5, fx: { kind: 'phys', mult: (l) => 1 + 0.75 * l, ignoreDef: true, noMiss: true, visual: 'impact', color: '#c79bff' },
    desc: (l) => `A palm strike that passes through armour: ${pct(100 + 75 * l)}, ignoring DEF and never missing.` });
  add('asura_strike', { name: 'Asura Strike', job: 'monk', max: 5, pos: [2, 0], req: [['triple_attack', 5]], icon: { shape: 's_burst', color: '#ff3b3b' },
    sp: () => 1, cd: () => 4, cast: () => 4, fx: { kind: 'special' },
    desc: (l) => `Pour every point of SP into one blow: ATK × (8 + SP ÷ 10) + ${250 + 150 * l}. Needs at least half your SP and drains it all.` });

  /* ---------------- Assassin ---------------- */
  passive('katar_mastery', 'assassin', 'Katar Mastery', [0, 0], { shape: 's_daggers', color: '#c79bff' },
    (l) => `+${3 * l} ATK with a katar.`, (l, p) => (p.equippedWeaponType() === 'katar' ? { atk: 3 * l } : {}));
  add('sonic_blow', { name: 'Sonic Blow', job: 'assassin', pos: [1, 0], req: [['katar_mastery', 4]], needs: 'katar', icon: { shape: 's_daggers', color: '#ff5468' },
    sp: (l) => 14 + 2 * l, cd: () => 1, fx: { kind: 'phys', mult: (l) => (3 + 0.5 * l) / 8, hits: () => 8, hitDelay: 0.06, visual: 'impact', color: '#ff8a8a' },
    desc: (l) => `Eight lightning-fast slashes totalling ${pct(300 + 50 * l)}. Requires a katar.` });
  add('grimtooth', { name: 'Grimtooth', job: 'assassin', max: 5, pos: [2, 0], req: [['sonic_blow', 5]], range: () => 4, icon: { shape: 's_rain', color: '#c79bff' },
    sp: () => 3, cd: () => 0.5, fx: { kind: 'phys', mult: (l) => 1.2 + 0.2 * l, area: 1.6, ranged: true, visual: 'impact', color: '#c79bff' },
    desc: (l) => `Blades erupt from the ground near the target: ${pct(120 + 20 * l)} to everything there.` });
  buff('enchant_poison', 'assassin', 'Enchant Poison', [0, 1], { shape: 's_drop', color: '#6fd06a' },
    { sp: () => 20, cd: () => 2, fx: { kind: 'buff', id: 'enchant_poison', dur: (l) => 30 + 15 * l, color: '#6fd06a' },
      desc: (l) => `For ${30 + 15 * l} seconds your attacks are poison element and have a ${2.5 + 0.5 * l}% chance to poison.` });

  /* ---------------- Rogue ---------------- */
  add('back_stab', { name: 'Back Stab', job: 'rogue', pos: [0, 0], icon: { shape: 's_daggers', color: '#5f8a5f' },
    sp: () => 16, cd: () => 0.6, fx: { kind: 'phys', mult: (l) => 3 + 0.4 * l, noMiss: true, visual: 'impact', color: '#8fd16a' },
    desc: (l) => `Strike from the shadows for ${pct(300 + 40 * l)}. Never misses.` });
  add('raid', { name: 'Raid', job: 'rogue', target: 'self', max: 5, pos: [1, 0], icon: { shape: 's_burst', color: '#8fd16a' },
    sp: () => 20, cd: () => 1.5, fx: { kind: 'phys', mult: (l) => 1 + 0.4 * l, area: 2, at: 'self', visual: 'ring', color: '#8fd16a', status: { id: 'stunned', chance: (l) => 10 + 3 * l, dur: () => 2 } },
    desc: (l) => `Burst out at everything around you for ${pct(100 + 40 * l)}, with a chance to stun.` });
  passive('snatcher', 'rogue', 'Snatcher', [0, 1], { shape: 's_hand', color: '#c79bff' },
    (l) => `${3 + l}% chance to steal from a monster whenever you hit it.`, (l) => ({ snatcher: 3 + l }));
  add('strip_weapon', { name: 'Strip Weapon', job: 'rogue', max: 5, pos: [1, 1], icon: { shape: 's_hand', color: '#ff8a8a' },
    sp: (l) => 17 + l, cd: () => 1,
    fx: { kind: 'status', status: { id: 'disarmed', chance: (l) => 50 + 5 * l, dur: (l) => 20 + 5 * l }, visual: 'impact', color: '#ff8a8a' },
    desc: (l) => `Knock the weapon from a monster’s grasp: ${50 + 5 * l}% chance, its attacks deal 25% less for ${20 + 5 * l} seconds.` });

  /* ---------------- Blacksmith ---------------- */
  buff('adrenaline_rush', 'blacksmith', 'Adrenaline Rush', [0, 0], { shape: 's_wing', color: '#ff7a3d' },
    { sp: (l) => 17 + 3 * l, cd: () => 2, fx: { kind: 'buff', id: 'adrenaline_rush', dur: (l) => 30 * l, color: '#ff7a3d' },
      desc: (l) => `Attack 30% faster for ${30 * l} seconds.` });
  buff('power_thrust', 'blacksmith', 'Power Thrust', [1, 0], { shape: 's_bash', color: '#ff9f43' },
    { max: 5, sp: (l) => 18 - 2 * l, cd: () => 2, fx: { kind: 'buff', id: 'power_thrust', dur: (l) => 20 * l, color: '#ff9f43' },
      desc: (l) => `+${5 * l}% damage for ${20 * l} seconds.` });
  add('hammer_fall', { name: 'Hammerfall', job: 'blacksmith', max: 5, pos: [0, 1], icon: { shape: 's_bash', color: '#ffd84a' },
    sp: () => 10, cd: () => 1,
    fx: { kind: 'status', area: 2.5, status: { id: 'stunned', chance: (l) => 20 + 10 * l, dur: () => 3 }, visual: 'ring', color: '#ffd84a' },
    desc: (l) => `Slam the ground: monsters near the target have a ${20 + 10 * l}% chance to be stunned for 3 seconds.` });
  passive('skin_tempering', 'blacksmith', 'Skin Tempering', [1, 1], { shape: 's_shield', color: '#ff7a3d' },
    (l) => `+${2 * l}% Max HP from years at the forge.`, (l) => ({ maxHpPct: 2 * l }));

  /* ---------------- Alchemist ---------------- */
  passive('axe_mastery', 'alchemist', 'Axe Mastery', [0, 0], { shape: 's_sword', color: '#c9a06b' },
    (l) => `+${3 * l} ATK with an axe or sword.`, (l, p) => (/axe|sword/.test(p.equippedWeaponType()) ? { atk: 3 * l } : {}));
  add('acid_terror', { name: 'Acid Terror', job: 'alchemist', pos: [1, 0], range: r9, icon: { shape: 's_drop', color: '#9ee86a' },
    sp: () => 15, cd: () => 0.8, cast: () => 1, fx: { kind: 'phys', mult: (l) => 1 + 0.4 * l, ignoreDef: true, ranged: true, visual: 'orb', color: '#9ee86a' },
    desc: (l) => `Hurl a flask of acid: ${pct(100 + 40 * l)}, ignoring DEF.` });
  add('demonstration', { name: 'Demonstration', job: 'alchemist', pos: [0, 1], range: r9, element: 'fire', icon: { shape: 's_burst', color: '#ff7a3d' },
    sp: () => 10, cd: () => 2, cast: () => 1, fx: { kind: 'special' },
    desc: (l) => `A fire bomb sets the ground ablaze for ${4 + l} seconds: ${pct(60 + 10 * l)} MATK fire damage every half second to anything in it.` });
  add('potion_pitcher', { name: 'Potion Pitcher', job: 'alchemist', target: 'ally', range: r9, pos: [1, 1], icon: { shape: 's_cross', color: '#ff8a8a' },
    sp: () => 1, cd: () => 0.8, cast: () => 0.5, fx: { kind: 'heal', amount: (l) => 50 + 50 * l, color: '#ff8a8a' },
    desc: (l) => `Throw a potion at a character, restoring ${50 + 50 * l} HP.` });
})(window.G = window.G || {});
