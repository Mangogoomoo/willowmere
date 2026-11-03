/* Guild quests handed out by Captain Brin (giver: 'quest_giver').
   Objective types:
     kill       { target: monsterType, count }
     item       { id, count }          (handed over when you turn the quest in)
     baseLevel  { level }   jobLevel { level }
     job        { tier }               (have changed to a job of this tier)
     visit      { map }                (set foot on a map)
   req: quests that must be finished first. */
(function (G) {
  'use strict';
  G.QUESTS = [
    { id: 'pest_control', name: 'Pest Control', giver: 'quest_giver', minLevel: 1, req: [],
      text: 'Porings keep nibbling the town gardens. Defeat 5 of them in the meadows south of town.',
      objectives: [{ type: 'kill', target: 'poring', count: 5 }],
      rewards: { exp: 40, jobExp: 25, zeny: 150, items: [['red_potion', 5]] },
      done: 'Five fewer Porings in the cabbages. Nicely done!' },
    { id: 'jelly_jars', name: 'Jellopy Jars', giver: 'quest_giver', minLevel: 1, req: [],
      text: 'The town alchemist needs 5 Jellopy for her jars. Porings drop them.',
      objectives: [{ type: 'item', id: 'jellopy', count: 5 }],
      rewards: { exp: 30, jobExp: 20, zeny: 120, items: [['apple', 5]] },
      done: 'Lovely, still a little wobbly. I’ll pass these on.' },
    { id: 'growing_up', name: 'Growing Up', giver: 'quest_giver', minLevel: 1, req: ['pest_control'],
      text: 'Toughen up out there. Come back when you reach base level 5.',
      objectives: [{ type: 'baseLevel', level: 5 }],
      rewards: { exp: 60, jobExp: 40, zeny: 200, items: [['orange_potion', 3]] },
      done: 'Look at you, standing taller already.' },
    { id: 'novice_mastery', name: 'Ready for More', giver: 'quest_giver', minLevel: 3, req: ['growing_up'],
      text: 'Reach job level 10. Every job master asks for that much experience.',
      objectives: [{ type: 'jobLevel', level: 10 }],
      rewards: { exp: 120, jobExp: 0, zeny: 300, items: [['butterfly_wing', 2]] },
      done: 'Job level 10! Master Rowan will want to see you.' },
    { id: 'new_path', name: 'A New Path', giver: 'quest_giver', minLevel: 5, req: ['novice_mastery'],
      text: 'Complete your first job change with Master Rowan in the plaza.',
      objectives: [{ type: 'job', tier: 1 }],
      rewards: { exp: 200, jobExp: 100, zeny: 500, items: [['blue_potion', 2]] },
      done: 'A proper adventurer at last. The guild is proud of you.' },
    { id: 'fabre_fluff', name: 'Soft as Fluff', giver: 'quest_giver', minLevel: 5, req: [],
      text: 'The tailor wants Fabre fluff for winter cloaks. Defeat 8 Fabres in Whisperwood Glade and bring 6 Fluff.',
      objectives: [{ type: 'kill', target: 'fabre', count: 8 }, { type: 'item', id: 'fluff', count: 6 }],
      rewards: { exp: 180, jobExp: 120, zeny: 400, items: [['green_herb', 10]] },
      done: 'So soft! The tailor will be thrilled.' },
    { id: 'rocker_legs', name: 'Hopping Mad', giver: 'quest_giver', minLevel: 8, req: [],
      text: 'Rockers keep kicking our scouts in Whisperwood. Bring back 5 Grasshopper’s Legs as proof you’ve dealt with them.',
      objectives: [{ type: 'item', id: 'grasshopper_leg', count: 5 }],
      rewards: { exp: 300, jobExp: 200, zeny: 600, items: [['orange_potion', 5]] },
      done: 'That should keep them hopping somewhere else.' },
    { id: 'hollow_scout', name: 'Into the Hollow', giver: 'quest_giver', minLevel: 10, req: ['fabre_fluff'],
      text: 'Scout Mossy Hollow, the cave in the east of Whisperwood Glade. Just get inside and look around.',
      objectives: [{ type: 'visit', map: 'dungeon' }],
      rewards: { exp: 250, jobExp: 150, zeny: 500, items: [['royal_jelly', 2]] },
      done: 'Bats, mushrooms and ghosts? Glad you made it back.' },
    { id: 'king_poring', name: 'Long Live the King?', giver: 'quest_giver', minLevel: 12, req: ['hollow_scout'],
      text: 'Something enormous and wobbly rules the deepest chamber of Mossy Hollow. Defeat the King Poring.',
      objectives: [{ type: 'kill', target: 'king_poring', count: 1 }],
      rewards: { exp: 1200, jobExp: 800, zeny: 3000, items: [['royal_jelly', 5]] },
      done: 'You toppled the King Poring? The whole guild will be talking about this!' },
  ];
})(window.G = window.G || {});
