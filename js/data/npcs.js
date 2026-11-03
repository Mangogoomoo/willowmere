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

  async function toolDealer(d, game) {
    const c = await d.choose('Welcome to Pell’s Provisions! Potions, wings, the works. I’ll also buy whatever you drag back from the meadows.', ['Buy', 'Sell', 'Leave']);
    if (c === 0) game.shop.open('buy');
    else if (c === 1) game.shop.open('sell');
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
    { id: 'pond_priestess', name: 'Sister Lune', title: 'Pond Keeper', costume: 'priestess', x: 35.2, z: 55.2, facing: Math.atan2(10.8, 0.8),
      appearance: { hair: 'honey', eyes: 'violet', style: 'twintails' }, script: priestess },
  ];

  G.SHOP_STOCK = ['red_potion', 'orange_potion', 'blue_potion', 'apple', 'carrot', 'butterfly_wing', 'fly_wing'];
})(window.G = window.G || {});
