

**Olivia's Garden Foundation**

*Platform Architecture & Build Plan*

In honor of Olivia  •  2020–2024

| MISSION | To honor Olivia and her love of homesteading by educating our community, sharing the joy of growing, and connecting people through food and land. |
| :---: | :---- |

# **1\. Platform Overview**

The Olivia's Garden Foundation platform is a unified digital presence connecting the foundation's story, programs, operations, and community tools under one roof. Everything shares a single identity, single auth, and single design system.

## **1.1 Core Initiatives**

| Foundation | oliviasgarden.org — home, Olivia's story, mission, classes, shop, fundraising |
| :---- | :---- |
| **The Okra Project** | oliviasgarden.org/okra — global seed map, seed requests, grower photo gallery |
| **Good Roots Network** | grn.oliviasgarden.org — connecting local gardeners with neighbors who need food |
| **Admin** | admin.oliviasgarden.org — internal operations for the foundation team |

## **1.2 Domain Structure**

| oliviasgarden.org | Foundation home — story, classes, shop, fundraising, pasture naming |
| :---- | :---- |
| **oliviasgarden.org/okra** | Okra Project SPA — map, seed requests, photo submissions |
| **grn.oliviasgarden.org** | Good Roots Network — full app, own subdomain, shared auth |
| **admin.oliviasgarden.org** | Admin UI — operations, approvals, donor management, order fulfillment |

| NOTE | The Okra Project lives under the main domain (not a subdomain) because it is as much a memorial and story as it is an app. It draws people into the foundation. Good Roots earns a subdomain because it is a standalone product with its own users. |
| :---: | :---- |

**2\. Technical Architecture**

## **2.1 Frontend — Monorepo**

Single Turborepo containing all frontend apps and shared packages. All apps use React 19 \+ Vite for consistency.

| apps/web | oliviasgarden.org — Next.js or Vite SPA for foundation home |
| :---- | :---- |
| **apps/okra** | Okra Project — migrated and rebuilt clean inside monorepo |
| **apps/grn** | Good Roots Network — migrated frontend, shared auth \+ UI |
| **apps/admin** | Admin UI — internal ops, role-gated, Cognito admin claim |
| **packages/ui** | Shared component library — Olivia's design system, brand tokens |
| **packages/auth** | Shared auth utilities — Cognito hooks, JWT helpers, role checks |

## **2.2 Backend — AWS Serverless (SAM)**

One SAM project per bounded domain. Shared infrastructure lives in a separate stack exported via CloudFormation outputs.

| foundation-api | Donations, pasture naming, class registration, Stripe webhooks, shop orders |
| :---- | :---- |
| **okra-api** | Seed requests, photo submissions, approval queue, map pin data |
| **grn-api** | Good Roots Network — existing SAM project migrated into foundation AWS account |
| **infra (shared)** | Cognito user pool, Route 53, ACM certs, shared DynamoDB tables, SES, SNS |

| PATTERN | Synchronous/user-facing Lambda handlers are written in Rust. Async background jobs (notifications, approvals, email sends, Slack posts) are written in Node. This pattern is already established in Good Roots and carries forward. |
| :---: | :---- |

## **2.3 Auth — Single Cognito User Pool**

One Cognito user pool serves all apps. Each app gets its own App Client. Role claims on the JWT gate admin access.

| User Pool | Single pool in the shared infra SAM stack |
| :---- | :---- |
| **App Clients** | One per app: web, okra, grn, admin |
| **Login methods** | Google OAuth \+ email magic link |
| **Roles** | admin (full access), contributor (approvals/fulfillment only), user (public) |
| **Admin gate** | Custom JWT claim checked in packages/auth — admin.oliviasgarden.org is role-gated |

## **2.4 Payments — Stripe**

Stripe handles all money movement. No custom payment logic.

| Merch / shop | Stripe product catalog, custom storefront UI in apps/web |
| :---- | :---- |
| **Homestead goods** | Same Stripe catalog, fulfillment tracked in admin |
| **Donations** | Stripe Checkout or Payment Links, one-time and recurring |
| **Pasture naming** | $500 annual donation tier, donor linked to named pasture record in DynamoDB |
| **Class registration** | Stripe Checkout per class, capacity enforced in foundation-api |
| **Nonprofit rate** | Apply once 501(c)(3) is approved — drops to \~0.7% \+ 5c vs standard 2.9% \+ 30c |

## **2.5 Slack — Operational Nervous System**

Day-to-day foundation operations run through Slack. A dedicated Slack app with interactivity enabled posts events and receives button actions back via API Gateway.

| \#okra-requests | Incoming seed requests — approve/fulfill buttons post back to okra-api |
| :---- | :---- |
| **\#okra-photos** | Photo submissions — image renders inline, approve/reject in Slack |
| **\#pasture-naming** | Payment cleared — donor details, prompt to send welcome message |
| **\#orders** | Shop and homestead goods orders needing fulfillment |
| **\#grn-activity** | Good Roots notable events — new listings, connections made |
| **Slash commands** | /okra approve {id}, /seed fulfill {id} — Lambdas handle, update DDB, send confirmation email |

# **3\. Admin Roles**

The admin app is used by the foundation team for daily operations. It is designed to be clear and usable without technical knowledge.

| Admin | Full access. You and your wife. Financials, donor management, all settings, class management, all approvals. |
| :---- | :---- |
| **Contributor** | Friends taking GitHub issues. Can approve okra photos, fulfill seed requests, and manage shop orders. No access to financials or donor records. |
| **User** | Public account. Donors, class registrants, Good Roots users, seed requesters. No admin access. |

| KEY FLOWS FOR WIFE | Pasture naming: see donor, manage renewal, send thank you and pasture photo update. Okra photos: see image inline, approve or reject. Class management: view registrations, mark attendance, manage capacity. |
| :---: | :---- |

# **4\. Phased Build Plan**

Four phases sequenced to deliver value early, avoid migration risk up front, and build on a proven foundation before touching Good Roots.

| PHASE 1  Foundation First *Weeks 1–6   |   Greenfield — no migration burden* |
| :---- |

Stand up the core platform. Everything else plugs into what gets built here.

**Infra & Auth**

* Create shared infra SAM stack — Cognito user pool, Route 53, ACM certs, SES

* Configure Cognito app clients for web, okra, admin

* Set up Google OAuth and email magic link login

* Establish monorepo with Turborepo — apps/web, packages/ui, packages/auth

**Foundation Home (oliviasgarden.org)**

* Olivia's story — who she was, the foundation's why

* Mission and program overview

* Donation page — Stripe Checkout, one-time and recurring

* Pasture naming page — $500 tier, donor flow, DynamoDB record creation

* Email confirmation and receipt on donation (SES)

**Design System (packages/ui)**

* Brand tokens — Olivia's color palette, typography, spacing

* Core components — buttons, cards, nav, footer, forms

* Used by all apps from this point forward

**Admin — Phase 1 Scope**

* Pasture naming management — list of named pastures, donor info, renewal dates

* Donation history view (Stripe data surfaced in admin)

* Slack integration — pasture naming payment cleared notification

| PHASE 2  The Okra Project *Weeks 7–12   |   Rebuild clean — small scope, high meaning* |
| :---- |

Bring the Okra Project home. Rebuild it clean inside the monorepo on shared auth and shared UI. This is the most emotionally central piece of the platform.

**Okra SPA (apps/okra)**

* Rebuild existing SPA inside monorepo — React 19 \+ Vite

* World map with pins showing active growers

* Seed request form — name, location, message, stores to DynamoDB

* Photo submission flow — authenticated users submit plant photos

* Async approval — you approve/reject via Slack or admin UI

* Approved photos appear on the grower's pin on the map

**Okra API (okra-api SAM project)**

* Seed request handler (Rust) — validates, stores, posts to \#okra-requests Slack channel

* Photo upload handler (Rust) — presigned S3 URL, metadata to DDB

* Approval handler (Node) — Slack interactivity endpoint, updates DDB status, notifies submitter

* Map data handler (Rust) — returns approved pins for map render

**Admin — Phase 2 Additions**

* Seed request queue — list, details, approve/fulfill button

* Photo approval queue — image inline, approve/reject

* Grower map management — remove pins, flag inactive growers

* Slack channels — \#okra-requests and \#okra-photos active

| PHASE 3  Shop & Classes *Weeks 13–18   |   Greenfield on proven foundation* |
| :---- |

Add the commerce and education layer to the foundation home. Pattern is established, Stripe is already wired.

**Shop (oliviasgarden.org/shop)**

* Merch catalog — Stripe product API, custom storefront UI

* Homestead goods — seasonal items, fulfillment tracked in admin

* Cart and checkout — Stripe Checkout

* Order confirmation email (SES)

**Classes (oliviasgarden.org/classes)**

* Class calendar — upcoming events, descriptions, capacity

* Registration flow — Stripe Checkout per class

* Capacity enforcement — foundation-api checks seat count before allowing registration

* Admin class management — view registrations, mark attendance, close registration

**Admin — Phase 3 Additions**

* Order fulfillment queue — new shop orders, mark shipped

* Class management — registrant list, attendance, capacity controls

* Slack \#orders channel active

| PHASE 4  Good Roots Network Migration *Weeks 19–28   |   Migration — largest effort* |
| :---- |

Bring Good Roots Network into the family. This is the most complex phase because it involves migrating an existing production app, not building greenfield. By Phase 4 the monorepo patterns are proven, auth is stable, and shared UI is mature.

**Backend Migration**

* Move grn-api SAM project into foundation AWS account

* Migrate DynamoDB tables — data migration scripts, validate parity

* Update Cognito app client to use shared user pool

* Audit and update IAM roles and resource policies

* Smoke test all existing GRN API endpoints

**Frontend Migration (apps/grn)**

* Move GRN frontend into monorepo as apps/grn

* Replace auth layer with packages/auth (shared Cognito)

* Replace component library with packages/ui where applicable

* Subdomain — grn.oliviasgarden.org

* Cross-link from oliviasgarden.org — foundation pushes GRN as an initiative

**Admin & Slack — Phase 4 Additions**

* GRN moderation in admin — flag listings, manage users

* \#grn-activity Slack channel — notable connections, new listings

| NOTE | GRN merch and foundation cross-promotion (people finding GRN through the foundation, merch that carries the GRN brand) are marketing decisions that can be executed independently of the technical migration. |
| :---: | :---- |

# **5\. GitHub Issues Framework**

Issues should be scoped so a contributor can pick one up without context outside the issue itself. Suggested labels and structure:

| Labels | phase-1, phase-2, phase-3, phase-4, infra, frontend, backend, admin, slack, design, migration |
| :---- | :---- |
| **Size** | S (\< 2hrs), M (half day), L (full day), XL (multi-day — break it up) |
| **Template** | Context, Acceptance Criteria, AWS/Stripe resources involved, Related issues |
| **Assignees** | You, wife (admin/UX feedback issues only), friend 1, friend 2 |

**Recommended first 10 issues to create after this doc:**

* **INFRA** Scaffold Turborepo monorepo with apps/web, packages/ui, packages/auth

* **INFRA** Create shared infra SAM stack — Cognito user pool, Route 53, SES

* **INFRA** Configure Cognito Google OAuth and magic link login

* **DESIGN** Build packages/ui foundation — brand tokens, Button, Card, Nav, Footer

* **FRONTEND** Build packages/auth — useAuth hook, JWT utilities, role check helpers

* **FRONTEND** Build oliviasgarden.org home page — Olivia's story, mission section

* **FRONTEND** Build donation page — Stripe Checkout integration, one-time \+ recurring

* **FRONTEND** Build pasture naming page and DynamoDB record creation

* **ADMIN** Build admin pasture naming view — list, donor info, renewal dates

* **SLACK** Set up Slack app — webhook, interactivity endpoint, \#pasture-naming channel

# **6\. Open Decisions**

Items to decide before or during Phase 1:

| oliviasgarden.org vs .com | Foundation URLs are typically .org — confirm domain availability and register |
| :---- | :---- |
| **Next.js vs Vite SPA** | If SEO matters for oliviasgarden.org home (it probably does for donor discovery), Next.js is worth it for the main site. Apps/okra and apps/grn stay Vite. |
| **DynamoDB table design** | Single-table per SAM project or cross-domain shared tables. Decide before Phase 1 infra work. |
| **Stripe nonprofit rate** | File 501(c)(3) as soon as possible. Apply for nonprofit Stripe rate once approved. |
| **Class format** | In-person only at the property, or virtual option? Affects registration flow complexity. |

*Olivia's Garden Foundation  •  Platform Architecture v1.0  •  Built with love*