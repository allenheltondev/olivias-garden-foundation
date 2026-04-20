Got it â€” if you donâ€™t want separate profile endpoints, the clean MVP move is:

* **Keep `GET /me`**
* **Use a single `PUT /me`** for:

  * userType selection
  * profile fields (grower or gatherer)
  * onboarding completion once the required profile for that userType is present

Below is your doc updated in place to reflect that. I removed `/me/grower-profile` and `/me/gatherer-profile`, and updated the flow, schemas, types, properties, error handling, and idempotency notes accordingly.

---

# Design Document: User Onboarding Flow

## Overview

This design implements a first-time user onboarding flow that detects new users, guides them through user type selection (**Grower vs Gatherer**), and collects the minimum required information to provide value. The design follows the platform's mobile-first philosophy, emphasizing low friction and fast time-to-value.

The onboarding flow bridges Phase 0 (Foundations) and Phase 1 (Grower-first MVP) by adding support for a second user type (**Gatherers**) while maintaining the existing grower functionality. This enables Phase 2 (Searcher Basics) by establishing the user type distinction and access control patterns.

### User Type Naming Decision

After considering options like "Recipient" and other domain labels, we've chosen **"Gatherer"** as the name for non-grower users. This name is:

* Dignity-first and avoids implying dependency
* Clear about the role (finding and collecting food)
* Concise and easy to understand
* Appropriate for diverse users (individuals, non-profits, social workers, community organizations)
* Parallel to "Grower" in structure (both are active agent nouns)

### Key Design Principles

1. **Progressive Disclosure**: Block access to main app until onboarding is complete
2. **Minimal Friction**: Collect only essential information during onboarding
3. **Mobile-First**: Design for one-handed interaction

### High-Level Flow

```
Auth â†' GET /me â†' onboardingCompleted?
   â”œâ”€ true  â†' Main App
   â””â”€ false â†' Select Type (Grower/Gatherer)
                 â†“
           Type-specific Wizard
                 â†“
            PUT /me (type + profile)
                 â†“
           Mark Complete
                 â†“
              Main App
```

---

## Backend Components

1. **User Handler** (`backend/src/handlers/user.rs`)

   * GET /me - Returns user profile with onboarding status and (if present) profile data
   * PUT /me - Updates user profile:

     * userType selection
     * role-specific profile data (grower or gatherer)
     * sets onboardingCompleted when required fields are satisfied

2. **Authorization Module** (`backend/src/auth/authorization.rs`)

   * Checks user_type from JWT context
   * Enforces feature access control
   * Returns 403 for unauthorized actions

3. **Database Layer**

   * PostgreSQL: Add user_type, onboarding_completed to users table
   * PostgreSQL: Create gatherer_profiles table
   * (Existing) PostgreSQL: grower_profiles table continues to exist
   * DynamoDB: Add user_type to USER#<id>#PROFILE items
   * DynamoDB: Create/maintain GATHERER_PROFILE items (and existing GROWER_PROFILE items)

---

## Data Flow

```
Frontend                    API                     Database
   |                         |                          |
   |-- GET /me ------------>|                          |
   |                         |-- Query user profile -->|
   |                         |<-- User + onboarding ---|
   |<-- User profile --------|                          |
   |                         |                          |
   |-- PUT /me ------------>|                          |
   |   (userType + profile)  |                          |
   |                         |-- Validate payload ----->|
   |                         |-- Persist user + profile>|
   |                         |-- Mark onboarding done ->|
   |                         |<-- Success --------------|
   |<-- Updated profile -----|                          |
```

---

## Components and Interfaces

### Frontend Components

#### 1. OnboardingGuard Component

```typescript
interface OnboardingGuardProps {
  children: React.ReactNode;
}

function OnboardingGuard({ children }: OnboardingGuardProps): JSX.Element {
  const { user, isLoading } = useUser();

  if (isLoading) return <LoadingScreen />;
  if (!user?.onboardingCompleted) return <OnboardingFlow />;
  return <>{children}</>;
}
```

#### 2. OnboardingFlow Component

```typescript
type OnboardingStep = 'user-type' | 'grower-wizard' | 'gatherer-wizard';

interface OnboardingFlowState {
  step: OnboardingStep;
  userType: 'grower' | 'gatherer' | null;
}

function OnboardingFlow(): JSX.Element {
  const [state, setState] = useState<OnboardingFlowState>({
    step: 'user-type',
    userType: null
  });

  // Render appropriate step component
  // On final submit, call PUT /me with userType + profile payload
}
```

#### 3. UserTypeSelection Component

```typescript
interface UserTypeSelectionProps {
  onSelect: (userType: 'grower' | 'gatherer') => Promise<void>;
}

function UserTypeSelection({ onSelect }: UserTypeSelectionProps): JSX.Element {
  // Display two cards with descriptions
  // Update local state; optionally persist selection via PUT /me immediately
}
```

#### 4. GrowerWizard Component

```typescript
interface GrowerProfileData {
  homeZone: string;
  location: { lat: number; lng: number };
  shareRadiusKm: number;
  units: 'metric' | 'imperial';
  locale: string;
}

interface GrowerWizardProps {
  onComplete: (data: GrowerProfileData) => Promise<void>;
}

function GrowerWizard({ onComplete }: GrowerWizardProps): JSX.Element {
  // Multi-step form for grower data
  // onComplete -> PUT /me with { userType: 'grower', growerProfile: {...} }
}
```

#### 5. GathererWizard Component

```typescript
interface GathererProfileData {
  location: { lat: number; lng: number };
  searchRadiusKm: number;
  organizationAffiliation?: string;
  units: 'metric' | 'imperial';
  locale: string;
}

interface GathererWizardProps {
  onComplete: (data: GathererProfileData) => Promise<void>;
}

function GathererWizard({ onComplete }: GathererWizardProps): JSX.Element {
  // Multi-step form for gatherer data
  // onComplete -> PUT /me with { userType: 'gatherer', gathererProfile: {...} }
}
```

---

## Backend API Endpoints

### GET /me

**Purpose**: Retrieve current user profile with onboarding status and optional profile data

**Response**:

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "userType": "grower" | "gatherer" | null,
  "onboardingCompleted": true,
  "tier": "free" | "supporter" | "pro",
  "growerProfile": {
    "homeZone": "8a",
    "geoKey": "9q8yy9",
    "lat": 37.7749,
    "lng": -122.4194,
    "shareRadiusKm": 5.0,
    "units": "imperial",
    "locale": "en-US"
  },
  "gathererProfile": null
}
```

Notes:

* Only one of `growerProfile` or `gathererProfile` is expected to be non-null for MVP.

### PUT /me

**Purpose**: Update user profile, including user type selection and role-specific profile data.

**Request**:

```json
{
  "displayName": "Jane Doe",
  "userType": "grower" | "gatherer",
  "growerProfile": {
    "homeZone": "8a",
    "lat": 37.7749,
    "lng": -122.4194,
    "shareRadiusKm": 5.0,
    "units": "imperial",
    "locale": "en-US"
  },
  "gathererProfile": {
    "lat": 37.7749,
    "lng": -122.4194,
    "searchRadiusKm": 10.0,
    "organizationAffiliation": "SF Food Bank",
    "units": "metric",
    "locale": "en-US"
  }
}
```

Rules:

* `userType` is required if onboarding is incomplete.
* Exactly one of `growerProfile` or `gathererProfile` should be provided in a single request.
* The provided profile object must match `userType`.
* Server computes `geoKey` from lat/lng and persists it.

**Response**:

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "userType": "grower" | "gatherer",
  "onboardingCompleted": true,
  "tier": "free",
  "growerProfile": { "...": "..." },
  "gathererProfile": null
}
```

**Side Effects**:

* Upserts the role-specific profile record
* Sets onboarding_completed = true when required fields are satisfied

**Validation**:

* If userType = grower:

  * shareRadiusKm > 0
  * homeZone format valid
  * lat/lng in valid ranges
  * units in {metric, imperial}
* If userType = gatherer:

  * searchRadiusKm > 0
  * lat/lng in valid ranges
  * units in {metric, imperial}

**Authorization**:

* Requires valid JWT
* User can only update their own profile

---

## Authorization Module

```rust
pub enum UserType {
    Grower,
    Gatherer,
}

pub struct AuthContext {
    pub user_id: String,
    pub user_type: Option<UserType>,
    pub tier: String,
}

pub fn extract_auth_context(event: &Request) -> Result<AuthContext, Error>;
pub fn require_grower(ctx: &AuthContext) -> Result<(), Error>;
pub fn require_user_type(ctx: &AuthContext, required: UserType) -> Result<(), Error>;
```

Protected endpoints and open endpoints remain the same.

---

## Data Models

### PostgreSQL Schema Updates

#### users table (modifications)

```sql
ALTER TABLE users
  ADD COLUMN user_type text CHECK (user_type IN ('grower', 'gatherer')),
  ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;

CREATE INDEX idx_users_user_type ON users(user_type) WHERE user_type IS NOT NULL;

UPDATE users u
SET
  user_type = 'grower',
  onboarding_completed = true
WHERE EXISTS (
  SELECT 1 FROM grower_profiles gp WHERE gp.user_id = u.id
);
```

#### gatherer_profiles table (new)

```sql
CREATE TABLE gatherer_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  geo_key text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  search_radius_km numeric(8,3) NOT NULL DEFAULT 10.000,
  organization_affiliation text,
  units units_system NOT NULL DEFAULT 'imperial',
  locale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gatherer_profiles_radius_positive CHECK (search_radius_km > 0),
  CONSTRAINT gatherer_profiles_lat_range CHECK (lat >= -90 AND lat <= 90),
  CONSTRAINT gatherer_profiles_lng_range CHECK (lng >= -180 AND lng <= 180)
);

CREATE INDEX idx_gatherer_profiles_geo_key ON gatherer_profiles(geo_key);
```

---

### DynamoDB Schema Updates

#### User Profile Item (modifications)

```json
{
  "PK": "USER#<uuid>",
  "SK": "PROFILE",
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "userType": "grower" | "gatherer",
  "onboardingCompleted": true,
  "isVerified": false,
  "tier": "free",
  "createdAt": "2024-01-15T10:30:00Z",
  "deletedAt": null
}
```

#### Gatherer Profile Item (new)

**PK**: `USER#<user_id>`
**SK**: `GATHERER_PROFILE`

```json
{
  "PK": "USER#<uuid>",
  "SK": "GATHERER_PROFILE",
  "geoKey": "9q8yy9",
  "lat": 37.7749,
  "lng": -122.4194,
  "searchRadiusKm": 10.0,
  "organizationAffiliation": "SF Food Bank",
  "units": "metric",
  "locale": "en-US",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

GSI remains the same except naming:

* **GSI1PK**: `GEOHASH#<geohash_prefix>`
* **GSI1SK**: `GATHERER#<user_id>`

---

## TypeScript Types

```typescript
export type UserType = 'grower' | 'gatherer';

export interface User {
  userId: string;
  email: string;
  displayName: string;
  userType: UserType | null;
  onboardingCompleted: boolean;
  tier: 'free' | 'supporter' | 'pro';
  growerProfile?: GrowerProfile | null;
  gathererProfile?: GathererProfile | null;
}

export interface GrowerProfile {
  homeZone: string;
  geoKey: string;
  lat: number;
  lng: number;
  shareRadiusKm: number;
  units: 'metric' | 'imperial';
  locale: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GathererProfile {
  geoKey: string;
  lat: number;
  lng: number;
  searchRadiusKm: number;
  organizationAffiliation?: string;
  units: 'metric' | 'imperial';
  locale: string;
  createdAt?: string;
  updatedAt?: string;
}
```

---

## Rust Types

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UserType {
    Grower,
    Gatherer,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub user_id: String,
    pub email: String,
    pub display_name: String,
    pub user_type: Option<UserType>,
    pub onboarding_completed: bool,
    pub tier: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowerProfileInput {
    pub home_zone: String,
    pub lat: f64,
    pub lng: f64,
    pub share_radius_km: f64,
    pub units: String,
    pub locale: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GathererProfileInput {
    pub lat: f64,
    pub lng: f64,
    pub search_radius_km: f64,
    pub organization_affiliation: Option<String>,
    pub units: String,
    pub locale: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutMeRequest {
    pub display_name: Option<String>,
    pub user_type: Option<UserType>,
    pub grower_profile: Option<GrowerProfileInput>,
    pub gatherer_profile: Option<GathererProfileInput>,
}
```

---

## Geohash Calculation

Unchanged, but applies to both profiles and is computed server-side during PUT /me.

---

## Correctness Properties (updated)

Key changes: profile submission is now via **PUT /me** for both roles.

### Property 5: Profile creation completeness for growers

*For any* valid grower profile data, when submitted to PUT /me with userType = "grower" and growerProfile present, the system should upsert a grower_profiles record containing all provided fields (and derived geoKey).

### Property 6: Profile creation completeness for gatherers

*For any* valid gatherer profile data, when submitted to PUT /me with userType = "gatherer" and gathererProfile present, the system should create a gatherer_profiles record containing all provided fields (and derived geoKey).

### Property 7: Onboarding completion on profile creation

*For any* user, when their role-specific profile is successfully created via PUT /me, the system should set onboarding_completed = true on their user record.

(Other properties remain the same with â€œgathererâ€ terminology; endpoint references should be updated from /me/*-profile to /me.)

---

## Error Handling (updated)

### Validation Errors (400 Bad Request)

* Invalid user_type value (not "grower" or "gatherer")
* Missing required fields for the selected userType
* Both growerProfile and gathererProfile provided in the same request
* Profile provided that does not match userType
* Radius values <= 0
* Latitude outside [-90, 90]
* Longitude outside [-180, 180]
* Invalid homeZone format
* Invalid units value

### Authorization Errors (403 Forbidden)

* Gatherer attempting to create listing
* Gatherer attempting to access grower-specific endpoints

Error messages updated to â€œGatherersâ€.

---

If you want one more tightening pass: Iâ€™d recommend making **PUT /me** support *partial saves* during onboarding (e.g., userType only first), which will make the wizard resumable without needing extra endpoints. But the doc above already supports that shape with `user_type: Option<UserType>` and optional profile blocks.
