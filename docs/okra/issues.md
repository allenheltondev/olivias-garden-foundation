# Okra - MVP Issues (Dependency Ordered)

> Create in this order. Dependencies are explicit so work stays linear and solo-friendly.

## Issue 1 - Repo scaffolding + conventions

**Title:** `[Foundation] Initialize Okra structure and engineering conventions`

**Description:**
- Add monorepo/simple workspace structure (`frontend`, `backend`, `infra`, `db`).
- Pin Node.js 24 in tooling/docs.
- Set backend structure to match Good Roots Network style:
  - AWS SAM template
  - esbuild bundling for Lambdas
  - eslint + unit test baseline
- Add formatter/linter/test scripts and baseline README updates.

**Depends on:** none

---

## Issue 2 - Database schema + migration baseline

**Title:** `[Data] Implement MVP PostgreSQL schema from db/ddl.sql`

**Description:**
- Apply schema for submissions, photos, admin users, edit tokens.
- Add migration workflow and seed script for local/dev.

**Depends on:** #1

---

## Issue 3 - S3 buckets + CloudFront + static hosting

**Title:** `[Infra] Provision frontend hosting and media buckets`

**Description:**
- Frontend static bucket + CloudFront distribution.
- Private media bucket for originals/normalized photos.
- Bucket policies/CORS for pre-signed uploads.

**Depends on:** #1

---

## Issue 4 - API skeleton (Node.js 24)

**Title:** `[API] Create HTTP API + Lambda routing skeleton (Node.js 24)`

**Description:**
- API Gateway HTTP API + Lambda entrypoint.
- Health endpoint and shared request/response/error patterns.

**Depends on:** #1, #3

---

## Issue 5 - Public submit API

**Title:** `[Submit] Create submission endpoint with pending_review lifecycle`

**Description:**
- `POST /submissions` for contributor details, privacy mode, display coordinates.
- Persist pending submission in DB.
- Validation for required fields and coordinate bounds.

**Depends on:** #2, #4

---

## Issue 6 - Pre-signed upload intent API

**Title:** `[Media] Implement pre-signed upload intent + photo record creation`

**Description:**
- `POST /submissions/:id/photos/upload-intent`
- Return signed URL and S3 key.
- Create `submission_photos` row in `uploaded` state.

**Depends on:** #2, #4, #5

---

## Issue 7 - Image processor Lambda

**Title:** `[Media] Process uploads: normalize/transcode/thumbnail + EXIF strip`

**Description:**
- S3 event -> Lambda (Node.js 24 + sharp).
- Generate normalized + thumbnail outputs.
- Update photo status (`processing` -> `ready`/`failed`).

**Depends on:** #3, #6

---

## Issue 8 - Admin auth + authorization

**Title:** `[Admin] Add Cognito-based admin auth guard`

**Description:**
- Reuse existing Good Roots Network Cognito User Pool when applicable.
- API auth middleware for admin-only routes.
- Seed/allowlist first admin account/group mapping.
- Support importing pool/client IDs via SAM parameters or stack exports/SSM.

**Depends on:** #4

---

## Issue 9 - Review queue API

**Title:** `[Review] Build admin review queue endpoints (approve/deny)`

**Description:**
- `GET /admin/submissions?status=pending_review`
- `POST /admin/submissions/:id/approve`
- `POST /admin/submissions/:id/deny`
- Optional pin adjustment at approval time.

**Depends on:** #2, #5, #7, #8

---

## Issue 10 - Public map API

**Title:** `[Map] Provide approved submissions feed for world map pins`

**Description:**
- `GET /public/map-pins`
- Return approved entries + media metadata for popups/gallery.
- Keep raw/private location details excluded.

**Depends on:** #2, #7, #9

---

## Issue 11 - Frontend submit page (Vite + React)

**Title:** `[Frontend] Build public submission flow with map pin + photo upload`

**Description:**
- Form fields (location, privacy mode, photo required, optional name/story/email).
- Map picker for display point.
- Upload via pre-signed URL.

**Depends on:** #3, #5, #6

---

## Issue 12 - Frontend public world map

**Title:** `[Frontend] Build public approved map with pin detail cards`

**Description:**
- World map with clustered pins.
- Click pin to view photo(s) and details.

**Depends on:** #3, #10

---

## Issue 13 - Frontend admin review queue

**Title:** `[Frontend] Build admin queue UI for approve/deny workflow`

**Description:**
- Pending list view with images and submission details.
- Approve/deny actions and optional pin adjustment.

**Depends on:** #8, #9

---

## Issue 14 - Edit link flow (no-login update path)

**Title:** `[Updates] Add secure email edit-link flow for one-off contributors`

**Description:**
- Create + hash + expire edit tokens.
- Optional endpoint to request edit link by email.
- Allow adding photos/notes to existing submission via token.

**Depends on:** #2, #5, #6

---

## Issue 15 - MVP hardening + launch checklist

**Title:** `[Launch] MVP hardening checklist and deployment runbook`

**Description:**
- Basic rate limits and input validation pass.
- Smoke test runbook.
- Recovery notes for common failures.
- Final docs for one-person operations.

**Depends on:** #11, #12, #13
