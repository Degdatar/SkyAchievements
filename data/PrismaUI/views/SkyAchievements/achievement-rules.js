/* Save-backed achievement rules for SkyAchievements. This file is deliberately
   read-only: it evaluates snapshots already delivered by the SkyOS bridge. */
(() => {
  const normalize = (value) => String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const keyOf = (value) => normalize(value).replace(/\s/g, '');
  const rules = new Map();
  const add = (names, target, description, sources, measure, note = '') => {
    for (const name of Array.isArray(names) ? names : [names]) {
      rules.set(keyOf(name), { name, target, description, sources, measure, note });
    }
  };
  const unavailable = (names, description, reason) => add(names, 1, description, [], () => 0, `Tracking unavailable: ${reason}`);

  const completedQuest = (...aliases) => (ctx) => aliases.some((alias) => {
    const key = normalize(alias);
    return ctx.quests.has(key) || [...ctx.quests].some((quest) => quest.includes(key));
  }) ? 1 : 0;
  const questRule = (name, aliases, description) => {
    const displayQuest = aliases.find((alias) => /\s/.test(alias)) || aliases[0] || name;
    add(name, 1, description || `Complete the quest: ${displayQuest}.`, ['history'], completedQuest(...aliases));
  };
  const deathEvents = (ctx, pattern, predicate = () => true) => {
    let count = 0;
    for (const event of ctx.events) {
      if (event?.kind !== 'death' || event?.detail !== 'Player killed this actor') continue;
      const text = `${event.subject || ''} ${event.identity || ''}`;
      const context = `${text} ${event.location || ''}`;
      if (pattern.test(text) && predicate(event, text, context)) count++;
    }
    return count;
  };
  const stateCount = (ctx, categories) => {
    let found = false;
    let count = 0;
    for (const state of ctx.creatureStates) {
      if (String(state.holdKey || '').toLowerCase() !== 'all') continue;
      if (!categories.includes(String(state.category || '').toLowerCase())) continue;
      found = true;
      count += Math.max(0, Number(state.count) || 0);
    }
    return found ? count : null;
  };
  const highest = (...values) => values.reduce((best, value) => Number.isFinite(value) ? Math.max(best, value) : best, 0);
  const killRule = (name, target, description, categories, pattern, reputationFields = [], note = '', eventPredicate = () => true) => add(
    name, target, description, ['history'], (ctx) => {
      const saved = stateCount(ctx, categories);
      const reputation = reputationFields.map((field) => Number(ctx.reputation[field])).filter(Number.isFinite);
      return highest(saved, ...reputation, deathEvents(ctx, pattern, eventPredicate));
    }, note
  );
  const recentKillRule = (name, target, description, pattern, predicate = () => true, note = 'Subtype is counted from SkyRewrite history retained in the save.') => add(
    name, target, description, ['history'], (ctx) => deathEvents(ctx, pattern, predicate), note
  );
  const locationRule = (names, target, description) => add(names, target, description, ['locations'], (ctx) => ctx.locations.length);
  const itemRule = (name, target, description, measure, note = '') => add(name, target, description, ['items'], measure, note);
  const itemRecords = (ctx) => ctx.items.filter((item) => Math.max(0, Number(item.totalFound) || 0) > 0);
  const itemQuantity = (ctx, predicate) => ctx.items.reduce((sum, item) => predicate(item) ? sum + Math.max(0, Number(item.totalFound) || 0) : sum, 0);
  const rarityCount = (rarity, predicate = () => true) => (ctx) => itemRecords(ctx).filter((item) => String(item.rarity || '').toLowerCase() === rarity.toLowerCase() && predicate(item)).length;
  const nameCount = (pattern, quantity = false) => (ctx) => quantity
    ? itemQuantity(ctx, (item) => pattern.test(`${item.name || ''} ${item.category || ''}`))
    : itemRecords(ctx).filter((item) => pattern.test(`${item.name || ''} ${item.category || ''}`)).length;
  const historyEventCount = (ctx, predicate) => ctx.events.filter(predicate).length;
  const highestCarriedGold = (ctx) => Math.max(
    Math.max(0, Number(ctx.history.peakGold) || 0),
    ctx.history.goldBalanceAvailable === true ? Math.max(0, Number(ctx.history.currentGold) || 0) : 0
  );
  const killText = (event) => `${event?.subject || ''} ${event?.identity || ''} ${event?.location || ''}`;

  // Quest, named-boss, and story achievements.
  questRule('A Good Death', ['The Cursed Tribe']);
  questRule('Aetherium Champion', ['Lost to the Ages']);
  add("Apocrypha's Bane", 1, 'Defeat Miraak.', ['history'], (ctx) => Math.max(completedQuest('At the Summit of Apocrypha')(ctx), deathEvents(ctx, /\bmiraak\b/i)));
  questRule('Arch Mage', ['The Eye of Magnus']);
  questRule("Arvak's Summon", ['DLC01SoulCairnHorseQuest2', 'Find Arvak\'s Skull', 'Arvak']);
  questRule("Betrayer's Fall", ['Blindsighted']);
  questRule('Blood on the Ice', ['Blood on the Ice']);
  questRule('Civil War Hero', ['Battle for Windhelm', 'Battle for Solitude'], 'Complete either Battle for Windhelm or Battle for Solitude.');
  add("Forgemaster's Ruin", 1, 'Defeat the Forgemaster.', ['history'], (ctx) => deathEvents(ctx, /\bforgemaster\b/i));
  add('Gatekeeper', 1, 'Defeat Nahkriin.', ['history'], (ctx) => deathEvents(ctx, /\bnahkriin\b/i));
  questRule('Gauldur Rebirth', ['Forbidden Legend']);
  questRule('Harbinger', ['Glory of the Dead']);
  add("Harkon's Demise", 1, 'Defeat Lord Harkon.', ['history'], (ctx) => Math.max(completedQuest('Kindred Judgment')(ctx), deathEvents(ctx, /\bharkon\b/i)));
  add("Karstaag's Fall", 1, 'Defeat the Ghost of Karstaag.', ['history'], (ctx) => deathEvents(ctx, /\bkarstaag\b/i));
  add('Legendary Challenger', 1, 'Defeat the Ebony Warrior at Last Vigil.', ['history'], (ctx) => deathEvents(ctx, /ebony warrior/i));
  questRule("Potema's Doom", ['The Wolf Queen Awakened']);
  add('Reaper Ripper', 2, 'Collect all three Reaper Gem Fragments and defeat the Reaper.', ['history', 'items'], (ctx) => {
    const fragments = Math.min(3, itemQuantity(ctx, (item) => /reaper gem fragment/i.test(item.name || '')));
    const defeated = deathEvents(ctx, /\breaper\b/i) > 0;
    return (fragments >= 3 ? 1 : 0) + (defeated ? 1 : 0);
  }, 'The fragment count depends on SkyCollection exposing the three quest items.');
  questRule("Red Eagle's Fall", ['The Legend of Red Eagle', 'Red Eagle']);
  add('Sisters of Doom', 1, 'Defeat the Glenmoril Witches.', ['history'], (ctx) => deathEvents(ctx, /glenmoril witch/i));
  add("Snow Elf's Last Stand", 1, 'Defeat Arch-Curate Vyrthur.', ['history'], (ctx) => Math.max(completedQuest('Touching the Sky')(ctx), deathEvents(ctx, /\bvyrthur\b/i)));
  add('Thane of the Nine Holds', 9, 'Become Thane in all nine Holds.', ['player'], (ctx) => {
    const holds = ['eastmarch', 'falkreath', 'haafingar', 'hjaalmarch', 'pale', 'reach', 'rift', 'whiterun', 'winterhold'];
    const factions = ctx.factions.map((faction) => normalize(`${faction.name || ''} ${faction.editorID || ''}`));
    return holds.filter((hold) => factions.some((faction) => faction.includes('thane') && faction.includes(hold))).length;
  }, 'Requires SkyAchievements to receive the active player faction list.');
  questRule('The Listener', ["Where You Hang Your Enemy's Head", 'The Dark Brotherhood Forever'], 'Complete the Dark Brotherhood questline and become the Listener.');
  add('The Pale Lady', 1, 'Defeat the Pale Lady in Frostmere Crypt.', ['history'], (ctx) => Math.max(completedQuest('The Pale Lady')(ctx), deathEvents(ctx, /pale lady/i)));
  add("Vulthuryol's Doom", 1, 'Defeat Vulthuryol in Blackreach.', ['history'], (ctx) => deathEvents(ctx, /vulthuryol/i));
  add('Warmongers Ruin', 1, 'Defeat General Tullius or Ulfric Stormcloak.', ['history'], (ctx) => deathEvents(ctx, /general tullius|ulfric stormcloak/i));
  add("World Eater's End", 1, 'Defeat Alduin in Sovngarde.', ['history'], (ctx) => Math.max(completedQuest('Dragonslayer')(ctx), deathEvents(ctx, /\balduin\b/i)));

  // General and creature kill counters. SkyRewrite's all-holds counters are
  // preferred; retained named death records fill the gaps for subtypes.
  killRule('Acid Resistance', 25, 'Slay Chaurus.', ['chaurus'], /\bchaurus\b/i);
  add('Apex Predator', 500, 'Slay 500 hostile monsters.', ['history'], (ctx) => highest(
    stateCount(ctx, ['monster']),
    Number(ctx.reputation.monsters),
    deathEvents(ctx, /./i, (event) => event.victimHostile === true && event.victimMonster === true)
  ), 'Uses SkyRewrite’s persistent hostile-monster counter, with retained death events as a fallback.');
  killRule('Arcane Eraser', 50, 'Slay hostile mages, warlocks, or conjurers.', ['necromancer', 'pyromancer', 'cryomancer', 'electromancer', 'conjurer', 'roguewarlock'], /necromancer|pyromancer|cryomancer|electromancer|conjurer|warlock|rogue/i);
  killRule('Ash And Bone', 25, 'Slay Ash Spawn.', ['ashspawn'], /ash spawn|ashspawn/i);
  recentKillRule('Ash Guardian Destroyer', 10, 'Slay Ash Guardians.', /ash guardian/i);
  recentKillRule('Ash Hopper Squasher', 25, 'Slay Ash Hoppers.', /ash hopper/i);
  killRule('Ash Spawn Purger', 50, 'Slay Ash Spawn.', ['ashspawn'], /ash spawn|ashspawn/i);
  killRule('Ash To Ash', 50, 'Slay Vampires.', ['vampire'], /vampire/i, ['vampires']);
  killRule('Atronach Abolisher', 50, 'Slay Atronachs.', ['atronach'], /atronach/i);
  recentKillRule("Bandit Chief's Ruin", 25, 'Slay Bandit Chiefs.', /bandit chief/i);
  killRule('Bandit Marauder', 100, 'Slay Bandits.', ['bandit'], /bandit|marauder/i, ['bandits']);
  killRule('Banish The Daedra', 5, 'Slay or banish Daedra.', ['dremora'], /dremora|daedra/i);
  killRule('Barrow Purger', 75, 'Slay Draugr.', ['draugr'], /draugr/i, ['draugrs']);
  killRule('Bear Hunter', 50, 'Slay Bears.', ['bear'], /bear/i, ['bears']);
  killRule('Blind Spot', 50, 'Slay Falmer.', ['falmer'], /falmer/i, ['falmers']);
  killRule('Blood Sucker', 100, 'Slay Vampires.', ['vampire'], /vampire/i, ['vampires']);
  killRule('Bone Breaker', 25, 'Slay Skeletons.', ['skeleton'], /skeleton/i, ['skeletons']);
  recentKillRule('Briarheart Plucker', 20, 'Slay Forsworn Briarhearts.', /forsworn briarheart/i);
  recentKillRule('Burnt Spriggan Bane', 10, 'Slay Burnt Spriggans on Solstheim.', /burnt spriggan/i, (_event, _text, context) => /solstheim|raven rock|ashlands|tel mithryn/i.test(context));
  killRule("Centurion's Ruin", 10, 'Destroy Dwarven Centurions.', ['dwarvencenturion'], /dwarven centurion|centurion/i);
  killRule('Chaurus Exterminator', 50, 'Slay Chaurus.', ['chaurus'], /\bchaurus\b/i);
  killRule('Cleanse Of Skyrim', 250, 'Slay Undead across Skyrim.', ['draugr', 'skeleton', 'vampire', 'ghost', 'dragonpriest', 'boneman', 'mistman', 'wrathman'], /draugr|skeleton|vampire|ghost|shade|dragon priest|boneman|mistman|wrathman/i);
  killRule('Cold Snap', 25, 'Slay Frost Atronachs.', ['atronach'], /frost atronach/i);
  killRule('Colossal Bane', 25, 'Slay Giants.', ['giant'], /giant/i);
  killRule('Coven Breaker', 10, 'Slay Hagravens.', ['hagraven'], /hagraven/i, ['hagravens']);
  killRule('Coven Culler', 25, 'Slay Witches or Glenmoril Witches.', ['witch'], /witch|glenmoril/i);
  killRule('Crypt Sweeper', 50, 'Slay Skeletons.', ['skeleton'], /skeleton/i, ['skeletons']);
  killRule('Cultist Purger', 25, 'Slay Cultists.', ['dragoncultist', 'mythicdawncultist', 'miraakcultist', 'cultist'], /cultist|mythic dawn/i);
  killRule('Daedric Purge', 50, 'Slay Daedra.', ['dremora'], /dremora|daedra/i);
  killRule('Death Hound Tamer', 25, 'Slay Death Hounds.', ['deathhound'], /death.?hound/i);
  recentKillRule('Deathlord Doom', 25, 'Slay Draugr Deathlords.', /draugr deathlord|deathlord/i);
  killRule('Deep Dweller', 100, 'Slay Chaurus.', ['chaurus'], /\bchaurus\b/i);
  killRule("Dominion's Nightmare", 50, 'Slay Thalmor Justiciars and Soldiers.', ['thalmorjusticiar'], /thalmor/i);
  killRule("Dovahkiin's Trophy", 10, 'Slay Dragons.', ['dragon'], /\bdragon\b/i, ['dragons']);
  recentKillRule('Down With The Thalmor', 25, 'Slay Thalmor agents.', /thalmor/i);
  killRule('Dragon Emperor', 100, 'Slay Dragons.', ['dragon'], /\bdragon\b/i, ['dragons']);
  killRule('Dragon Hunter', 25, 'Slay Dragons.', ['dragon'], /\bdragon\b/i, ['dragons']);
  add("Dragon Priest's Bane", 10, 'Defeat 8 named Dragon Priests or 10 Dragon Priests total.', ['history'], (ctx) => {
    const total = highest(stateCount(ctx, ['dragonpriest']), Number(ctx.reputation.dragonPriests), deathEvents(ctx, /dragon priest|dragonpriest/i));
    const named = new Set();
    for (const event of ctx.events) if (event?.kind === 'death' && /Player killed this actor/.test(event.detail || '') && /dragon priest|dragonpriest/i.test(killText(event))) named.add(normalize(event.subject || event.identity));
    return total >= 10 ? 10 : Math.max(total, named.size >= 8 ? 10 : named.size);
  }, 'The named-priest alternative is limited to retained death history; the cumulative 10-priest counter is persistent.');
  killRule('Dragon Slayer', 50, 'Slay Dragons.', ['dragon'], /\bdragon\b/i, ['dragons']);
  killRule('Draugr Cleanser', 100, 'Slay Draugr.', ['draugr'], /draugr/i, ['draugrs']);
  killRule('Dust To Dust', 150, 'Slay Vampires.', ['vampire'], /vampire/i, ['vampires']);
  killRule('Dwarven Demolisher', 25, 'Destroy Dwarven Automatons (Spiders and Spheres).', ['dwarvenspider', 'dwarvensphere'], /dwarven spider|dwarven sphere|spider guardian|sphere guardian/i);
  killRule('Dwarven Purge', 50, 'Destroy Dwarven Automatons.', ['dwarven'], /dwarven|dwemer|centurion|sphere guardian|spider guardian/i, ['dwarvenCreatures']);
  killRule('Eight Legged Freaks', 25, 'Slay Frostbite Spiders.', ['spider'], /frostbite spider|spider/i, ['spiders']);
  killRule('Extraplanar Obliterator', 50, 'Slay Atronachs, Seekers, or Lurkers.', ['atronach'], /atronach|seeker|lurker/i);
  killRule('Falmer Stalker', 150, 'Slay Falmer.', ['falmer'], /falmer/i, ['falmers']);
  killRule('Forsworn Raider', 50, 'Slay Forsworn.', ['forsworn'], /forsworn/i, ['forsworn']);
  recentKillRule('Frost Giant Slayer', 5, 'Slay Frost Giants in the Forgotten Vale.', /frost giant/i, (_event, _text, context) => /forgotten vale|vale/i.test(context));
  killRule('Frostbite Purger', 50, 'Slay Frostbite Spiders.', ['spider'], /frostbite spider|spider/i, ['spiders']);
  killRule('Gargoyle Shatterer', 25, 'Slay Gargoyles.', ['gargoyle'], /gargoyle/i);
  killRule('Ghostly Purge', 25, 'Slay Ghosts or Shades.', ['ghost'], /ghost|shade/i);
  killRule('Giant Slayer', 10, 'Slay Giants.', ['giant'], /giant/i);
  killRule('Global Warming', 25, 'Slay Flame Atronachs.', ['atronach'], /flame atronach/i);
  killRule('Grounding Rod', 25, 'Slay Storm Atronachs.', ['atronach'], /storm atronach/i);
  killRule('Hagraven Hunter', 25, 'Slay Hagravens.', ['hagraven'], /hagraven/i, ['hagravens']);
  killRule("Highwayman's Bane", 50, 'Slay Bandits.', ['bandit'], /bandit|marauder/i, ['bandits']);
  recentKillRule('Horker Hunter', 25, 'Slay Horkers.', /horker/i);
  add('Humanitarian Crisis', 500, 'Slay 500 hostile NPCs.', ['history'], (ctx) => {
    const allHostile = Number(ctx.reputation.allHostile) || 0;
    const monsters = Number(ctx.reputation.monsters) || 0;
    return highest(Math.max(0, allHostile - monsters), historyEventCount(ctx, (event) => event?.kind === 'death' && event?.detail === 'Player killed this actor' && event.victimHostile === true && event.victimMonster !== true));
  }, 'Uses SkyRewrite’s cumulative hostile and monster counters; monsters are subtracted from hostile kills.');
  killRule('Ice Wraith Bane', 25, 'Slay Ice Wraiths.', ['icewraith'], /ice wraith/i);
  killRule('Inquisition', 25, 'Slay Vigilants, Cultists, or Necromancers.', ['dragoncultist', 'mythicdawncultist', 'miraakcultist', 'cultist', 'necromancer'], /vigilant|cultist|mythic dawn|necromancer/i);
  recentKillRule('Legendary Dragon Bane', 10, 'Slay Legendary Dragons.', /legendary dragon/i);
  recentKillRule('Mammoth Hunter', 25, 'Slay Mammoths.', /mammoth/i);
  add('Master of the Hunt', 100, 'Slay non-hostile animals.', ['history'], (ctx) => historyEventCount(ctx, (event) => {
    if (event?.kind !== 'death' || event?.detail !== 'Player killed this actor' || event.victimHostile !== false) return false;
    return event.victimMonster !== true && /bear|deer|elk|fox|goat|hare|horse|cow|chicken|dog|wolf|mammoth|mudcrab|skeever|horker|slaughterfish|sabre.?cat/i.test(killText(event));
  }), 'Non-hostile animal deaths are counted from retained SkyRewrite history.');
  add('Monster Mash', 300, 'Slay 300 hostile monsters.', ['history'], (ctx) => highest(
    stateCount(ctx, ['monster']),
    Number(ctx.reputation.monsters),
    deathEvents(ctx, /./i, (event) => event.victimHostile === true && event.victimMonster === true)
  ), 'Uses SkyRewrite’s persistent hostile-monster counter, with retained death events as a fallback.');
  killRule('Moonlit Hunter', 10, 'Slay Werewolves or Werebears.', ['werewolf'], /werewolf|werebear/i);
  killRule('Mudcrab Crusher', 25, 'Slay Mudcrabs.', ['mudcrab'], /mudcrab/i);
  killRule("Nature's Wrath", 25, 'Slay Spriggans.', ['spriggan'], /spriggan/i);
  killRule("Necromancer's Bane", 25, 'Slay Necromancers.', ['necromancer'], /necromancer/i);
  recentKillRule('Netch Hunter', 25, 'Slay Netch on Solstheim.', /netch/i);
  killRule("Pack Alpha's Bane", 50, 'Slay Wolves, including Ice Wolves.', ['wolf'], /wolf/i, ['wolves']);
  killRule('Pox Upon You', 25, 'Slay Afflicted.', ['afflicted'], /afflicted/i);
  killRule('Reach Purger', 150, 'Slay Forsworn.', ['forsworn'], /forsworn/i, ['forsworn']);
  killRule('Reach Reformer', 25, 'Slay Forsworn.', ['forsworn'], /forsworn/i, ['forsworn']);
  recentKillRule('Ruins Exorcist', 50, 'Slay Ghosts, Shades, or Undead in ancient ruins.', /ghost|shade|draugr|skeleton|vampire|dragon priest/i, (_event, _text, context) => /ruin|crypt|tomb|barrow|temple|cairn|catacomb/i.test(context));
  killRule('Sabre Cat Stalker', 25, 'Slay Sabre Cats, including Snowy Sabre Cats.', ['sabrecat'], /sabre.?cat/i);
  recentKillRule('Scourge of the Roads', 200, 'Slay Bandits or Highwaymen along Skyrim roads.', /bandit|highwayman/i, (_event, _text, context) => /road|pass|trail|path|crossing/i.test(context));
  killRule('Scrap Metal', 100, 'Destroy Dwarven Automatons.', ['dwarven'], /dwarven|dwemer|centurion|sphere guardian|spider guardian/i, ['dwarvenCreatures']);
  recentKillRule('Shadows Bane', 25, 'Slay Nightmaster Vampires, Shades, or Dark Brotherhood Assassins.', /nightmaster|shade|dark brotherhood assassin/i);
  recentKillRule('Silver Hand Purge', 50, 'Slay Silver Hand members.', /silver hand/i);
  killRule('Skeever Exterminator', 50, 'Slay Skeevers.', ['skeever'], /skeever/i);
  killRule('Skeleton Smasher', 100, 'Slay Skeletons.', ['skeleton'], /skeleton/i, ['skeletons']);
  killRule('Slaughterfish Slayer', 25, 'Slay Slaughterfish.', ['slaughterfish'], /slaughterfish/i);
  recentKillRule('Solstheim Sweeper', 50, 'Slay Rieklings.', /riekling/i);
  recentKillRule('Soul Cairn Purger', 50, 'Slay Bonemen, Mistmen, or Wrathmen in the Soul Cairn.', /boneman|mistman|wrathman/i, (_event, _text, context) => /soul cairn/i.test(context));
  killRule('Specter Hunter', 50, 'Slay Ghosts or Wispmothers.', ['ghost', 'wispmother'], /ghost|shade|wisp.?mother/i);
  killRule('Spriggan Sapper', 50, 'Slay Spriggans.', ['spriggan'], /spriggan/i);
  locationRule('Tomb Raider', 25, 'Discover 25 locations (used as the dungeon-clears count).');
  recentKillRule('Tribe Purger', 25, 'Slay Rieklings on Solstheim.', /riekling/i, (_event, _text, context) => /solstheim|raven rock|ashlands|tel mithryn/i.test(context));
  killRule('Troll Hunter', 10, 'Slay Trolls.', ['troll'], /troll/i);
  killRule('Troll Slayer', 25, 'Slay Cave Trolls or Frost Trolls.', ['troll'], /troll/i);
  killRule('Troll Toll', 50, 'Slay Trolls.', ['troll'], /troll/i);
  recentKillRule('Unraveling Reality', 25, 'Slay Seekers and Lurkers in Apocrypha.', /seeker|lurker/i, (_event, _text, context) => /apocrypha|black book/i.test(context));
  recentKillRule('Vale Sabre Stalker', 10, 'Slay Vale Sabre Cats or Vale Deer in the Forgotten Vale.', /sabre.?cat|vale deer/i, (_event, _text, context) => /forgotten vale|vale/i.test(context));
  killRule('Vampire Slayer', 25, 'Slay Vampires.', ['vampire'], /vampire/i, ['vampires']);
  killRule("Vampire's Nightmare", 300, 'Slay Vampires.', ['vampire'], /vampire/i, ['vampires']);
  killRule('Void Banisher', 25, 'Slay Dremora.', ['dremora'], /dremora/i);
  killRule('Warlock Hunter', 25, 'Slay Warlocks.', ['roguewarlock'], /warlock|rogue/i);
  killRule('Werewolf Bane', 25, 'Slay Werewolves or Werebears.', ['werewolf'], /werewolf|werebear/i);
  killRule('Wisp Whisperer', 10, 'Slay Wispmothers.', ['wispmother'], /wisp.?mother/i);
  killRule('Wolf Hunter', 100, 'Slay Wolves.', ['wolf'], /wolf/i, ['wolves']);

  // Quests, crafting, player skills, discoveries, and inventory milestones.
  questRule("All-Maker's Chosen", ['Cleansing the Stones']);
  add("Apothecary's Shelf", 500, 'Collect 500 alchemy ingredients or craft 100 potions.', ['items', 'history'], (ctx) => Math.max(
    itemQuantity(ctx, (item) => /ingredient/i.test(item.category || '')),
    ctx.events.filter((event) => Number(event.eventType) === 40).length >= 100 ? 500 : ctx.events.filter((event) => Number(event.eventType) === 40).length * 5
  ), 'Potion-crafting progress is read from retained SkyRewrite craft events; ingredient quantity is cumulative in SkyCollection.');
  const blackBooks = ['Waking Dreams', 'The Winds of Change', 'The Sallow Regent', 'The Hidden Twilight', 'Untold Legends', 'The Blood Skaal', 'Epistolary Acumen'];
  add('Black Book Scholar', 7, 'Find and read all seven Black Books.', ['history'], (ctx) => new Set(ctx.events.filter((event) => Number(event.eventType) === 34 || event.kind === 'read').map((event) => normalize(`${event.subject || ''} ${event.identity || ''}`)).filter((text) => blackBooks.some((book) => text.includes(normalize(book)))).map((text) => blackBooks.find((book) => text.includes(normalize(book))))).size, 'Books already read before SkyRewrite recorded book reads may not appear in history.');
  add('Brawl Champion', 10, 'Win ten tavern brawls.', ['history'], (ctx) => historyEventCount(ctx, (event) => {
    const isBrawlOutcome = event?.kind === 'brawl' || Number(event?.eventType) === 45;
    return isBrawlOutcome && (Number(event.stage) === 1 || String(event.identity || '') === 'SkyRewrite/Brawl/v1/won');
  }), 'Wins are counted from SkyRewrite brawl outcome records; losses do not count.');
  locationRule('Cartographer of Skyrim', 100, 'Discover 100 locations across Skyrim.');
  add('Cataloger Of Tamriel', 500, 'Discover 500 Rare items or books, or 200 locations.', ['items', 'locations'], (ctx) => Math.max(rarityCount('Rare')(ctx), ctx.locations.length >= 200 ? 500 : 0));
  itemRule("Collector's Pinnacle", 300, 'Discover 300 Legendary Legacy of the Dragonborn items.', (ctx) => rarityCount('Legendary', (item) => /legacy.?of.?the.?dragonborn/i.test(`${item.plugin || ''} ${item.category || ''}`))(ctx));
  itemRule('Crimson Collector', 30, 'Collect Crimson Nirnroots in Blackreach.', (ctx) => itemQuantity(ctx, (item) => /crimson nirnroot/i.test(item.name || '')));
  itemRule('Curio Seeker', 200, 'Discover 200 Epic items.', rarityCount('Epic'));
  add('Cutpurse Supreme', 50, 'Successfully pickpocket 50 items or steal 10,000 Gold from NPCs.', ['history'], (ctx) => Math.max(
    ctx.events.filter((event) => event?.isTheft === true && event.theftSourceKind === 'pickpocket').reduce((sum, event) => sum + Math.max(1, Math.abs(Number(event.stage) || 0)), 0),
    Number(ctx.reputation.goldStolen) >= 10000 ? 50 : 0
  ), 'The pickpocket count uses recorded theft events; the gold alternative uses SkyRewrite’s cumulative stolen-septim counter.');
  const daedricQuests = ['The Black Star', "Boethiah's Calling", "A Daedra's Best Friend", 'Discerning the Transmundane', 'Ill Met by Moonlight', 'The Cursed Tribe', 'Pieces of the Past', 'The Whispering Door', 'The Break of Dawn', 'The House of Horrors', 'The Taste of Death', 'The Only Cure', 'A Night to Remember', 'The Mind of Madness', 'Waking Nightmare'];
  add('Daedric Champion', 15, 'Complete all 15 listed Daedric quests.', ['history'], (ctx) => daedricQuests.filter((quest) => completedQuest(quest)(ctx)).length);
  add('Dragon Soul Reaper', 100, 'Absorb 100 Dragon Souls (one recorded dragon kill counts as one soul, as requested).', ['history'], (ctx) => highest(stateCount(ctx, ['dragon']), Number(ctx.reputation.dragons), deathEvents(ctx, /\bdragon\b/i)));
  add('Dragonbone Smith', 2, 'Reach Smithing 100 and craft Dragonbone armor or a weapon.', ['history'], (ctx) => {
    const skillEvents = ctx.events.filter((event) => Number(event.eventType) === 32 && /smithing/i.test(`${event.subject || ''} ${event.detail || ''}`));
    let skill = 0;
    for (const event of skillEvents) {
      const match = `${event.detail || ''} ${event.subject || ''}`.match(/current\s+skill\s+level\s+(\d+(?:\.\d+)?)/i);
      if (match) skill = Math.max(skill, Number(match[1]) || 0);
    }
    const crafted = ctx.events.some((event) => Number(event.eventType) === 38 && /dragonbone/i.test(`${event.subject || ''} ${event.identity || ''}`));
    return (skill >= 100 ? 1 : 0) + (crafted ? 1 : 0);
  }, 'Smithing skill and crafted equipment are checked from SkyRewrite history retained in the save.');
  itemRule('Epic Find', 250, 'Discover 250 Epic items.', rarityCount('Epic'));
  add('Golden Touch', 100000, 'Have 100,000 Gold in your inventory at once.', ['history'], highestCarriedGold,
    'Progress uses the current carried balance and the highest recorded balance in SkyRewrite history.');
  itemRule("Hoarder's Paradise", 1000, 'Discover 1,000 distinct items.', (ctx) => itemRecords(ctx).length);
  itemRule('Junk Collector', 100, 'Collect miscellaneous clutter such as baskets, buckets, and tankards.', nameCount(/basket|bucket|tankard|plate|cup|goblet|jug|pitcher|wooden bowl|wooden ladle|pot|pan|broom|fork|knife|spoon|candlestick|candle|cheese wheel|sack|barrel|crate|urn|bottle|flagon|mug|tongs|potato sack/i));
  add('Legend Of The Hoard', 1000000, 'Have 1,000,000 Gold in your inventory at once.', ['history'], highestCarriedGold,
    'Progress uses the current carried balance and the highest recorded balance in SkyRewrite history.');
  add('Legend of the North', 50, 'Reach character level 50.', ['player'], (ctx) => Number(ctx.player.level) || 0);
  itemRule('Mask Hunter', 8, 'Collect all eight Dragon Priest Masks.', (ctx) => itemRecords(ctx).filter((item) => /dragon masks?/i.test(item.category || '') || /mask/i.test(item.name || '') && /dragon|priest/i.test(item.name || '')).length);
  locationRule('Master Explorer', 300, 'Discover 300 locations across Skyrim and Solstheim.');
  add('Master Lockpicker', 50, 'Successfully pick 50 locks.', ['history'], (ctx) => historyEventCount(ctx, (event) => Number(event.eventType) === 21 || event.kind === 'lockpick'), 'Lockpick progress is counted from retained SkyRewrite history.');
  questRule('Master Thief', ['Under New Management']);
  questRule("Master's Best Friend", ["A Daedra's Best Friend"]);
  add('Menace to Society', 100, 'Slay non-hostile NPCs.', ['history'], (ctx) => historyEventCount(ctx, (event) => event?.kind === 'death' && event?.detail === 'Player killed this actor' && event.victimHostile === false && event.victimMonster !== true), 'Non-hostile NPC deaths are counted from retained SkyRewrite history; unclassified deaths are not guessed.');
  itemRule('Museum Curator', 500, 'Discover 500 Rare items.', rarityCount('Rare'));
  itemRule('Mythic Crusader', 800, 'Discover 800 Common items.', rarityCount('Common'));
  itemRule('Mythic Discovery', 800, 'Discover 800 Legendary items.', rarityCount('Legendary'));
  itemRule('Relic Hunter', 200, 'Discover 200 Uncommon items.', rarityCount('Uncommon'));
  add('Shout Unleashed', 50, 'Learn 50 Dragon Shouts.', ['history'], (ctx) => new Set(ctx.events.filter((event) => Number(event.eventType) === 27 || event.kind === 'shout').map((event) => `${event.formID || ''}|${normalize(event.subject || event.identity)}`)).size, 'Shouts learned are counted from SkyRewrite history retained in the save.');
  add('Silver-Tongued', 25, 'Pass Persuade or Intimidate checks.', ['history'], (ctx) => historyEventCount(ctx, (event) => Number(event.eventType) === 23 && /persuad|intimidat/i.test(`${event.subject || ''} ${event.detail || ''} ${event.identity || ''}`)), 'Persuade and Intimidate checks are counted from retained SkyRewrite interaction history.');
  add('Stalhrim Smith', 1, 'Craft a piece of Stalhrim equipment.', ['history'], (ctx) => ctx.events.some((event) => Number(event.eventType) === 38 && /stalhrim/i.test(`${event.subject || ''} ${event.identity || ''}`)) ? 1 : 0, 'Crafting is counted from SkyRewrite history retained in the save.');
  add('Way of the Voice', 100, 'Learn 100 Shouts.', ['history'], (ctx) => new Set(ctx.events.filter((event) => Number(event.eventType) === 27 || event.kind === 'shout').map((event) => `${event.formID || ''}|${normalize(event.subject || event.identity)}`)).size, 'Shouts learned are counted from SkyRewrite history retained in the save.');

  function buildContext(input) {
    const history = input.history && typeof input.history === 'object' ? input.history : {};
    const events = Array.isArray(history.events) ? history.events : [];
    const quests = new Set();
    for (const quest of Array.isArray(history.completedQuests) ? history.completedQuests : []) {
      const value = normalize(`${quest?.name || ''} ${quest?.formID || ''}`);
      if (value) quests.add(value);
    }
    for (const event of events) {
      if (event?.questCompleted === true || Number(event?.eventType) === 19) {
        const value = normalize(`${event.subject || ''} ${event.identity || ''}`);
        if (value) quests.add(value);
      }
    }
    return {
      history, events, quests,
      reputation: history.reputation && typeof history.reputation === 'object' ? history.reputation : {},
      creatureStates: Array.isArray(history.regionalCreatureStates) ? history.regionalCreatureStates : [],
      items: Array.isArray(input.items) ? input.items : [],
      locations: Array.isArray(input.locations) ? input.locations : [],
      player: input.player && typeof input.player === 'object' ? input.player : {},
      factions: Array.isArray(input.player?.factions) ? input.player.factions : []
    };
  }

  function evaluate(input) {
    const ctx = buildContext(input || {});
    const priorProgress = input?.storedProgress && typeof input.storedProgress === 'object' ? input.storedProgress : {};
    const priorUnlocked = new Set(Array.isArray(input?.storedUnlocked) ? input.storedUnlocked.map(keyOf) : []);
    const progress = { ...priorProgress };
    const unlocked = new Set(priorUnlocked);
    const results = new Map();
    for (const achievement of Array.isArray(input?.achievements) ? input.achievements : []) {
      const key = keyOf(achievement?.name);
      const rule = rules.get(key);
      if (!rule) {
        results.set(key, { name: achievement?.name || 'Unknown achievement', target: 1, progress: 0, unlocked: unlocked.has(key), description: '', status: 'Requirement is not mapped yet.' });
        continue;
      }
      const missing = rule.sources.filter((source) => source === 'history' ? input.historyLoaded !== true
        : source === 'items' ? input.itemsLoaded !== true
          : source === 'locations' ? input.locationsLoaded !== true
            : source === 'player' ? input.playerLoaded !== true : false);
      const stored = Math.max(0, Number(progress[key]) || 0);
      let current = stored;
      let status = rule.note;
      if (rule.sources.length === 0) {
        status = rule.note;
      } else if (missing.length) {
        status = `Waiting for ${missing.join(' and ')} data.`;
      } else {
        try { current = Math.max(stored, Math.min(rule.target, Math.max(0, Number(rule.measure(ctx)) || 0))); }
        catch (_) { current = stored; status = 'Progress could not be read from the available save data.'; }
        if (current > stored) progress[key] = current;
        if (current >= rule.target) unlocked.add(key);
        if (!status) status = `${current.toLocaleString()} / ${rule.target.toLocaleString()}`;
        else status = `${current.toLocaleString()} / ${rule.target.toLocaleString()} · ${status}`;
      }
      const isUnlocked = unlocked.has(key);
      results.set(key, { name: achievement?.name || rule.name, target: rule.target, progress: Math.max(current, isUnlocked ? rule.target : 0), unlocked: isUnlocked, description: rule.description, status: isUnlocked ? 'Unlocked' : status });
    }
    return { results, progress, unlocked: [...unlocked] };
  }

  window.SkyAchievementsRuleEngine = Object.freeze({ evaluate, normalize, ruleCount: rules.size });
})();
