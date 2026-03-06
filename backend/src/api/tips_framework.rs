use serde::{Deserialize, Serialize};

pub const TIP_SCHEMA_VERSION_V1: &str = "tips.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExperienceLevel {
    Beginner,
    Intermediate,
    Advanced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TipCategory {
    Watering,
    Pests,
    Planting,
    Soil,
    Seasonal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperienceSignals {
    pub completed_grows: u32,
    pub successful_harvests: u32,
    pub active_days_last_90: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TipTargeting {
    pub minimum_level: ExperienceLevel,
    pub seasons: Vec<String>,
    pub crop_tags: Vec<String>,
    pub zone_tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GardeningTip {
    pub schema_version: String,
    pub title: String,
    pub body: String,
    pub category: TipCategory,
    pub level: ExperienceLevel,
    pub season: String,
    pub crop_tags: Vec<String>,
    pub zone_tags: Vec<String>,
}

impl GardeningTip {
    #[must_use]
    pub fn new_v1(
        title: String,
        body: String,
        category: TipCategory,
        level: ExperienceLevel,
        season: String,
        crop_tags: Vec<String>,
        zone_tags: Vec<String>,
    ) -> Self {
        Self {
            schema_version: TIP_SCHEMA_VERSION_V1.to_string(),
            title,
            body,
            category,
            level,
            season,
            crop_tags,
            zone_tags,
        }
    }
}

#[must_use]
pub fn assign_experience_level(signals: &ExperienceSignals) -> ExperienceLevel {
    if signals.completed_grows >= 10 && signals.successful_harvests >= 6 && signals.active_days_last_90 >= 45 {
        ExperienceLevel::Advanced
    } else if signals.completed_grows >= 3 && signals.successful_harvests >= 1 && signals.active_days_last_90 >= 15 {
        ExperienceLevel::Intermediate
    } else {
        ExperienceLevel::Beginner
    }
}

#[must_use]
pub fn is_tip_eligible(
    user_level: ExperienceLevel,
    user_season: &str,
    user_zone: &str,
    user_crop_tags: &[String],
    targeting: &TipTargeting,
) -> bool {
    if user_level < targeting.minimum_level {
        return false;
    }

    let season_matches = targeting.seasons.is_empty()
        || targeting
            .seasons
            .iter()
            .any(|season| season.eq_ignore_ascii_case(user_season));

    if !season_matches {
        return false;
    }

    let zone_matches = targeting.zone_tags.is_empty()
        || targeting
            .zone_tags
            .iter()
            .any(|zone| zone.eq_ignore_ascii_case(user_zone));

    if !zone_matches {
        return false;
    }

    targeting.crop_tags.is_empty()
        || targeting.crop_tags.iter().any(|tag| {
            user_crop_tags
                .iter()
                .any(|user_tag| user_tag.eq_ignore_ascii_case(tag))
        })
}

impl PartialOrd for ExperienceLevel {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ExperienceLevel {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        rank_level(*self).cmp(&rank_level(*other))
    }
}

const fn rank_level(level: ExperienceLevel) -> u8 {
    match level {
        ExperienceLevel::Beginner => 0,
        ExperienceLevel::Intermediate => 1,
        ExperienceLevel::Advanced => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        assign_experience_level, is_tip_eligible, ExperienceLevel, ExperienceSignals, GardeningTip,
        TipCategory, TipTargeting, TIP_SCHEMA_VERSION_V1,
    };

    #[test]
    fn assigns_beginner_by_default() {
        let signals = ExperienceSignals {
            completed_grows: 1,
            successful_harvests: 0,
            active_days_last_90: 4,
        };

        assert_eq!(assign_experience_level(&signals), ExperienceLevel::Beginner);
    }

    #[test]
    fn assigns_intermediate_when_threshold_met() {
        let signals = ExperienceSignals {
            completed_grows: 3,
            successful_harvests: 1,
            active_days_last_90: 20,
        };

        assert_eq!(assign_experience_level(&signals), ExperienceLevel::Intermediate);
    }

    #[test]
    fn assigns_advanced_when_all_advanced_thresholds_met() {
        let signals = ExperienceSignals {
            completed_grows: 11,
            successful_harvests: 6,
            active_days_last_90: 50,
        };

        assert_eq!(assign_experience_level(&signals), ExperienceLevel::Advanced);
    }

    #[test]
    fn eligibility_requires_all_targeting_dimensions() {
        let targeting = TipTargeting {
            minimum_level: ExperienceLevel::Intermediate,
            seasons: vec!["spring".to_string()],
            crop_tags: vec!["tomato".to_string()],
            zone_tags: vec!["9b".to_string()],
        };

        let is_eligible = is_tip_eligible(
            ExperienceLevel::Intermediate,
            "spring",
            "9b",
            &["tomato".to_string()],
            &targeting,
        );

        assert!(is_eligible);
    }

    #[test]
    fn eligibility_fails_for_lower_level() {
        let targeting = TipTargeting {
            minimum_level: ExperienceLevel::Intermediate,
            seasons: vec![],
            crop_tags: vec![],
            zone_tags: vec![],
        };

        assert!(!is_tip_eligible(
            ExperienceLevel::Beginner,
            "summer",
            "10a",
            &[],
            &targeting,
        ));
    }

    #[test]
    fn tip_schema_is_versioned() {
        let tip = GardeningTip::new_v1(
            "Water deeply at dawn".to_string(),
            "Water early to reduce evaporation losses.".to_string(),
            TipCategory::Watering,
            ExperienceLevel::Beginner,
            "summer".to_string(),
            vec!["pepper".to_string()],
            vec!["10a".to_string()],
        );

        assert_eq!(tip.schema_version, TIP_SCHEMA_VERSION_V1);
    }
}
