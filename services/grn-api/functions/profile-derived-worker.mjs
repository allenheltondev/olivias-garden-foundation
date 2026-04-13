import pg from "pg";

const { DATABASE_URL } = process.env;

// ── experience level ─────────────────────────────────────────────────────────

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

async function computeExperienceSignals(client, userId) {
  const { rows } = await client.query(
    `with activity_events as (
       select created_at as activity_at from grower_crop_library where user_id = $1
       union all select updated_at from grower_crop_library where user_id = $1
       union all select created_at from surplus_listings where user_id = $1 and deleted_at is null
       union all select claimed_at from claims where claimer_id = $1
       union all select confirmed_at from claims where claimer_id = $1 and confirmed_at is not null
       union all select completed_at from claims where claimer_id = $1 and completed_at is not null
     )
     select
       (select count(*)::int from claims where claimer_id = $1 and status = 'completed') as completed_grows,
       (select count(*)::int from claims where claimer_id = $1 and status = 'completed') as successful_harvests,
       (select count(distinct date_trunc('day', activity_at))::int from activity_events where activity_at >= now() - interval '90 days') as active_days_last_90,
       (select count(distinct (award_snapshot->>'seasonYear'))::int from badge_award_audit where user_id = $1 and badge_key like 'gardener_season_%' and award_snapshot->>'seasonYear' is not null) as seasonal_consistency,
       (select count(distinct crop_id)::int from grower_crop_library where user_id = $1) as variety_breadth,
       (select count(*)::int from badge_evidence_submissions where user_id = $1 and status = 'auto_approved') as badge_credibility`,
    [userId]
  );
  const r = rows[0];
  return {
    completed_grows: Math.max(0, r.completed_grows),
    successful_harvests: Math.max(0, r.successful_harvests),
    active_days_last_90: Math.max(0, r.active_days_last_90),
    seasonal_consistency: Math.max(0, r.seasonal_consistency),
    variety_breadth: Math.max(0, r.variety_breadth),
    badge_credibility: Math.max(0, r.badge_credibility),
  };
}

async function persistExperienceLevel(client, userId, level, signals) {
  const signalsJson = JSON.stringify(signals);
  const prev = await client.query(
    "select experience_level::text as experience_level, signals from user_experience_levels where user_id = $1",
    [userId]
  );

  await client.query(
    `insert into user_experience_levels (user_id, experience_level, signals, computed_at, updated_at)
     values ($1, $2, $3::jsonb, now(), now())
     on conflict (user_id) do update
       set experience_level = excluded.experience_level, signals = excluded.signals,
           computed_at = excluded.computed_at, updated_at = now()`,
    [userId, level, signalsJson]
  );

  const prevLevel = prev.rows[0]?.experience_level;
  const prevSignals = prev.rows[0]?.signals ? JSON.stringify(prev.rows[0].signals) : null;
  if (prevLevel !== level || prevSignals !== signalsJson) {
    await client.query(
      `insert into user_experience_level_audit
         (user_id, previous_level, new_level, previous_signals, new_signals, transition_reason, changed_at)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, now())`,
      [userId, prevLevel ?? null, level, prevSignals, signalsJson, "profile_updated_worker"]
    );
  }
}

// ── gardener tier ────────────────────────────────────────────────────────────

function bucketPoints(value, steps) {
  let max = 0;
  for (const [min, pts] of steps) if (value >= min && pts > max) max = pts;
  return max;
}

async function evaluateGardenerTier(client, userId) {
  const { rows } = await client.query(
    `with crop_metrics as (
       select count(distinct gcl.crop_id)::int as diversity
       from grower_crop_library gcl where gcl.user_id = $1 and gcl.status in ('planning','growing')
     ),
     season_metrics as (
       select count(distinct date_part('quarter', sl.created_at)::int)::int as active_quarters
       from surplus_listings sl where sl.user_id = $1 and sl.deleted_at is null and sl.created_at >= now() - interval '365 days'
     ),
     share_metrics as (
       select count(*) filter (where c.status = 'completed')::int as completed_shares,
              count(*)::int as total_claims
       from claims c join surplus_listings sl on sl.id = c.listing_id where sl.user_id = $1
     ),
     evidence_metrics as (
       select coalesce(avg(trust_score), 0)::double precision as avg_trust
       from badge_evidence_submissions where user_id = $1 and status in ('auto_approved','needs_review')
     )
     select cm.diversity, sm.active_quarters, shm.completed_shares, shm.total_claims, em.avg_trust
     from crop_metrics cm cross join season_metrics sm cross join share_metrics shm cross join evidence_metrics em`,
    [userId]
  );
  const m = rows[0];
  const cropPts = bucketPoints(m.diversity, [[1,8],[3,16],[5,24],[8,30]]);
  const seasonPts = bucketPoints(m.active_quarters, [[1,5],[2,10],[3,15],[4,20]]);
  const sharePts = bucketPoints(m.completed_shares, [[1,6],[3,12],[8,16],[15,20]]);
  const ratio = m.total_claims === 0 ? 1.0 : Math.min(1, Math.max(0, m.completed_shares / m.total_claims));
  const reliabilityPts = Math.round(ratio * 15);
  const trustPts = Math.round(Math.min(1, Math.max(0, m.avg_trust / 100)) * 15);
  const total = cropPts + seasonPts + sharePts + reliabilityPts + trustPts;

  const tier = total >= 80 ? "master" : total >= 60 ? "pro" : total >= 35 ? "intermediate" : "novice";
  const explanation = [
    `Verified crop diversity observed: ${m.diversity} unique crops.`,
    `Seasonal consistency observed: ${m.active_quarters} active quarter(s) in trailing year.`,
    `Sharing outcomes: ${m.completed_shares}/${m.total_claims} completed claims.`,
    `Photo evidence trust average: ${m.avg_trust.toFixed(1)}.`,
    `Reliability completion ratio: ${(ratio * 100).toFixed(0)}%.`,
  ];
  const breakdown = { crop_diversity_points: cropPts, seasonal_consistency_points: seasonPts, sharing_outcomes_points: sharePts, photo_trust_points: trustPts, reliability_points: reliabilityPts, total_points: total };

  const prev = await client.query(
    "select tier::text as tier from gardener_tier_promotions where user_id = $1 order by promoted_at desc limit 1",
    [userId]
  );
  const tierRank = { novice: 0, intermediate: 1, pro: 2, master: 3 };
  const priorTier = prev.rows[0]?.tier;
  if (!priorTier || tierRank[tier] > (tierRank[priorTier] ?? -1)) {
    await client.query(
      `insert into gardener_tier_promotions (user_id, tier, explanation, score_breakdown, total_score, promoted_at)
       values ($1, $2::gardener_tier, $3, $4::jsonb, $5, now())`,
      [userId, tier, explanation.join(" "), JSON.stringify(breakdown), total]
    );
  }
}

// ── badge cabinet ────────────────────────────────────────────────────────────

async function maybeAward(client, userId, badgeKey, qualifies, snapshot, reason) {
  if (!qualifies) return;
  const existing = await client.query(
    "select id from badge_award_audit where user_id = $1 and badge_key = $2 limit 1",
    [userId, badgeKey]
  );
  if (existing.rows.length > 0) return;
  await client.query(
    `insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot)
     values ($1, $2, now(), null, $3, '[]'::jsonb, $4::jsonb)`,
    [userId, badgeKey, reason, JSON.stringify(snapshot)]
  );
}

async function syncBadges(client, userId) {
  await syncFirstHarvest(client, userId);
  await syncSeasonLadder(client, userId);
  await syncFruitBadges(client, userId);
  await syncSharingBadges(client, userId);
  await syncPracticeBadges(client, userId);
}

async function syncFirstHarvest(client, userId) {
  const existing = await client.query(
    "select id from badge_award_audit where user_id = $1 and badge_key = 'first_harvest' limit 1", [userId]
  );
  if (existing.rows.length > 0) return;

  const { rows } = await client.query(
    `with harvest_events as (
       select sl.grower_crop_id, min(c.completed_at) as harvest_at
       from surplus_listings sl join claims c on c.listing_id = sl.id
       where sl.user_id = $1 and sl.grower_crop_id is not null and c.status = 'completed' and c.completed_at is not null
       group by sl.grower_crop_id
     ),
     proof_matches as (
       select he.grower_crop_id, count(*)::int as proof_count, min(he.harvest_at) as first_harvest_at
       from harvest_events he
       join badge_evidence_submissions bes on bes.user_id = $1 and bes.grower_crop_id = he.grower_crop_id
         and bes.status in ('auto_approved','needs_review')
         and coalesce(bes.exif_taken_at, bes.captured_at, bes.created_at) between he.harvest_at - interval '14 days' and he.harvest_at + interval '14 days'
       group by he.grower_crop_id
     )
     select sum(proof_count)::int as proof_count, min(first_harvest_at) as first_harvest_at from proof_matches`,
    [userId]
  );
  const r = rows[0];
  if (!r || !r.proof_count || r.proof_count <= 0 || !r.first_harvest_at) return;

  await client.query(
    `insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot)
     values ($1, 'first_harvest', $2, null, $3, '[]'::jsonb, $4::jsonb)`,
    [userId, r.first_harvest_at, "First Harvest awarded: completed harvest event with timestamped linked photo proof near harvest window",
     JSON.stringify({ proofCount: r.proof_count, windowDays: 14, badgeFamily: "milestone_identity" })]
  );
}

async function syncSeasonLadder(client, userId) {
  const criteriaRow = await client.query(
    "select min_activity_weeks, min_crop_completions, min_evidence_count from badge_season_criteria where criteria_key = 'gardener_season_v1' limit 1"
  );
  const c = criteriaRow.rows[0] ?? { min_activity_weeks: 10, min_crop_completions: 3, min_evidence_count: 6 };

  const { rows } = await client.query(
    `with year_activity as (
       select extract(year from c.completed_at at time zone 'utc')::int as season_year,
              min(c.completed_at) as first_activity_at, max(c.completed_at) as last_activity_at,
              count(distinct sl.grower_crop_id)::int as crop_completions
       from surplus_listings sl join claims cl on cl.listing_id = sl.id
       where sl.user_id = $1 and sl.grower_crop_id is not null and cl.status = 'completed' and cl.completed_at is not null
       group by 1
     ),
     year_evidence as (
       select extract(year from coalesce(bes.exif_taken_at, bes.captured_at, bes.created_at) at time zone 'utc')::int as season_year,
              count(*)::int as evidence_count
       from badge_evidence_submissions bes where bes.user_id = $1 and bes.status in ('auto_approved','needs_review')
       group by 1
     )
     select ya.season_year, ya.first_activity_at, ya.last_activity_at, ya.crop_completions, coalesce(ye.evidence_count,0)::int as evidence_count
     from year_activity ya left join year_evidence ye on ye.season_year = ya.season_year order by ya.season_year asc`,
    [userId]
  );

  const qualified = [];
  for (const r of rows) {
    const weeks = Math.floor((new Date(r.last_activity_at) - new Date(r.first_activity_at)) / (7 * 86400000));
    if (weeks >= c.min_activity_weeks && r.crop_completions >= c.min_crop_completions && r.evidence_count >= c.min_evidence_count) {
      qualified.push({ seasonYear: r.season_year, earnedAt: r.last_activity_at });
    }
  }

  for (let i = 0; i < qualified.length; i++) {
    const level = i + 1;
    const badgeKey = `gardener_season_${level}`;
    const s = qualified[i];
    const existing = await client.query(
      "select id from badge_award_audit where user_id = $1 and badge_key = $2 and (award_snapshot->>'seasonYear')::int = $3 limit 1",
      [userId, badgeKey, s.seasonYear]
    );
    if (existing.rows.length > 0) continue;
    await client.query(
      `insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot)
       values ($1, $2, $3, null, $4, '[]'::jsonb, $5::jsonb)`,
      [userId, badgeKey, s.earnedAt,
       "Gardener Season awarded: met configured annual activity, crop completion, and evidence thresholds",
       JSON.stringify({ badgeFamily: "seasonal_mastery", seasonYear: s.seasonYear, level, criteria: { minActivityWeeks: c.min_activity_weeks, minCropCompletions: c.min_crop_completions, minEvidenceCount: c.min_evidence_count } })]
    );
  }
}

async function syncFruitBadges(client, userId) {
  const { rows: treeRows } = await client.query(
    `with fruit_tree_events as (
       select sl.crop_id, min(c.completed_at) as first_completed_at, max(c.completed_at) as last_completed_at, count(*)::int as completed_count
       from surplus_listings sl join claims c on c.listing_id = sl.id join crops cr on cr.id = sl.crop_id
       where sl.user_id = $1 and c.status = 'completed' and c.completed_at is not null
         and (coalesce(cr.category,'') ilike '%fruit%' or cr.common_name ilike any(array['%apple%','%pear%','%peach%','%plum%','%cherry%','%citrus%','%orange%','%lemon%']))
       group by sl.crop_id
     ),
     fruit_tree_proof as (
       select bes.grower_crop_id, count(*)::int as evidence_count
       from badge_evidence_submissions bes where bes.user_id = $1 and bes.status in ('auto_approved','needs_review')
       group by bes.grower_crop_id
     )
     select fte.crop_id, fte.first_completed_at, fte.last_completed_at, coalesce(sum(ftp.evidence_count),0)::int as evidence_count
     from fruit_tree_events fte
     left join grower_crop_library gcl on gcl.user_id = $1 and gcl.crop_id = fte.crop_id
     left join fruit_tree_proof ftp on ftp.grower_crop_id = gcl.id
     group by fte.crop_id, fte.first_completed_at, fte.last_completed_at`,
    [userId]
  );

  const qualifyingTrees = treeRows.filter(r => {
    const days = (new Date(r.last_completed_at) - new Date(r.first_completed_at)) / 86400000;
    return days >= 60 && r.evidence_count >= 2;
  }).length;

  await maybeAward(client, userId, "fruit_tree_keeper", qualifyingTrees >= 1,
    { badgeFamily: "fruit_focus", qualifyingTreeCount: qualifyingTrees }, "Fruit Tree Keeper awarded");
  await maybeAward(client, userId, "orchard_starter", qualifyingTrees >= 3,
    { badgeFamily: "fruit_focus", qualifyingTreeCount: qualifyingTrees }, "Orchard Starter awarded");

  const { rows: berryRows } = await client.query(
    `select count(distinct coalesce(cv.id::text, sl.variety_id::text, sl.crop_id::text))::int as cnt
     from surplus_listings sl join claims c on c.listing_id = sl.id join crops cr on cr.id = sl.crop_id
     left join crop_varieties cv on cv.id = sl.variety_id
     where sl.user_id = $1 and c.status = 'completed' and c.completed_at is not null
       and (coalesce(cr.category,'') ilike '%berry%' or cr.common_name ilike '%berry%' or coalesce(cv.name,'') ilike '%berry%')`,
    [userId]
  );
  await maybeAward(client, userId, "berry_builder", (berryRows[0]?.cnt ?? 0) >= 3,
    { badgeFamily: "fruit_focus", berryVarietyCount: berryRows[0]?.cnt ?? 0 }, "Berry Builder awarded");
}

async function syncSharingBadges(client, userId) {
  const { rows } = await client.query(
    `select
       count(*) filter (where c.status = 'completed')::int as completed_count,
       count(*) filter (where c.status in ('cancelled','no_show'))::int as disrupted_count,
       count(*)::int as total_count,
       coalesce(sum(c.quantity_claimed) filter (
         where c.status = 'completed' and c.completed_at is not null
           and lower(coalesce(sl.unit,'')) in ('g','gram','grams','kg','kilogram','kilograms','oz','ounce','ounces','lb','lbs','pound','pounds','ml','milliliter','milliliters','l','liter','liters')
       ), 0)::double precision as weight_volume
     from surplus_listings sl join claims c on c.listing_id = sl.id
     where sl.user_id = $1 and c.claimer_id <> $1`,
    [userId]
  );
  const r = rows[0];

  await maybeAward(client, userId, "first_share", r.completed_count >= 1,
    { badgeFamily: "sharing_credibility", completedShareCount: r.completed_count }, "First Share awarded");
  await maybeAward(client, userId, "neighborhood_provider", r.completed_count >= 10,
    { badgeFamily: "sharing_credibility", completedShareCount: r.completed_count }, "Neighborhood Provider awarded");
  await maybeAward(client, userId, "abundance_giver", r.weight_volume >= 25.0,
    { badgeFamily: "sharing_credibility", weightVolume: r.weight_volume }, "Abundance Giver awarded");

  // Consistency streak
  const { rows: monthRows } = await client.query(
    `select date_trunc('month', c.completed_at at time zone 'utc')::date as m, count(*)::int as cnt
     from surplus_listings sl join claims c on c.listing_id = sl.id
     where sl.user_id = $1 and c.claimer_id <> $1 and c.status = 'completed' and c.completed_at is not null
     group by 1 order by 1 asc`,
    [userId]
  );
  let longest = 0, current = 0, prev = null;
  for (const row of monthRows) {
    const d = new Date(row.m);
    const idx = d.getFullYear() * 12 + d.getMonth();
    current = (prev !== null && idx === prev + 1) ? current + 1 : 1;
    if (current > longest) longest = current;
    prev = idx;
  }
  await maybeAward(client, userId, "consistency_giver", longest >= 3,
    { badgeFamily: "sharing_credibility", longestStreak: longest }, "Consistency Giver awarded");

  const ratio = r.total_count === 0 ? 0 : r.completed_count / r.total_count;
  await maybeAward(client, userId, "reliable_grower",
    r.completed_count >= 10 && ratio >= 0.9 && r.disrupted_count <= 1,
    { badgeFamily: "sharing_credibility", completedShareCount: r.completed_count, completionRatio: ratio }, "Reliable Grower awarded");
}

async function syncPracticeBadges(client, userId) {
  const { rows } = await client.query(
    `with scoped_evidence as (
       select lower(coalesce(ai_crop_label,'')) as crop_label, lower(coalesce(ai_stage_label,'')) as stage_label,
              coalesce(ai_crop_confidence::double precision,0) as crop_conf, coalesce(ai_stage_confidence::double precision,0) as stage_conf,
              coalesce(exif_taken_at, captured_at, created_at) as observed_at
       from badge_evidence_submissions where user_id = $1 and status in ('auto_approved','needs_review')
     )
     select
       count(*) filter (where crop_label like any(array['%herb%','%basil%','%mint%','%cilantro%','%parsley%']) and greatest(crop_conf,stage_conf) >= 0.8)::int as herb_count,
       count(*) filter (where crop_label like any(array['%flower%','%pollinator%','%lavender%','%bee balm%','%native%']) and greatest(crop_conf,stage_conf) >= 0.8)::int as pollinator_count,
       count(*) filter (where stage_label like any(array['%irrig%','%watering%','%mulch%']) and greatest(crop_conf,stage_conf) >= 0.8)::int as water_wise_count,
       count(*) filter (where crop_label like any(array['%compost%','%compostable%','%soil amendment%']) and greatest(crop_conf,stage_conf) >= 0.8)::int as compost_count,
       count(*) filter (where extract(month from observed_at at time zone 'utc') between 3 and 5)::int as spring_count,
       count(*) filter (where extract(month from observed_at at time zone 'utc') between 9 and 11)::int as fall_count
     from scoped_evidence`,
    [userId]
  );
  const r = rows[0];
  await maybeAward(client, userId, "herb_whisperer", r.herb_count >= 3, { badgeFamily: "garden_practice", count: r.herb_count }, "Herb Whisperer awarded");
  await maybeAward(client, userId, "pollinator_friend", r.pollinator_count >= 3, { badgeFamily: "garden_practice", count: r.pollinator_count }, "Pollinator Friend awarded");
  await maybeAward(client, userId, "water_wise", r.water_wise_count >= 4, { badgeFamily: "garden_practice", count: r.water_wise_count }, "Water Wise awarded");
  await maybeAward(client, userId, "compost_champion", r.compost_count >= 4, { badgeFamily: "garden_practice", count: r.compost_count }, "Compost Champion awarded");
  await maybeAward(client, userId, "season_starter", r.spring_count >= 2, { badgeFamily: "garden_practice", seasonWindow: "spring", count: r.spring_count }, "Season Starter awarded");
  await maybeAward(client, userId, "season_finisher", r.fall_count >= 2, { badgeFamily: "garden_practice", seasonWindow: "fall", count: r.fall_count }, "Season Finisher awarded");
}

// ── user id extraction ───────────────────────────────────────────────────────

function extractUserIds(detail) {
  // claim events carry claimerId + listingOwnerId (refresh both)
  if (detail.claimerId || detail.listingOwnerId) {
    return [detail.claimerId, detail.listingOwnerId].filter(Boolean);
  }
  // listing, request, and profile events carry userId
  return detail.userId ? [detail.userId] : [];
}

// ── handler ──────────────────────────────────────────────────────────────────

async function refreshForUser(client, userId, correlationId) {
  await syncBadges(client, userId);

  const signals = await computeExperienceSignals(client, userId);
  const level = assignExperienceLevel(signals);
  await persistExperienceLevel(client, userId, level, signals);

  await evaluateGardenerTier(client, userId);

  await client.query(
    `insert into premium_analytics_events (user_id, event_name, event_source, metadata)
     values ($1, 'profile.derived.refreshed', 'worker', $2::jsonb)`,
    [userId, JSON.stringify({ correlationId, experienceLevel: level })]
  );

  return level;
}

export async function handler(event) {
  const detail = event.detail ?? {};
  const correlationId = detail.correlationId ?? "unknown";
  const detailType = event["detail-type"] ?? "unknown";
  const userIds = extractUserIds(detail);

  if (userIds.length === 0) {
    console.warn("No userId(s) in event detail, skipping", JSON.stringify(event));
    return { statusCode: 200, body: "skipped: no userId" };
  }

  console.log(JSON.stringify({ message: "Processing profile derived data", detailType, userIds, correlationId }));

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const userId of userIds) {
      const level = await refreshForUser(client, userId, correlationId);
      console.log(JSON.stringify({ message: "Profile derived data refreshed", userId, correlationId, experienceLevel: level }));
    }
    return { statusCode: 200, body: "ok" };
  } finally {
    await client.end();
  }
}
