---
inclusion: auto
description: Core product vision, principles, target users, AI boundaries, and success metrics for the community food coordination platform.
---

# Product Vision – Community Food Coordination Platform

## Purpose

Build a location-aware platform that helps local communities coordinate food surplus by connecting growers with nearby individuals and organizations seeking fresh food. The product reduces waste and improves access by improving timing, awareness, and coordination rather than increasing production.

The product is built around the gardener. It supports human judgment and follow-through. AI is used to surface context and summaries that are difficult for individuals to see on their own, while keeping agency with users.

## Target Users

### First Wedge
The first target users are growers using phones. The initial product experience must be fast to learn, low friction, and usable one-handed in real-world conditions.

### User Types
- **Growers**: Home gardeners, homesteaders, small farms, and community gardens
- **Searchers**: Families, food banks, community kitchens, schools, and mutual aid organizations

## Product Principles

* **Built around people, not optimization.** The platform supports human decisions and coordination rather than enforcing efficiency.
* **Community-aware, privacy-first.** Insights come from aggregated signals scoped to a local context.
* **Low friction.** Participating should be easier than informal coordination.
* **Explainable AI.** AI outputs are optional and understandable.
* **Event-driven by default.** The system reacts to changes through events and derived views.

## Community Model

Communities are defined implicitly through geographic proximity and participation rather than explicit group membership. Insights and coordination are scoped to a localized context, not a national view, enabling the product to scale broadly while staying locally relevant.

## Core Capabilities

### Grower Workspace
* Declare planned crops for a season
* Declare available or upcoming surplus with a time window
* Receive AI-assisted planting guidance based on seasonality and aggregated community trends
* See private, non-competitive impact feedback

### Searcher Workspace
* Discover available and upcoming food within a local context
* Submit requests for items and quantities
* Coordinate pickup windows and receive updates

## AI Role and Boundaries

### AI Responsibilities
* Summarize upcoming availability for a local context and time window
* Surface community-level imbalances, such as likely overrepresented and underrepresented crops
* Provide optional grower guidance with clear reasoning

### AI Non-Goals
* Predict exact yields
* Decide allocations or who receives food
* Automate commitments or coordination

**Critical constraint:** AI outputs may only create or update derived data. AI must not mutate core transactional records.

## Gamification Posture

Recognition reinforces participation and reliability, not production volume.

### Allowed
* Private milestones, streaks, seasonal participation
* Contribution summaries and impact highlights

### Disallowed
* Leaderboards or competitive rankings
* Scarcity-based rewards
* Incentives that pressure overproduction

## Success Metrics

### Measure
* Reduced waste for declared surplus
* Increased successful coordination events
* Improved predictability of availability
* Sustained participation across seasons

### Explicitly Avoid
* Raw volume
* Yield increases
* Competitive contribution scores
