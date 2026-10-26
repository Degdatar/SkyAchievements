(() => {
  const filters = {
    'achievement-quest-plugin': 'all',
    'achievement-location-plugin': 'all',
    'achievement-item-plugin': 'all',
    'achievement-item-rarity': 'all',
    'achievement-marital-status': 'Single'
  };
  let data = { player: {}, history: {}, items: [], locations: [], assets: { playerCard: null, nameCards: [], achievements: [], properties: [] }, playerLoaded: false, historyLoaded: false, itemsLoaded: false, locationsLoaded: false, assetsLoaded: false };
  let activeTab = 'achievements';
  const recordPageSizes = { locations: 50, items: 50 };
  const settingsPrefix = 'skyachievements.dashboard.v1';
  let settingsKey = `${settingsPrefix}:pending`;
  const readSettings = (key) => {
    const defaults = { nameCard: '', defaultNameCardApplied: false, title: '', mainFaction: '', properties: [], mainProperty: '', maritalStatus: 'Single', spouse: '', missionState: null, achievementProgress: {}, unlockedAchievements: [] };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      return { ...defaults, ...saved, properties: Array.isArray(saved.properties) ? saved.properties : [], achievementProgress: saved.achievementProgress && typeof saved.achievementProgress === 'object' ? saved.achievementProgress : {}, unlockedAchievements: Array.isArray(saved.unlockedAchievements) ? saved.unlockedAchievements : [] };
    } catch (_) { return defaults; }
  };
  let profileSettings = readSettings(settingsKey);
  let achievementCarouselOffset = 0;
  let nameCardListOffset = 0;
  let scheduledRenderTimer = 0;
  let renderScheduleCount = 0;
  const byId = (id) => document.getElementById(id);
  let missionToastTimer = 0;
  const processedSkyAchievementsUpdateIds = new Set();
  const latestSkyAchievementsUpdateIds = new Map();
  let expectedHistoryChunkCount = 0;
  let receivedHistoryChunkCount = 0;
  let achievementDataRevision = 0;
  let achievementEvaluationCache = { revision: -1, settingsKey: '', results: new Map(), unlocked: [] };
  let achievementNotificationProfileKey = settingsKey;
  let achievementNotificationBaselineReady = false;
  let lastObservedAchievementUnlocks = new Set();
  let achievementDetailOpener = null;
  function reportSkyAchievementsDiagnostic(message) {
    window.parent.postMessage({ channel: 'skyachievements', type: 'diagnostic', payload: { message: String(message || '').slice(0, 180) } }, '*');
  }
  function acknowledgeSkyAchievementsUpdate(id, kind, ok, detail = '') {
    const started = performance.now();
    window.parent.postMessage({ channel: 'skyachievements', type: 'update-ack', payload: { id, kind, ok, detail: String(detail || '').slice(0, 100) } }, '*');
    reportSkyAchievementsDiagnostic(`TRACE ack post returned id=${id} kind=${kind} ok=${ok} elapsedMs=${Math.round(performance.now() - started)}`);
  }
  function deferSkyAchievementsMissionProcessing(kind, process) {
    window.setTimeout(() => {
      const started = performance.now();
      reportSkyAchievementsDiagnostic(`${kind} mission processing started`);
      try {
        Promise.resolve(process()).then(() => {
          scheduleSkyAchievementsRender(`${kind} mission processing`);
          reportSkyAchievementsDiagnostic(`${kind} mission processing completed; elapsedMs=${Math.round(performance.now() - started)}`);
        }).catch((error) => {
          const detail = String(error?.message || error || 'unknown processing error').replace(/[\r\n\t]/g, ' ').slice(0, 100);
          reportSkyAchievementsDiagnostic(`${kind} mission processing failed: ${detail}`);
        });
      } catch (error) {
        const detail = String(error?.message || error || 'unknown processing error').replace(/[\r\n\t]/g, ' ').slice(0, 100);
        reportSkyAchievementsDiagnostic(`${kind} mission processing failed: ${detail}`);
      }
    }, 0);
  }
  window.addEventListener('error', (event) => {
    reportSkyAchievementsDiagnostic(`uncaught JS error: ${event.message || 'unknown'} at ${event.filename || 'inline'}:${event.lineno || 0}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason || 'unknown rejection';
    reportSkyAchievementsDiagnostic(`unhandled promise rejection: ${String(reason).slice(0, 120)}`);
  });
  reportSkyAchievementsDiagnostic('app.js started');

  // PrismaUI's embedded page receives smaller wheel deltas than the desktop browser.
  // Scale only wheel scrolling that can move a scrollable container in that direction.
  document.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.defaultPrevented || event.deltaY === 0) return;
    const direction = Math.sign(event.deltaY);
    let element = event.target instanceof Element ? event.target : event.target?.parentElement;
    while (element && element !== document.body && element !== document.documentElement) {
      const overflowY = window.getComputedStyle(element).overflowY;
      const isScrollable = /^(auto|scroll|overlay)$/.test(overflowY) && element.scrollHeight > element.clientHeight;
      const canMove = direction < 0
        ? element.scrollTop > 0
        : element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      if (isScrollable && canMove) {
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 18
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientHeight : 1;
        event.preventDefault();
        element.scrollTop += event.deltaY * unit * 2.25;
        return;
      }
      element = element.parentElement;
    }
    const pageScroller = document.scrollingElement;
    if (pageScroller) {
      const canMove = direction < 0
        ? pageScroller.scrollTop > 0
        : pageScroller.scrollTop + pageScroller.clientHeight < pageScroller.scrollHeight - 1;
      if (canMove) {
        const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 18
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pageScroller.clientHeight : 1;
        event.preventDefault();
        pageScroller.scrollTop += event.deltaY * unit * 2.25;
      }
    }
  }, { capture: true, passive: false });

  function scheduleSkyAchievementsRender(reason) {
    renderScheduleCount++;
    if (scheduledRenderTimer) return;
    scheduledRenderTimer = window.setTimeout(() => {
      scheduledRenderTimer = 0;
      const started = performance.now();
      reportSkyAchievementsDiagnostic(`TRACE render started tab=${activeTab} reason=${reason}`);
      try { renderSkyAchievements(); }
      catch (error) {
        const detail = String(error?.message || error || 'unknown render error').replace(/[\r\n\t]/g, ' ').slice(0, 100);
        reportSkyAchievementsDiagnostic(`TRACE render failed tab=${activeTab}: ${detail}`);
        renderScheduleCount = 0;
        return;
      }
      const elapsed = Math.round(performance.now() - started);
      reportSkyAchievementsDiagnostic(`render complete: tab=${activeTab}, elapsedMs=${elapsed}, batchedUpdates=${renderScheduleCount}, reason=${reason}`);
      renderScheduleCount = 0;
    }, 30);
  }

  function missionState() {
    if (!profileSettings.missionState || typeof profileSettings.missionState !== 'object') {
      profileSettings.missionState = { completed: 0, points: 0, offers: [], seenEventKeys: [], baselineReady: false, unlockedCards: [] };
    }
    const state = profileSettings.missionState;
    state.completed = Math.max(0, Math.floor(Number(state.completed) || 0));
    state.points = Math.max(0, Math.floor(Number(state.points) || 0));
    state.offers = Array.isArray(state.offers) ? state.offers.slice(0, 3) : [];
    state.seenEventKeys = Array.isArray(state.seenEventKeys) ? state.seenEventKeys.slice(0, 512) : [];
    state.unlockedCards = Array.isArray(state.unlockedCards) ? state.unlockedCards : [];
    state.baselineReady = Boolean(state.baselineReady);
    return state;
  }

  const missionKinds = [
    { kind: 'skeletons', label: 'Skeletons', action: 'Defeat', min: 3, max: 9 },
    { kind: 'dragons', label: 'Dragons', action: 'Defeat', min: 1, max: 3 },
    { kind: 'hostile-npcs', label: 'hostile NPCs', action: 'Defeat', min: 3, max: 12 },
    { kind: 'hostile-monsters', label: 'hostile monsters', action: 'Defeat', min: 3, max: 12 },
    { kind: 'hostiles', label: 'hostile enemies', action: 'Defeat', min: 4, max: 15 },
    { kind: 'ingredients', label: 'ingredients', action: 'Collect', min: 3, max: 12 },
    { kind: 'pelts', label: 'monster pelts or hides', action: 'Collect', min: 2, max: 8 }
  ];
  const missionNameParts = [
    ['Ashen', 'Frostbound', 'Silent', 'Hunter', 'Wandering', 'Forgotten', 'Dawnguard', 'Whiterun'],
    ['Purge', 'Hunt', 'Gathering', 'Forage', 'Extermination', 'Proving', 'Trail', 'Reckoning']
  ];

  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function createMission() {
    const kind = missionKinds[randomInt(0, missionKinds.length - 1)];
    const goal = randomInt(kind.min, kind.max);
    const reward = Math.min(100, Math.max(5, Math.round(goal * randomInt(2, 7))));
    return {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      kind: kind.kind, goal, progress: 0, reward, accepted: false,
      title: missionNameParts[0][randomInt(0, missionNameParts[0].length - 1)] + ' ' + missionNameParts[1][randomInt(0, missionNameParts[1].length - 1)],
      description: kind.action + ' ' + goal + ' ' + kind.label + '.'
    };
  }

  function ensureMissionOffers() {
    const state = missionState();
    const validKinds = new Set(missionKinds.map((kind) => kind.kind));
    state.offers = state.offers.map((mission) => validKinds.has(mission?.kind) ? mission : createMission());
    while (state.offers.length < 3) state.offers.push(createMission());
    if (state.offers.length > 3) state.offers = state.offers.slice(0, 3);
    return state;
  }

  function showMissionToast(title, message) {
    let toast = byId('achievement-mission-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'achievement-mission-toast';
      toast.setAttribute('role', 'status');
      toast.hidden = true;
      toast.innerHTML = '<strong></strong><span></span>';
      document.body.appendChild(toast);
    }
    toast.querySelector('strong').textContent = title;
    toast.querySelector('span').textContent = message;
    toast.hidden = false;
    window.clearTimeout(missionToastTimer);
    missionToastTimer = window.setTimeout(() => { toast.hidden = true; }, 5200);
  }

  function reputationRank(scoreValue) {
    const score = Math.trunc(Number(scoreValue) || 0);
    if (score < 0) {
      if (score >= -50) return 'Unwelcome';
      if (score >= -150) return 'Shunned';
      if (score >= -200) return 'Hunted';
      if (score >= -350) return 'Outlaw';
      return 'Public Enemy';
    }
    if (score <= 50) return 'Nameless Wanderer';
    if (score <= 100) return 'Rumored Blade';
    if (score <= 150) return 'Hold-Known';
    if (score <= 200) return 'Songforged';
    if (score <= 250) return 'Shield of the Holds';
    if (score <= 300) return 'Dragonsworn Hero';
    if (score <= 350) return 'Oathkeeper of Ysgramor';
    if (score <= 400) return 'Voice of the North';
    if (score <= 450) return 'Saga-Born';
    if (score <= 500) return 'Pride of Skyrim';
    if (score <= 999) return 'Saga of the Living';
    return 'Eternal Song of Sovngarde';
  }

  function cardMissionCost(index) {
    return 500 + Math.round(((index - 10) / 13) * 9500);
  }

  function isDefaultNameCard(card) {
    return String(card?.name || '').trim().toLocaleLowerCase() === 'default name card';
  }

  function nameCardUnlockIndex(card, index, cards = data.assets?.nameCards || []) {
    if (isDefaultNameCard(card)) return -1;
    let unlockIndex = -1;
    for (let current = 0; current <= index; current++) {
      if (!isDefaultNameCard(cards[current])) unlockIndex++;
    }
    return unlockIndex;
  }

  function isNameCardUnlocked(card, index) {
    const state = missionState();
    if (isDefaultNameCard(card)) return true;
    if (state.unlockedCards.includes(card.url)) return true;
    const unlockIndex = nameCardUnlockIndex(card, index);
    return unlockIndex < 10 && state.completed >= (unlockIndex + 1) * 10;
  }

  function unlockNameCard(card, index) {
    const state = missionState();
    if (isNameCardUnlocked(card, index)) return true;
    const unlockIndex = nameCardUnlockIndex(card, index);
    if (unlockIndex < 10) {
      const required = (unlockIndex + 1) * 10;
      showMissionToast('Name Card Locked', `Complete ${required} missions to unlock ${card.name}.`);
      return false;
    }
    const cost = cardMissionCost(unlockIndex);
    if (state.points < cost) {
      showMissionToast('Not Enough SkyPoints', `${card.name} costs ${cost.toLocaleString()} SkyPoints; you have ${state.points.toLocaleString()} SkyPoints.`);
      return false;
    }
    state.points -= cost;
    state.unlockedCards.push(card.url);
    saveProfileSettings();
    showMissionToast('Name Card Unlocked', `${card.name} is now available to use.`);
    return true;
  }


  function historyEventKey(event) {
    return [event?.day, event?.eventType, event?.formID, event?.baseFormID, event?.stage,
      event?.kind, event?.identity, event?.subject, event?.detail, event?.location].map((value) => String(value ?? '')).join('|');
  }

  function missionEventAmount(mission, event) {
    if (!event || event.isTheft || event.kind === 'theft') return 0;
    if (event.kind === 'death' && event.detail === 'Player killed this actor' && event.victimHostile === true) {
      const name = String(event.subject || '') + ' ' + String(event.identity || '');
      if (mission.kind === 'skeletons') return /skeleton/i.test(name) ? 1 : 0;
      if (mission.kind === 'dragons') return event.victimDragon === true || /dragon(?! ?priest)/i.test(name) ? 1 : 0;
      if (mission.kind === 'hostile-npcs') return event.victimMonster !== true && event.victimDragon !== true ? 1 : 0;
      if (mission.kind === 'hostile-monsters') return event.victimMonster === true || event.victimDragon === true ? 1 : 0;
      if (mission.kind === 'hostiles') return 1;
    }
    if (event.kind !== 'inventory' || Number(event.eventType) !== 4) return 0;
    const identity = String(event.identity || '');
    if (!/picked-up|looted-body|looted-container/.test(identity)) return 0;
    const itemName = String(event.subject || '');
    const category = String(event.itemCategory || '').toLowerCase();
    if (mission.kind === 'ingredients' && (category === 'ingredient' || /ingredient/i.test(itemName))) return Math.max(1, Number(event.stage) || 1);
    if (mission.kind === 'pelts' && (category === 'pelthide' || /pelt|hide/i.test(itemName))) return Math.max(1, Number(event.stage) || 1);
    return 0;
  }

  function processMissionHistory(events) {
    const state = ensureMissionOffers();
    const visibleEvents = Array.isArray(events) ? events.slice(0, 2048) : [];
    const keys = visibleEvents.map(historyEventKey);
    if (!state.baselineReady) {
      state.seenEventKeys = keys.slice(0, 512);
      state.baselineReady = true;
      saveProfileSettings();
      return;
    }

    const previouslySeen = new Set(state.seenEventKeys);
    const newEvents = [];
    for (const event of visibleEvents) {
      if (previouslySeen.has(historyEventKey(event))) break;
      newEvents.push(event);
    }

    let changed = false;
    for (const event of newEvents.reverse()) {
      for (let slot = 0; slot < state.offers.length; slot++) {
        const mission = state.offers[slot];
        if (!mission?.accepted) continue;
        const amount = missionEventAmount(mission, event);
        if (amount <= 0) continue;
        mission.progress = Math.min(mission.goal, (Number(mission.progress) || 0) + amount);
        changed = true;
        if (mission.progress >= mission.goal) {
          state.completed++;
          state.points += mission.reward;
          state.offers[slot] = createMission();
          window.parent.postMessage({
            channel: 'skyachievements',
            type: 'mission-completed',
            payload: { title: mission.title, reward: mission.reward }
          }, '*');
        }
      }
    }
    state.seenEventKeys = [...keys, ...state.seenEventKeys.filter((key) => !keys.includes(key))].slice(0, 512);
    if (changed || newEvents.length) saveProfileSettings();
  }

  function renderMissions() {
    const state = ensureMissionOffers();
    const host = byId('achievement-missions');
    const completed = byId('achievement-mission-completed');
    const points = byId('achievement-mission-points');
    if (completed) completed.textContent = state.completed.toLocaleString();
    if (points) points.textContent = state.points.toLocaleString();
    const completeBasic = byId('achievement-basic-missions');
    if (completeBasic) completeBasic.textContent = state.completed.toLocaleString();
    if (!host) return;
    host.replaceChildren();
    state.offers.forEach((mission, index) => {
      const card = document.createElement('article');
      card.className = `achievement-mission-card${mission.accepted ? ' accepted' : ''}`;
      const title = document.createElement('h3'); title.textContent = mission.title;
      const description = document.createElement('p'); description.textContent = mission.description;
      const bar = document.createElement('div'); bar.className = 'achievement-mission-progress'; bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(mission.goal)); bar.setAttribute('aria-valuenow', String(mission.progress));
      const fill = document.createElement('span'); fill.style.width = `${Math.min(100, (mission.progress / mission.goal) * 100)}%`; bar.appendChild(fill);
      const meta = document.createElement('div'); meta.className = 'achievement-mission-meta';
      const progress = document.createElement('span'); progress.textContent = `${mission.progress} / ${mission.goal}`;
      const reward = document.createElement('span'); reward.textContent = `${mission.reward} SkyPoints`;
      meta.append(progress, reward);
      const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = mission.accepted ? 'In Progress' : 'Accept Mission'; accept.disabled = mission.accepted;
      accept.addEventListener('click', () => {
        const current = missionState().offers[index]; if (!current || current.accepted) return;
        current.accepted = true;
        saveProfileSettings(); renderMissions();
      });
      card.append(title, description, bar, meta, accept);
      host.appendChild(card);
    });
  }


  const knownFactions = [
    { id: 'companions', name: 'The Companions', match: /companions|companionsfaction/i, jobs: ['Companion', 'Shield-Brother / Shield-Sister', 'Circle Member', 'Harbinger'] },
    { id: 'thieves-guild', name: 'Thieves Guild', match: /thieves.?guild|tg.*faction/i, jobs: ['Guild Member', 'Thief', 'Guild Member', 'Guild Master'] },
    { id: 'college-winterhold', name: 'College of Winterhold', match: /college.?of.?winterhold|winterhold.?college|mgcollegefaction/i, jobs: ['Apprentice', 'Mage', 'Senior Mage', 'Arch-Mage'] },
    { id: 'dark-brotherhood', name: 'Dark Brotherhood', match: /dark.?brotherhood|db.*faction/i, jobs: ['Initiate', 'Assassin', 'Assassin', 'Listener'] },
    { id: 'imperial-legion', name: 'Imperial Legion', match: /imperial.?legion|imperialarmy|imperialfaction/i, jobs: ['Legion Recruit', 'Legionnaire', 'Quaestor', 'Legate'] },
    { id: 'stormcloaks', name: 'Stormcloaks', match: /stormcloak/i, jobs: ['Stormcloak Recruit', 'Stormcloak Soldier', 'Stormcloak Officer', 'Stormcloak Commander'] },
    { id: 'dawnguard', name: 'Dawnguard', match: /dawnguard/i, jobs: ['Dawnguard Recruit', 'Dawnguard', 'Dawnguard Veteran', 'Dawnguard Leader'] },
    { id: 'volkihar', name: 'Volkihar Vampire Clan', match: /volkihar|vampire.?clan|vampirepcfaction/i, jobs: ['Volkihar Vampire', 'Vampire', 'Volkihar Vampire', 'Vampire Lord'] },
    { id: 'bards-college', name: 'Bards College', match: /bards.?college|bardcollegefaction/i, jobs: ['Bard Student', 'Bard', 'Bard', 'Bard'] },
    { id: 'blades', name: 'The Blades', match: /bladesfaction|the.?blades/i, jobs: ['Blade Recruit', 'Blade', 'Blade', 'Blade'] }
  ];
  const playerNameColors = new Set([
    '#F4D28D', '#FFD700', '#FFF2CC', '#FFFFFF', '#C7D2E0', '#A8E6FF', '#66CCFF', '#4169E1',
    '#00B8D9', '#00FFFF', '#00FF7F', '#39FF14', '#BFFF00', '#FFFF00', '#FFB000', '#FF6A00',
    '#E63946', '#FF1744', '#FF4D8D', '#FF10F0', '#9B59FF', '#BC13FE', '#D7B8FF', '#7CFFFA'
  ]);
  const playerNameFonts = {
    cinzel: 'Cinzel, "Palatino Linotype", Georgia, serif',
    georgia: 'Georgia, serif',
    palatino: '"Palatino Linotype", "Book Antiqua", serif',
    times: '"Times New Roman", serif',
    cambria: 'Cambria, Georgia, serif',
    garamond: 'Garamond, "Times New Roman", serif',
    papyrus: 'Papyrus, fantasy',
    trebuchet: '"Trebuchet MS", sans-serif',
    segoe: '"Segoe UI", sans-serif',
    candara: 'Candara, sans-serif',
    copperplate: '"Copperplate Gothic Light", Copperplate, fantasy',
    impact: 'Impact, sans-serif'
  };

  function saveProfileSettings() {
    try { localStorage.setItem(settingsKey, JSON.stringify(profileSettings)); } catch (_) { /* keep this session usable if storage is unavailable */ }
  }

  function useCharacterSettings(name) {
    const owner = String(name || 'Unknown adventurer').trim().toLocaleLowerCase() || 'unknown-adventurer';
    const key = `${settingsPrefix}:${encodeURIComponent(owner)}`;
    if (key === settingsKey) return;
    settingsKey = key;
    profileSettings = readSettings(settingsKey);
    achievementNotificationProfileKey = key;
    achievementNotificationBaselineReady = false;
    lastObservedAchievementUnlocks = new Set();
    achievementEvaluationCache = { revision: -1, settingsKey: '', results: new Map(), unlocked: [] };
  }

  function evaluateAchievements(achievements) {
    if (!window.SkyAchievementsRuleEngine || !data.assetsLoaded) return achievementEvaluationCache;
    if (achievementEvaluationCache.revision === achievementDataRevision && achievementEvaluationCache.settingsKey === settingsKey) return achievementEvaluationCache;
    const evaluated = window.SkyAchievementsRuleEngine.evaluate({
      achievements,
      player: data.player,
      history: data.history,
      items: data.items,
      locations: data.locations,
      playerLoaded: data.playerLoaded,
      historyLoaded: data.historyLoaded,
      itemsLoaded: data.itemsLoaded,
      locationsLoaded: data.locationsLoaded,
      storedProgress: profileSettings.achievementProgress,
      storedUnlocked: profileSettings.unlockedAchievements
    });
    const currentUnlocked = new Set(evaluated.unlocked.map(achievementKey));
    profileSettings.achievementProgress = evaluated.progress;
    profileSettings.unlockedAchievements = evaluated.unlocked;
    achievementEvaluationCache = {
      revision: achievementDataRevision,
      settingsKey,
      results: evaluated.results,
      unlocked: achievements.filter((achievement) => evaluated.results.get(achievementKey(achievement.name))?.unlocked)
    };
    const notificationDataReady = data.playerLoaded && data.assetsLoaded && data.historyLoaded && data.itemsLoaded && data.locationsLoaded;
    if (achievementNotificationProfileKey !== settingsKey) {
      achievementNotificationProfileKey = settingsKey;
      achievementNotificationBaselineReady = false;
      lastObservedAchievementUnlocks = new Set();
    }
    if (notificationDataReady && !achievementNotificationBaselineReady) {
      lastObservedAchievementUnlocks = currentUnlocked;
      achievementNotificationBaselineReady = true;
      reportSkyAchievementsDiagnostic(`achievement notification baseline ready: unlocked=${currentUnlocked.size}`);
    } else if (notificationDataReady && achievementNotificationBaselineReady) {
      for (const achievement of achievements) {
        const key = achievementKey(achievement.name);
        if (!currentUnlocked.has(key) || lastObservedAchievementUnlocks.has(key)) continue;
        const result = evaluated.results.get(key) || {};
        window.parent.postMessage({
          channel: 'skyachievements',
          type: 'achievement-unlocked',
          payload: {
            name: String(achievement.name || '').slice(0, 160),
            requirements: String(result.description || 'Achievement requirement completed.').replace(/[\r\n\t]/g, ' ').slice(0, 400),
            iconUrl: String(achievement.url || '').slice(0, 2048)
          }
        }, '*');
        reportSkyAchievementsDiagnostic(`achievement unlock notice requested: ${String(achievement.name || '').slice(0, 100)}`);
      }
      lastObservedAchievementUnlocks = currentUnlocked;
    }
    return achievementEvaluationCache;
  }

  function achievementKey(name) {
    return window.SkyAchievementsRuleEngine?.normalize(name).replace(/\s/g, '') || String(name || '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function createImage(url, alt = '') {
    const image = document.createElement('img');
    image.src = url;
    image.alt = alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    return image;
  }

  function followerCount(events) {
    const states = new Map();
    for (const event of [...events].reverse()) {
      if (event?.kind !== 'follower') continue;
      const id = Number(event.formID || event.baseFormID) || event.identity || event.subject;
      if (event.eventType === 36) states.set(id, true);
      else if (event.eventType === 37) states.set(id, false);
    }
    return [...states.values()].filter(Boolean).length;
  }

  function renderDashboard() {
    const player = data.player || {};
    useCharacterSettings(player.name);
    filters['achievement-marital-status'] = profileSettings.maritalStatus === 'Married' ? 'Married' : 'Single';
    const history = data.history || {};
    const reputation = history.reputation || {};
    const assets = data.assets || {};
    const nameCards = Array.isArray(assets.nameCards) ? assets.nameCards : [];
    const achievements = Array.isArray(assets.achievements) ? assets.achievements : [];
    const achievementEvaluation = evaluateAchievements(achievements);
    const unlockedAchievements = achievementEvaluation.unlocked;
    const lockedAchievements = achievements.filter((achievement) => !achievementEvaluation.results.get(achievementKey(achievement.name))?.unlocked);
    const vanillaHomes = Array.isArray(assets.properties) ? assets.properties : [];
    const events = Array.isArray(history.events) ? history.events : [];
    let activeNameCard = nameCards.find((card, index) => card.url === profileSettings.nameCard && isNameCardUnlocked(card, index)) || null;
    if (data.assetsLoaded && !profileSettings.defaultNameCardApplied) {
      const defaultNameCard = nameCards.find((card) => isDefaultNameCard(card));
      if (defaultNameCard) {
        profileSettings.nameCard = defaultNameCard.url;
        profileSettings.defaultNameCardApplied = true;
        activeNameCard = defaultNameCard;
      }
    }
    if (data.assetsLoaded && !activeNameCard) {
      const defaultNameCard = nameCards.find((card) => isDefaultNameCard(card));
      profileSettings.nameCard = defaultNameCard?.url || '';
      activeNameCard = defaultNameCard || null;
    }
    if (data.assetsLoaded && profileSettings.title && !unlockedAchievements.some((item) => item.name === profileSettings.title)) profileSettings.title = '';
    const selectedVanillaHome = vanillaHomes.find((home) => String(home.name || '').trim() === profileSettings.mainProperty);
    if (data.assetsLoaded && selectedVanillaHome && (selectedVanillaHome.available === false || selectedVanillaHome.owned !== true)) profileSettings.mainProperty = '';
    const portrait = byId('achievement-player-portrait');
    const portraitFallback = byId('achievement-portrait-fallback');
    if (portrait && assets.playerCard) {
      if (portrait.getAttribute('src') !== assets.playerCard) portrait.src = assets.playerCard;
      portrait.hidden = false;
      portrait.onload = () => {
        const frame = byId('achievement-portrait-frame');
        if (!frame || !portrait.naturalWidth || !portrait.naturalHeight) return;
        const ratio = portrait.naturalWidth / portrait.naturalHeight;
        frame.classList.toggle('wrong-size', Math.abs(ratio - 0.75) > 0.04);
      };
      if (portrait.complete && portrait.naturalWidth) portrait.onload();
      if (portraitFallback) portraitFallback.hidden = true;
    } else if (portrait) {
      portrait.hidden = true;
      byId('achievement-portrait-frame')?.classList.remove('wrong-size');
      if (portraitFallback) portraitFallback.hidden = false;
    }
    const nameplate = byId('achievement-current-name-card');
    if (nameplate) {
      if (activeNameCard) { nameplate.src = activeNameCard.url; nameplate.hidden = false; }
      else nameplate.hidden = true;
    }
    const nameplateName = byId('achievement-nameplate-name');
    const nameColor = playerNameColors.has(assets.playerNameColor) ? assets.playerNameColor : '#F4D28D';
    const nameFont = playerNameFonts[assets.playerNameFont] || playerNameFonts.cinzel;
    if (nameplateName) { nameplateName.style.color = nameColor; nameplateName.style.fontFamily = nameFont; nameplateName.style.textShadow = `0 0 8px ${nameColor}99, 0 2px 5px #08111bdd, 0 0 12px #101923`; }
    const playerName = player.name || 'Unknown adventurer';
    const setText = (id, value) => { const node = byId(id); if (node) node.textContent = String(value); };
    setText('achievement-player-name', playerName);
    setText('achievement-nameplate-name', playerName);
    setText('achievement-player-level', Number(player.level) || 0);
    setText('achievement-player-title', profileSettings.title || 'No title selected');
    setText('achievement-reputation', (Number(reputation.score) || 0).toLocaleString());
    setText('achievement-reputation-rank', reputationRank(reputation.score));
    setText('achievement-completed-missions', missionState().completed.toLocaleString());
    const gender = String(player.gender || 'male').toLowerCase() === 'female' ? 'female' : 'male';
    setText('achievement-gender-icon', gender === 'female' ? '♀' : '♂');
    const genderIcon = byId('achievement-gender-icon');
    if (genderIcon) genderIcon.setAttribute('aria-label', gender === 'female' ? 'Female' : 'Male');
    for (const [id, value] of [['achievement-health', player.health], ['achievement-magicka', player.magicka], ['achievement-stamina', player.stamina]]) {
      const node = byId(id);
      if (node) node.textContent = Math.round(Number(value) || 0).toLocaleString();
    }
    setText('achievement-basic-name', playerName);
    setText('achievement-basic-health', Math.round(Number(player.health) || 0).toLocaleString());
    setText('achievement-basic-magicka', Math.round(Number(player.magicka) || 0).toLocaleString());
    setText('achievement-basic-stamina', Math.round(Number(player.stamina) || 0).toLocaleString());
    setText('achievement-basic-property', profileSettings.mainProperty || 'None selected');
    const spouse = String(profileSettings.spouse || '').trim();
    profileSettings.spouse = spouse;
    const marital = profileSettings.maritalStatus === 'Married' && spouse
      ? `Married to ${spouse}` : 'Single';
    setText('achievement-basic-marital', marital);
    const spouseName = byId('achievement-spouse-name');
    if (spouseName) { spouseName.value = spouse; spouseName.disabled = profileSettings.maritalStatus !== 'Married'; }
    setText('achievement-basic-achievements', unlockedAchievements.length.toLocaleString());
    setText('achievement-basic-missions', missionState().completed.toLocaleString());
    const followers = Number.isFinite(Number(player.followers)) ? Number(player.followers) : followerCount(events);
    setText('achievement-basic-followers', Math.max(0, followers).toLocaleString());
    setText('achievement-basic-kills', (Math.max(0, Number(reputation.allHostile) || 0) + Math.max(0, Number(reputation.nonhostileKills) || 0)).toLocaleString());
    setText('achievement-basic-theft', (Number(reputation.thefts) || 0).toLocaleString());

    const memberships = Array.isArray(player.factions) ? player.factions : [];
    const factionStates = knownFactions.map((faction) => {
      const member = memberships.find((entry) => faction.match.test(`${entry.name || ''} ${entry.editorID || ''}`));
      return { ...faction, unlocked: Boolean(member), rank: member ? Math.max(0, Number(member.rank) || 0) : 0 };
    });
    const unlockedFactions = factionStates.filter((faction) => faction.unlocked);
    const chosenFaction = unlockedFactions.find((faction) => faction.id === profileSettings.mainFaction) || unlockedFactions[0] || null;
    if (data.playerLoaded && !profileSettings.mainFaction && chosenFaction) profileSettings.mainFaction = chosenFaction.id;
    if (data.playerLoaded && profileSettings.mainFaction && !unlockedFactions.some((faction) => faction.id === profileSettings.mainFaction)) profileSettings.mainFaction = chosenFaction?.id || '';
    const job = chosenFaction ? (chosenFaction.jobs[Math.min(chosenFaction.rank, chosenFaction.jobs.length - 1)] || chosenFaction.jobs[0]) : 'Adventurer';
    setText('achievement-basic-faction', chosenFaction?.name || 'None selected');
    setText('achievement-basic-job', job);
    if (activeTab === 'factions') {
      renderFactionList('achievement-locked-factions', factionStates.filter((faction) => !faction.unlocked), false);
      renderFactionList('achievement-unlocked-factions', unlockedFactions, true);
      setText('achievement-locked-faction-count', factionStates.filter((faction) => !faction.unlocked).length);
      setText('achievement-unlocked-faction-count', unlockedFactions.length);
    }

    const actionHost = byId('achievement-recent-actions');
    if (activeTab === 'dashboard' && actionHost) {
      actionHost.replaceChildren();
      const recent = events.slice(0, 10);
      if (!recent.length) {
        const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'No SkyRewrite actions are available yet.'; actionHost.appendChild(empty);
      }
      for (const event of recent) {
        const row = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = event.detail || event.subject || `${event.kind || 'Recorded'} action`;
        const meta = document.createElement('small');
        meta.textContent = [event.detail && event.subject && event.detail !== event.subject ? event.subject : '', event.location || ''].filter(Boolean).join(' · ');
        row.append(title, meta); actionHost.appendChild(row);
      }
    }

    if (activeTab === 'dashboard') {
      renderAchievementCarousel(unlockedAchievements);
      renderNameCardList(nameCards);
    } else if (activeTab === 'name-cards') renderNameCardGallery(nameCards);
    else if (activeTab === 'achievements') renderAchievementCatalog(achievements, achievementEvaluation.results);
    else if (activeTab === 'properties') renderProperties();
    setText('achievement-unlocked-summary', `${unlockedAchievements.length} unlocked`);
    setText('achievement-catalog-unlocked-count', `${unlockedAchievements.length} unlocked`);
    setText('achievement-catalog-locked-count', `${lockedAchievements.length} locked`);
    setText('achievement-name-card-summary', `${nameCards.filter((card, index) => isNameCardUnlocked(card, index)).length} unlocked`);
    setText('achievement-tab-summary', `${unlockedAchievements.length} of ${achievements.length} unlocked`);
    saveProfileSettings();
  }

  function renderFactionList(hostId, factions, selectable) {
    const host = byId(hostId);
    if (!host) return;
    host.replaceChildren();
    if (!factions.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = selectable ? 'No recognized faction memberships found.' : 'No factions are locked.'; host.appendChild(empty); return; }
    for (const faction of factions) {
      const row = document.createElement('article'); row.className = 'achievement-choice-row';
      const copy = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = faction.name;
      const hint = document.createElement('small'); hint.textContent = selectable ? `Rank ${faction.rank} · ${faction.jobs[Math.min(faction.rank, faction.jobs.length - 1)] || faction.jobs[0]}` : 'Not joined';
      copy.append(title, hint); row.appendChild(copy);
      if (selectable) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = profileSettings.mainFaction === faction.id ? 'Main faction' : 'Use as main faction';
        button.disabled = profileSettings.mainFaction === faction.id;
        button.addEventListener('click', () => { profileSettings.mainFaction = faction.id; saveProfileSettings(); renderSkyAchievements(); });
        row.appendChild(button);
      }
      host.appendChild(row);
    }
  }

  function renderAchievementCarousel(achievements) {
    const host = byId('achievement-unlocked-carousel');
    if (!host) return;
    host.replaceChildren();
    if (!achievements.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Add achievement images to the SkyAchievements/Achievements folder.'; host.appendChild(empty); return; }
    const visibleCount = Math.min(6, achievements.length);
    for (let index = 0; index < visibleCount; index++) {
      const achievement = achievements[(achievementCarouselOffset + index) % achievements.length];
      const card = document.createElement('article'); card.className = 'achievement-showcase-card';
      card.appendChild(createImage(achievement.url, achievement.name));
      const label = document.createElement('span'); label.textContent = achievement.name; card.appendChild(label);
      host.appendChild(card);
    }
  }

  function renderAchievementCatalog(achievements, results) {
    const locked = byId('achievement-locked-grid');
    const unlocked = byId('achievement-unlocked-grid');
    if (locked) locked.replaceChildren();
    if (unlocked) unlocked.replaceChildren();
    if (!achievements.length) {
      const host = locked || unlocked;
      if (host) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = data.assetsLoaded ? 'Add achievement artwork to the SkyAchievements/Achievements folder.' : 'Loading achievement artwork…'; host.appendChild(empty); }
      return;
    }
    for (const achievement of achievements) {
      const result = results.get(achievementKey(achievement.name)) || { unlocked: false, target: 1, progress: 0, description: '', status: 'Requirement is not mapped yet.' };
      const isUnlocked = result.unlocked === true;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `achievement-catalog-card${isUnlocked ? ' is-unlocked' : ' is-locked'}`;
      card.setAttribute('aria-label', `${achievement.name}${isUnlocked ? ', unlocked' : ', locked'}. Open achievement details.`);
      card.appendChild(createImage(achievement.url, achievement.name));
      const title = document.createElement('strong'); title.textContent = achievement.name;
      card.appendChild(title);
      if (!isUnlocked) {
        const progress = document.createElement('div'); progress.className = 'achievement-catalog-progress'; progress.setAttribute('role', 'progressbar');
        progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(result.target || 1)); progress.setAttribute('aria-valuenow', String(result.progress || 0));
        const fill = document.createElement('span'); fill.style.width = `${Math.min(100, Math.max(0, (Number(result.progress) || 0) / Math.max(1, Number(result.target) || 1) * 100))}%`; progress.appendChild(fill);
        card.appendChild(progress);
      }
      card.addEventListener('click', () => openAchievementDetail(achievement, result, card));
      (isUnlocked ? unlocked : locked)?.appendChild(card);
    }
    if (locked && !locked.childElementCount) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'All tracked achievements are unlocked.'; locked.appendChild(empty); }
    if (unlocked && !unlocked.childElementCount) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No achievements unlocked yet.'; unlocked.appendChild(empty); }
  }

  function openAchievementDetail(achievement, result, opener) {
    const dialog = byId('achievement-detail-dialog');
    if (!dialog) return;
    const unlocked = result?.unlocked === true;
    const image = byId('achievement-detail-image');
    if (image) { image.src = achievement.url || ''; image.alt = achievement.name || ''; }
    const name = byId('achievement-detail-name');
    if (name) name.textContent = achievement.name || 'Achievement';
    const requirements = byId('achievement-detail-requirements');
    if (requirements) requirements.textContent = result?.description || 'Requirement details are not mapped yet.';
    const unlockedStatus = byId('achievement-detail-status');
    if (unlockedStatus) { unlockedStatus.hidden = !unlocked; unlockedStatus.textContent = 'Achievement unlocked'; }
    const progressStatus = byId('achievement-detail-progress-status');
    if (progressStatus) progressStatus.textContent = result?.status || 'Waiting for save data.';
    const section = byId('achievement-detail-progress-section');
    if (section) section.hidden = unlocked;
    if (!unlocked) {
      const current = Math.max(0, Number(result?.progress) || 0);
      const target = Math.max(1, Number(result?.target) || 1);
      const progress = byId('achievement-detail-progress');
      const fill = byId('achievement-detail-progress-fill');
      const copy = byId('achievement-detail-progress-copy');
      if (progress) progress.setAttribute('aria-valuenow', String(current));
      if (progress) progress.setAttribute('aria-valuemax', String(target));
      if (fill) fill.style.width = `${Math.min(100, current / target * 100)}%`;
      if (copy) copy.textContent = `${current.toLocaleString()} / ${target.toLocaleString()}`;
    }
    dialog.returnValue = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    byId('achievement-detail-close')?.focus();
    achievementDetailOpener = opener || null;
  }

  byId('achievement-detail-close')?.addEventListener('click', () => byId('achievement-detail-dialog')?.close());
  byId('achievement-detail-dialog')?.addEventListener('close', (event) => {
    achievementDetailOpener?.focus();
    achievementDetailOpener = null;
  });

  function renderNameCardList(nameCards) {
    const host = byId('achievement-name-card-list');
    if (!host) return;
    host.replaceChildren();
    const unlockedCards = nameCards.filter((card, index) => isNameCardUnlocked(card, index));
    if (!unlockedCards.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Complete missions to unlock your first name card.'; host.appendChild(empty); return; }
    const start = Math.min(nameCardListOffset, Math.max(0, unlockedCards.length - 4));
    for (const cardData of unlockedCards.slice(start, start + 4)) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'achievement-name-card-row';
      if (cardData.url === profileSettings.nameCard) card.classList.add('selected');
      const art = document.createElement('span'); art.className = 'achievement-name-card-art'; art.appendChild(createImage(cardData.url, cardData.name));
      const label = document.createElement('strong'); label.textContent = cardData.name;
      card.append(art, label);
      card.addEventListener('click', () => { profileSettings.nameCard = cardData.url; saveProfileSettings(); renderSkyAchievements(); });
      host.appendChild(card);
    }
  }

  function renderNameCardGallery(nameCards) {
    const host = byId('achievement-name-card-grid');
    if (!host) return;
    host.replaceChildren();
    if (!nameCards.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Name cards are managed in SkyMissions.'; host.appendChild(empty); return; }
    for (const [index, cardData] of nameCards.entries()) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'achievement-name-card-option';
      const unlocked = isNameCardUnlocked(cardData, index);
      if (!unlocked) card.classList.add('locked');
      if (unlocked && cardData.url === profileSettings.nameCard) card.classList.add('selected');
      const art = document.createElement('span'); art.className = 'achievement-name-card-art'; art.appendChild(createImage(cardData.url, cardData.name));
      const name = document.createElement('strong'); name.textContent = cardData.name;
      const action = document.createElement('span'); action.className = 'achievement-name-card-action';
      const unlockIndex = nameCardUnlockIndex(cardData, index, nameCards);
      action.textContent = unlocked ? (cardData.url === profileSettings.nameCard ? 'Currently selected' : 'Use this name card') : unlockIndex < 10 ? `Unlock after ${(unlockIndex + 1) * 10} completed missions` : `Unlock for ${cardMissionCost(unlockIndex).toLocaleString()} SkyPoints`;
      card.append(art, name, action);
      card.addEventListener('click', () => {
        if (!unlockNameCard(cardData, index)) return;
        profileSettings.nameCard = cardData.url;
        saveProfileSettings();
        renderSkyAchievements();
      });
      host.appendChild(card);
    }
  }

  function renderProperties() {
    const host = byId('achievement-properties');
    if (!host) return;
    host.replaceChildren();
    const stored = [...new Set(profileSettings.properties.map((name) => String(name).trim()).filter(Boolean))];
    profileSettings.properties = stored;
    const vanillaHomes = Array.isArray(data.assets?.properties) ? data.assets.properties : [];
    const vanillaNames = new Set(vanillaHomes.map((home) => String(home.name || '').trim().toLocaleLowerCase()));
    const homes = [
      ...vanillaHomes,
      ...stored.filter((name) => !vanillaNames.has(name.toLocaleLowerCase())).map((name) => ({ name, owned: true, available: true, manual: true }))
    ];
    if (!homes.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Waiting for the active save’s home ownership data…'; host.appendChild(empty); return; }
    for (const home of homes) {
      const name = String(home.name || 'Unnamed home').trim();
      const isOwned = home.manual === true || home.owned === true;
      const row = document.createElement('article'); row.className = 'achievement-choice-row';
      const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = name;
      const hint = document.createElement('small');
      hint.textContent = profileSettings.mainProperty === name ? 'Displayed on the dashboard' : home.available === false ? 'Home record not found; check that its DLC is installed' : isOwned ? (home.manual ? 'Added as an owned modded home' : 'Owned') : 'Not owned';
      copy.append(title, hint);
      const controls = document.createElement('div'); controls.className = 'achievement-choice-controls';
      const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = profileSettings.mainProperty === name ? 'Main property' : 'Set as main'; choose.disabled = profileSettings.mainProperty === name;
      choose.disabled = choose.disabled || !isOwned || home.available === false;
      choose.addEventListener('click', () => { if (!isOwned || home.available === false) return; profileSettings.mainProperty = name; saveProfileSettings(); renderSkyAchievements(); });
      controls.append(choose);
      if (home.manual) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'subtle'; remove.textContent = 'Remove';
        remove.addEventListener('click', () => { profileSettings.properties = profileSettings.properties.filter((entry) => entry !== name); if (profileSettings.mainProperty === name) profileSettings.mainProperty = ''; saveProfileSettings(); renderSkyAchievements(); });
        controls.append(remove);
      }
      row.append(copy, controls); host.appendChild(row);
    }
  }

  function renderFilterPicker(name, options, selectedValue) {
    const picker = document.querySelector(`[data-skyachievement-picker="${name}"]`);
    if (!picker) return;
    const triggerLabel = picker.querySelector('.skyachievement-picker-trigger span');
    const optionHost = picker.querySelector('.skyachievement-picker-options');
    const search = picker.querySelector('.skyachievement-picker-search input');
    const selected = options.find((option) => option.value === String(selectedValue)) || options[0];
    if (triggerLabel) triggerLabel.textContent = selected?.label || '';
    if (!optionHost) return;
    const needle = (search?.value || '').trim().toLocaleLowerCase();
    const matches = options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
    const signature = JSON.stringify({ matches, selectedValue: String(selectedValue), needle });
    if (optionHost.dataset.signature === signature) return;
    optionHost.replaceChildren();
    optionHost.dataset.signature = signature;
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'skyachievement-picker-empty';
      empty.textContent = 'No matching filters';
      optionHost.appendChild(empty);
      return;
    }
    for (const option of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skyachievement-picker-option';
      button.dataset.value = option.value;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', option.value === String(selectedValue) ? 'true' : 'false');
      if (option.value === String(selectedValue)) button.classList.add('selected');
      button.textContent = option.label;
      optionHost.appendChild(button);
    }
  }

  function renderAchievementRecords(host, records, emptyMessage, type, pageSize = 50) {
    if (!host) return;
    const paged = type === 'location' || type === 'item';
    const pageKey = type === 'location' ? 'locations' : 'items';
    const visibleLimit = paged ? Math.max(50, Number(recordPageSizes[pageKey]) || pageSize) : records.length;
    const visibleRecords = records.slice(0, visibleLimit);
    const fragment = document.createDocumentFragment();
    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = emptyMessage;
      fragment.appendChild(empty);
    }
    for (const record of visibleRecords) {
      const card = document.createElement('article');
      card.className = type === 'quest' ? 'achievement-record achievement-quest-record' : 'achievement-record';
      if (type === 'item') card.classList.add(`rarity-${String(record.rarity || 'Common').toLowerCase()}`);
      const title = document.createElement('strong');
      title.textContent = record.name || 'Unknown record';
      const image = document.createElement('div');
      image.className = 'achievement-record-art';
      const imagePath = type === 'location' ? record.image : type === 'item' ? record.icon : '';
      if (imagePath) {
        const img = document.createElement('img');
        img.src = imagePath;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        image.appendChild(img);
      } else {
        const placeholder = document.createElement('small');
        placeholder.textContent = type === 'location' ? 'SCREENSHOT PENDING' : type === 'item' ? 'NO ICON YET' : (record.plugin || 'COMPLETED');
        image.appendChild(placeholder);
      }
      const meta = document.createElement('div');
      meta.className = 'achievement-record-meta';
      if (type === 'item') {
        const rarity = document.createElement('span');
        rarity.className = 'achievement-rarity';
        rarity.textContent = record.rarity || 'Common';
        meta.appendChild(rarity);
      }
      const plugin = document.createElement('small');
      plugin.textContent = record.plugin || 'Unknown plugin';
      meta.appendChild(plugin);
      card.append(title, image, meta);
      fragment.appendChild(card);
    }
    host.replaceChildren(fragment);
    const moreButton = paged ? byId(type === 'location' ? 'achievement-location-load-more' : 'achievement-item-load-more') : null;
    if (moreButton) {
      const remaining = Math.max(0, records.length - visibleRecords.length);
      moreButton.hidden = !paged || remaining === 0;
      moreButton.textContent = `Load 50 more (${remaining.toLocaleString()} remaining)`;
      moreButton.setAttribute('aria-label', `Load 50 more ${pageKey}`);
    }
  }

  function achievementCounterValue(history, key, fallbackPattern, summaryValue, disposition = 'any') {
    const states = Array.isArray(history?.regionalCreatureStates) ? history.regionalCreatureStates : [];
    const stateKey = disposition === 'hostile' ? `hostile_${key}` : key;
    const saved = states.find((entry) => String(entry.holdKey || '').toLowerCase() === 'all' && String(entry.category || '').toLowerCase() === stateKey);
    const events = Array.isArray(history?.events) ? history.events : [];
    const eventCount = events.filter((event) => {
      if (event?.kind !== 'death' || event?.detail !== 'Player killed this actor' || !fallbackPattern.test(`${event.subject || ''} ${event.identity || ''}`)) return false;
      if (disposition === 'hostile') return event.victimHostile === true || (event.victimHostile !== false && ((Number(event.stage) || 0) & 1) !== 0);
      if (disposition === 'nonhostile') return event.victimHostile === false && event.victimTeammate !== true;
      return true;
    }).length;
    const savedCount = Math.max(0, Number(saved?.count) || 0);
    const summaryCount = Number.isFinite(Number(summaryValue)) ? Math.max(0, Number(summaryValue) || 0) : 0;
    return Math.max(savedCount, eventCount, summaryCount);
  }

  function countHistoryEvents(history, predicate) {
    return (Array.isArray(history?.events) ? history.events : []).filter(predicate).length;
  }

  function countUniqueHistoryEvents(history, predicate) {
    const unique = new Set();
    for (const event of Array.isArray(history?.events) ? history.events : []) {
      if (!predicate(event)) continue;
      const formID = Number(event.formID) || 0;
      const label = window.SkyAchievementsRuleEngine?.normalize(event.subject || event.identity || event.detail) || String(event.subject || event.identity || event.detail || '').toLocaleLowerCase();
      unique.add(formID ? `form:${formID}` : `name:${label}`);
    }
    return unique.size;
  }

  function completedQuestCount(history) {
    const quests = new Set();
    const add = (record) => {
      const formID = Number(record?.formID) || 0;
      const name = window.SkyAchievementsRuleEngine?.normalize(record?.name || record?.subject || record?.identity) || '';
      if (formID) quests.add(`form:${formID}`);
      else if (name) quests.add(`name:${name}`);
    };
    for (const quest of Array.isArray(history?.completedQuests) ? history.completedQuests : []) add(quest);
    for (const event of Array.isArray(history?.events) ? history.events : []) {
      if (event?.questCompleted === true || Number(event?.eventType) === 19) add({ formID: event.formID, name: event.subject || event.identity });
    }
    return quests.size;
  }

  function thievesGuildJobCount(history, editorID, questName) {
    const normalize = window.SkyAchievementsRuleEngine?.normalize || ((value) => String(value || '').toLocaleLowerCase());
    const jobKey = normalize(editorID);
    const nameKey = normalize(questName);
    const matches = (value) => {
      const key = normalize(value);
      return (jobKey && key.includes(jobKey)) || (nameKey && key.includes(nameKey));
    };
    const events = (Array.isArray(history?.events) ? history.events : []).filter((event) =>
      (event?.questCompleted === true || Number(event?.eventType) === 19) && matches(`${event.identity || ''} ${event.subject || ''}`));
    const savedCompletion = (Array.isArray(history?.completedQuests) ? history.completedQuests : []).some((quest) => matches(quest?.name));
    return Math.max(events.length, savedCompletion ? 1 : 0);
  }

  function renderSkyAchievements() {
    renderDashboard();
    if (activeTab === 'missions') renderMissions();
    const player = data.player || {};
    const history = data.history || {};
    const reputation = history.reputation || {};
    const playerName = byId('achievement-player-name');
    const level = byId('achievement-player-level');
    if (playerName) playerName.textContent = player.name || 'Unknown adventurer';
    if (level) level.textContent = String(Number(player.level) || 0);
    for (const [id, value] of [['achievement-health', player.health], ['achievement-magicka', player.magicka], ['achievement-stamina', player.stamina]]) {
      const node = byId(id);
      if (node) node.textContent = Math.round(Number(value) || 0).toLocaleString();
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const locations = Array.isArray(data.locations) ? data.locations : [];
    const events = Array.isArray(history.events) ? history.events : [];
    const completedQuestRecords = [
      ...(Array.isArray(history.completedQuests) ? history.completedQuests.map((quest) => ({
        formID: quest.formID, name: quest.name, plugin: quest.plugin, day: null
      })) : []),
      ...events.filter((event) => event.questCompleted === true || Number(event.eventType) === 19).map((event) => ({
        formID: event.formID, name: event.subject || event.identity, plugin: event.formPlugin, day: Number(event.day)
      }))
    ];
    const quests = [...new Map(completedQuestRecords.map((quest) => [
      `${quest.plugin || ''}|${quest.formID || ''}`,
      { name: quest.name || 'Completed quest', plugin: quest.plugin || 'Unknown plugin', day: Number(quest.day) }
    ])).values()]
      .sort((a, b) => (Number.isFinite(b.day) ? b.day : -1) - (Number.isFinite(a.day) ? a.day : -1) || a.name.localeCompare(b.name));
    const pluginList = (records) => [...new Set(records.map((entry) => entry.plugin).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const pluginOptions = (records) => [{ value: 'all', label: 'All plugins' }, ...pluginList(records).map((plugin) => ({ value: plugin, label: plugin }))];
    const pickerOptions = {
      'achievement-quest-plugin': pluginOptions(quests),
      'achievement-location-plugin': pluginOptions(locations),
      'achievement-item-plugin': pluginOptions(items),
      'achievement-marital-status': [
        { value: 'Single', label: 'Single' }, { value: 'Married', label: 'Married' }
      ],
      'achievement-item-rarity': [
        { value: 'all', label: 'All rarities' }, { value: 'Common', label: 'Common' },
        { value: 'Uncommon', label: 'Uncommon' }, { value: 'Rare', label: 'Rare' },
        { value: 'Epic', label: 'Epic' }, { value: 'Legendary', label: 'Legendary' }
      ]
    };
    for (const [name, options] of Object.entries(pickerOptions)) {
      if (!options.some((option) => option.value === filters[name])) filters[name] = 'all';
      renderFilterPicker(name, options, filters[name]);
    }
    const visibleQuests = quests.filter((entry) => filters['achievement-quest-plugin'] === 'all' || entry.plugin === filters['achievement-quest-plugin']);
    const visibleLocations = locations.filter((entry) => filters['achievement-location-plugin'] === 'all' || entry.plugin === filters['achievement-location-plugin']).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const visibleItems = items.filter((entry) => (filters['achievement-item-plugin'] === 'all' || entry.plugin === filters['achievement-item-plugin']) && (filters['achievement-item-rarity'] === 'all' || entry.rarity === filters['achievement-item-rarity'])).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const updateCount = (id, count, noun) => {
      const node = byId(id);
      if (node) node.textContent = `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
    };
    updateCount('achievement-quest-count', visibleQuests.length, 'quest');
    updateCount('achievement-location-count', visibleLocations.length, 'location');
    updateCount('achievement-item-count', visibleItems.length, 'item');
    if (activeTab === 'quests') renderAchievementRecords(byId('achievement-quests'), visibleQuests, 'No completed quests were found in the active save.', 'quest');
    if (activeTab === 'locations') renderAchievementRecords(byId('achievement-locations'), visibleLocations, 'Discover a map marker to add its location and first-visit screenshot.', 'location');
    if (activeTab === 'items') renderAchievementRecords(byId('achievement-items'), visibleItems, 'Discovered items will appear here.', 'item');

    if (activeTab !== 'lifetime') return;
    const counterGroups = byId('achievement-counter-groups');
    const note = byId('achievement-record-note');
    if (!counterGroups) return;
    if (note) note.textContent = 'Save-backed totals · completed quests read from the active save';
    const creature = (key, pattern, value) => achievementCounterValue(history, key, pattern, value, 'hostile');
    const hostileEvents = events.filter((event) => event?.kind === 'death' && event?.detail === 'Player killed this actor' &&
      (event.victimHostile === true || (event.victimHostile !== false && ((Number(event.stage) || 0) & 1) !== 0)));
    const allHostileKills = Math.max(Number(reputation.allHostile) || 0, hostileEvents.length);
    const totalQuests = completedQuestCount(history);
    const discoveredItems = items.filter((item) => Math.max(0, Number(item.totalFound) || 0) > 0);
    const discoveredIngredients = discoveredItems.filter((item) => /ingredient/i.test(`${item.name || ''} ${item.category || ''}`));
    const booksRead = countUniqueHistoryEvents(history, (event) => Number(event.eventType) === 34 || event?.kind === 'read');
    const spellsLearned = countUniqueHistoryEvents(history, (event) => Number(event.eventType) === 25 || event?.kind === 'spell');
    const shoutsLearned = countUniqueHistoryEvents(history, (event) => Number(event.eventType) === 27 || event?.kind === 'shout');
    const theftEvents = events.filter((event) => event?.isTheft === true || Number(event.eventType) === 10);
    const shopRobberyEvents = events.filter((event) => Number(event.eventType) === 17 || event?.kind === 'shopTheft');
    const stolenItemUnits = theftEvents.reduce((sum, event) => sum + Math.max(0, Number(event.stage) || 0), 0);
    const stolenGold = theftEvents.filter((event) => event.isGold === true || Number(event.formID) === 15)
      .reduce((sum, event) => sum + Math.max(0, Number(event.stage) || 0), 0);
    const lockpickEvents = events.filter((event) => Number(event.eventType) === 21 || event?.kind === 'lockpick');
    const jobCount = (editorID, name) => thievesGuildJobCount(history, editorID, name);
    const hostileNpcCounters = [
      ['Dark Seducer', 'darkseducer', /dark.?seducer/i], ['Golden Saint', 'goldensaint', /golden.?saint/i],
      ['Saints Bandit', 'saintsbandit', /saints?.?bandit/i], ['Seducers Bandit', 'seducersbandit', /seducers?.?bandit/i],
      ['Bandits', 'bandit', /bandit|marauder/i, reputation.bandits], ['Forsworn', 'forsworn', /forsworn/i, reputation.forsworn],
      ['Vampires', 'vampire', /vampire/i, reputation.vampires], ['Thalmor Justiciars', 'thalmorjusticiar', /thalmor.?justiciar/i],
      ['Other Thalmor', 'thalmor', /thalmor(?!.*justiciar)|thalmore(?!.*justiciar)/i], ['Silver Hand', 'silverhand', /silver.?hand/i],
      ['Penitus Oculatus', 'penitusoculatus', /penitus.?oculatus/i], ['Dawnguard', 'dawnguard', /dawnguard/i],
      ['Vigilants of Stendarr', 'vigilant', /vigilant/i], ['Imperial soldiers', 'imperialsoldier', /imperial (soldier|captain|legion)/i],
      ['Stormcloaks', 'stormcloaksoldier', /storm.?cloak/i], ['Hired thugs', 'hiredthug', /hired.?thug/i],
      ['Mercenaries', 'mercenary', /mercenary/i], ['Assassins', 'assassin', /assassin/i], ['Necromancers', 'necromancer', /necromancer/i],
      ['Pyromancers', 'pyromancer', /pyromancer/i], ['Cryomancers', 'cryomancer', /cryomancer/i],
      ['Electromancers', 'electromancer', /electromancer/i], ['Conjurers', 'conjurer', /conjurer/i],
      ['Rogues & Warlocks', 'roguewarlock', /rogue|warlock/i], ['Afflicted', 'afflicted', /afflicted/i],
      ['Glenmoril Witches', 'witch', /glenmoril|witch/i], ['Dragon Cultists', 'dragoncultist', /dragon.?cultist/i],
      ['Mythic Dawn Cultists', 'mythicdawncultist', /mythic.?dawn/i], ['Miraak Cultists', 'miraakcultist', /miraak.?cultist|cultist of miraak/i],
      ['Other Cultists', 'cultist', /(?!.*(?:dragon|mythic.?dawn|miraak)).*cultist/i], ['Reavers', 'reaver', /reaver/i]
    ].map(([label, key, pattern, summary]) => [label, creature(key, pattern, summary)]);
    const hostileMonsterCounters = [
      ['Chaurus', 'chaurus', /chaurus/i], ['Dragons', 'dragon', /dragon(?!.?priest)/i, reputation.dragons],
      ['Dragon Priests', 'dragonpriest', /dragon.?priest/i, reputation.dragonPriests], ['Falmer', 'falmer', /falmer/i, reputation.falmers],
      ['Frostbite Spiders', 'spider', /spider/i, reputation.spiders], ['Giants', 'giant', /giant/i],
      ['Hagravens', 'hagraven', /hagraven/i, reputation.hagravens], ['Ice Wraiths', 'icewraith', /ice.?wraith/i],
      ['Magic Anomalies', 'magicanomaly', /magic(al)? anomaly/i], ['Spriggans', 'spriggan', /spriggan/i], ['Trolls', 'troll', /troll/i],
      ['Werewolves & Werebears', 'werewolf', /werewolf|werebear/i], ['Wispmothers', 'wispmother', /wispmother|wisp.?mother/i],
      ['Wisps', 'wisp', /wisp(?!.*mother)/i], ['Gargoyles', 'gargoyle', /gargoyle/i], ['Death Hounds', 'deathhound', /death.?hound/i],
      ['Ash Spawns', 'ashspawn', /ash.?spawn/i], ['Ash Hoppers', 'ashhopper', /ash.?hopper/i], ['Ash Guardians', 'ashguardian', /ash.?guardian/i],
      ['Netch', 'netch', /netch/i], ['Bonemen', 'boneman', /bone.?man/i], ['Mistmen', 'mistman', /mist.?man/i],
      ['Wrathmen', 'wrathman', /wrath.?man/i], ['Ghosts & Shades', 'ghost', /ghost|shade/i],
      ['Draugr', 'draugr', /draugr/i, reputation.draugrs], ['Skeletons', 'skeleton', /skeleton/i, reputation.skeletons],
      ['Dwarven Centurions', 'dwarvencenturion', /centurion/i], ['Dwarven Spheres', 'dwarvensphere', /dwarven.?sphere|sphere guardian/i],
      ['Dwarven Spiders', 'dwarvenspider', /dwarven.?spider|spider guardian/i], ['Dwarven Ballistae', 'dwarvenballista', /dwarven.?ballista|dwemer.?ballista/i],
      ['Other Dwarven Constructs', 'dwarven', /dwarven|dwemer/i], ['Bears', 'bear', /bear/i, reputation.bears],
      ['Sabre Cats', 'sabrecat', /sabre.?cat/i], ['Wolves', 'wolf', /wolf/i, reputation.wolves], ['Skeevers', 'skeever', /skeever/i],
      ['Slaughterfish', 'slaughterfish', /slaughterfish/i], ['Mudcrabs', 'mudcrab', /mudcrab/i], ['Horkers', 'horker', /horker/i],
      ['Mammoths', 'mammoth', /mammoth/i], ['Dremora', 'dremora', /dremora/i], ['Atronachs', 'atronach', /atronach/i],
      ['Rieklings', 'riekling', /riekling/i]
    ].map(([label, key, pattern, summary]) => [label, creature(key, pattern, summary)]);
    const groups = [
      ['Hostile NPCs', [['All hostile kills', allHostileKills], ['Other hostile NPCs', Math.max(0, Number(reputation.otherHostile) || 0)], ...hostileNpcCounters]],
      ['Hostile Monsters & Creatures', [['All monster kills', Number(reputation.monsters) || 0], ...hostileMonsterCounters]],
      ['Non-hostile Kills', [['Non-hostile kills', achievementCounterValue(history, 'nonhostile', /./, reputation.nonhostileKills, 'nonhostile')]]],
      ['Theft & Lockpicking', [
        ['Theft events', Math.max(Number(reputation.thefts) || 0, theftEvents.length)],
        ['Container thefts', theftEvents.filter((event) => event.theftSourceKind !== 'pickpocket').length],
        ['Pickpocket thefts', theftEvents.filter((event) => event.theftSourceKind === 'pickpocket').length],
        ['Items stolen', Math.max(Number(reputation.itemsStolen) || 0, stolenItemUnits)],
        ['Septims stolen', Math.max(Number(reputation.goldStolen) || 0, stolenGold)],
        ['Shop robberies', shopRobberyEvents.length],
        ['Items scattered in robberies', shopRobberyEvents.reduce((sum, event) => sum + Math.max(0, Number(event.stage) || 0), 0)],
        ['Locks picked', lockpickEvents.length], ['Doors picked', lockpickEvents.filter((event) => String(event.identity || '').toLowerCase().endsWith('/door')).length],
        ['Containers picked', lockpickEvents.filter((event) => String(event.identity || '').toLowerCase().endsWith('/container')).length],
        ['Ledger forgeries', Math.max(Number(reputation.forgeries) || 0, countHistoryEvents(history, (event) => Number(event.eventType) === 24 || event?.kind === 'forgery'))]
      ]],
      ['Thieves Guild Jobs', [
        ['Bedlam Jobs', jobCount('TGRNT', 'The Bedlam Job')], ['Fishing Jobs', jobCount('TGRGF', 'The Fishing Job')],
        ['Numbers Jobs', jobCount('TGRFO', 'The Numbers Job')], ['Burglary Jobs', jobCount('TGRBE', 'The Burglary Job')],
        ['Heist Jobs', jobCount('TGRSL', 'The Heist Job')], ['Shill Jobs', jobCount('TGRDU', 'The Shill Job')],
        ['Sweep Jobs', jobCount('TGRHC', 'The Sweep Job')]
      ]],
      ['Quests & Discoveries', [
        ['Quests completed', totalQuests], ['Locations discovered', locations.length], ['Items discovered', discoveredItems.length],
        ['Ingredients discovered', discoveredIngredients.length], ['Books read', booksRead], ['Spells learned', spellsLearned], ['Shouts learned', shoutsLearned],
        ['Ingredient effects learned', countUniqueHistoryEvents(history, (event) => Number(event.eventType) === 35 || event?.kind === 'ingredientEffect')],
        ...['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].map((rarity) => [`${rarity} items discovered`, discoveredItems.filter((item) => item.rarity === rarity).length])
      ]],
      ['Character & Crafting Milestones', [
        ['Skill increases', countHistoryEvents(history, (event) => Number(event.eventType) === 32 || event?.kind === 'skill')],
        ['Levels gained', countHistoryEvents(history, (event) => Number(event.eventType) === 33 || event?.kind === 'level')],
        ['Followers recruited', countHistoryEvents(history, (event) => Number(event.eventType) === 36)],
        ['Items smithed', countHistoryEvents(history, (event) => Number(event.eventType) === 38)],
        ['Items tanned', countHistoryEvents(history, (event) => Number(event.eventType) === 39)],
        ['Potions crafted', countHistoryEvents(history, (event) => Number(event.eventType) === 40)],
        ['Items enchanted', countHistoryEvents(history, (event) => Number(event.eventType) === 41)],
        ['Meals cooked', countHistoryEvents(history, (event) => Number(event.eventType) === 43)]
      ]]
    ];
    const highlights = byId('achievement-counter-highlights');
    if (highlights) {
      highlights.replaceChildren();
      for (const [label, value] of [
        ['QUESTS COMPLETED', totalQuests], ['HOSTILE DEFEATS', allHostileKills], ['INGREDIENTS FOUND', discoveredIngredients.length],
        ['BOOKS READ', booksRead], ['SPELLS LEARNED', spellsLearned], ['SHOUTS LEARNED', shoutsLearned]
      ]) {
        const card = document.createElement('article'); card.className = 'achievement-counter-highlight';
        const name = document.createElement('span'); name.textContent = label;
        const amount = document.createElement('strong'); amount.textContent = Math.max(0, Number(value) || 0).toLocaleString();
        card.append(name, amount); highlights.appendChild(card);
      }
    }
    counterGroups.replaceChildren();
    for (const [heading, entries] of groups) {
      const section = document.createElement('section');
      section.className = 'achievement-counter-group';
      const title = document.createElement('h3');
      title.textContent = heading;
      const grid = document.createElement('div');
      grid.className = 'achievement-counter-grid';
      for (const [label, value] of entries) {
        const card = document.createElement('article');
        card.className = 'achievement-counter-card';
        const amount = document.createElement('strong');
        amount.textContent = Math.max(0, Number(value) || 0).toLocaleString();
        const caption = document.createElement('span');
        caption.textContent = label;
        card.append(amount, caption);
        grid.appendChild(card);
      }
      section.append(title, grid);
      counterGroups.appendChild(section);
    }
  }

  document.querySelectorAll('[data-achievements-tab]').forEach((button) => button.addEventListener('click', () => {
    activeTab = button.dataset.achievementsTab || 'dashboard';
    document.querySelectorAll('[data-achievements-tab]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-achievements-panel]').forEach((panel) => { panel.hidden = panel.dataset.achievementsPanel !== activeTab; });
    renderSkyAchievements();
  }));
  byId('achievement-location-load-more')?.addEventListener('click', () => {
    recordPageSizes.locations += 50;
    renderSkyAchievements();
  });
  byId('achievement-item-load-more')?.addEventListener('click', () => {
    recordPageSizes.items += 50;
    renderSkyAchievements();
  });

  document.querySelectorAll('[data-achievement-carousel]').forEach((button) => button.addEventListener('click', () => {
    const all = Array.isArray(data.assets?.achievements) ? data.assets.achievements : [];
    const achievements = evaluateAchievements(all).unlocked;
    if (!achievements.length) return;
    const step = Math.min(6, achievements.length);
    achievementCarouselOffset = (achievementCarouselOffset + (button.dataset.achievementCarousel === 'next' ? step : -step) + achievements.length) % achievements.length;
    renderAchievementCarousel(achievements);
  }));
  document.querySelectorAll('[data-name-card-scroll]').forEach((button) => button.addEventListener('click', () => {
    const cards = (Array.isArray(data.assets?.nameCards) ? data.assets.nameCards : []).filter((card, index) => isNameCardUnlocked(card, index));
    const max = Math.max(0, cards.length - 4);
    nameCardListOffset = Math.max(0, Math.min(max, nameCardListOffset + (button.dataset.nameCardScroll === 'down' ? 1 : -1)));
    renderNameCardList(cards);
  }));
  byId('achievement-add-property')?.addEventListener('click', () => {
    const input = byId('achievement-property-input');
    const name = input?.value.trim();
    if (!name) return;
    if (!profileSettings.properties.some((property) => property.toLocaleLowerCase() === name.toLocaleLowerCase())) profileSettings.properties.push(name);
    if (input) input.value = '';
    saveProfileSettings();
    renderSkyAchievements();
  });
  byId('achievement-property-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); byId('achievement-add-property')?.click(); }
  });
  const spouseName = byId('achievement-spouse-name');
  if (spouseName) { spouseName.value = profileSettings.spouse || ''; spouseName.disabled = profileSettings.maritalStatus !== 'Married'; }
  byId('achievement-save-marital')?.addEventListener('click', () => {
    profileSettings.maritalStatus = profileSettings.maritalStatus === 'Married' ? 'Married' : 'Single';
    profileSettings.spouse = profileSettings.maritalStatus === 'Married' ? (spouseName?.value.trim() || '') : '';
    saveProfileSettings();
    renderSkyAchievements();
  });

  document.querySelectorAll('.skyachievement-picker').forEach((picker) => {
    const name = picker.dataset.skyachievementPicker;
    const trigger = picker.querySelector('.skyachievement-picker-trigger');
    const popover = picker.querySelector('.skyachievement-picker-popover');
    const search = picker.querySelector('.skyachievement-picker-search input');
    trigger.addEventListener('click', () => {
      const opening = popover.hidden;
      document.querySelectorAll('.skyachievement-picker-popover').forEach((menu) => {
        menu.hidden = true;
        menu.parentElement.querySelector('.skyachievement-picker-trigger')?.setAttribute('aria-expanded', 'false');
      });
      popover.hidden = !opening;
      trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening && search) { search.value = ''; renderSkyAchievements(); search.focus(); }
    });
    if (search) {
      search.addEventListener('input', renderSkyAchievements);
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      });
    }
    picker.querySelector('.skyachievement-picker-options').addEventListener('click', (event) => {
      const option = event.target.closest('.skyachievement-picker-option');
      if (!option) return;
      filters[name] = option.dataset.value;
      if (name === 'achievement-location-plugin') recordPageSizes.locations = 50;
      if (name === 'achievement-item-plugin' || name === 'achievement-item-rarity') recordPageSizes.items = 50;
      if (name === 'achievement-marital-status') {
        profileSettings.maritalStatus = option.dataset.value === 'Married' ? 'Married' : 'Single';
        if (profileSettings.maritalStatus === 'Single') profileSettings.spouse = '';
        saveProfileSettings();
      }
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      renderSkyAchievements();
    });
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.skyachievement-picker')) return;
    document.querySelectorAll('.skyachievement-picker-popover:not([hidden])').forEach((menu) => {
      menu.hidden = true;
      menu.parentElement.querySelector('.skyachievement-picker-trigger')?.setAttribute('aria-expanded', 'false');
    });
  });

  window.addEventListener('message', (event) => {
    const rawMessage = event.data;
    if (rawMessage?.channel === 'skyachievements' && rawMessage.type === 'update') {
      const rawPayload = rawMessage.payload && typeof rawMessage.payload === 'object' ? rawMessage.payload : {};
      const rawData = rawPayload.data && typeof rawPayload.data === 'object' ? rawPayload.data : {};
      const eventCount = Array.isArray(rawData.events) ? rawData.events.length : 0;
      reportSkyAchievementsDiagnostic(`TRACE message event entered id=${Number(rawPayload.id) || 0} kind=${String(rawPayload.kind || 'unknown')} sourceIsParent=${event.source === window.parent} events=${eventCount}`);
    }
    if (event.source !== window.parent) {
      if (event.data?.channel === 'skyachievements' && event.data.type === 'update') {
        reportSkyAchievementsDiagnostic(`ignored update from unexpected message source; id=${Number(event.data.payload?.id) || 0}`);
      }
      return;
    }
    let message = event.data;
    const receivedType = typeof message;
    const receivedLength = typeof message === 'string' ? message.length : 0;
    if (typeof message === 'string') reportSkyAchievementsDiagnostic(`parent message received; type=${receivedType}; chars=${receivedLength}`);
    if (typeof message === 'string') {
      try { message = JSON.parse(message); }
      catch (error) {
        reportSkyAchievementsDiagnostic(`could not parse message from SkyOS: ${String(error?.message || error).slice(0, 100)}`);
        return;
      }
    }
    if (message?.channel !== 'skyachievements') return;
    if (message.type === 'host-ready') {
      reportSkyAchievementsDiagnostic('app.js acknowledged host-ready');
      window.parent.postMessage({ channel: 'skyachievements', type: 'ready' }, '*');
      return;
    }
    if (message.type !== 'update') return;
    const update = message.payload && typeof message.payload === 'object' ? message.payload : {};
    const updateId = Number(update.id);
    const kind = String(update.kind || 'unknown');
    reportSkyAchievementsDiagnostic(`update envelope parsed id=${updateId}; kind=${kind}; dataType=${typeof update.data}`);
    if (!Number.isSafeInteger(updateId) || updateId <= 0) {
      reportSkyAchievementsDiagnostic(`received ${kind} update with invalid id=${update.id}`);
      acknowledgeSkyAchievementsUpdate(updateId || 0, kind, false, 'invalid update id');
      return;
    }
    if (processedSkyAchievementsUpdateIds.has(updateId)) {
      reportSkyAchievementsDiagnostic(`duplicate ${kind} update id=${updateId}; acknowledging without reprocessing`);
      acknowledgeSkyAchievementsUpdate(updateId, kind, true, 'duplicate already processed');
      return;
    }
    const latestId = latestSkyAchievementsUpdateIds.get(kind) || 0;
    if (updateId < latestId) {
      reportSkyAchievementsDiagnostic(`stale ${kind} update id=${updateId}; latest processed id=${latestId}`);
      acknowledgeSkyAchievementsUpdate(updateId, kind, true, 'stale update ignored');
      return;
    }
    const updateStarted = performance.now();
    reportSkyAchievementsDiagnostic(`native ${kind} update arrived id=${updateId}`);
    try {
      if (kind === 'player') {
        data.player = update.data && typeof update.data === 'object' ? update.data : {};
        data.playerLoaded = true;
        achievementDataRevision++;
      }
      else if (kind.startsWith('history-chunk-')) {
        const chunkIndex = Number(kind.slice('history-chunk-'.length));
        const chunk = update.data && typeof update.data === 'object' ? update.data : {};
        if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || !Array.isArray(chunk.events)) {
          acknowledgeSkyAchievementsUpdate(updateId, kind, false, 'invalid history chunk');
          return;
        }
        if (chunkIndex === 0) {
          data.history = { ...(chunk.metadata && typeof chunk.metadata === 'object' ? chunk.metadata : {}), events: [] };
          data.historyLoaded = false;
          expectedHistoryChunkCount = Math.max(1, Math.floor(Number(chunk.chunkCount) || 1));
          receivedHistoryChunkCount = 0;
        }
        if (chunkIndex !== receivedHistoryChunkCount || expectedHistoryChunkCount <= 0) {
          acknowledgeSkyAchievementsUpdate(updateId, kind, false, 'history chunks arrived out of order');
          return;
        }
        const appendStarted = performance.now();
        reportSkyAchievementsDiagnostic(`TRACE chunk append started index=${chunkIndex}/${expectedHistoryChunkCount - 1} priorEvents=${data.history.events.length} appendEvents=${chunk.events.length}`);
        data.history.events.push(...chunk.events);
        receivedHistoryChunkCount++;
        data.historyLoaded = receivedHistoryChunkCount === expectedHistoryChunkCount;
        achievementDataRevision++;
        reportSkyAchievementsDiagnostic(`TRACE chunk append complete index=${chunkIndex} totalEvents=${data.history.events.length} appendMs=${Math.round(performance.now() - appendStarted)}`);
      }
      else if (kind === 'history') {
        data.history = update.data && typeof update.data === 'object' ? update.data : {};
        data.historyLoaded = true;
        expectedHistoryChunkCount = 0;
        receivedHistoryChunkCount = 0;
        achievementDataRevision++;
        deferSkyAchievementsMissionProcessing(kind, () => processMissionHistory(data.history.events));
      }
      else if (kind === 'assets') { data.assets = update.data && typeof update.data === 'object' ? update.data : { playerCard: null, nameCards: [], achievements: [] }; data.assetsLoaded = true; achievementDataRevision++; }
      else if (kind === 'items') { data.items = Array.isArray(update.data) ? update.data : []; data.itemsLoaded = true; achievementDataRevision++; }
      else if (kind === 'locations') { data.locations = Array.isArray(update.data) ? update.data : []; data.locationsLoaded = true; achievementDataRevision++; }
      else {
        reportSkyAchievementsDiagnostic(`cannot process update id=${updateId}; unsupported kind=${kind}`);
        acknowledgeSkyAchievementsUpdate(updateId, kind, false, 'unsupported update kind');
        return;
      }
      const recordCount = kind === 'history' ? (Array.isArray(data.history.events) ? data.history.events.length : 0)
        : kind.startsWith('history-chunk-') ? `${receivedHistoryChunkCount}/${expectedHistoryChunkCount} history chunks`
        : kind === 'items' ? data.items.length
          : kind === 'locations' ? data.locations.length
            : kind === 'assets' ? `${data.assets.achievements?.length || 0} achievements/${data.assets.nameCards?.length || 0} name cards` : '';
      const historyComplete = kind.startsWith('history-chunk-') && receivedHistoryChunkCount === expectedHistoryChunkCount;
      if (!kind.startsWith('history-chunk-') || historyComplete) {
        if (historyComplete) deferSkyAchievementsMissionProcessing('history', () => processMissionHistory(data.history.events));
        scheduleSkyAchievementsRender(`${kind} update`);
      }
      latestSkyAchievementsUpdateIds.set(kind, updateId);
      processedSkyAchievementsUpdateIds.add(updateId);
      if (processedSkyAchievementsUpdateIds.size > 128) processedSkyAchievementsUpdateIds.delete(processedSkyAchievementsUpdateIds.values().next().value);
      reportSkyAchievementsDiagnostic(`processed ${kind} update id=${updateId}${recordCount ? ` (${recordCount})` : ''}; elapsedMs=${Math.round(performance.now() - updateStarted)}`);
      acknowledgeSkyAchievementsUpdate(updateId, kind, true);
    } catch (error) {
      const detail = String(error?.message || error || 'unknown processing error').replace(/[\r\n\t]/g, ' ').slice(0, 100);
      reportSkyAchievementsDiagnostic(`processing ${kind} update id=${updateId} failed: ${detail}`);
      acknowledgeSkyAchievementsUpdate(updateId, kind, false, detail);
    }
  });
  window.addEventListener('messageerror', () => reportSkyAchievementsDiagnostic('browser reported a message deserialization error from SkyOS'));

  const startupRenderStarted = performance.now();
  reportSkyAchievementsDiagnostic('TRACE initial render started');
  renderSkyAchievements();
  reportSkyAchievementsDiagnostic(`initial render complete: elapsedMs=${Math.round(performance.now() - startupRenderStarted)}`);
  window.parent.postMessage({ channel: 'skyachievements', type: 'ready' }, '*');
})();
