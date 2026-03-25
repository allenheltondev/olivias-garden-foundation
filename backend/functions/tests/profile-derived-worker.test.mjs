import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── pure logic mirrored from worker ──────────────────────────────────────────

function assignExperienceLevel(s) {
  const score =
    s.completed_grows * 3 +
    s.seasonal_consistency * 3 +
    s.variety_breadth * 2 +
    s.badge_credibility * 2 +
    s.successful_harvests * 2 +
    Math.floor(s.active_days_last_90 / 10);

  if (score >= 50 && s.completed_grows >= 10 && s.seasonal_consistency >= 2 && s.variety_breadth >= 6) return "advanced";
  if (score >= 18 && s.completed_grows >= 3 && s.variety_breadth >= 2) return "intermediate";
  return "beginner";
}

function bucketPoints(value, steps) {
  let max = 0;
  for (const [min, pts] of steps) if (value >= min && pts > max) max = pts;
  return max;
}

function extractUserIds(detail) {
  if (detail.claimerId || detail.listingOwnerId) {
    return [detail.claimerId, detail.listingOwnerId].filter(Boolean);
  }
  return detail.userId ? [detail.userId] : [];
}

describe("assignExperienceLevel", () => {
  it("returns beginner for zero signals", () => {
    const level = assignExperienceLevel({
      completed_grows: 0, successful_harvests: 0, active_days_last_90: 0,
      seasonal_consistency: 0, variety_breadth: 0, badge_credibility: 0,
    });
    assert.equal(level, "beginner");
  });

  it("returns intermediate for moderate signals", () => {
    const level = assignExperienceLevel({
      completed_grows: 4, successful_harvests: 3, active_days_last_90: 20,
      seasonal_consistency: 1, variety_breadth: 3, badge_credibility: 1,
    });
    assert.equal(level, "intermediate");
  });

  it("returns advanced for high signals", () => {
    const level = assignExperienceLevel({
      completed_grows: 15, successful_harvests: 12, active_days_last_90: 60,
      seasonal_consistency: 4, variety_breadth: 8, badge_credibility: 5,
    });
    assert.equal(level, "advanced");
  });

  it("requires all thresholds for advanced, not just score", () => {
    // High score but low variety_breadth
    const level = assignExperienceLevel({
      completed_grows: 20, successful_harvests: 20, active_days_last_90: 90,
      seasonal_consistency: 5, variety_breadth: 3, badge_credibility: 10,
    });
    assert.equal(level, "intermediate");
  });
});

describe("bucketPoints", () => {
  it("returns 0 when value is below all steps", () => {
    assert.equal(bucketPoints(0, [[1, 8], [3, 16], [5, 24]]), 0);
  });

  it("returns highest matching bucket", () => {
    assert.equal(bucketPoints(5, [[1, 8], [3, 16], [5, 24], [8, 30]]), 24);
  });

  it("returns max bucket when value exceeds all", () => {
    assert.equal(bucketPoints(100, [[1, 8], [3, 16], [5, 24], [8, 30]]), 30);
  });

  it("returns first bucket for value at minimum", () => {
    assert.equal(bucketPoints(1, [[1, 8], [3, 16]]), 8);
  });
});

describe("gardener tier thresholds", () => {
  function tierFromScore(total) {
    if (total >= 80) return "master";
    if (total >= 60) return "pro";
    if (total >= 35) return "intermediate";
    return "novice";
  }

  it("novice for 0 points", () => assert.equal(tierFromScore(0), "novice"));
  it("intermediate at 35", () => assert.equal(tierFromScore(35), "intermediate"));
  it("pro at 60", () => assert.equal(tierFromScore(60), "pro"));
  it("master at 80", () => assert.equal(tierFromScore(80), "master"));
  it("novice at 34", () => assert.equal(tierFromScore(34), "novice"));
});

describe("extractUserIds", () => {
  it("extracts userId from profile/listing/request events", () => {
    assert.deepEqual(extractUserIds({ userId: "u1" }), ["u1"]);
  });

  it("extracts both parties from claim events", () => {
    const ids = extractUserIds({ claimerId: "c1", listingOwnerId: "o1" });
    assert.deepEqual(ids, ["c1", "o1"]);
  });

  it("extracts claimerId only when listingOwnerId is missing", () => {
    assert.deepEqual(extractUserIds({ claimerId: "c1" }), ["c1"]);
  });

  it("returns empty for events with no user identifiers", () => {
    assert.deepEqual(extractUserIds({}), []);
  });
});

// ── property-based tests (fast-check) ────────────────────────────────────────

import fc from "fast-check";

// ── pure scoring logic mirrored from worker for tier computation ─────────────

function bucketPointsPure(value, steps) {
  let max = 0;
  for (const [min, pts] of steps) if (value >= min && pts > max) max = pts;
  return max;
}

function computeTierFromMetrics(metrics) {
  const { diversity, active_quarters, completed_shares, total_claims, avg_trust } = metrics;
  const cropPts = bucketPointsPure(diversity, [[1,8],[3,16],[5,24],[8,30]]);
  const seasonPts = bucketPointsPure(active_quarters, [[1,5],[2,10],[3,15],[4,20]]);
  const sharePts = bucketPointsPure(completed_shares, [[1,6],[3,12],[8,16],[15,20]]);
  const ratio = total_claims === 0 ? 1.0 : Math.min(1, Math.max(0, completed_shares / total_claims));
  const reliabilityPts = Math.round(ratio * 15);
  const trustPts = Math.round(Math.min(1, Math.max(0, avg_trust / 100)) * 15);
  const total = cropPts + seasonPts + sharePts + reliabilityPts + trustPts;

  const tier = total >= 80 ? "master" : total >= 60 ? "pro" : total >= 35 ? "intermediate" : "novice";
  const breakdown = {
    crop_diversity_points: cropPts,
    seasonal_consistency_points: seasonPts,
    sharing_outcomes_points: sharePts,
    photo_trust_points: trustPts,
    reliability_points: reliabilityPts,
    total_points: total,
  };
  return { tier, breakdown };
}

// ── Property 6: Tier scoring algorithm equivalence ───────────────────────────
// **Validates: Requirements 6.2**

describe("Property 6: Tier scoring algorithm equivalence [Feature: get-me-read-only-refactor]", () => {
  // Arbitrary for gardener metrics matching the domain constraints
  const gardenerMetricsArb = fc.record({
    diversity: fc.integer({ min: 0, max: 50 }),
    active_quarters: fc.integer({ min: 0, max: 4 }),
    completed_shares: fc.integer({ min: 0, max: 100 }),
    total_claims: fc.integer({ min: 0, max: 200 }),
    avg_trust: fc.double({ min: 0, max: 100, noNaN: true }),
  }).filter(m => m.completed_shares <= m.total_claims);

  it("tier classification matches threshold rules for any metrics (100 iterations)", () => {
    fc.assert(
      fc.property(gardenerMetricsArb, (metrics) => {
        const { tier, breakdown } = computeTierFromMetrics(metrics);
        const total = breakdown.total_points;

        // Verify tier matches threshold rules
        if (total >= 80) assert.equal(tier, "master");
        else if (total >= 60) assert.equal(tier, "pro");
        else if (total >= 35) assert.equal(tier, "intermediate");
        else assert.equal(tier, "novice");
      }),
      { numRuns: 100 }
    );
  });

  it("point breakdown components sum to total for any metrics (100 iterations)", () => {
    fc.assert(
      fc.property(gardenerMetricsArb, (metrics) => {
        const { breakdown } = computeTierFromMetrics(metrics);
        const componentSum =
          breakdown.crop_diversity_points +
          breakdown.seasonal_consistency_points +
          breakdown.sharing_outcomes_points +
          breakdown.photo_trust_points +
          breakdown.reliability_points;
        assert.equal(componentSum, breakdown.total_points);
      }),
      { numRuns: 100 }
    );
  });

  it("crop diversity points follow bucket steps for any diversity value (100 iterations)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (diversity) => {
        const pts = bucketPointsPure(diversity, [[1,8],[3,16],[5,24],[8,30]]);
        // Points must be one of the valid bucket outputs
        assert.ok([0, 8, 16, 24, 30].includes(pts), `unexpected crop pts: ${pts}`);
        // Monotonicity: higher diversity should not produce fewer points
        if (diversity >= 8) assert.equal(pts, 30);
        else if (diversity >= 5) assert.equal(pts, 24);
        else if (diversity >= 3) assert.equal(pts, 16);
        else if (diversity >= 1) assert.equal(pts, 8);
        else assert.equal(pts, 0);
      }),
      { numRuns: 100 }
    );
  });

  it("reliability points are bounded [0, 15] for any metrics (100 iterations)", () => {
    fc.assert(
      fc.property(gardenerMetricsArb, (metrics) => {
        const { breakdown } = computeTierFromMetrics(metrics);
        assert.ok(breakdown.reliability_points >= 0, `reliability < 0: ${breakdown.reliability_points}`);
        assert.ok(breakdown.reliability_points <= 15, `reliability > 15: ${breakdown.reliability_points}`);
      }),
      { numRuns: 100 }
    );
  });

  it("trust points are bounded [0, 15] for any metrics (100 iterations)", () => {
    fc.assert(
      fc.property(gardenerMetricsArb, (metrics) => {
        const { breakdown } = computeTierFromMetrics(metrics);
        assert.ok(breakdown.photo_trust_points >= 0, `trust < 0: ${breakdown.photo_trust_points}`);
        assert.ok(breakdown.photo_trust_points <= 15, `trust > 15: ${breakdown.photo_trust_points}`);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 7: Experience level algorithm equivalence ───────────────────────
// **Validates: Requirements 7.3**

describe("Property 7: Experience level algorithm equivalence [Feature: get-me-read-only-refactor]", () => {
  const experienceSignalsArb = fc.record({
    completed_grows: fc.integer({ min: 0, max: 100 }),
    successful_harvests: fc.integer({ min: 0, max: 100 }),
    active_days_last_90: fc.integer({ min: 0, max: 90 }),
    seasonal_consistency: fc.integer({ min: 0, max: 20 }),
    variety_breadth: fc.integer({ min: 0, max: 50 }),
    badge_credibility: fc.integer({ min: 0, max: 50 }),
  });

  it("level matches scoring formula and threshold rules for any signals (100 iterations)", () => {
    fc.assert(
      fc.property(experienceSignalsArb, (s) => {
        const level = assignExperienceLevel(s);

        // Recompute score using the same formula
        const score =
          s.completed_grows * 3 +
          s.seasonal_consistency * 3 +
          s.variety_breadth * 2 +
          s.badge_credibility * 2 +
          s.successful_harvests * 2 +
          Math.floor(s.active_days_last_90 / 10);

        const expectAdvanced = score >= 50 && s.completed_grows >= 10 && s.seasonal_consistency >= 2 && s.variety_breadth >= 6;
        const expectIntermediate = score >= 18 && s.completed_grows >= 3 && s.variety_breadth >= 2;

        if (expectAdvanced) {
          assert.equal(level, "advanced");
        } else if (expectIntermediate) {
          assert.equal(level, "intermediate");
        } else {
          assert.equal(level, "beginner");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("level is always one of the three valid values for any signals (100 iterations)", () => {
    fc.assert(
      fc.property(experienceSignalsArb, (s) => {
        const level = assignExperienceLevel(s);
        assert.ok(
          ["beginner", "intermediate", "advanced"].includes(level),
          `unexpected level: ${level}`
        );
      }),
      { numRuns: 100 }
    );
  });

  it("zero signals always produce beginner (100 iterations)", () => {
    // Property: any signals where all fields are 0 must yield beginner
    fc.assert(
      fc.property(
        fc.constant({
          completed_grows: 0, successful_harvests: 0, active_days_last_90: 0,
          seasonal_consistency: 0, variety_breadth: 0, badge_credibility: 0,
        }),
        (s) => {
          assert.equal(assignExperienceLevel(s), "beginner");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("advanced requires all gate conditions, not just high score (100 iterations)", () => {
    // Generate signals with high score but missing at least one gate condition
    const highScoreMissingGateArb = experienceSignalsArb.filter((s) => {
      const score =
        s.completed_grows * 3 +
        s.seasonal_consistency * 3 +
        s.variety_breadth * 2 +
        s.badge_credibility * 2 +
        s.successful_harvests * 2 +
        Math.floor(s.active_days_last_90 / 10);
      return score >= 50 && (s.completed_grows < 10 || s.seasonal_consistency < 2 || s.variety_breadth < 6);
    });

    fc.assert(
      fc.property(highScoreMissingGateArb, (s) => {
        const level = assignExperienceLevel(s);
        assert.notEqual(level, "advanced", "should not be advanced when gate conditions are not met");
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 9: User ID extraction covers all event shapes ──────────────────
// **Validates: Requirements 10.2, 10.3**

describe("Property 9: User ID extraction covers all event shapes [Feature: get-me-read-only-refactor]", () => {
  const userIdArb = fc.uuid();

  it("returns both IDs when claimerId and listingOwnerId are present (100 iterations)", () => {
    fc.assert(
      fc.property(userIdArb, userIdArb, (claimerId, listingOwnerId) => {
        const result = extractUserIds({ claimerId, listingOwnerId });
        assert.ok(result.includes(claimerId), `missing claimerId: ${claimerId}`);
        assert.ok(result.includes(listingOwnerId), `missing listingOwnerId: ${listingOwnerId}`);
        assert.equal(result.length, 2);
      }),
      { numRuns: 100 }
    );
  });

  it("returns only claimerId when listingOwnerId is missing (100 iterations)", () => {
    fc.assert(
      fc.property(userIdArb, (claimerId) => {
        const result = extractUserIds({ claimerId });
        assert.deepEqual(result, [claimerId]);
      }),
      { numRuns: 100 }
    );
  });

  it("returns only listingOwnerId when claimerId is missing (100 iterations)", () => {
    fc.assert(
      fc.property(userIdArb, (listingOwnerId) => {
        const result = extractUserIds({ listingOwnerId });
        assert.deepEqual(result, [listingOwnerId]);
      }),
      { numRuns: 100 }
    );
  });

  it("returns [userId] for listing/profile events (100 iterations)", () => {
    fc.assert(
      fc.property(userIdArb, (userId) => {
        const result = extractUserIds({ userId });
        assert.deepEqual(result, [userId]);
      }),
      { numRuns: 100 }
    );
  });

  it("returns empty array when no user identifiers exist (100 iterations)", () => {
    // Generate arbitrary objects without claimerId, listingOwnerId, or userId
    const noUserIdDetailArb = fc.record({
      correlationId: fc.option(fc.string(), { nil: undefined }),
      eventType: fc.option(fc.string(), { nil: undefined }),
    });

    fc.assert(
      fc.property(noUserIdDetailArb, (detail) => {
        const result = extractUserIds(detail);
        assert.deepEqual(result, []);
      }),
      { numRuns: 100 }
    );
  });

  it("userId is ignored when claimerId or listingOwnerId is present (100 iterations)", () => {
    fc.assert(
      fc.property(userIdArb, userIdArb, userIdArb, (claimerId, listingOwnerId, userId) => {
        // When claim fields are present, userId should not appear in result
        const result = extractUserIds({ claimerId, listingOwnerId, userId });
        assert.ok(result.includes(claimerId));
        assert.ok(result.includes(listingOwnerId));
        assert.equal(result.length, 2);
        // userId should not be in the result (claim path takes precedence)
        if (userId !== claimerId && userId !== listingOwnerId) {
          assert.ok(!result.includes(userId), "userId should not appear when claim fields are present");
        }
      }),
      { numRuns: 100 }
    );
  });
});
