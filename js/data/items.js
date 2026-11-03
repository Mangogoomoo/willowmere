/* Item database. Every item the game knows about is defined here as data;
   systems (inventory, equipment, loot, shops later) only read from it.

   type:   'use' (consumable) | 'etc' (loot/material) | 'equip' | 'card'
   slot:   equipment slot for 'equip' items (see EQUIP_SLOTS)
   bonus:  flat bonuses applied while equipped (atk, matk, def, mdef, str,
           agi, vit, int, dex, luk, maxHp, maxSp, hit, flee, crit, aspd%)
   jobs:   'all' or a list of job ids allowed to equip it
   slots:  card slots (used from Stage 4)
   icon:   procedural icon recipe (see graphics/icons.js)              */
(function (G) {
  'use strict';

  const EQUIP_SLOTS = [
    { id: 'headTop', name: 'Upper headgear' },
    { id: 'headMid', name: 'Middle headgear' },
    { id: 'headLow', name: 'Lower headgear' },
    { id: 'weapon', name: 'Weapon' },
    { id: 'shield', name: 'Shield' },
    { id: 'armor', name: 'Armor' },
    { id: 'garment', name: 'Garment' },
    { id: 'shoes', name: 'Shoes' },
    { id: 'acc1', name: 'Accessory' },
    { id: 'acc2', name: 'Accessory' },
  ];

  const RARITY = {
    common: { name: 'Common', color: '#f4f4f4' },
    uncommon: { name: 'Uncommon', color: '#7fe08a' },
    rare: { name: 'Rare', color: '#6fb6ff' },
    epic: { name: 'Epic', color: '#c79bff' },
  };

  const WEAPON_TYPES = {
    none: { name: 'Bare hands', delay: 0.72, range: 1.55 },
    dagger: { name: 'Dagger', delay: 0.78, range: 1.55 },
    sword: { name: 'One-handed sword', delay: 0.9, range: 1.65 },
    mace: { name: 'Mace', delay: 0.95, range: 1.6 },
    rod: { name: 'Rod', delay: 1.0, range: 1.6 },
    bow: { name: 'Bow', delay: 0.95, range: 9.0, twoHanded: true },
  };

  const I = {};
  const def = (id, o) => { I[id] = Object.assign({ id, rarity: 'common', weight: 1, price: 10, stack: o.type !== 'equip' }, o); };

  /* ---------- consumables ---------- */
  def('novice_potion', { name: 'Novice Potion', type: 'use', icon: { shape: 'potion', color: '#ff8fb0' }, weight: 0, price: 0,
    use: { heal: 30 }, desc: 'A small sweet tonic handed to every new adventurer. Restores 30 HP.' });
  def('red_potion', { name: 'Red Potion', type: 'use', icon: { shape: 'potion', color: '#e8364a' }, weight: 7, price: 50,
    use: { heal: 45 }, desc: 'Brewed from red herbs. Restores 45 HP.' });
  def('orange_potion', { name: 'Orange Potion', type: 'use', icon: { shape: 'potion', color: '#f39233' }, weight: 10, price: 200,
    use: { heal: 105 }, desc: 'A stronger brew of red and yellow herbs. Restores 105 HP.' });
  def('blue_potion', { name: 'Blue Potion', type: 'use', icon: { shape: 'potion', color: '#4a7ef0' }, weight: 15, price: 600, rarity: 'uncommon',
    use: { sp: 60 }, desc: 'Clears the mind. Restores 60 SP.' });
  def('apple', { name: 'Apple', type: 'use', icon: { shape: 'apple' }, weight: 2, price: 15,
    use: { heal: 16 }, desc: 'Crisp and juicy. Restores 16 HP.' });
  def('carrot', { name: 'Carrot', type: 'use', icon: { shape: 'carrot' }, weight: 2, price: 15,
    use: { heal: 18 }, desc: 'Fresh from a meadow burrow. Restores 18 HP.' });
  def('butterfly_wing', { name: 'Butterfly Wing', type: 'use', icon: { shape: 'wing', color: '#7fc8ff' }, weight: 5, price: 300,
    use: { recall: true }, desc: 'Crush it to be carried home to your save point in Willowmere.' });
  def('fly_wing', { name: 'Fly Wing', type: 'use', icon: { shape: 'wing', color: '#e9e2c8' }, weight: 5, price: 60,
    use: { teleport: true }, desc: 'Carries you to a random spot in the meadows.' });

  def('green_herb', { name: 'Green Herb', type: 'use', icon: { shape: 'herb', color: '#5fbf4a' }, weight: 3, price: 20,
    use: { heal: 25 }, desc: 'A bitter forest herb. Restores 25 HP.' });

  /* ---------- loot ---------- */
  def('chrysalis', { name: 'Chrysalis', type: 'etc', icon: { shape: 'cocoon' }, weight: 2, price: 30,
    desc: 'The empty husk of a Pupa. Tough and papery.' });
  def('grasshopper_leg', { name: 'Grasshopper’s Leg', type: 'etc', icon: { shape: 'leg' }, weight: 2, price: 46,
    desc: 'A springy hind leg. Still twitches now and then.' });
  def('jellopy', { name: 'Jellopy', type: 'etc', icon: { shape: 'jellopy' }, weight: 1, price: 6,
    desc: 'A small crystallised blob left behind by jelly creatures.' });
  def('sticky_mucus', { name: 'Sticky Mucus', type: 'etc', icon: { shape: 'mucus' }, weight: 1, price: 14,
    desc: 'Gooey and faintly sweet. Alchemists find it useful.' });
  def('empty_bottle', { name: 'Empty Bottle', type: 'etc', icon: { shape: 'bottle' }, weight: 2, price: 6,
    desc: 'A clean glass bottle, ready for a potion.' });
  def('clover', { name: 'Clover', type: 'etc', icon: { shape: 'clover' }, weight: 0, price: 8,
    desc: 'Three leaves. Lunatics carry them around for luck.' });
  def('fluff', { name: 'Fluff', type: 'etc', icon: { shape: 'fluff' }, weight: 1, price: 10,
    desc: 'Soft white fur shed by a moon-bunny.' });
  def('lucky_clover', { name: 'Four-Leaf Clover', type: 'etc', icon: { shape: 'clover', color: '#3fbf5a', four: true }, weight: 0, price: 500, rarity: 'rare',
    desc: 'Extremely rare. Collectors in town pay well for these.' });

  /* ---------- weapons ---------- */
  def('knife', { name: 'Knife', type: 'equip', slot: 'weapon', weaponType: 'dagger', icon: { shape: 'dagger', color: '#d7dee8' },
    weight: 40, price: 50, slots: 3, reqLevel: 1, jobs: 'all', bonus: { atk: 17 }, desc: 'A plain kitchen-style knife. Better than nothing.' });
  def('cutter', { name: 'Cutter', type: 'equip', slot: 'weapon', weaponType: 'dagger', icon: { shape: 'dagger', color: '#f1e6b8' },
    weight: 60, price: 1250, slots: 3, reqLevel: 1, jobs: 'all', bonus: { atk: 30 }, rarity: 'uncommon', desc: 'A sharp, well-balanced dagger.' });
  def('sword', { name: 'Sword', type: 'equip', slot: 'weapon', weaponType: 'sword', icon: { shape: 'sword', color: '#cfd8e6' },
    weight: 50, price: 100, slots: 3, reqLevel: 2, jobs: ['novice', 'swordsman', 'merchant', 'thief'], bonus: { atk: 25 }, desc: 'A simple straight blade.' });
  def('club', { name: 'Club', type: 'equip', slot: 'weapon', weaponType: 'mace', icon: { shape: 'club', color: '#9c6a3c' },
    weight: 70, price: 60, slots: 3, reqLevel: 2, jobs: ['novice', 'swordsman', 'merchant', 'acolyte'], bonus: { atk: 23 }, desc: 'A heavy wooden club.' });
  def('rod', { name: 'Rod', type: 'equip', slot: 'weapon', weaponType: 'rod', icon: { shape: 'rod', color: '#8e5bd6' },
    weight: 40, price: 50, slots: 3, reqLevel: 1, jobs: ['novice', 'mage', 'acolyte'], bonus: { atk: 15, matk: 15, int: 1 }, desc: 'A wooden staff that hums with faint magic.' });

  def('bow', { name: 'Bow', type: 'equip', slot: 'weapon', weaponType: 'bow', icon: { shape: 'bow' },
    weight: 50, price: 400, slots: 3, reqLevel: 1, jobs: ['archer'], bonus: { atk: 15 }, desc: 'A simple hunting bow. Uses DEX for damage. Needs both hands.' });
  def('composite_bow', { name: 'Composite Bow', type: 'equip', slot: 'weapon', weaponType: 'bow', icon: { shape: 'bow' },
    weight: 60, price: 2500, slots: 2, reqLevel: 4, jobs: ['archer'], bonus: { atk: 29 }, rarity: 'uncommon', desc: 'Layered wood and horn. Draws hard, flies far.' });
  def('wand', { name: 'Wand', type: 'equip', slot: 'weapon', weaponType: 'rod', icon: { shape: 'rod', color: '#3fa3e0' },
    weight: 40, price: 2200, slots: 2, reqLevel: 5, jobs: ['mage', 'acolyte'], bonus: { atk: 25, matk: 25, int: 2 }, rarity: 'uncommon', desc: 'A slim wand tipped with blue crystal.' });

  /* ---------- armour ---------- */
  def('cotton_shirt', { name: 'Cotton Shirt', type: 'equip', slot: 'armor', icon: { shape: 'shirt', color: '#f3ead7' },
    weight: 10, price: 10, slots: 1, reqLevel: 1, jobs: 'all', bonus: { def: 1 }, desc: 'Comfortable, if not very protective.' });
  def('adventurer_suit', { name: "Adventurer’s Suit", type: 'equip', slot: 'armor', icon: { shape: 'shirt', color: '#5f9ad8' },
    weight: 20, price: 400, slots: 1, reqLevel: 1, jobs: 'all', bonus: { def: 3 }, rarity: 'uncommon', desc: 'Sturdy travel clothes with many pockets.' });
  def('silk_robe', { name: 'Silk Robe', type: 'equip', slot: 'armor', icon: { shape: 'shirt', color: '#f4efe2' },
    weight: 40, price: 3000, slots: 1, reqLevel: 5, jobs: 'all', bonus: { def: 3, mdef: 8, maxSp: 15 }, rarity: 'rare', desc: 'Woven from Pupa silk. Light, cool and faintly magical.' });
  def('sandals', { name: 'Sandals', type: 'equip', slot: 'shoes', icon: { shape: 'boots', color: '#b9824a' },
    weight: 20, price: 400, slots: 1, reqLevel: 1, jobs: 'all', bonus: { def: 1 }, desc: 'Light leather sandals.' });
  def('hood', { name: 'Hood', type: 'equip', slot: 'garment', icon: { shape: 'cape', color: '#7e9b5a' },
    weight: 20, price: 1000, slots: 1, reqLevel: 1, jobs: 'all', bonus: { def: 1, flee: 2 }, desc: 'A hooded cloak that keeps the rain off.' });
  def('guard', { name: 'Guard', type: 'equip', slot: 'shield', icon: { shape: 'shield', color: '#b5875a' },
    weight: 30, price: 500, slots: 1, reqLevel: 1, jobs: 'all', bonus: { def: 2 }, desc: 'A small round buckler.' });

  /* ---------- headgear and accessories ---------- */
  def('ribbon', { name: 'Ribbon', type: 'equip', slot: 'headTop', icon: { shape: 'ribbon', color: '#ff6b8b' },
    weight: 10, price: 800, slots: 0, reqLevel: 1, jobs: 'all', bonus: { int: 1, mdef: 3 }, desc: 'A pretty bow for your hair.' });
  def('moonbunny_ears', { name: 'Moonbunny Ears', type: 'equip', slot: 'headTop', icon: { shape: 'ears', color: '#fbfbff' },
    weight: 10, price: 3000, slots: 0, reqLevel: 1, jobs: 'all', bonus: { agi: 1, luk: 2, flee: 3 }, rarity: 'rare',
    desc: 'Floppy ears said to carry the luck of the moon-bunnies.' });
  def('leaf_cap', { name: 'Leaf Cap', type: 'equip', slot: 'headTop', icon: { shape: 'leafcap' },
    weight: 10, price: 1200, slots: 0, reqLevel: 6, jobs: 'all', bonus: { def: 1, vit: 1, maxHp: 30 }, rarity: 'uncommon', desc: 'A cap stitched from broad forest leaves.' });
  def('round_glasses', { name: 'Round Glasses', type: 'equip', slot: 'headMid', icon: { shape: 'glasses' },
    weight: 10, price: 600, slots: 0, reqLevel: 1, jobs: 'all', bonus: { dex: 1, hit: 3 }, rarity: 'uncommon', desc: 'See every opening.' });
  def('clover_charm', { name: 'Clover Pipe', type: 'equip', slot: 'headLow', icon: { shape: 'pipe' },
    weight: 10, price: 600, slots: 0, reqLevel: 1, jobs: 'all', bonus: { luk: 1, crit: 2 }, rarity: 'uncommon', desc: 'A little pipe carved from clover stems.' });
  def('jelly_brooch', { name: 'Jelly Brooch', type: 'equip', slot: 'acc', icon: { shape: 'brooch', color: '#ff9cb8' },
    weight: 10, price: 1500, slots: 1, reqLevel: 1, jobs: 'all', bonus: { maxHp: 40, vit: 1 }, rarity: 'rare', desc: 'A brooch of hardened jelly. Springy and reassuring.' });
  def('wind_clip', { name: 'Wind Clip', type: 'equip', slot: 'acc', icon: { shape: 'brooch', color: '#8fe0d0' },
    weight: 10, price: 1500, slots: 1, reqLevel: 3, jobs: 'all', bonus: { agi: 1, maxSp: 10 }, rarity: 'rare', desc: 'A hair clip shaped like a gust of wind.' });

  G.Items = {
    DB: I, EQUIP_SLOTS, RARITY, WEAPON_TYPES,
    get(id) { return I[id] || null; },
    isEquip(id) { return !!I[id] && I[id].type === 'equip'; },
    STAT_NAMES: {
      atk: 'ATK', matk: 'MATK', def: 'DEF', mdef: 'MDEF', str: 'STR', agi: 'AGI', vit: 'VIT', int: 'INT', dex: 'DEX', luk: 'LUK',
      maxHp: 'Max HP', maxSp: 'Max SP', hit: 'HIT', flee: 'FLEE', crit: 'CRIT', aspd: 'ASPD',
    },
  };
})(window.G = window.G || {});
