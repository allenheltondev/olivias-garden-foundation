#![allow(dead_code)]

use serde::{Deserialize, Serialize};

const EXIF_PRESENT_WEIGHT: i32 = 15;
const EXIF_GEO_MATCH_WEIGHT: i32 = 20;
const EXIF_TIME_MATCH_WEIGHT: i32 = 15;
const AI_CROP_CLASSIFICATION_WEIGHT: i32 = 25;
const AI_STAGE_CLASSIFICATION_WEIGHT: i32 = 15;
const PHOTO_UNIQUENESS_WEIGHT: i32 = 10;

const DUPLICATE_PENALTY: i32 = 40;
const METADATA_MISMATCH_PENALTY: i32 = 25;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceReviewStatus {
    Pending,
    AutoApproved,
    NeedsReview,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BadgeDisputeStatus {
    Open,
    UnderReview,
    MoreEvidenceRequested,
    Upheld,
    Revoked,
}

pub fn parse_badge_dispute_status(value: &str) -> Option<BadgeDisputeStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "open" => Some(BadgeDisputeStatus::Open),
        "under_review" => Some(BadgeDisputeStatus::UnderReview),
        "more_evidence_requested" => Some(BadgeDisputeStatus::MoreEvidenceRequested),
        "upheld" => Some(BadgeDisputeStatus::Upheld),
        "revoked" => Some(BadgeDisputeStatus::Revoked),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct EvidenceSignals {
    pub exif_present: bool,
    pub exif_geo_match: bool,
    pub exif_time_window_match: bool,
    pub duplicate_or_near_duplicate: bool,
    pub metadata_mismatch_flag: bool,
    pub ai_crop_confidence: f64,
    pub ai_stage_confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceScoreBreakdown {
    pub exif_present_points: i32,
    pub exif_geo_match_points: i32,
    pub exif_time_match_points: i32,
    pub ai_crop_points: i32,
    pub ai_stage_points: i32,
    pub uniqueness_points: i32,
    pub duplicate_penalty_points: i32,
    pub metadata_penalty_points: i32,
    pub total_score: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceScoreDecision {
    pub trust_score: i32,
    pub status: EvidenceReviewStatus,
    pub auto_approve_threshold: i32,
    pub manual_review_threshold: i32,
    pub breakdown: EvidenceScoreBreakdown,
}

pub fn evaluate_evidence_signals(signals: &EvidenceSignals) -> EvidenceScoreDecision {
    let exif_present_points = if signals.exif_present {
        EXIF_PRESENT_WEIGHT
    } else {
        0
    };
    let exif_geo_match_points = if signals.exif_geo_match {
        EXIF_GEO_MATCH_WEIGHT
    } else {
        0
    };
    let exif_time_match_points = if signals.exif_time_window_match {
        EXIF_TIME_MATCH_WEIGHT
    } else {
        0
    };

    let ai_crop_points =
        weighted_confidence(signals.ai_crop_confidence, AI_CROP_CLASSIFICATION_WEIGHT);
    let ai_stage_points =
        weighted_confidence(signals.ai_stage_confidence, AI_STAGE_CLASSIFICATION_WEIGHT);
    let uniqueness_points = if signals.duplicate_or_near_duplicate {
        0
    } else {
        PHOTO_UNIQUENESS_WEIGHT
    };

    let duplicate_penalty_points = if signals.duplicate_or_near_duplicate {
        DUPLICATE_PENALTY
    } else {
        0
    };
    let metadata_penalty_points = if signals.metadata_mismatch_flag {
        METADATA_MISMATCH_PENALTY
    } else {
        0
    };

    let raw_total = exif_present_points
        + exif_geo_match_points
        + exif_time_match_points
        + ai_crop_points
        + ai_stage_points
        + uniqueness_points
        - duplicate_penalty_points
        - metadata_penalty_points;

    let trust_score = raw_total.clamp(0, 100);

    let auto_approve_threshold = 80;
    let manual_review_threshold = 55;

    let status = if trust_score >= auto_approve_threshold {
        EvidenceReviewStatus::AutoApproved
    } else if trust_score >= manual_review_threshold {
        EvidenceReviewStatus::NeedsReview
    } else {
        EvidenceReviewStatus::Rejected
    };

    EvidenceScoreDecision {
        trust_score,
        status,
        auto_approve_threshold,
        manual_review_threshold,
        breakdown: EvidenceScoreBreakdown {
            exif_present_points,
            exif_geo_match_points,
            exif_time_match_points,
            ai_crop_points,
            ai_stage_points,
            uniqueness_points,
            duplicate_penalty_points,
            metadata_penalty_points,
            total_score: trust_score,
        },
    }
}

#[allow(clippy::cast_possible_truncation)]
fn weighted_confidence(confidence: f64, max_weight: i32) -> i32 {
    let normalized = confidence.clamp(0.0, 1.0);
    (normalized * f64::from(max_weight)).round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approves_high_confidence_evidence() {
        let decision = evaluate_evidence_signals(&EvidenceSignals {
            exif_present: true,
            exif_geo_match: true,
            exif_time_window_match: true,
            duplicate_or_near_duplicate: false,
            metadata_mismatch_flag: false,
            ai_crop_confidence: 0.95,
            ai_stage_confidence: 0.9,
        });

        assert_eq!(decision.status, EvidenceReviewStatus::AutoApproved);
        assert!(decision.trust_score >= 80);
    }

    #[test]
    fn sends_mid_confidence_to_manual_review() {
        let decision = evaluate_evidence_signals(&EvidenceSignals {
            exif_present: true,
            exif_geo_match: false,
            exif_time_window_match: true,
            duplicate_or_near_duplicate: false,
            metadata_mismatch_flag: false,
            ai_crop_confidence: 0.7,
            ai_stage_confidence: 0.55,
        });

        assert_eq!(decision.status, EvidenceReviewStatus::NeedsReview);
        assert!((55..80).contains(&decision.trust_score));
    }

    #[test]
    fn rejects_low_confidence_or_duplicate_evidence() {
        let decision = evaluate_evidence_signals(&EvidenceSignals {
            exif_present: false,
            exif_geo_match: false,
            exif_time_window_match: false,
            duplicate_or_near_duplicate: true,
            metadata_mismatch_flag: true,
            ai_crop_confidence: 0.1,
            ai_stage_confidence: 0.2,
        });

        assert_eq!(decision.status, EvidenceReviewStatus::Rejected);
        assert!(decision.trust_score < 55);
    }

    #[test]
    fn parses_supported_badge_dispute_statuses() {
        assert_eq!(
            parse_badge_dispute_status("under_review"),
            Some(BadgeDisputeStatus::UnderReview)
        );
        assert_eq!(
            parse_badge_dispute_status("MORE_EVIDENCE_REQUESTED"),
            Some(BadgeDisputeStatus::MoreEvidenceRequested)
        );
        assert_eq!(
            parse_badge_dispute_status("revoked"),
            Some(BadgeDisputeStatus::Revoked)
        );
    }

    #[test]
    fn rejects_unknown_badge_dispute_statuses() {
        assert_eq!(parse_badge_dispute_status("pending"), None);
        assert_eq!(parse_badge_dispute_status(""), None);
    }
}
