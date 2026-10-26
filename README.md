# SkyAchievements

SkyAchievements is a SkyOS app module for achievement artwork, progress, unlock records, completed-quest records, and item and location discoveries. It includes an in-game achievement unlock message with configurable design, size, and position.

## Features

- Browse locked and unlocked achievements, view their requirements, and track progress.
- Save achievement progress and unlocks per character in the local SkyOS profile.
- Read player level and faction membership from the active Skyrim character.
- Use optional SkyRewrite history for quest completions, creature counters, brawl wins, gold tracking, and named actions.
- Use optional SkyCollection data for discovered items and locations.
- Configure the in-game unlock message through the SkyViewer module settings.

SkyAchievements owns the achievement system and art. The character dashboard, missions, properties, factions, name cards, and SkyStore belong to the separate SkyMissions app.

## Requirements

- Windows x64 and Visual Studio 2022 with the C++ desktop workload.
- CMake 3.24 or newer, Git, and vcpkg with `VCPKG_ROOT` set.
- The `x64-windows-static-md` vcpkg triplet.
- Skyrim Special Edition or Anniversary Edition, SKSE, PrismaUI, SkyOS Core, and SkyViewer at runtime.
- SkyRewrite 
- SkyCollection

## Build and package

From this directory, configure and build the Release preset:

```powershell
cmake --preset release
cmake --build --preset release --parallel
```

Create a ZIP package from CPack's install manifest:

```powershell
cpack --config build/CPackConfig.cmake -C Release
```

The package installs `SkyAchievements.dll` and its app view, unlock-notice view, achievement artwork, SkyViewer module definition, and SkyDocuments under Skyrim's `Data` directory. Install SkyOS Core, SKSE, PrismaUI, and SkyViewer in the profile as runtime requirements.

## SkyOS integration

SkyOS Core owns the shared shell and calls the functions exported by `SkyAchievements.dll` to provide player and artwork data and to display unlock messages. SkyAchievements remains inactive when the SkyOS Core plugin is unavailable.

SkyRewrite provides optional adventure-history records, including cumulative gold and brawl-win data. SkyCollection provides optional item and location discoveries. SkyAchievements does not take ownership of either app's data.

## SkyDocuments

The module guide and feature reference are in `data/SKSE/Plugins/SkyOS/Mods/SkyAchievements/SkyDocuments/`.

## Repository layout

```text
src/                                                        Native SKSE app module and exported SkyAchievements functions
data/PrismaUI/views/SkyAchievements/                         Achievement browser and app artwork
data/PrismaUI/views/SkyOS/SkyAchievements/                   In-game unlock-notice overlay
data/SKSE/Plugins/SkyOS/Mods/SkyAchievements/                Achievement artwork, metadata, and SkyDocuments
data/SKSE/Plugins/SkyOS/Mods/SkyViewer/SkyAchievements/      SkyViewer module settings and page
```
