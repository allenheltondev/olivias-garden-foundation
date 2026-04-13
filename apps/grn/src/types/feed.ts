export interface DerivedFeedSignal {
  geoBoundaryKey: string;
  cropId: string | null;
  windowDays: number;
  listingCount: number;
  requestCount: number;
  supplyQuantity: string;
  demandQuantity: string;
  scarcityScore: number;
  abundanceScore: number;
  computedAt: string;
  expiresAt: string;
}

export interface DerivedFeedFreshness {
  asOf: string;
  isStale: boolean;
  staleFallbackUsed: boolean;
  staleReason: string | null;
}

export interface DerivedFeedAiSummary {
  summaryText: string;
  modelId: string;
  modelVersion: string;
  generatedAt: string;
  expiresAt: string;
  fromCache: boolean;
}

export interface GrowerGuidanceSignalRef {
  geoBoundaryKey: string;
  cropId: string | null;
  scarcityScore: number;
  abundanceScore: number;
  listingCount: number;
  requestCount: number;
}

export interface GrowerGuidanceExplanation {
  season: string;
  strategy: string;
  windowDays: number;
  sourceSignalCount: number;
  strongestScarcitySignal: GrowerGuidanceSignalRef | null;
  strongestAbundanceSignal: GrowerGuidanceSignalRef | null;
}

export interface GrowerGuidance {
  guidanceText: string;
  explanation: GrowerGuidanceExplanation;
}

export interface DerivedFeedResponse {
  items: unknown[];
  signals: DerivedFeedSignal[];
  freshness: DerivedFeedFreshness;
  aiSummary: DerivedFeedAiSummary | null;
  growerGuidance: GrowerGuidance | null;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}
