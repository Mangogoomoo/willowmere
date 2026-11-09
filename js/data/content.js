/* Game content shared by the game, the database page and the server:
   extra items (skill materials, new weapons, dungeon loot, cards), the full
   monster roster from level 1 to 94 with bosses/MVPs on every map, and the
   Orc Dungeon and Ember Ruins maps. Levels, HP, attack, defence and
   elements follow the classic (pre-renewal) monster database; EXP is fitted
   to Willowmere's own level curve, and MVP HP is scaled for small groups. */
(function (G) {
  'use strict';
  const C = G.Config;

  const D = G.Items.DB;
  const item = (id, o) => { D[id] = Object.assign({ id, rarity: 'common', weight: 1, price: 10, stack: o.type !== 'equip' }, o); };
  item('blue_gemstone', { name: 'Blue Gemstone', type: 'etc', icon: { shape: 'ore', color: '#4f8ae8' }, price: 600, weight: 1, desc: 'A catalyst for Warp Portal, Safety Wall, Magnetic Earth and Resurrection.' });
  item('red_gemstone', { name: 'Red Gemstone', type: 'etc', icon: { shape: 'ore', color: '#e84f5a' }, price: 600, weight: 1, desc: 'A catalyst for Stone Curse, Venom Dust and Scribble.' });
  item('yellow_gemstone', { name: 'Yellow Gemstone', type: 'etc', icon: { shape: 'ore', color: '#ffd84a' }, price: 600, weight: 1, desc: 'A catalyst for the Sage\'s zones, Dispell and Hocus-pocus.' });
  item('holy_water', { name: 'Holy Water', type: 'use', icon: { shape: 'potion', color: '#bfe8ff' }, price: 20, weight: 3, use: { sp: 10 }, desc: 'Water blessed by Aqua Benedicta. Drink for 10 SP, or use it for Aspersio.' });
  item('stone', { name: 'Stone', type: 'etc', icon: { shape: 'ore', color: '#9aa3ad' }, price: 1, weight: 3, desc: 'Just a stone. Good for throwing.' });
  item('iron_ore', { name: 'Iron Ore', type: 'etc', icon: { shape: 'ore', color: '#8a7f70' }, price: 75, weight: 15, desc: 'Raw ore. Iron Tempering turns it into Iron.' });
  item('iron', { name: 'Iron', type: 'etc', icon: { shape: 'ore', color: '#b8c0cc' }, price: 100, weight: 10, desc: 'A refined iron ingot, the base of forged weapons.' });
  item('coal', { name: 'Coal', type: 'etc', icon: { shape: 'ore', color: '#3a3a40' }, price: 200, weight: 10, desc: 'Fuel for Steel Tempering.' });
  item('steel', { name: 'Steel', type: 'etc', icon: { shape: 'ore', color: '#dfe6f0' }, price: 600, weight: 10, rarity: 'uncommon', desc: 'Hard steel for advanced forging.' });
  item('ember', { name: 'Ember', type: 'etc', icon: { shape: 'ore', color: '#ff7a3d' }, price: 30, weight: 1, desc: 'A still-warm cinder dropped by Drops.' });
  for (const [id, name, color] of [['flame_heart', 'Flame Heart', '#ff5a2a'], ['mystic_frozen', 'Mystic Frozen', '#6fc3ff'], ['rough_wind', 'Rough Wind', '#ffe066'], ['great_nature', 'Great Nature', '#8fd16a']])
    item(id, { name, type: 'etc', icon: { shape: 'ore', color }, price: 1500, weight: 5, rarity: 'uncommon', desc: 'An elemental stone. Forge it into a weapon to give the weapon its element.' });
  for (const [el, name, color] of [['fire', 'Fire', '#ff5a2a'], ['water', 'Water', '#6fc3ff'], ['wind', 'Wind', '#ffe066'], ['earth', 'Earth', '#c9a06b']])
    item(`${el}_converter`, { name: `${name} Elemental Converter`, type: 'use', icon: { shape: 'book', color }, price: 200, weight: 3, use: { fn: 'converter', element: el }, desc: `Endow your weapon with ${el} for 3 minutes.` });
  item('acid_bottle', { name: 'Acid Bottle', type: 'etc', icon: { shape: 'potion', color: '#9ee86a' }, price: 100, weight: 10, desc: 'Ammunition for Acid Terror.' });
  item('bottle_grenade', { name: 'Bottle Grenade', type: 'etc', icon: { shape: 'potion', color: '#ff7a3d' }, price: 100, weight: 10, desc: 'Ammunition for Demonstration.' });
  item('arrow', { name: 'Arrow', type: 'etc', icon: { shape: 'arrow', color: '#c9a06b' }, price: 1, weight: 0.1, desc: 'A plain arrow. (Arrows aren\'t used as ammunition yet; sell them.)' });
  const W = (id, name, wt, wlv, atk, req, jobs, price, iconShape, color, desc, extra) => item(id, Object.assign({ name, type: 'equip', slot: 'weapon', weaponType: wt, wlv, icon: { shape: iconShape, color },
    weight: 70, price, slots: wlv >= 3 ? 1 : 2, reqLevel: req, jobs, bonus: { atk }, desc }, extra || {}));
  W('claymore', 'Claymore', 'twohand', 3, 180, 33, ['swordsman'], 15000, 'sword', '#e6edf5', 'A huge two-handed sword.', { slots: 0 });
  W('slayer', 'Slayer', 'twohand', 2, 120, 18, ['swordsman'], 8000, 'sword', '#cfd8e6', 'A broad two-handed blade.');
  W('violin', 'Violin', 'instrument', 2, 60, 1, ['bard'], 3000, 'book', '#a8743c', 'A sweet-voiced fiddle that doubles as a club.');
  W('guitar', 'Guitar', 'instrument', 3, 95, 20, ['bard'], 11000, 'book', '#c0394a', 'A guitar strung with steel. Rocks hard.');
  W('rope', 'Rope', 'whip', 1, 45, 1, ['dancer'], 1500, 'knuckle', '#c9a06b', 'A braided rope whip.');
  W('chain', 'Chain', 'whip', 2, 80, 15, ['dancer'], 7000, 'knuckle', '#cfd8e6', 'A whip of iron links.');
  Object.assign(G.Items.WEAPON_TYPES, {
    twohand: { name: 'Two-handed Sword', delay: 1.1, range: 1.85, twoHanded: true },
    instrument: { name: 'Instrument', delay: 0.95, range: 1.6 },
    whip: { name: 'Whip', delay: 0.9, range: 2.0 },
  });

  const drops = { drops: [['ember', 0.4], ['flame_heart', 0.004]], rocker: [['iron_ore', 0.15], ['great_nature', 0.004]], poporing: [['iron_ore', 0.1]], familiar: [['coal', 0.08]],
    spore: [['mystic_frozen', 0.004], ['coal', 0.05]], whisper: [['rough_wind', 0.006]], king_poring: [['steel', 0.3], ['flame_heart', 0.05]] };
  for (const m in drops) for (const [id, chance] of drops[m]) G.Config.MONSTERS[m].drops.push({ id, chance });

  /* ---------------- new loot, gear and the Emperium ---------------- */
  item('emperium', { name: 'Emperium', type: 'etc', icon: { shape: 'ore', color: '#ffd84a' }, price: 0, weight: 10, rarity: 'epic',
    desc: 'A radiant crystal said to hold the authority of a guild. You need one to found a guild. Orcs guard them jealously.' });
  item('decayed_nail', { name: 'Decayed Nail', type: 'etc', icon: { shape: 'leg', color: '#9a8a6a' }, price: 110, weight: 1, desc: 'A yellowed nail from an Orc Zombie.' });
  item('skel_bone', { name: 'Skel-Bone', type: 'etc', icon: { shape: 'leg', color: '#efe6d2' }, price: 140, weight: 1, desc: 'A sturdy bone from an Orc Skeleton.' });
  item('orcish_voucher', { name: 'Orcish Voucher', type: 'etc', icon: { shape: 'herb', color: '#7a9a3a' }, price: 120, weight: 1, desc: 'A crude orcish trade token.' });
  item('tooth_of_bat', { name: 'Tooth of Bat', type: 'etc', icon: { shape: 'leg', color: '#ffffff' }, price: 90, weight: 1, desc: 'A sharp little fang.' });
  item('burning_heart', { name: 'Burning Heart', type: 'etc', icon: { shape: 'ore', color: '#ff5a2a' }, price: 600, weight: 3, desc: 'A heart that still smoulders.' });
  item('brigan', { name: 'Brigan', type: 'etc', icon: { shape: 'cape', color: '#5a4a7a' }, price: 400, weight: 1, desc: 'A scrap of a haunted knight\'s mail.' });
  item('evil_horn', { name: 'Evil Horn', type: 'etc', icon: { shape: 'leg', color: '#3a2a4a' }, price: 2000, weight: 1, rarity: 'uncommon', desc: 'A horn that hums with dark power.' });
  item('old_magic_book', { name: 'Old Magic Book', type: 'etc', icon: { shape: 'book', color: '#5a3a7a' }, price: 1500, weight: 5, desc: 'Its pages whisper when turned.' });
  item('white_potion', { name: 'White Potion', type: 'use', icon: { shape: 'potion', color: '#f4f4f4' }, price: 1200, weight: 15, use: { heal: 325 }, desc: 'Restores about 325 HP.' });
  item('yggdrasil_berry', { name: 'Yggdrasil Berry', type: 'use', icon: { shape: 'apple', color: '#ff6b8b' }, price: 5000, weight: 30, rarity: 'rare', use: { heal: 99999, sp: 99999 }, desc: 'Fully restores HP and SP.' });
  item('orcish_axe', { name: 'Orcish Axe', type: 'equip', slot: 'weapon', weaponType: 'axe', wlv: 3, icon: { shape: 'axe', color: '#9aa36a' }, weight: 150, price: 18000, slots: 1,
    reqLevel: 30, jobs: ['merchant', 'swordsman'], bonus: { atk: 145 }, rarity: 'rare', desc: 'A brutal axe hammered out by orc smiths.' });
  item('orc_helm', { name: 'Orc Helm', type: 'equip', slot: 'headTop', icon: { shape: 'crown', color: '#7a6a4a' }, weight: 50, price: 9000, slots: 0, reqLevel: 25, jobs: 'all',
    bonus: { def: 5 }, rarity: 'uncommon', desc: 'A dented iron helm taken from an orc.' });
  item('bloody_edge', { name: 'Bloody Edge', type: 'equip', slot: 'weapon', weaponType: 'sword', wlv: 4, icon: { shape: 'sword', color: '#c0394a' }, weight: 100, price: 60000, slots: 1,
    reqLevel: 60, jobs: ['swordsman', 'thief', 'merchant'], bonus: { atk: 210, crit: 5 }, rarity: 'epic', desc: 'A blade that drinks the light around it.' });

  /* Cards for the new monsters. */
  const SLOTN = { weapon: 'weapon', armor: 'armour', garment: 'garment', shoes: 'shoes', headgear: 'headgear', acc: 'accessory', shield: 'shield' };
  const card = (mon, name, slot, bonus, text, color, naming) => item('card_' + mon, { name: `${name} Card`, type: 'card', cardSlot: slot, bonus, rarity: 'card',
    icon: { shape: 'card', color, letter: name[0], slot: (G.Items.CARD_SLOTS && G.Items.CARD_SLOTS[slot] && G.Items.CARD_SLOTS[slot].short) || slot.toUpperCase() },
    weight: 1, price: 20, naming, effectText: text, desc: `A card holding the essence of a ${name}. Goes into ${SLOTN[slot]}.` });
  card('marin', 'Marin', 'acc', { dex: 2 }, 'DEX +2.', '#9fd8ff', { prefix: 'Slippery' });
  card('eclipse', 'Eclipse', 'headgear', { vit: 2, maxHp: 150 }, 'VIT +2, Max HP +150.', '#ffe6f0', { prefix: 'Bunny' });
  card('vocal', 'Vocal', 'acc', { agi: 2, flee: 5 }, 'AGI +2, FLEE +5.', '#8fd16a', { suffix: 'of Song' });
  card('poison_spore', 'Poison Spore', 'weapon', { atk: 10, str: 1 }, 'ATK +10, STR +1.', '#9a5ad0', { prefix: 'Venomous' });
  card('drainliar', 'Drainliar', 'weapon', { atk: 15 }, 'ATK +15.', '#c0394a', { prefix: 'Draining' });
  card('orc_zombie', 'Orc Zombie', 'armor', { vit: 2, def: 2 }, 'VIT +2, DEF +2.', '#7a9a5a', { prefix: 'Rotting' });
  card('orc_skeleton', 'Orc Skeleton', 'weapon', { atk: 20 }, 'ATK +20.', '#efe6d2', { prefix: 'Bony' });
  card('zenorc', 'Zenorc', 'weapon', { atk: 12, crit: 3 }, 'ATK +12, CRIT +3.', '#5a8a3a', { prefix: 'Savage' });
  card('orc_lord', 'Orc Lord', 'armor', { str: 3, maxHpPct: 10, def: 3 }, 'STR +3, Max HP +10%, DEF +3.', '#c9a24a', { suffix: 'of the Orc Lord' });
  card('wind_ghost', 'Wind Ghost', 'acc', { int: 2, maxSp: 60 }, 'INT +2, Max SP +60.', '#ffe066', { prefix: 'Breezy' });
  card('wraith', 'Wraith', 'armor', { maxHpPct: 8, vit: 1 }, 'Max HP +8%, VIT +1.', '#6f7ba8', { prefix: 'Spectral' });
  card('raydric', 'Raydric', 'garment', { def: 4, mdef: 4, vit: 1 }, 'DEF +4, MDEF +4, VIT +1.', '#3a3a5a', { suffix: 'of the Raydric' });
  card('evil_druid', 'Evil Druid', 'armor', { int: 3, mdef: 5 }, 'INT +3, MDEF +5.', '#3f7a3a', { prefix: 'Accursed' });
  card('khalitzburg', 'Khalitzburg', 'weapon', { atk: 30, str: 2 }, 'ATK +30, STR +2.', '#9aa3ad', { prefix: 'Knightly' });
  card('abysmal_knight', 'Abysmal Knight', 'weapon', { atk: 40, crit: 4 }, 'ATK +40, CRIT +4.', '#2a2a3a', { prefix: 'Abysmal' });
  card('bloody_knight', 'Bloody Knight', 'shoes', { str: 3, agi: 3, maxHpPct: 5 }, 'STR +3, AGI +3, Max HP +5%.', '#8a1a2a', { suffix: 'of Blood' });
  card('dark_lord', 'Dark Lord', 'headgear', { int: 5, maxSpPct: 15 }, 'INT +5, Max SP +15%.', '#3a1a4a', { suffix: 'of the Dark Lord' });
  card('lord_of_death', 'Lord of Death', 'shoes', { vit: 5, maxHpPct: 20 }, 'VIT +5, Max HP +20%.', '#1a1a2a', { suffix: 'of Death' });

  /* ---------------- elements: undead ---------------- */
  if (C.ELEMENTS) {
    const E = C.ELEMENTS;
    (E.holy = E.holy || {}).undead = 2; (E.fire = E.fire || {}).undead = 1.5;
    (E.poison = E.poison || {}).undead = 0.5; (E.shadow = E.shadow || {}).undead = 0;
  }

  /* ---------------- monsters ---------------- */
  // EXP from our own level curve (about a dozen kills per level at your level; MVPs give about 40x).
  const xp = (lv, mvp) => Math.max(1, Math.round((C.EXP_TABLE[Math.min(98, lv)] || 10) * 0.045 * (mvp ? 40 : 1)));
  const mon = (id, o) => {
    const lv = o.level;
    C.MONSTERS[id] = Object.assign({
      softDef: Math.round((o.def || 0) / 3), mdef: 0, hit: 10 + lv * 2, flee: 10 + lv, element: 'neutral',
      speed: 2.2, chaseSpeed: 3.6, attackRange: 1.4, attackInterval: 1.4, impactTime: 0.3,
      respawn: o.mvp ? 300 : 14, hitRadius: 0.85, height: 2, radius: 0.55, scale: 1.2, deathColor: [0.7, 0.7, 0.75],
      zeny: { chance: 0.7, min: lv * 4, max: lv * 10 },
    }, o, { exp: o.exp || xp(lv, o.mvp), jobExp: o.jobExp || Math.round(xp(lv, o.mvp) * 0.75) });
  };
  // Re-level the original monsters toward their classic levels so progression flows.
  const relevel = (id, lv, extra) => { const m = C.MONSTERS[id]; if (!m) return; m.level = lv; m.exp = xp(lv); m.jobExp = Math.round(xp(lv) * 0.75); Object.assign(m, extra || {}); };
  relevel('pupa', 2, { hp: 427 });
  relevel('rocker', 9, { hp: 198 });
  relevel('poporing', 14, { hp: 344 });
  relevel('familiar', 8, { hp: 155 });
  relevel('spore', 16, { hp: 510, atk: [24, 48] });
  relevel('whisper', 24, { hp: 1100, atk: [60, 90] });
  if (C.MONSTERS.king_poring) Object.assign(C.MONSTERS.king_poring, { level: 30, mvp: true, hp: 18000, atk: [90, 140], exp: xp(30, true), jobExp: Math.round(xp(30, true) * 0.75), respawn: 300 });

  // Meadow / forest bosses (classic mini-bosses).
  mon('marin', { name: 'Marin', level: 15, hp: 742, atk: [39, 43], def: 0, mdef: 10, element: 'water', sprite: { base: 'poring', hue: -130, sat: 1.1, light: 1.05 },
    drops: [{ id: 'card_marin', chance: 0.002 }, { id: 'jellopy', chance: 0.6 }, { id: 'blue_potion', chance: 0.03 }] });
  mon('eclipse', { name: 'Eclipse', level: 6, hp: 1800, atk: [20, 26], def: 0, element: 'neutral', boss: { slamEvery: 9, slamRadius: 2.6, slamDamage: [25, 40] },
    scale: 1.9, hitRadius: 1.1, height: 2.4, respawn: 240, sprite: { base: 'lunatic', hue: -20, sat: 0.6, light: 1.12 },
    drops: [{ id: 'card_eclipse', chance: 0.05 }, { id: 'carrot', chance: 1, qty: 5 }, { id: 'clover', chance: 0.6 }, { id: 'moonbunny_ears', chance: 0.08 }] });
  mon('vocal', { name: 'Vocal', level: 18, hp: 3317, atk: [71, 82], def: 10, element: 'earth', boss: { slamEvery: 8, slamRadius: 3, slamDamage: [60, 90] }, aggressive: true,
    scale: 1.7, hitRadius: 1.1, height: 2.6, respawn: 300, sprite: { base: 'rocker', hue: 35, sat: 1.2, light: 0.95 },
    drops: [{ id: 'card_vocal', chance: 0.05 }, { id: 'grasshopper_leg', chance: 1, qty: 4 }, { id: 'great_nature', chance: 0.15 }, { id: 'white_potion', chance: 0.4 }] });
  // Mossy Hollow additions.
  mon('poison_spore', { name: 'Poison Spore', level: 19, hp: 665, atk: [89, 101], def: 0, element: 'poison', aggressive: false, sprite: { base: 'spore', hue: 250, sat: 1.2 },
    drops: [{ id: 'card_poison_spore', chance: 0.002 }, { id: 'spore_cap', chance: 0.6 }, { id: 'green_herb', chance: 0.3 }] });
  // Orc Dungeon.
  mon('drainliar', { name: 'Drainliar', level: 24, hp: 1162, atk: [192, 216], def: 0, element: 'shadow', aggressive: true, aggroRange: 7, flying: true, speed: 3, chaseSpeed: 4.6,
    sprite: { base: 'familiar', hue: 95, sat: 1.5, light: 0.95 }, drops: [{ id: 'card_drainliar', chance: 0.002 }, { id: 'tooth_of_bat', chance: 0.5 }, { id: 'bat_wing', chance: 0.4 }] });
  mon('orc_zombie', { name: 'Orc Zombie', level: 24, hp: 1568, atk: [151, 184], def: 5, mdef: 10, element: 'undead', aggressive: true, speed: 1.8, chaseSpeed: 2.8,
    sprite: { humanoid: { costume: 'orc_zombie', weapon: 'none', skin: '#7a9a5a', hair: 'raven', style: 'buzz' } },
    drops: [{ id: 'card_orc_zombie', chance: 0.002 }, { id: 'emperium', chance: 0.0015 }, { id: 'decayed_nail', chance: 0.55 }, { id: 'orcish_voucher', chance: 0.2 }, { id: 'orc_helm', chance: 0.003 }] });
  mon('orc_skeleton', { name: 'Orc Skeleton', level: 26, hp: 2278, atk: [190, 236], def: 36, mdef: 10, element: 'undead', aggressive: true,
    sprite: { humanoid: { costume: 'orc_skeleton', weapon: 'axe', skin: '#efe6d2', hair: 'snow', style: 'buzz', eyes: 'violet' } },
    drops: [{ id: 'card_orc_skeleton', chance: 0.002 }, { id: 'emperium', chance: 0.0015 }, { id: 'skel_bone', chance: 0.5 }, { id: 'orcish_axe', chance: 0.002 }, { id: 'iron_ore', chance: 0.1 }] });
  mon('zenorc', { name: 'Zenorc', level: 31, hp: 2585, atk: [188, 246], def: 0, element: 'shadow', aggressive: true, speed: 2.6, chaseSpeed: 4.2,
    sprite: { humanoid: { costume: 'zenorc', weapon: 'knuckle', skin: '#5a8a3a', hair: 'raven', style: 'spiky' } },
    drops: [{ id: 'card_zenorc', chance: 0.002 }, { id: 'emperium', chance: 0.002 }, { id: 'tooth_of_bat', chance: 0.4 }, { id: 'orcish_voucher', chance: 0.3 }, { id: 'yellow_gemstone', chance: 0.05 }] });
  mon('orc_lord', { name: 'Orc Lord', level: 55, mvp: true, hp: 60000, atk: [380, 480], def: 40, mdef: 25, element: 'earth', aggressive: true, scale: 1.8, hitRadius: 1.4, height: 3.2,
    boss: { slamEvery: 7, slamRadius: 3.6, slamDamage: [500, 700] }, chaseSpeed: 3.4,
    sprite: { humanoid: { costume: 'orc_lord', weapon: 'axe', skin: '#5a8a3a', hair: 'raven', style: 'buzz' } },
    drops: [{ id: 'card_orc_lord', chance: 0.05 }, { id: 'emperium', chance: 0.3 }, { id: 'orcish_axe', chance: 0.25 }, { id: 'orc_helm', chance: 0.3 }, { id: 'yggdrasil_berry', chance: 0.5 }, { id: 'oridecon', chance: 0.5, qty: 2 }] });
  // Ember Ruins (levels 50-94).
  mon('wind_ghost', { name: 'Wind Ghost', level: 51, hp: 4820, atk: [250, 330], def: 0, mdef: 45, element: 'wind', aggressive: true, flying: true, flee: 70,
    sprite: { base: 'whisper', hue: -140, sat: 2.2, light: 0.95 }, drops: [{ id: 'card_wind_ghost', chance: 0.002 }, { id: 'rough_wind', chance: 0.05 }, { id: 'old_magic_book', chance: 0.1 }] });
  mon('raydric', { name: 'Raydric', level: 52, hp: 8613, atk: [370, 430], def: 40, mdef: 15, element: 'shadow', aggressive: true,
    sprite: { humanoid: { costume: 'raydric', weapon: 'twohand', skin: '#3a3a4a', hair: 'raven', style: 'buzz' } },
    drops: [{ id: 'card_raydric', chance: 0.002 }, { id: 'brigan', chance: 0.5 }, { id: 'white_potion', chance: 0.1 }, { id: 'elunium', chance: 0.05 }] });
  mon('wraith', { name: 'Wraith', level: 53, hp: 10999, atk: [290, 380], def: 5, mdef: 30, element: 'undead', aggressive: true, flying: true,
    sprite: { base: 'whisper', hue: 45, sat: 0.7, light: 0.5 }, drops: [{ id: 'card_wraith', chance: 0.002 }, { id: 'ectoplasm', chance: 0.6 }, { id: 'white_potion', chance: 0.15 }] });
  mon('evil_druid', { name: 'Evil Druid', level: 58, hp: 16506, atk: [250, 370], def: 5, mdef: 60, element: 'undead', aggressive: true,
    sprite: { humanoid: { costume: 'evil_druid', weapon: 'rod', skin: '#b8c8a8', hair: 'snow', style: 'slick' } },
    drops: [{ id: 'card_evil_druid', chance: 0.002 }, { id: 'old_magic_book', chance: 0.3 }, { id: 'blue_gemstone', chance: 0.2 }] });
  mon('khalitzburg', { name: 'Khalitzburg', level: 63, hp: 19276, atk: [410, 490], def: 45, mdef: 10, element: 'undead', aggressive: true,
    sprite: { humanoid: { costume: 'khalitzburg', weapon: 'twohand', skin: '#efe6d2', hair: 'snow', style: 'buzz' } },
    drops: [{ id: 'card_khalitzburg', chance: 0.002 }, { id: 'skel_bone', chance: 0.6 }, { id: 'oridecon', chance: 0.05 }] });
  mon('abysmal_knight', { name: 'Abysmal Knight', level: 79, hp: 36140, atk: [640, 880], def: 55, mdef: 25, element: 'shadow', aggressive: true, scale: 1.35,
    sprite: { humanoid: { costume: 'abysmal_knight', weapon: 'spear', skin: '#2a2a3a', hair: 'raven', style: 'buzz' } },
    drops: [{ id: 'card_abysmal_knight', chance: 0.002 }, { id: 'evil_horn', chance: 0.3 }, { id: 'elunium', chance: 0.1 }, { id: 'bloody_edge', chance: 0.002 }] });
  mon('bloody_knight', { name: 'Bloody Knight', level: 82, hp: 57870, atk: [800, 1080], def: 60, mdef: 45, element: 'shadow', aggressive: true, scale: 1.4,
    sprite: { humanoid: { costume: 'bloody_knight', weapon: 'twohand', skin: '#5a1a2a', hair: 'raven', style: 'buzz' } },
    drops: [{ id: 'card_bloody_knight', chance: 0.002 }, { id: 'burning_heart', chance: 0.3 }, { id: 'bloody_edge', chance: 0.005 }, { id: 'yggdrasil_berry', chance: 0.02 }] });
  mon('dark_lord', { name: 'Dark Lord', level: 80, mvp: true, hp: 160000, atk: [1050, 1300], def: 30, mdef: 70, element: 'undead', aggressive: true, scale: 1.9, hitRadius: 1.4, height: 3.4,
    boss: { slamEvery: 6, slamRadius: 4, slamDamage: [900, 1250] },
    sprite: { humanoid: { costume: 'dark_lord', weapon: 'rod', skin: '#d8d0e8', hair: 'raven', style: 'slick' } },
    drops: [{ id: 'card_dark_lord', chance: 0.05 }, { id: 'old_magic_book', chance: 1, qty: 3 }, { id: 'yggdrasil_berry', chance: 0.6 }, { id: 'evil_horn', chance: 0.5 }] });
  mon('lord_of_death', { name: 'Lord of Death', level: 94, mvp: true, hp: 300000, atk: [1250, 1550], def: 70, mdef: 73, element: 'shadow', aggressive: true, scale: 2.1, hitRadius: 1.5, height: 3.8,
    boss: { slamEvery: 5, slamRadius: 4.5, slamDamage: [1150, 1550] },
    sprite: { humanoid: { costume: 'lord_of_death', weapon: 'spear', skin: '#1a1a24', hair: 'raven', style: 'buzz' } },
    drops: [{ id: 'card_lord_of_death', chance: 0.05 }, { id: 'yggdrasil_berry', chance: 1, qty: 2 }, { id: 'bloody_edge', chance: 0.2 }, { id: 'evil_horn', chance: 1 }] });

  /* ---------------- Sunpetal Plains: Geographers, Giearths and Metalings (v0.40) ---------------- */
  item('maneater_blossom', { name: 'Maneater Blossom', type: 'etc', icon: { shape: 'herb', color: '#ffd23a' }, price: 40, weight: 1, desc: 'A golden petal from a Geographer. It still bites.' });
  item('maneater_root', { name: 'Maneater Root', type: 'etc', icon: { shape: 'leg', color: '#8a6a3a' }, price: 60, weight: 1, desc: 'A gnarled root that held a Geographer in place.' });
  item('elder_pixie_moustache', { name: 'Elder Pixie’s Moustache', type: 'etc', icon: { shape: 'fluff', color: '#f4f2ee' }, price: 50, weight: 1, desc: 'A Giearth’s proud white whiskers.' });
  item('star_dust', { name: 'Star Dust', type: 'etc', icon: { shape: 'ore', color: '#fff3a0' }, price: 120, weight: 1, rarity: 'uncommon', desc: 'Glittering dust said to fall from the stars.' });
  item('jubilee', { name: 'Jubilee', type: 'etc', icon: { shape: 'clover', color: '#ffd84a' }, price: 30, weight: 1, desc: 'A shiny little token Metalings love to collect.' });
  item('flexible_tube', { name: 'Flexible Tube', type: 'etc', icon: { shape: 'pipe', color: '#9aa3ad' }, price: 60, weight: 1, desc: 'A bendy metal tube from a Metaling.' });
  item('rusty_screw', { name: 'Rusty Screw', type: 'etc', icon: { shape: 'ore', color: '#a8643a' }, price: 200, weight: 1, desc: 'A screw that has seen better days.' });
  item('large_jellopy', { name: 'Large Jellopy', type: 'etc', icon: { shape: 'jellopy', color: '#7fc8ff' }, price: 90, weight: 1, desc: 'An unusually big, wobbly jellopy.' });
  item('heal_scroll', { name: 'Heal Scroll', type: 'use', icon: { shape: 'book', color: '#7dff9a' }, price: 800, weight: 1, rarity: 'uncommon', use: { heal: 600 }, desc: 'A prayer written on a leaf. Restores about 600 HP.' });

  card('geographer', 'Geographer', 'garment', { healPct: 10, int: 1 }, 'Heal power +10%, INT +1.', '#ffd23a', { prefix: 'Blooming' });
  card('giearth', 'Giearth', 'shoes', { vit: 1, maxHp: 100, mdef: 2 }, 'VIT +1, Max HP +100, MDEF +2.', '#8a6a3a', { suffix: 'of the Gnome' });
  card('metaling', 'Metaling', 'weapon', { atk: 15, hit: 5 }, 'ATK +15, HIT +5.', '#9aa3ad', { prefix: 'Metallic' });

  /* ---------------- gear for every build (v0.40) ----------------
     Magic (INT/DEX), healing (INT/VIT), ranged (DEX/AGI/LUK), melee (STR/AGI/LUK) and tank (STR/VIT):
     each has a weapon for its classes plus armour, garment, shoes, headgear and an accessory. */
  const MAGIC = ['mage', 'wizard', 'sage'], HEALERS = ['acolyte', 'priest', 'monk'], BOWS = ['archer', 'hunter', 'bard', 'dancer', 'rogue'];
  const SWORDS = ['swordsman', 'knight', 'crusader', 'thief', 'assassin', 'rogue', 'merchant', 'blacksmith', 'alchemist'];
  const gear = (id, name, slot, req, bonus, icon, color, price, desc, extra) => item(id, Object.assign({ name, type: 'equip', slot, icon: { shape: icon, color },
    weight: slot === 'armor' ? 80 : slot === 'shield' ? 70 : 20, price, slots: 1, reqLevel: req, jobs: 'all', bonus, rarity: 'rare', desc }, extra || {}));
  const weapon = (id, name, wt, wlv, req, jobs, bonus, icon, color, price, desc) => gear(id, name, 'weapon', req, bonus, icon, color, price, desc,
    { weaponType: wt, wlv, jobs, weight: 90 });
  // Magic
  weapon('apprentice_staff', 'Apprentice Staff', 'rod', 2, 20, MAGIC, { atk: 30, matk: 50, int: 2, dex: 1 }, 'rod', '#7fb8e8', 9000, 'A practice staff with a steady glow.');
  weapon('arcanist_staff', 'Arcanist Staff', 'rod', 3, 40, MAGIC, { atk: 35, matk: 90, int: 3, castReduce: 5 }, 'rod', '#5ab4ff', 32000, 'Spells leap from its crystal before the words are done.');
  weapon('tome_of_embers', 'Tome of Embers', 'book', 3, 45, ['sage'], { atk: 70, matk: 80, int: 3, dex: 2 }, 'book', '#ff7a3d', 36000, 'Its pages are warm to the touch.');
  gear('arcanist_robe', 'Arcanist Robe', 'armor', 35, { def: 3, mdef: 10, int: 2, maxSp: 80 }, 'shirt', '#4a5ad8', 24000, 'Robes stitched with silver runes.');
  gear('starweave_mantle', 'Starweave Mantle', 'garment', 30, { def: 1, mdef: 5, dex: 2 }, 'cape', '#3a3a8a', 16000, 'A cloak that shimmers like the night sky.');
  gear('arcanist_slippers', 'Arcanist Slippers', 'shoes', 30, { def: 1, int: 1, maxSpPct: 5 }, 'boots', '#6a5ab0', 14000, 'Soft slippers for long nights of study.');
  gear('mana_circlet', 'Mana Circlet', 'headTop', 30, { int: 2, dex: 1, mdef: 3 }, 'crown', '#5ab4ff', 18000, 'A thin gold band with a blue stone.', { look: 'circlet', slots: 0 });
  gear('focus_ring', 'Focus Ring', 'acc', 35, { int: 2, dex: 2, castReduce: 3 }, 'brooch', '#5ab4ff', 22000, 'Helps the mind stay on the spell.');
  // Healing
  weapon('lightbringer_rod', 'Lightbringer Rod', 'rod', 3, 35, HEALERS, { atk: 30, matk: 55, int: 2, healPct: 15 }, 'rod', '#ffe27a', 28000, 'Warm light gathers at its tip.');
  weapon('mace_of_mercy', 'Mace of Mercy', 'mace', 3, 40, HEALERS, { atk: 110, int: 2, vit: 1, healPct: 10 }, 'club', '#f2efe6', 30000, 'Strikes gently, heals mightily.');
  weapon('holy_codex', 'Holy Codex', 'book', 3, 50, ['priest'], { atk: 80, matk: 50, int: 2, vit: 2, healPct: 12 }, 'book', '#f2efe6', 40000, 'Every prayer ever answered, written down.');
  gear('vestments_of_grace', 'Vestments of Grace', 'armor', 35, { def: 5, mdef: 8, vit: 2, int: 1, maxHpPct: 5 }, 'shirt', '#f2f0f7', 24000, 'White robes trimmed with gold.');
  gear('prayer_shawl', 'Prayer Shawl', 'garment', 30, { def: 2, mdef: 4, vit: 1, healPct: 5 }, 'cape', '#e6c25a', 15000, 'Blessed in the Pond Priestess’s waters.');
  gear('pilgrim_sandals', 'Pilgrim Sandals', 'shoes', 25, { def: 2, vit: 2, maxHp: 150 }, 'boots', '#c9a06b', 10000, 'Worn smooth by many miles of walking.');
  gear('halo_circlet', 'Halo Circlet', 'headTop', 40, { int: 1, vit: 1, healPct: 5, mdef: 2 }, 'crown', '#fff3b0', 26000, 'A ring of soft light that floats above you.', { look: 'halo', slots: 0 });
  gear('rosary', 'Rosary of Light', 'acc', 30, { int: 2, vit: 1, spRegenPct: 10 }, 'brooch', '#f2efe6', 18000, 'Counting its beads calms the spirit.');
  // Ranged
  weapon('hawkeye_bow', 'Hawkeye Bow', 'bow', 2, 25, BOWS, { atk: 85, dex: 2, crit: 3 }, 'bow', '#8a5a2c', 14000, 'A light bow for quick, sure shots.');
  weapon('gale_longbow', 'Gale Longbow', 'bow', 3, 40, BOWS, { atk: 130, dex: 3, hit: 8 }, 'bow', '#8fe0d0', 34000, 'Its arrows ride the wind.');
  weapon('whispering_lyre', 'Whispering Lyre', 'instrument', 3, 40, ['bard'], { atk: 120, dex: 2, agi: 2 }, 'book', '#e6c25a', 32000, 'Its notes cut like blades.');
  weapon('silkwind_whip', 'Silkwind Whip', 'whip', 3, 40, ['dancer'], { atk: 115, agi: 2, luk: 2 }, 'knuckle', '#ff9ad6', 32000, 'A silk whip that sings through the air.');
  gear('ranger_jerkin', 'Ranger Jerkin', 'armor', 30, { def: 4, agi: 2, flee: 5 }, 'shirt', '#5f8a3a', 18000, 'Light leather for moving fast.');
  gear('windrunner_cloak', 'Windrunner Cloak', 'garment', 30, { def: 2, flee: 8, agi: 1 }, 'cape', '#8fe0d0', 16000, 'Catches the wind at your back.');
  gear('swift_boots', 'Swift Boots', 'shoes', 25, { def: 2, agi: 2, moveSpeed: 5 }, 'boots', '#5f8a3a', 14000, 'Boots for those who never stand still.');
  gear('eagle_goggles', 'Eagle Goggles', 'headMid', 30, { dex: 3, hit: 5 }, 'glasses', '#c9a24a', 16000, 'See a fly’s wings at fifty paces.', { look: 'glasses', slots: 0 });
  gear('marksman_charm', 'Marksman’s Charm', 'acc', 30, { dex: 2, luk: 2, crit: 3 }, 'brooch', '#ffd84a', 18000, 'A lucky arrowhead on a string.');
  // Melee
  weapon('fang_dagger', 'Fang Dagger', 'dagger', 2, 25, ['thief', 'assassin', 'rogue', 'swordsman', 'knight', 'crusader', 'merchant', 'blacksmith', 'alchemist'], { atk: 70, agi: 2, crit: 3 }, 'dagger', '#efe6d2', 12000, 'A curved fang set in a bone handle.');
  weapon('duelist_saber', 'Duelist Saber', 'sword', 3, 40, SWORDS, { atk: 150, agi: 2, crit: 4 }, 'sword', '#cfd8e6', 34000, 'Balanced for the quickest hands.');
  weapon('wyrm_spear', 'Wyrm Spear', 'spear', 3, 45, ['knight', 'crusader'], { atk: 185, str: 3 }, 'spear', '#5a8a3a', 38000, 'Its tip was carved from a dragon’s tooth.');
  weapon('shadowfang', 'Shadowfang', 'katar', 3, 45, ['assassin'], { atk: 165, crit: 8, luk: 2 }, 'katar', '#3a2a4a', 38000, 'Twin blades that find the gaps in armour.');
  weapon('ironfist', 'Ironfist', 'knuckle', 3, 40, ['monk'], { atk: 135, str: 2, agi: 2 }, 'knuckle', '#9aa3ad', 32000, 'Iron knuckles for iron fists.');
  weapon('warbreaker', 'Warbreaker', 'axe', 3, 40, ['merchant', 'blacksmith', 'alchemist'], { atk: 175, str: 3 }, 'axe', '#8a5a2c', 36000, 'An axe heavy enough to end arguments.');
  gear('gladiator_harness', 'Gladiator Harness', 'armor', 35, { def: 6, str: 2, agi: 1 }, 'shirt', '#a8743c', 22000, 'Straps and plates for the arena.');
  gear('duelist_cape', 'Duelist Cape', 'garment', 30, { def: 2, flee: 5, luk: 1 }, 'cape', '#c0394a', 15000, 'Swirl it to distract your foe.');
  gear('fleetfoot_greaves', 'Fleetfoot Greaves', 'shoes', 30, { def: 3, agi: 2 }, 'boots', '#9aa3ad', 15000, 'Plated, yet light as a feather.');
  gear('berserker_band', 'Berserker Band', 'headTop', 30, { str: 2, atk: 10 }, 'ribbon', '#c0394a', 16000, 'Tie it on and charge.', { look: 'headband', slots: 0 });
  gear('fang_necklace', 'Fang Necklace', 'acc', 35, { str: 2, luk: 1, crit: 3 }, 'brooch', '#efe6d2', 20000, 'Trophies of past hunts.');
  // Tank
  weapon('warden_mace', 'Warden Mace', 'mace', 3, 40, ['crusader', 'merchant', 'blacksmith', 'alchemist', 'acolyte', 'priest', 'monk'], { atk: 140, vit: 2, def: 3 }, 'club', '#7a838d', 32000, 'A mace for those who hold the line.');
  gear('bulwark_shield', 'Bulwark Shield', 'shield', 35, { def: 8, vit: 2, maxHpPct: 5 }, 'shield', '#7a838d', 26000, 'Nothing gets past it.');
  gear('fortress_plate', 'Fortress Plate', 'armor', 40, { def: 10, vit: 3, maxHpPct: 8 }, 'shirt', '#9aa3ad', 32000, 'Plate armour as thick as a castle wall.');
  gear('bastion_mantle', 'Bastion Mantle', 'garment', 35, { def: 4, mdef: 3, vit: 1 }, 'cape', '#5a6070', 18000, 'A heavy cloak lined with chain.');
  gear('ironclad_boots', 'Ironclad Boots', 'shoes', 30, { def: 5, maxHp: 300 }, 'boots', '#7a838d', 16000, 'Boots that do not budge.');
  gear('guardian_helm', 'Guardian Helm', 'headTop', 35, { def: 5, vit: 2, str: 1 }, 'crown', '#9aa3ad', 20000, 'An iron helm with a red plume.', { look: 'warhelm', slots: 0 });
  gear('stoneheart_amulet', 'Stoneheart Amulet', 'acc', 35, { vit: 3, maxHp: 200 }, 'brooch', '#8a6a3a', 20000, 'A heart of stone keeps you standing.');
  Object.assign(G.Items.STAT_NAMES, { healPct: 'Heal power %', castReduce: 'Cast time −%', spRegenPct: 'SP recovery %', hpRegenPct: 'HP recovery %', moveSpeed: 'Move speed %', atkPct: 'ATK %' });

  // Bards and Dancers can wield their instruments and whips.
  if (G.Jobs) for (const [job, wt] of [['bard', 'instrument'], ['dancer', 'whip']]) { const j = G.Jobs.get(job); if (j && !j.weapons.includes(wt)) j.weapons.push(wt); }

  // The new monsters (stats after the classic pre-renewal ones, tuned to Willowmere).
  mon('geographer', { name: 'Geographer', level: 56, hp: 8071, atk: [467, 621], def: 28, mdef: 26, element: 'earth', hit: 120, flee: 60,
    aggressive: true, aggroRange: 3.2, attackRange: 3, attackInterval: 1.31, impactTime: 0.45, speed: 0, chaseSpeed: 0, loseRange: 12,
    healFriends: { every: 5, range: 9, amount: 1100 },   // Heal on a hurt neighbour, like the classic Geographer
    scale: 1.3, hitRadius: 1, height: 3, radius: 0.7, deathColor: [1, 0.85, 0.3],
    drops: [{ id: 'card_geographer', chance: 0.002 }, { id: 'maneater_blossom', chance: 0.62 }, { id: 'maneater_root', chance: 0.55 }, { id: 'heal_scroll', chance: 0.01 },
      { id: 'arcanist_staff', chance: 0.004 }, { id: 'tome_of_embers', chance: 0.003 }, { id: 'lightbringer_rod', chance: 0.004 }, { id: 'holy_codex', chance: 0.003 },
      { id: 'halo_circlet', chance: 0.005 }, { id: 'mana_circlet', chance: 0.005 }, { id: 'arcanist_robe', chance: 0.004 }, { id: 'prayer_shawl', chance: 0.004 }, { id: 'focus_ring', chance: 0.003 }] });
  mon('giearth', { name: 'Giearth', level: 29, hp: 2252, atk: [154, 185], def: 10, mdef: 50, element: 'earth', aggressive: false, attackInterval: 1.85, speed: 1.6, chaseSpeed: 2.8,
    scale: 0.85, height: 1.6, sprite: { humanoid: { costume: 'giearth', weapon: 'none', skin: '#e8c49a', hair: 'snow', style: 'buzz' } },
    drops: [{ id: 'card_giearth', chance: 0.002 }, { id: 'elder_pixie_moustache', chance: 0.55 }, { id: 'coal', chance: 0.015 }, { id: 'star_dust', chance: 0.01 }, { id: 'great_nature', chance: 0.003 },
      { id: 'pilgrim_sandals', chance: 0.008 }, { id: 'apprentice_staff', chance: 0.006 }, { id: 'starweave_mantle', chance: 0.006 }, { id: 'arcanist_slippers', chance: 0.006 },
      { id: 'rosary', chance: 0.005 }, { id: 'eagle_goggles', chance: 0.005 }] });
  mon('metaling', { name: 'Metaling', level: 26, hp: 889, atk: [135, 270], def: 5, mdef: 3, element: 'neutral', aggressive: false, attackInterval: 0.67, speed: 1.6, chaseSpeed: 3,
    scale: 1.2, height: 1.15, hitRadius: 0.8, radius: 0.55, sprite: { base: 'poring', hue: 0, sat: 0.03, light: 0.88 }, deathColor: [0.75, 0.78, 0.85],
    drops: [{ id: 'card_metaling', chance: 0.002 }, { id: 'jubilee', chance: 0.5 }, { id: 'flexible_tube', chance: 0.4 }, { id: 'iron_ore', chance: 0.1 }, { id: 'large_jellopy', chance: 0.1 },
      { id: 'iron', chance: 0.05 }, { id: 'rusty_screw', chance: 0.02 }, { id: 'ironclad_boots', chance: 0.008 }, { id: 'warden_mace', chance: 0.004 }, { id: 'stoneheart_amulet', chance: 0.004 },
      { id: 'fang_dagger', chance: 0.006 }, { id: 'hawkeye_bow', chance: 0.005 }, { id: 'swift_boots', chance: 0.006 }] });
  // The rest of the new gear drops from monsters around its level.
  const more = {
    orc_zombie: [['gladiator_harness', 0.005], ['duelist_cape', 0.005]], orc_skeleton: [['bulwark_shield', 0.004], ['guardian_helm', 0.004]],
    zenorc: [['berserker_band', 0.005], ['ironfist', 0.004], ['fleetfoot_greaves', 0.005]], drainliar: [['windrunner_cloak', 0.005], ['marksman_charm', 0.004]],
    whisper: [['ranger_jerkin', 0.005], ['silkwind_whip', 0.004]], wind_ghost: [['gale_longbow', 0.004], ['whispering_lyre', 0.004]],
    raydric: [['fortress_plate', 0.004], ['bastion_mantle', 0.005]], wraith: [['vestments_of_grace', 0.004]], evil_druid: [['mace_of_mercy', 0.004]],
    khalitzburg: [['duelist_saber', 0.004], ['wyrm_spear', 0.004]], abysmal_knight: [['shadowfang', 0.004], ['warbreaker', 0.004], ['fang_necklace', 0.005]],
  };
  for (const m in more) if (C.MONSTERS[m]) for (const [id, chance] of more[m]) C.MONSTERS[m].drops.push({ id, chance });

  /* ---------------- maps: Orc Dungeon, Ember Ruins ---------------- */
  if (G.Maps) {
    G.Maps.orc_dungeon = {
      id: 'orc_dungeon', name: 'Orc Dungeon', cave: true, town: false, stream: false, bridge: false,
      paths: [
        [[0, -96], [0, -72], [-30, -55], [-60, -40], [-70, -10], [-50, 15], [-20, 20], [10, 15], [40, 0], [65, -20], [80, -52]],
        [[-20, 20], [-25, 50], [0, 75], [30, 86]],
        [[40, 0], [55, 35], [75, 62]],
      ],
      corridor: 5.2,
      rooms: [
        { x: 0, z: -88, r: 12 }, { x: -60, z: -40, r: 16 }, { x: -70, z: -8, r: 12 }, { x: 10, z: 15, r: 18 }, { x: 65, z: -20, r: 14 },
        { x: 80, z: -54, r: 12 }, { x: -25, z: 50, r: 14 }, { x: 55, z: 35, r: 14 }, { x: 75, z: 62, r: 13 }, { x: 30, z: 86, r: 18 },
      ],
      pond: null, hills: 0, seed: 1717, forest: { count: 0, grove: 1, clearing: 1 },
      palette: { floor: '#7a6a52', floorDark: '#5e5040', wall: '#4a3a2c', moss: '#6a7a3a' },
      atmosphere: { fog: '#1c150f', near: 22, far: 110, hemi: 0.45, sun: 0.42, sky: ['#070504', '#120c08', '#1c150f'], ground: '#2a2018' },
      spawns: [
        { type: 'familiar', x: -30, z: -55, r: 8, count: 4 }, { type: 'orc_zombie', x: -60, z: -40, r: 12, count: 6 }, { type: 'drainliar', x: -70, z: -8, r: 9, count: 4 },
        { type: 'orc_zombie', x: 10, z: 15, r: 14, count: 5 }, { type: 'orc_skeleton', x: 10, z: 15, r: 14, count: 4 }, { type: 'orc_skeleton', x: 65, z: -20, r: 10, count: 5 },
        { type: 'zenorc', x: -25, z: 50, r: 10, count: 5 }, { type: 'zenorc', x: 55, z: 35, r: 10, count: 4 }, { type: 'drainliar', x: 75, z: 62, r: 9, count: 4 },
        { type: 'orc_skeleton', x: 0, z: 75, r: 6, count: 3 }, { type: 'orc_lord', x: 30, z: 88, r: 6, count: 1 },
      ],
      npcs: [],
      portals: [
        { x: 0, z: -100, to: 'forest', tx: -78, tz: -40, label: 'Whisperwood Glade' },
        { x: 80, z: -60, to: 'ember_ruins', tx: 0, tz: -86, label: 'Ember Ruins' },
      ],
    };
    G.Maps.ember_ruins = {
      id: 'ember_ruins', name: 'Ember Ruins', cave: true, town: false, stream: false, bridge: false,
      paths: [
        [[0, -96], [0, -60], [-40, -45], [-70, -15], [-60, 25], [-25, 45], [10, 30], [45, 15], [70, -10], [60, -50]],
        [[10, 30], [5, 65], [0, 88]],
      ],
      corridor: 5,
      rooms: [
        { x: 0, z: -88, r: 12 }, { x: -40, z: -45, r: 14 }, { x: -70, z: -15, r: 13 }, { x: -60, z: 25, r: 14 }, { x: -25, z: 45, r: 13 },
        { x: 10, z: 30, r: 16 }, { x: 45, z: 15, r: 14 }, { x: 70, z: -10, r: 13 }, { x: 60, z: -50, r: 15 }, { x: 0, z: 88, r: 15 },
      ],
      pond: null, hills: 0, seed: 4242, forest: { count: 0, grove: 1, clearing: 1 },
      palette: { floor: '#5a5262', floorDark: '#433c4c', wall: '#2e2836', moss: '#6a3a4a' },
      atmosphere: { fog: '#140d16', near: 20, far: 100, hemi: 0.4, sun: 0.36, sky: ['#05030a', '#0d0812', '#140d16'], ground: '#201822' },
      spawns: [
        { type: 'wind_ghost', x: -40, z: -45, r: 10, count: 5 }, { type: 'raydric', x: -70, z: -15, r: 9, count: 5 }, { type: 'wraith', x: -60, z: 25, r: 10, count: 5 },
        { type: 'evil_druid', x: -25, z: 45, r: 9, count: 4 }, { type: 'khalitzburg', x: 10, z: 30, r: 12, count: 5 }, { type: 'abysmal_knight', x: 45, z: 15, r: 10, count: 4 },
        { type: 'bloody_knight', x: 70, z: -10, r: 9, count: 3 }, { type: 'dark_lord', x: 60, z: -50, r: 6, count: 1 }, { type: 'raydric', x: 5, z: 65, r: 4, count: 2 },
        { type: 'lord_of_death', x: 0, z: 90, r: 5, count: 1 },
      ],
      npcs: [],
      portals: [{ x: 0, z: -100, to: 'orc_dungeon', tx: 78, tz: -50, label: 'Orc Dungeon' }],
    };
    // Sunpetal Plains, east of Willowmere Meadows: Giearths and Metalings near the way in, and
    // Geographers (rooted man-eating sunflowers, level 56) scattered over the hills: a classic
    // spot for mages, who can bolt them from beyond their short reach.
    G.Maps.sunpetal = {
      id: 'sunpetal', name: 'Sunpetal Plains', town: false, stream: false, bridge: false,
      paths: [
        [[-110, 0], [-84, 2], [-60, -6], [-36, -2], [-12, 8], [12, 4], [36, -10], [60, -4], [84, 10], [100, 14]],
        [[-36, -2], [-30, -30], [-20, -60], [-8, -86]],
        [[12, 4], [20, 32], [14, 60], [24, 88]],
      ],
      pond: { x: 62, z: -62, r: 7 },
      hills: 9, seed: 3131,
      forest: { count: 150, grove: 0.5, clearing: 0.6 },
      palette: {
        grassA: '#a9c25a', grassB: '#c2cf68', grassDark: '#7f9a3e', meadow: '#e0c95e',
        town: '#a9c25a', dirt: '#b08a58', dirtDark: '#8a6a40', cliff: '#9a9a6a', cliffHi: '#7f9a4a',
      },
      fog: '#f4ecd2',
      spawns: [
        { type: 'giearth', x: -76, z: -28, r: 10, count: 5 }, { type: 'giearth', x: -84, z: 32, r: 10, count: 4 },
        { type: 'metaling', x: -48, z: 26, r: 10, count: 5 }, { type: 'metaling', x: -52, z: -32, r: 9, count: 4 },
        { type: 'metaling', x: 30, z: -28, r: 8, count: 4 }, { type: 'giearth', x: 0, z: 26, r: 8, count: 4 },
        { type: 'geographer', x: 2, z: -42, r: 7, count: 3 }, { type: 'geographer', x: -70, z: 70, r: 8, count: 4 },
        { type: 'geographer', x: -38, z: 48, r: 8, count: 4 }, { type: 'geographer', x: 52, z: 34, r: 8, count: 4 },
        { type: 'geographer', x: 70, z: 70, r: 8, count: 4 }, { type: 'geographer', x: 42, z: -46, r: 7, count: 3 },
        { type: 'geographer', x: 82, z: -28, r: 8, count: 4 }, { type: 'geographer', x: -6, z: 76, r: 7, count: 3 },
        { type: 'geographer', x: 92, z: 48, r: 7, count: 3 }, { type: 'geographer', x: -84, z: -72, r: 8, count: 4 },
        { type: 'geographer', x: 26, z: -82, r: 8, count: 3 }, { type: 'geographer', x: -52, z: -80, r: 7, count: 3 },
      ],
      npcs: [],
      portals: [{ x: -104, z: 0, to: 'meadow', tx: 94, tz: 40, label: 'Willowmere Meadows' }],
    };
    if (G.Maps.meadow) G.Maps.meadow.portals.push({ x: 99, z: 40, to: 'sunpetal', tx: -97, tz: 0, label: 'Sunpetal Plains (Lv 26–56)' });
    // The way in: a second cave mouth in the west of Whisperwood Glade.
    if (G.Maps.forest) G.Maps.forest.portals.push({ x: -84, z: -42, to: 'orc_dungeon', tx: 0, tz: -86, label: 'Orc Dungeon' });
    // Map bosses for the outdoor maps.
    if (G.Maps.meadow) G.Maps.meadow.spawns.push({ type: 'eclipse', x: 30, z: 40, r: 6, count: 1 }, { type: 'marin', x: -30, z: 60, r: 10, count: 3 });
    if (G.Maps.forest) G.Maps.forest.spawns.push({ type: 'vocal', x: 50, z: 30, r: 8, count: 1 });
    if (G.Maps.dungeon) G.Maps.dungeon.spawns.push({ type: 'poison_spore', x: -62, z: 48, r: 8, count: 3 });
  }
})(window.G = window.G || {});
