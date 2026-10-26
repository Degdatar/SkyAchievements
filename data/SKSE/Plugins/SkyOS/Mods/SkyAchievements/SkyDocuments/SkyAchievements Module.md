# SkyAchievements

## App ownership

SkyAchievements owns achievement artwork, lifetime records, completed-quest records, and item and location discoveries. The character Dashboard, Missions, Name Cards, Factions, Properties, and SkyStore are in the separate **SkyMissions** app.

- SkyRewrite supplies optional reputation and adventure-history data. SkyMissions displays at most the newest ten actions on its Dashboard.
- SkyCollection supplies discovered items and locations.
- Achievement artwork appears in locked and unlocked card grids. Select a card to view its artwork, name, requirements, and (while locked) progress. The in-game unlock message can be configured in the SkyAchievements module.
- Achievement progress and unlocks are saved per character name in the local SkyOS profile.

## Data sources

- Player level and faction membership: the active Skyrim character.
- Quest completions, cumulative creature counters, and recent named actions: SkyRewrite. Some named-creature requirements rely on retained history and may not include events recorded before SkyRewrite was installed.
- Item and location discoveries: SkyCollection. Tomb Raider uses the discovered-location total as the dungeon-clears count.

**Brawl Champion** counts confirmed SkyRewrite brawl wins; losses do not count. **Golden Touch** and **Legend Of The Hoard** use SkyRewrite's accurate gold tracking and peak-balance progress, including pickups, looting, and transfers. Spending gold later does not erase a peak already reached. Cutpurse Supreme's alternative path uses SkyRewrite's cumulative stolen-septim counter.

SkyAchievements presents optional source-app records without taking ownership of their data. For character information, missions, properties, factions, name cards, and SkyStore, open **SkyMissions**.
