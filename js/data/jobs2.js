/* Second jobs. Each advances from a first job at job level 40 through a
   trial set by Master Rowan, and adds its own skill tree (data/skills2.js). */
(function (G) {
  'use strict';
  const exp2 = [0];
  for (let l = 1; l < 50; l++) exp2[l] = Math.round(60 + 40 * l + 5.5 * l * l);
  const J = (o) => G.Jobs.register(Object.assign({ tier: 2, maxJobLevel: 50, jobExp: exp2 }, o));

  J({ id: 'knight', name: 'Knight', from: 'swordsman', hpMult: 2.0, spMult: 0.9, color: '#3a5aa8',
    weapons: ['none', 'dagger', 'sword', 'spear'], gift: 'pike',
    blurb: 'A mounted lancer of legend: huge HP, spear sweeps and crushing combos.',
    strengths: 'Highest HP, strong area attacks with spears.', weaknesses: 'Little magic defence, low SP.',
    trial: { kind: 'kill', target: 'rocker', count: 10, text: 'Defeat 10 Rockers in Whisperwood Glade to prove your strength.' } });
  J({ id: 'crusader', name: 'Crusader', from: 'swordsman', hpMult: 1.9, spMult: 1.1, color: '#e8e2d8',
    weapons: ['none', 'dagger', 'sword', 'spear', 'mace'], gift: 'pike',
    blurb: 'A holy warrior who mixes steel with light and guards with a shield.',
    strengths: 'Holy attacks, blocking, sturdy.', weaknesses: 'Slower damage than a Knight.',
    trial: { kind: 'kill', target: 'whisper', count: 6, text: 'Purge 6 Whispers from the depths of Mossy Hollow.' } });
  J({ id: 'wizard', name: 'Wizard', from: 'mage', hpMult: 0.85, spMult: 2.1, color: '#4b2f8f',
    weapons: ['none', 'dagger', 'rod'], gift: 'wand',
    blurb: 'Master of devastating area magic: storms, meteors and lightning.',
    strengths: 'Enormous area damage.', weaknesses: 'Very fragile, long casts.',
    trial: { kind: 'items', items: [['spore_cap', 5], ['ectoplasm', 5]], text: 'Bring 5 Spore Caps and 5 Ectoplasm from Mossy Hollow.' } });
  J({ id: 'sage', name: 'Sage', from: 'mage', hpMult: 1.05, spMult: 1.9, color: '#3f8a6a',
    weapons: ['none', 'dagger', 'rod', 'book'], gift: 'bible',
    blurb: 'A scholar of the elements who imbues weapons and calls earth to battle.',
    strengths: 'Earth magic, elemental weapon buffs, sturdier than a Wizard.', weaknesses: 'Less raw area damage.',
    trial: { kind: 'items', items: [['chrysalis', 10]], text: 'Bring 10 Chrysalis husks from Whisperwood for study.' } });
  J({ id: 'hunter', name: 'Hunter', from: 'archer', hpMult: 1.25, spMult: 1.15, color: '#3f7a3a',
    weapons: ['none', 'dagger', 'bow'], gift: 'composite_bow',
    blurb: 'A tracker with a falcon companion, traps and deadly aimed shots.',
    strengths: 'Falcon strikes that never miss, snares, huge single shots.', weaknesses: 'Needs room to fight.',
    trial: { kind: 'kill', target: 'familiar', count: 10, text: 'Hunt 10 Familiars in Mossy Hollow.' } });
  J({ id: 'bard', name: 'Bard', from: 'archer', hpMult: 1.25, spMult: 1.3, color: '#c0394a',
    weapons: ['none', 'dagger', 'bow'], gift: 'composite_bow',
    blurb: 'A travelling musician whose songs speed spells and blades alike.',
    strengths: 'Powerful self-buffs, ranged attacks.', weaknesses: 'Less damage on its own.',
    trial: { kind: 'pay', zeny: 1500, items: [['grasshopper_leg', 5]], text: 'Pay the 1,500 Zeny music-hall fee and bring 5 Grasshopper’s Legs (for the drum).' } });
  J({ id: 'dancer', name: 'Dancer', from: 'archer', hpMult: 1.25, spMult: 1.3, color: '#e86aa0',
    weapons: ['none', 'dagger', 'bow'], gift: 'composite_bow',
    blurb: 'A graceful performer who dazzles friends and slows foes.',
    strengths: 'SP and accuracy buffs, crowd slowing.', weaknesses: 'Less damage on its own.',
    trial: { kind: 'items', items: [['bat_wing', 8]], text: 'Bring 8 Familiar Wings to stitch a stage costume.' } });
  J({ id: 'priest', name: 'Priest', from: 'acolyte', hpMult: 1.25, spMult: 1.9, color: '#f2f0f7',
    weapons: ['none', 'mace', 'rod', 'book'], gift: 'bible',
    blurb: 'The great healer: sanctuaries, protective blessings and holy light.',
    strengths: 'Healing over time, shields, holy area damage.', weaknesses: 'Modest physical damage.',
    trial: { kind: 'pray', npc: 'pond_priestess', map: 'meadow', place: 'the meadow pond', text: 'Pray once more with Sister Lune at the meadow pond.' } });
  J({ id: 'monk', name: 'Monk', from: 'acolyte', hpMult: 1.6, spMult: 1.3, color: '#c9783a',
    weapons: ['none', 'mace', 'rod', 'knuckle'], gift: 'waghnak',
    blurb: 'A martial artist whose fists land in flurries, ending in the fearsome Asura Strike.',
    strengths: 'Fast combos, armour-piercing blows, one huge finisher.', weaknesses: 'Asura Strike drains all SP.',
    trial: { kind: 'kill', target: 'spore', count: 15, text: 'Defeat 15 Spores in Mossy Hollow, with discipline.' } });
  J({ id: 'assassin', name: 'Assassin', from: 'thief', hpMult: 1.5, spMult: 1.0, color: '#3a2a4a',
    weapons: ['none', 'dagger', 'sword', 'katar'], gift: 'katar',
    blurb: 'A silent killer with twin-bladed katars and poisoned strikes.',
    strengths: 'Katars double your crit, Sonic Blow shreds single targets.', weaknesses: 'Weak against crowds.',
    trial: { kind: 'kill', target: 'whisper', count: 8, text: 'Silence 8 Whispers in Mossy Hollow.' } });
  J({ id: 'rogue', name: 'Rogue', from: 'thief', hpMult: 1.45, spMult: 1.05, color: '#3a5a3a',
    weapons: ['none', 'dagger', 'sword', 'bow'], gift: 'cutter',
    blurb: 'A cunning trickster who stabs from behind, strips weapons and pockets everything.',
    strengths: 'Unblockable backstabs, auto-stealing, disarming foes.', weaknesses: 'Average defence.',
    trial: { kind: 'pay', zeny: 1000, items: [['sticky_mucus', 5]], text: 'Pay 1,000 Zeny of “dues” and bring 5 Sticky Mucus.' } });
  J({ id: 'blacksmith', name: 'Blacksmith', from: 'merchant', hpMult: 1.6, spMult: 1.1, color: '#7a4a2a',
    weapons: ['none', 'dagger', 'sword', 'mace', 'axe'], gift: 'axe',
    blurb: 'A forge-master who swings axes faster and harder than anyone.',
    strengths: 'Attack speed and power buffs, stunning hammers.', weaknesses: 'Few ranged options.',
    trial: { kind: 'pay', zeny: 3000, items: [['grasshopper_leg', 10]], text: 'Pay the 3,000 Zeny guild fee and bring 10 Grasshopper’s Legs for the bellows.' } });
  J({ id: 'alchemist', name: 'Alchemist', from: 'merchant', hpMult: 1.4, spMult: 1.3, color: '#2f7a8a',
    weapons: ['none', 'dagger', 'sword', 'mace', 'axe'], gift: 'axe',
    blurb: 'A brewer of acids and fire bombs who can also throw healing potions.',
    strengths: 'Armour-piercing acid, burning ground, healing.', weaknesses: 'Skills cost potions and patience.',
    trial: { kind: 'items', items: [['spore_cap', 8], ['green_herb', 5]], text: 'Bring 8 Spore Caps and 5 Green Herbs for the laboratory.' } });

  // Can this job use gear made for 'jobs'? Second jobs inherit their first job's gear.
  G.Jobs.canUse = (jobs, jobId) => {
    if (jobs === 'all') return true;
    for (let j = jobId; j && j !== 'novice'; j = G.Jobs.get(j).from) if (jobs.includes(j)) return true;
    return jobId === 'novice' && jobs.includes('novice');
  };

  // First jobs can now carry the new weapon types where the classics allow it.
  G.Jobs.get('merchant').weapons.push('axe');
})(window.G = window.G || {});
