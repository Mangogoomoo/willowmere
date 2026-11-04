/* Job definitions. Stage 2 uses the Novice; Stage 3 adds the six first jobs
   with their skill trees, and the second-job table is already here so the
   progression graph exists from the start.

   hpMult/spMult scale max HP/SP, weapons lists usable weapon types, and
   jobExp is the EXP needed to go from each job level to the next. */
(function (G) {
  'use strict';

  const novJobExp = [0, 8, 14, 20, 28, 45, 65, 85, 110, 135];
  const firstJobExp = [0];
  for (let l = 1; l < 50; l++) firstJobExp[l] = Math.round(30 + 22 * l + 3.2 * l * l);

  /* colour: class outfit colour. trial: the job-change task the Job Master
     sets (see systems/quests.js). gift: the weapon handed over on promotion. */
  const J = {
    novice: { id: 'novice', name: 'Novice', tier: 0, hpMult: 1.0, spMult: 1.0, maxJobLevel: 10, jobExp: novJobExp,
      weapons: ['none', 'dagger', 'sword', 'mace', 'rod'] },
    swordsman: { id: 'swordsman', name: 'Swordsman', tier: 1, hpMult: 1.45, spMult: 0.8, maxJobLevel: 50, jobExp: firstJobExp,
      weapons: ['none', 'dagger', 'sword'], color: '#5d84c4',
      blurb: 'A sturdy front-line fighter with the most HP of any first job. Hits hard, shrugs off blows.',
      strengths: 'High HP and defence, strong single-target and area attacks.', weaknesses: 'Little SP, no ranged options.',
      trial: { kind: 'kill', target: 'lunatic', count: 8, text: 'Defeat 8 Lunatics in the meadows to prove your courage.' },
      gift: 'sword' },
    mage: { id: 'mage', name: 'Mage', tier: 1, hpMult: 0.75, spMult: 1.7, maxJobLevel: 50, jobExp: firstJobExp,
      weapons: ['none', 'dagger', 'rod'], color: '#7a59c9',
      blurb: 'Calls down fire, ice and lightning bolts. Fragile, but devastating from a distance.',
      strengths: 'Huge magic damage, elemental advantage, attacks never miss.', weaknesses: 'Low HP, spells take time to cast.',
      trial: { kind: 'items', items: [['jellopy', 10], ['clover', 5]], text: 'Bring 10 Jellopy and 5 Clovers to use as spell catalysts.' },
      gift: 'rod' },
    archer: { id: 'archer', name: 'Archer', tier: 1, hpMult: 0.95, spMult: 1.0, maxJobLevel: 50, jobExp: firstJobExp,
      weapons: ['none', 'dagger', 'bow'], color: '#5fa04a',
      blurb: 'A sharp-eyed marksman who strikes from long range with a bow. DEX powers every shot.',
      strengths: 'Long range, high accuracy, safe kiting.', weaknesses: 'Weak up close, average HP.',
      trial: { kind: 'items', items: [['fluff', 8]], text: 'Bring 8 Fluff from the Lunatics for fletching arrows.' },
      gift: 'bow' },
    acolyte: { id: 'acolyte', name: 'Acolyte', tier: 1, hpMult: 1.05, spMult: 1.4, maxJobLevel: 50, jobExp: firstJobExp,
      weapons: ['none', 'mace', 'rod'], color: '#eceaf4',
      blurb: 'A devoted healer who mends wounds and blesses allies, holding the line with a mace.',
      strengths: 'Self-healing and strong buffs, very hard to kill.', weaknesses: 'Modest damage.',
      trial: { kind: 'pray', npc: 'pond_priestess', map: 'meadow', place: 'the meadow pond', text: 'Make a pilgrimage to the meadow pond and pray with Sister Lune at its shore. Follow the beacon of light southeast of the bridge.' },
      gift: 'club' },
    thief: { id: 'thief', name: 'Thief', tier: 1, hpMult: 1.05, spMult: 0.9, maxJobLevel: 50, jobExp: firstJobExp,
      weapons: ['none', 'dagger', 'sword'], color: '#4f4470',
      blurb: 'Quick, slippery and opportunistic. Dodges blows, strikes twice and steals from monsters.',
      strengths: 'Very high FLEE, fast double hits, extra loot from Steal.', weaknesses: 'Lower HP, weak against crowds.',
      trial: { kind: 'items', items: [['apple', 6], ['carrot', 6]], text: 'Pilfer 6 Apples and 6 Carrots from the meadow creatures.' },
      gift: 'cutter' },
    merchant: { id: 'merchant', name: 'Merchant', tier: 1, hpMult: 1.3, spMult: 0.9, maxJobLevel: 50, jobExp: firstJobExp,
      weapons: ['none', 'dagger', 'sword', 'mace'], color: '#b47a3e',
      blurb: 'A tough trader who turns Zeny into raw power and gets the best deals in every shop.',
      strengths: 'Sturdy, big hits with Mammonite, cheaper shopping and better selling.', weaknesses: 'Mammonite costs Zeny.',
      trial: { kind: 'pay', zeny: 600, items: [['empty_bottle', 5]], text: 'Pay the 600 Zeny guild fee and bring 5 Empty Bottles.' },
      gift: 'club' },
  };

  // Advancement graph (filled with full job data in Stage 3).
  const NEXT = {
    novice: ['swordsman', 'mage', 'archer', 'acolyte', 'thief', 'merchant'],
    swordsman: ['knight', 'crusader'], mage: ['wizard', 'sage'], archer: ['hunter', 'bard', 'dancer'],
    acolyte: ['priest', 'monk'], thief: ['assassin', 'rogue'], merchant: ['blacksmith', 'alchemist'],
  };

  G.Jobs = {
    DB: J, NEXT, firstJobExp,
    get(id) { return J[id]; },
    FIRST: ['swordsman', 'mage', 'archer', 'acolyte', 'thief', 'merchant'],
    register(job) { J[job.id] = job; },
  };
})(window.G = window.G || {});
