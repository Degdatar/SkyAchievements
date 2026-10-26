#include "skyachievements.h"

#include <RE/A/Actor.h>
#include <RE/A/ActorValues.h>
#include <RE/P/PlayerCharacter.h>
#include <RE/T/TESDataHandler.h>
#include <RE/T/TESFaction.h>
#include <RE/T/TESNPC.h>
#include <RE/T/TESObjectCELL.h>

// Keep Windows.h after CommonLib's RE headers so its interlocked-operation
// macros cannot rewrite REX::W32 declarations used by those headers.
#include <Windows.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace fs = std::filesystem;

namespace {
    fs::path GameRoot()
    {
        std::array<wchar_t, 32768> executable{};
        const auto length = GetModuleFileNameW(nullptr, executable.data(), static_cast<DWORD>(executable.size()));
        if (!length || length >= executable.size()) return {};
        return fs::path(std::wstring(executable.data(), length)).parent_path();
    }

    std::string JsString(std::string_view text)
    {
        std::string out = "\"";
        for (const unsigned char ch : text) {
            switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: if (ch < 0x20) out += '?'; else out += static_cast<char>(ch); break;
            }
        }
        return out + '"';
    }

    std::string ToUtf8(const std::wstring& value)
    {
        if (value.empty()) return {};
        const int length = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        if (length <= 0) return {};
        std::string result(static_cast<std::size_t>(length), '\0');
        if (WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr) != length) return {};
        return result;
    }

    std::string FileUrl(const fs::path& path)
    {
        auto wide = path.wstring();
        std::replace(wide.begin(), wide.end(), L'\\', L'/');
        const auto utf8 = ToUtf8(wide);
        if (utf8.empty()) return {};
        std::string result = "file:///";
        constexpr char hex[] = "0123456789ABCDEF";
        for (const unsigned char ch : utf8) {
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') ||
                ch == '/' || ch == ':' || ch == '-' || ch == '_' || ch == '.' || ch == '~') {
                result.push_back(static_cast<char>(ch));
            } else {
                result.push_back('%');
                result.push_back(hex[ch >> 4]);
                result.push_back(hex[ch & 0x0F]);
            }
        }
        std::error_code timeError;
        const auto modified = fs::last_write_time(path, timeError);
        if (!timeError) result += "?v=" + std::to_string(modified.time_since_epoch().count());
        return result;
    }

    bool IsArtworkFile(const fs::path& path)
    {
        auto extension = path.extension().wstring();
        std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
        return extension == L".png" || extension == L".jpg" || extension == L".jpeg" ||
            extension == L".gif" || extension == L".webp";
    }

    std::vector<fs::path> ArtworkIn(const fs::path& directory)
    {
        std::vector<fs::path> files;
        std::error_code error;
        for (fs::directory_iterator it(directory, error), end; !error && it != end; it.increment(error)) {
            std::error_code fileError;
            if (it->is_regular_file(fileError) && !fileError && IsArtworkFile(it->path())) files.push_back(it->path());
        }
        std::sort(files.begin(), files.end(), [](const fs::path& left, const fs::path& right) {
            auto leftName = left.filename().wstring();
            auto rightName = right.filename().wstring();
            std::transform(leftName.begin(), leftName.end(), leftName.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
            std::transform(rightName.begin(), rightName.end(), rightName.begin(), [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
            return leftName < rightName;
        });
        return files;
    }

    std::string ReadSkyAchievementsModuleSetting(std::string_view settingId, std::string_view fallback)
    {
        std::array<wchar_t, 32768> localAppData{};
        const auto length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData.data(), static_cast<DWORD>(localAppData.size()));
        if (!length || length >= localAppData.size()) return std::string(fallback);
        const fs::path settingsPath = fs::path(std::wstring(localAppData.data(), length)) /
            L"SkyOS" / L"SkyViewer" / L"SkyAchievements" / L"settings.json";
        std::ifstream stream(settingsPath, std::ios::binary);
        if (!stream) return std::string(fallback);
        const std::string settings((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
        const auto key = settings.find(JsString(settingId));
        if (key == std::string::npos) return std::string(fallback);
        const auto colon = settings.find(':', key);
        if (colon == std::string::npos) return std::string(fallback);
        const auto quote = settings.find('"', colon + 1);
        if (quote == std::string::npos) return std::string(fallback);
        const auto end = settings.find('"', quote + 1);
        if (end == std::string::npos) return std::string(fallback);
        return settings.substr(quote + 1, end - quote - 1);
    }

    bool ReadSkyAchievementsModuleBooleanSetting(std::string_view settingId, bool fallback)
    {
        std::array<wchar_t, 32768> localAppData{};
        const auto length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData.data(), static_cast<DWORD>(localAppData.size()));
        if (!length || length >= localAppData.size()) return fallback;
        const fs::path settingsPath = fs::path(std::wstring(localAppData.data(), length)) /
            L"SkyOS" / L"SkyViewer" / L"SkyAchievements" / L"settings.json";
        std::ifstream stream(settingsPath, std::ios::binary);
        if (!stream) return fallback;
        const std::string settings((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
        const auto key = settings.find(JsString(settingId));
        if (key == std::string::npos) return fallback;
        const auto colon = settings.find(':', key);
        if (colon == std::string::npos) return fallback;
        auto value = colon + 1;
        while (value < settings.size() && std::isspace(static_cast<unsigned char>(settings[value]))) ++value;
        if (settings.compare(value, 4, "true") == 0) return true;
        if (settings.compare(value, 5, "false") == 0) return false;
        return fallback;
    }

    bool PlayerOwnsHomeCell(RE::TESObjectCELL* cell, RE::PlayerCharacter* player, RE::TESFaction* playerFaction)
    {
        if (!cell || !player) return false;
        if (auto* factionOwner = cell->GetFactionOwner(); factionOwner &&
            (factionOwner == playerFaction || player->IsInFaction(factionOwner))) return true;
        const auto* playerBase = player->GetActorBase();
        if (cell->GetActorOwner() == playerBase) return true;
        const auto* owner = cell->GetOwner();
        if (owner == player || owner == playerBase || owner == playerFaction) return true;
        const auto* ownerFaction = owner && owner->Is(RE::TESFaction::FORMTYPE)
            ? static_cast<const RE::TESFaction*>(owner)
            : nullptr;
        return ownerFaction && player->IsInFaction(ownerFaction);
    }

    std::string DefaultPropertiesJson()
    {
        struct HomeCell { std::string_view name; RE::FormID localFormID; std::string_view plugin; };
        constexpr std::array<HomeCell, 9> homes{{
            {"Breezehome", 0x165A8, "Skyrim.esm"},
            {"Honeyside", 0x16BDD, "Skyrim.esm"},
            {"Vlindrel Hall", 0x16DFA, "Skyrim.esm"},
            {"Hjerim", 0x16778, "Skyrim.esm"},
            {"Proudspire Manor", 0x16A06, "Skyrim.esm"},
            {"Heljarchen Hall", 0x16A56, "HearthFires.esm"},
            {"Lakeview Manor", 0x2FEC, "HearthFires.esm"},
            {"Windstad Manor", 0x11CB3, "HearthFires.esm"},
            {"Severin Manor", 0x17EBE, "Dragonborn.esm"}
        }};
        auto* player = RE::PlayerCharacter::GetSingleton();
        auto* dataHandler = RE::TESDataHandler::GetSingleton();
        auto* playerFaction = dataHandler
            ? static_cast<RE::TESFaction*>(dataHandler->LookupForm(0xDB1, "Skyrim.esm"))
            : nullptr;
        std::string result = "[";
        bool first = true;
        for (const auto& home : homes) {
            auto* cell = dataHandler
                ? static_cast<RE::TESObjectCELL*>(dataHandler->LookupForm(home.localFormID, home.plugin))
                : nullptr;
            const bool owned = PlayerOwnsHomeCell(cell, player, playerFaction);
            if (!cell) {
                SKSE::log::info("SkyAchievements vanilla property '{}' unavailable: CELL {:08X} in '{}' was not found (DLC may be disabled)",
                    home.name, home.localFormID, home.plugin);
            } else {
                const auto* ownerFaction = cell->GetFactionOwner();
                const auto* owner = cell->GetOwner();
                SKSE::log::info("SkyAchievements resolved property '{}': cellFormID={:08X}, cellEditorID='{}', ownerFormID={:08X}, ownerFactionFormID={:08X}, playerOwned={}",
                    home.name, cell->GetFormID(), cell->GetFormEditorID() ? cell->GetFormEditorID() : "",
                    owner ? owner->GetFormID() : 0, ownerFaction ? ownerFaction->GetFormID() : 0, owned);
            }
            if (!first) result += ',';
            first = false;
            result += "{\"name\":" + JsString(home.name) + ",\"available\":" + (cell ? "true" : "false") +
                ",\"owned\":" + (owned ? "true" : "false") + "}";
        }
        return result + "]";
    }

    std::string ArtworkJson(const std::vector<fs::path>& files)
    {
        std::string json = "[";
        bool first = true;
        for (const auto& file : files) {
            const auto stem = ToUtf8(file.stem().wstring());
            const auto url = FileUrl(file);
            if (url.empty()) continue;
            if (!first) json += ',';
            first = false;
            json += "{\"name\":" + JsString(stem) + ",\"url\":" + JsString(url) + "}";
        }
        return json + "]";
    }
}

namespace SkyOS {
    std::string GetSkyAchievementsPlayerUpdateScript()
    {
        auto* player = RE::PlayerCharacter::GetSingleton();
        const char* playerName = player ? player->GetName() : "";
        const auto level = player ? player->GetLevel() : 0;
        auto* actorValues = player ? player->AsActorValueOwner() : nullptr;
        const auto health = actorValues ? actorValues->GetActorValue(RE::ActorValue::kHealth) : 0.0F;
        const auto magicka = actorValues ? actorValues->GetActorValue(RE::ActorValue::kMagicka) : 0.0F;
        const auto stamina = actorValues ? actorValues->GetActorValue(RE::ActorValue::kStamina) : 0.0F;
        const auto followers = player ? player->GetInfoRuntimeData().teammateCount : 0U;
        const auto* base = player ? player->GetActorBase() : nullptr;
        const auto gender = base && base->GetSex() == RE::SEX::kFemale ? "female" : "male";
        std::string factions = "[";
        bool firstFaction = true;
        if (player) {
            if (auto* dataHandler = RE::TESDataHandler::GetSingleton()) {
                for (auto* faction : dataHandler->GetFormArray<RE::TESFaction>()) {
                    if (!faction || !player->IsInFaction(faction)) continue;
                    const char* name = faction->GetName();
                    if (!name || !*name) name = faction->GetFormEditorID();
                    if (!name || !*name) continue;
                    if (!firstFaction) factions += ',';
                    firstFaction = false;
                    factions += "{\"name\":" + JsString(name) + ",\"editorID\":" + JsString(faction->GetFormEditorID() ? faction->GetFormEditorID() : "") +
                        ",\"formID\":" + std::to_string(faction->GetFormID()) + ",\"rank\":" + std::to_string(player->GetFactionRank(faction, true)) + "}";
                }
            }
        }
        factions += ']';
        return GetSkyAchievementsAssetsUpdateScript() + ";SkyOS.setSkyAchievementsPlayer(" + JsString(playerName ? playerName : "") + "," +
            std::to_string(level) + "," + std::to_string(health) + "," + std::to_string(magicka) + "," +
            std::to_string(stamina) + "," + std::to_string(followers) + "," + JsString(gender) + "," + JsString(factions) + ")";
    }

    std::string GetSkyAchievementsAssetsUpdateScript()
    {
        const auto root = GameRoot() / L"Data" / L"SKSE" / L"Plugins" / L"SkyOS" / L"Mods" / L"SkyAchievements";
        const auto achievements = ArtworkJson(ArtworkIn(root / L"Achievements"));
        const auto properties = DefaultPropertiesJson();
        return "SkyOS.setSkyAchievementsAssets({\"achievements\":" + achievements + ",\"properties\":" + properties + "})";
    }

    std::string GetSkyAchievementsAchievementNoticeScript(
        std::string_view name, std::string_view requirements, std::string_view iconUrl)
    {
        if (!ReadSkyAchievementsModuleBooleanSetting("achievementNoticeEnabled", true) || name.empty()) return {};

        auto design = ReadSkyAchievementsModuleSetting("achievementNoticeDesign", "celestial");
        constexpr std::array<std::string_view, 4> designs{ "celestial", "dawnguard", "arcane", "minimal" };
        if (std::find(designs.begin(), designs.end(), design) == designs.end()) design = "celestial";

        auto size = ReadSkyAchievementsModuleSetting("achievementNoticeSize", "standard");
        constexpr std::array<std::string_view, 3> sizes{ "large", "standard", "compact" };
        if (std::find(sizes.begin(), sizes.end(), size) == sizes.end()) size = "standard";

        auto position = ReadSkyAchievementsModuleSetting("achievementNoticePosition", "top-center");
        constexpr std::array<std::string_view, 9> positions{
            "top-left", "top-center", "top-right", "center-left", "center-center", "center-right",
            "bottom-left", "bottom-center", "bottom-right"
        };
        if (std::find(positions.begin(), positions.end(), position) == positions.end()) position = "top-center";

        return "SkyAchievementNotice.show(" + JsString(name.substr(0, 160)) + "," +
            JsString(requirements.substr(0, 400)) + "," + JsString(iconUrl.substr(0, 2048)) + "," +
            JsString(design) + "," + JsString(position) + "," + JsString(size) + ",5200)";
    }
}
