#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const TIP_SCHEMA_VERSION_V1: &str = "tips.v1";

fn default_tip_schema_version() -> String {
    TIP_SCHEMA_VERSION_V1.to_string()
}

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
    Harvest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExperienceSignals {
    pub completed_grows: u32,
    pub successful_harvests: u32,
    pub active_days_last_90: u32,
    pub seasonal_consistency: u32,
    pub variety_breadth: u32,
    pub badge_credibility: u32,
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
    #[serde(default = "default_tip_schema_version")]
    pub schema_version: String,
    pub title: String,
    pub body: String,
    pub category: TipCategory,
    pub level: ExperienceLevel,
    pub season: String,
    pub crop_tags: Vec<String>,
    pub zone_tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CuratedTip {
    pub id: String,
    #[serde(flatten)]
    pub tip: GardeningTip,
    pub targeting: TipTargeting,
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
pub const fn assign_experience_level(signals: &ExperienceSignals) -> ExperienceLevel {
    let experience_score = (signals.completed_grows * 3)
        + (signals.seasonal_consistency * 3)
        + (signals.variety_breadth * 2)
        + (signals.badge_credibility * 2)
        + (signals.successful_harvests * 2)
        + (signals.active_days_last_90 / 10);

    if experience_score >= 50
        && signals.completed_grows >= 10
        && signals.seasonal_consistency >= 2
        && signals.variety_breadth >= 6
    {
        ExperienceLevel::Advanced
    } else if experience_score >= 18 && signals.completed_grows >= 3 && signals.variety_breadth >= 2
    {
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
        || targeting.seasons.iter().any(|season| {
            season.eq_ignore_ascii_case("any") || season.eq_ignore_ascii_case(user_season)
        });

    if !season_matches {
        return false;
    }

    let zone_matches = targeting.zone_tags.is_empty()
        || targeting
            .zone_tags
            .iter()
            .any(|zone| zone.eq_ignore_ascii_case("any") || zone.eq_ignore_ascii_case(user_zone));

    if !zone_matches {
        return false;
    }

    targeting.crop_tags.is_empty()
        || targeting.crop_tags.iter().any(|tag| {
            tag.eq_ignore_ascii_case("any")
                || user_crop_tags
                    .iter()
                    .any(|user_tag| user_tag.eq_ignore_ascii_case(tag))
        })
}

#[must_use]
pub fn recommend_curated_tips(
    user_level: ExperienceLevel,
    user_season: &str,
    user_zone: &str,
    user_crop_tags: &[String],
    limit: usize,
) -> Vec<GardeningTip> {
    curated_tip_catalog()
        .iter()
        .filter(|curated| {
            is_tip_eligible(
                user_level,
                user_season,
                user_zone,
                user_crop_tags,
                &curated.targeting,
            )
        })
        .map(|curated| curated.tip.clone())
        .take(limit)
        .collect()
}

#[allow(clippy::panic)]
pub fn curated_tip_catalog() -> &'static [CuratedTip] {
    static TIP_CATALOG: OnceLock<Vec<CuratedTip>> = OnceLock::new();

    TIP_CATALOG
        .get_or_init(|| {
            let raw = include_str!("../../../../data/tips/curated_tips.v1.json");
            let parsed: Vec<CuratedTip> = match serde_json::from_str(raw) {
                Ok(parsed) => parsed,
                Err(error) => {
                    panic!("curated tip catalog JSON should parse during startup: {error}");
                }
            };

            if let Err(error) = validate_curated_tip_catalog(&parsed) {
                panic!("curated tip catalog JSON must satisfy metadata constraints: {error}");
            }

            parsed
        })
        .as_slice()
}

pub const fn season_from_month(month: u32) -> &'static str {
    match month {
        3..=5 => "spring",
        6..=8 => "summer",
        9..=11 => "fall",
        _ => "winter",
    }
}

fn validate_curated_tip_catalog(catalog: &[CuratedTip]) -> Result<(), String> {
    for tip in catalog {
        if tip.tip.schema_version != TIP_SCHEMA_VERSION_V1 {
            return Err(format!(
                "tip {} has unsupported schema version {}",
                tip.id, tip.tip.schema_version
            ));
        }

        if tip.targeting.seasons.is_empty()
            || tip.targeting.zone_tags.is_empty()
            || tip.targeting.crop_tags.is_empty()
        {
            return Err(format!(
                "tip {} must include targeting seasons, zone tags, and crop tags",
                tip.id
            ));
        }
    }

    Ok(())
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
        assign_experience_level, curated_tip_catalog, is_tip_eligible, recommend_curated_tips,
        season_from_month, ExperienceLevel, ExperienceSignals, GardeningTip, TipCategory,
        TipTargeting, TIP_SCHEMA_VERSION_V1,
    };

    #[test]
    fn assigns_beginner_by_default() {
        let signals = ExperienceSignals {
            completed_grows: 1,
            successful_harvests: 0,
            active_days_last_90: 4,
            seasonal_consistency: 0,
            variety_breadth: 1,
            badge_credibility: 0,
        };

        assert_eq!(assign_experience_level(&signals), ExperienceLevel::Beginner);
    }

    #[test]
    fn assigns_intermediate_when_threshold_met() {
        let signals = ExperienceSignals {
            completed_grows: 3,
            successful_harvests: 1,
            active_days_last_90: 20,
            seasonal_consistency: 1,
            variety_breadth: 3,
            badge_credibility: 1,
        };

        assert_eq!(
            assign_experience_level(&signals),
            ExperienceLevel::Intermediate
        );
    }

    #[test]
    fn assigns_advanced_when_all_advanced_thresholds_met() {
        let signals = ExperienceSignals {
            completed_grows: 11,
            successful_harvests: 6,
            active_days_last_90: 50,
            seasonal_consistency: 3,
            variety_breadth: 8,
            badge_credibility: 2,
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

    #[test]
    fn curated_tip_catalog_loads_with_required_metadata() {
        let catalog = curated_tip_catalog();
        assert!(!catalog.is_empty());
        assert!(catalog.iter().all(|tip| !tip.targeting.seasons.is_empty()));
        assert!(catalog
            .iter()
            .all(|tip| !tip.targeting.zone_tags.is_empty()));
        assert!(catalog
            .iter()
            .all(|tip| !tip.targeting.crop_tags.is_empty()));
    }

    #[test]
    fn recommend_curated_tips_filters_by_level_season_and_zone() {
        let tips = recommend_curated_tips(
            ExperienceLevel::Beginner,
            "spring",
            "8a",
            &["tomato".to_string()],
            3,
        );

        assert!(!tips.is_empty());
        assert!(tips
            .iter()
            .all(|tip| tip.level == ExperienceLevel::Beginner));
    }

    #[test]
    fn season_mapping_matches_expected_month_ranges() {
        assert_eq!(season_from_month(1), "winter");
        assert_eq!(season_from_month(4), "spring");
        assert_eq!(season_from_month(7), "summer");
        assert_eq!(season_from_month(10), "fall");
    }
}
