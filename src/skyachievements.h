#pragma once

#include <string>
#include <string_view>

#if defined(SKYOS_SKYACHIEVEMENTS_EXPORTS)
#define SKYOS_SKYACHIEVEMENTS_API __declspec(dllexport)
#else
#define SKYOS_SKYACHIEVEMENTS_API __declspec(dllimport)
#endif

namespace SkyOS {
    [[nodiscard]] SKYOS_SKYACHIEVEMENTS_API std::string GetSkyAchievementsPlayerUpdateScript();
    [[nodiscard]] SKYOS_SKYACHIEVEMENTS_API std::string GetSkyAchievementsAssetsUpdateScript();
    [[nodiscard]] SKYOS_SKYACHIEVEMENTS_API std::string GetSkyAchievementsAchievementNoticeScript(
        std::string_view name, std::string_view requirements, std::string_view iconUrl);
}
