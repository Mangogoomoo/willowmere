/* NPC definitions. Each script is an async function using the dialog API:
     await d.say(text)                 show text, wait for "Next"
     await d.choose(text, options)     returns the chosen index
   Leaving the conversation (Esc, walking away) ends the script safely. */
(function (G) {
  'use strict';

  async function jobMaster(d, game) {
    const p = game.player, Q = game.quests;
    if (p.job !== 'novice') {
      const job = p.jobDef;
      const next = (G.Jobs.NEXT[p.job] || []).map((j) => j[0].toUpperCase() + j.slice(1)).join(' or ');
      await d.say(`Well met, ${p.name} the ${job.name}! Keep honing your craft. One day you may become a ${next}, but those masters have not yet come to Willowmere.`);
      return;
    }

    const trial = Q.trial;
    if (trial) {
      const job = G.Jobs.get(trial.job), st = Q.status();
      if (st.complete) {
        await d.say(`You’ve done it! ${st.done}`);
        const c = await d.choose(`Are you ready to become a ${job.name}? Your Novice days end here.`, [`Become a ${job.name}`, 'Not yet']);
        if (c === 0) {
          Q.complete();
          p.changeJob(trial.job);
          await d.say(`Rise, ${p.name} the ${job.name}! Take this ${G.Items.get(job.gift).name}. Your new skills are waiting in the Skills window.`);
        }
        return;
      }
      const c = await d.choose(`How goes your ${job.name} trial?\n${job.trial.text}\n${st.progress}`, ['I’m still working on it', 'I’d like a different path']);
      if (c === 1) {
        const sure = await d.choose('Abandon this trial? Any progress will be lost.', ['Abandon it', 'Keep going']);
        if (sure === 0) { Q.abandon(); await d.say('Very well. Speak to me again whenever you want to choose a new path.'); }
      }
      return;
    }

    await d.say('Ah, a new adventurer! I am Master Rowan. I guide Novices onto one of the six paths: Swordsman, Mage, Archer, Acolyte, Thief and Merchant.');
    const bt = p.skills.level('basic_training');
    if (p.jobLevel < 10 || bt < 9) {
      await d.say(`First you must reach job level 10 and learn Basic Training to level 9.\nYou are job level ${p.jobLevel}, with Basic Training at ${bt} of 9.\nHunt in the meadows south of town, and spend your skill points in the Skills window (Alt+S).`);
      return;
    }
    const names = G.Jobs.FIRST.map((id) => G.Jobs.get(id).name);
    for (;;) {
      const c = await d.choose('You’re ready. Which path calls to you?', [...names, 'Let me think about it']);
      if (c >= G.Jobs.FIRST.length) return;
      const job = G.Jobs.get(G.Jobs.FIRST[c]);
      const pick = await d.choose(`${job.name}: ${job.blurb}\nStrengths: ${job.strengths}\nWeaknesses: ${job.weaknesses}\nTrial: ${job.trial.text}`, ['Accept this trial', 'Show me the other paths']);
      if (pick === 0) {
        Q.start(job.id);
        await d.say(`So be it. ${job.trial.text} Come back to me when it’s done.`);
        return;
      }
    }
  }

  const shopkeeper = (shopId, greeting) => async function (d, game) {
    const c = await d.choose(greeting, ['Buy', 'Sell', 'Leave']);
    if (c === 0) game.shop.open('buy', shopId);
    else if (c === 1) game.shop.open('sell', shopId);
  };
  const toolDealer = shopkeeper('tools', 'Welcome to Pell’s Provisions! Potions, wings, the works. I’ll also buy whatever you drag back from the meadows.');
  const weaponDealer = shopkeeper('weapons', 'Garrick’s Arms. Every blade here was tested on a training dummy, and most of the dummies survived. What’ll it be?');
  const armorDealer = shopkeeper('armor', 'Sabine’s Outfitters! Cloaks, shields and the finest hats in Willowmere. Do try something on.');

  async function storageKeeper(d, game) {
    const c = await d.choose(`Hello, ${game.player.name}! The Willowmere Storage keeps your things safe while you adventure. ${game.player.storage.length} of 300 shelves are in use.`, ['Open storage', 'Leave']);
    if (c === 0) game.storage.open();
  }

  async function innkeeper(d, game) {
    const p = game.player;
    const c = await d.choose('Welcome to the Sleepy Willow Inn. Want me to make this your save point? If you ever faint, you’ll wake up right here.', ['Save my position here', 'Rest (restore HP and SP)', 'Leave']);
    if (c === 0) {
      p.savePoint = { map: game.mapId, x: p.position.x, z: p.position.z };
      game.save.save(true);
      game.log.add('Your save point is set to the Sleepy Willow Inn.', 'system');
      await d.say('There you go. Sleep tight when you need to.');
    } else if (c === 1) {
      p.hp = p.maxHp; p.sp = p.maxSp;
      game.spells.aura(p, '#ffe27a');
      await d.say('A warm meal and a soft bed. You feel completely refreshed.');
    }
  }

  const TOPICS = [
    ['Moving and fighting', 'Left-click the ground to walk; hold the button to keep walking. Left-click a monster to walk up and attack it until it falls. Right-drag turns the camera, and the wheel zooms.'],
    ['Stats', 'Each base level gives stat points. Spend them in the Status window (Alt+A). STR hits harder, AGI attacks faster and dodges, VIT gives HP and defence, INT powers magic and SP, DEX improves accuracy, LUK brings critical hits.'],
    ['Skills and jobs', 'Job levels give skill points for the Skills window (Alt+S). Drag skills onto F1 to F9. At job level 10 with Basic Training 9, Master Rowan in the plaza can start your job change.'],
    ['Items and cards', 'Monsters drop loot. Double-click to use or equip. Every monster also carries a very rare card: double-click it to insert it into equipment with a free card slot, shown as diamonds in the tooltip. Hold Shift over gear to compare it with what you wear.'],
    ['Where to hunt', 'Porings and Lunatics roam the meadows south of town. Past the portal at the far south end lies Whisperwood Glade, and deep in its east is the entrance to Mossy Hollow, where the King Poring rules.'],
  ];
  async function tutor(d) {
    for (;;) {
      const c = await d.choose('Hi! I’m Pip, and I love explaining things. What would you like to know?', [...TOPICS.map((t) => t[0]), 'That’s all, thanks']);
      if (c >= TOPICS.length) return;
      await d.say(TOPICS[c][1]);
    }
  }

  // Captain Brin hands out the guild quests (see data/quests.js).
  async function questGiver(d, game) {
    const Q = game.questlog;
    const ready = Q.readyToTurnIn('quest_giver');
    for (const q of ready) {
      await d.say(`${q.def.done}\nRewards: ${Q.rewardText(q.def)}.`);
      Q.turnIn(q.def.id);
    }
    const avail = Q.available('quest_giver');
    const active = Q.active().filter((q) => q.def.giver === 'quest_giver');
    if (!avail.length) {
      await d.say(active.length ? `Keep at it, ${game.player.name}. Check your quest log (U) for the details.` : 'No new work right now. Get stronger and come back later.');
      return;
    }
    for (;;) {
      const list = Q.available('quest_giver');
      if (!list.length) return;
      const c = await d.choose('The Adventurers’ Guild always has work. Which job will you take?', [...list.map((q) => q.name), 'Not now']);
      if (c >= list.length) return;
      const q = list[c];
      const ok = await d.choose(`${q.name}\n${q.text}\nRewards: ${Q.rewardText(q)}.`, ['Accept', 'Back']);
      if (ok === 0) { Q.accept(q.id); await d.say('Good luck out there. Your quest log (U) tracks your progress.'); }
    }
  }

  async function priestess(d, game) {
    const p = game.player, Q = game.quests, t = Q.trial;
    if (t && t.job === 'acolyte' && !t.progress) {
      await d.say('Welcome, pilgrim. Master Rowan sent word that you might come. I am Sister Lune, keeper of this pond.');
      const c = await d.choose('Will you kneel and pray with me at the water’s edge?', ['Pray with Sister Lune', 'Not yet']);
      if (c === 0) {
        game.spells.aura(p, '#fff2a0');
        Q.prayed();
        await d.say('The water is still, and so is your heart. I feel its blessing upon you.\nReturn to Master Rowan. The path of the Acolyte is open to you.');
      }
      return;
    }
    const greet = p.job === 'acolyte' ? `Welcome back, ${p.name}. The pond remembers you.` : 'Peace be with you, traveller. This pond has soothed weary adventurers for generations.';
    const c = await d.choose(`${greet} Would you like to rest and pray a while?`, ['Pray (restore HP and SP)', 'Goodbye']);
    if (c === 0) {
      p.hp = p.maxHp; p.sp = p.maxSp;
      game.spells.aura(p, '#fff2a0');
      game.log.add('You pray by the pond. Your HP and SP are restored.', 'system');
      await d.say('Your wounds are mended. Walk gently.');
    }
  }

  G.NPC_DEFS = [
    { id: 'job_master', name: 'Master Rowan', title: 'Job Master', costume: 'master', x: 0, z: -82.5, facing: 0,
      appearance: { hair: 'snow', eyes: 'blue', style: 'short' }, script: jobMaster },
    { id: 'tool_dealer', name: 'Pell', title: 'Tool Dealer', costume: 'dealer', x: -3.58, z: -57.64, facing: Math.atan2(3.58, -14.36),
      appearance: { hair: 'chestnut', eyes: 'amber', style: 'short' }, script: toolDealer },
    { id: 'weapon_dealer', name: 'Garrick', title: 'Weapon Dealer', costume: 'smith', x: 3.58, z: -57.64, facing: Math.atan2(-3.58, -14.36),
      appearance: { hair: 'raven', eyes: 'amber', style: 'short' }, script: weaponDealer },
    { id: 'armor_dealer', name: 'Sabine', title: 'Armour Dealer', costume: 'tailor', x: 3.58, z: -86.36, facing: Math.atan2(-3.58, 14.36),
      appearance: { hair: 'rose', eyes: 'green', style: 'ponytail' }, script: armorDealer },
    { id: 'storage_keeper', name: 'Hilde', title: 'Storage', costume: 'clerk', x: -3.58, z: -86.36, facing: Math.atan2(3.58, 14.36),
      appearance: { hair: 'honey', eyes: 'blue', style: 'twintails' }, script: storageKeeper },
    { id: 'innkeeper', name: 'Odo', title: 'Innkeeper (Save Point)', costume: 'inn', x: 24, z: -69.2, facing: -Math.PI / 2,
      appearance: { hair: 'chestnut', eyes: 'green', style: 'short' }, script: innkeeper },
    { id: 'tutor', name: 'Pip', title: 'Tutor', costume: 'scholar', x: -5.2, z: -62.4, facing: Math.PI / 2,
      appearance: { hair: 'mint', eyes: 'violet', style: 'short' }, script: tutor },
    { id: 'quest_giver', name: 'Captain Brin', title: 'Adventurers’ Guild', costume: 'captain', x: -24, z: -69.2, facing: Math.PI / 2,
      appearance: { hair: 'raven', eyes: 'blue', style: 'ponytail' }, script: questGiver },
    { id: 'pond_priestess', name: 'Sister Lune', title: 'Pond Keeper', costume: 'priestess', x: 35.2, z: 55.2, facing: Math.atan2(10.8, 0.8),
      appearance: { hair: 'honey', eyes: 'violet', style: 'twintails' }, script: priestess },
  ];

  G.SHOPS = {
    tools: { name: 'Pell’s Provisions', npc: 'tool_dealer', stock: ['red_potion', 'orange_potion', 'blue_potion', 'green_herb', 'apple', 'carrot', 'butterfly_wing', 'fly_wing'] },
    weapons: { name: 'Garrick’s Arms', npc: 'weapon_dealer', stock: ['knife', 'cutter', 'sword', 'club', 'rod', 'wand', 'bow', 'composite_bow'] },
    armor: { name: 'Sabine’s Outfitters', npc: 'armor_dealer', stock: ['cotton_shirt', 'adventurer_suit', 'sandals', 'hood', 'guard', 'ribbon', 'round_glasses', 'leaf_cap'] },
  };
})(window.G = window.G || {});
