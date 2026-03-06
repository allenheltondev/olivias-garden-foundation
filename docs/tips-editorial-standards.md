# Tips Editorial Standards

Issue: #135

## Voice and tone
- Use plain, practical language.
- Prefer short, direct actions over theory.
- Avoid fear-based phrasing.

## Safety guardrails
- No medical, legal, or pesticide-licensing advice.
- No claims of guaranteed outcomes.
- Prefer low-risk, reversible recommendations.

## Metadata requirements (required for every tip)
- `schemaVersion`: currently `tips.v1`
- `category`: one of `watering`, `pests`, `planting`, `soil`, `seasonal`, `harvest`
- `level`: `beginner`, `intermediate`, or `advanced`
- `season` and targeting `seasons`
- targeting `zoneTags`
- targeting `cropTags`

Tips missing targeting metadata fail catalog validation at startup.

## Practical quality bar
- Action should be observable in a home/community garden.
- Include enough context to execute in one session.
- Keep advice conservative for mixed climates and skill levels.
