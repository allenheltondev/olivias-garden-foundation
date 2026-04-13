/**
 * Gardening tips framework types (tips.v1)
 * Issue: #133
 */

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export type TipCategory = 'watering' | 'pests' | 'planting' | 'soil' | 'seasonal' | 'harvest';

export type Season = 'spring' | 'summer' | 'fall' | 'winter' | 'any';

export interface TipTargeting {
  minimumLevel: ExperienceLevel;
  seasons: Season[];
  cropTags: string[];
  zoneTags: string[];
}

export interface GardeningTip {
  id: string;
  title: string;
  body: string;
  category: TipCategory;
  level: ExperienceLevel;
  season: Season;
  cropTags: string[];
  zoneTags: string[];
  targeting: TipTargeting;
}

export interface TipEligibilityContext {
  userLevel: ExperienceLevel;
  currentSeason?: Season;
  userZone?: string;
  userCrops?: string[];
}
