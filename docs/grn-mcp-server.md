# Good Roots Network MCP server

Good Roots Network exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server for **growers**, so a personal AI assistant can work with someone's
garden for them: log a harvest, check reminders, post extra produce to share,
browse what neighbors offer, claim some. The grower doesn't have to open the app.

It is a sibling of the operator server ([mcp-server.md](./mcp-server.md)) and is
built the same way: spec revision **2026-07-28** over Streamable HTTP, served
statelessly by `@modelcontextprotocol/server`, with 2025-era clients served
through the SDK's stateless fallback.

- **Endpoint:** `POST https://api.<domain>/grn-mcp` (stack output `McpServerUrl`
  of `ogf-grn-mcp-<env>`). The app's **Settings → API keys** page shows it.
- **Auth:** `Authorization: Bearer grnk_…`, the grower's own GRN API key.
- **Who:** every grower, on every plan. Each tool does what that grower's plan
  allows; Pro-only operations answer 403 for others and say so.
- **Code:** `services/grn-mcp/`:
  - `scripts/generate-operations.mjs` reads the spec into `src/generated/operations.json`
  - `src/catalog.mjs` decides which operations become tools
  - `src/grn-client.mjs` calls the GRN API
  - `src/handler.mjs` checks the key and runs the SDK
  - `src/handlers/mcp.mjs` is the Lambda adapter

## Connecting an assistant

1. In the app, **Settings → API keys → Create key** (name it after the assistant).
2. Add the server to the assistant with the key as a bearer token, for example:

```bash
# Claude Code
claude mcp add --transport http good-roots https://api.<domain>/grn-mcp \
  --header "Authorization: Bearer grnk_…"
```

Any MCP client that speaks Streamable HTTP and can send a header works the same
way. To cut an assistant off, revoke its key in the app.

API keys are **self-serve**: any grower can create one, with no access request
or approval. A grower may hold five live keys at once, and each key is
throttled and metered on the integration usage plan.

Keys are managed **only from a signed-in session**. The GRN API refuses every
`/me/api-keys` call made with an API key (403). The MCP server has no
key-management tools either. So a leaked key can't mint more keys that would
outlive its own revocation.

## Tools

Every GRN API operation is a tool unless it is excluded below. The tools are
**generated from the OpenAPI spec**: the tool name is the operation id in
snake_case (`listMyCrops` → `list_my_crops`). A tool's input has the path,
query and header parameters by name, and the request body as `body`, with the
spec's schemas. The SDK validates arguments against them before any call is made.

| Area | Tools |
|---|---|
| Profile | `get_me`, `put_me`, `get_public_user`, `get_my_entitlements` |
| Garden and crops | `list_my_crops`, `get_my_crop`, `create_my_crop`, `update_my_crop`, `delete_my_crop`, `list_my_beds`, `create_my_bed`, `update_my_bed`, `delete_my_bed`, `list_my_annotations`, `create_my_annotation`, `update_my_annotation`, `delete_my_annotation`, `get_my_garden_canvas`, `update_my_garden_canvas`, `create_garden_background_upload_url` |
| Harvests | `list_crop_harvests`, `record_crop_harvest`, `update_crop_harvest`, `delete_crop_harvest` |
| Journal | `get_journal`, `create_journal_note`, `delete_journal_note`, `create_journal_photo_upload_url` |
| Reminders | `list_reminders`, `create_reminder`, `update_reminder_status` |
| Sharing | `create_listing`, `update_listing`, `list_my_listings`, `get_my_listing`, `discover_listings`, `create_request`, `update_request`, `list_claims`, `create_claim`, `transition_claim` |
| Garden sharing | `get_my_garden_share_link`, `create_my_garden_share_link`, `revoke_my_garden_share_link`, `get_shared_garden` |
| Catalog | `list_catalog_crops`, `list_catalog_varieties` |
| Plan | `create_checkout_session` (an upgrade link), `get_pro_kpis` (Pro) |

Annotations come from the spec:
- `GET` is read-only.
- `DELETE` is destructive.
- `idempotentHint` is set for reads, deletes, writes that take an idempotency
  key, and `PUT`s the spec tags `Idempotent`. A `POST` without a key creates a
  new record each time, so a tag alone isn't enough.

Descriptions add what an assistant needs to know:
- Listings, requests and claims are seen by other growers, so it should confirm the details with the grower first.
- Operations that take an `Idempotency-Key` header **require** `idempotencyKey`,
  even where the API leaves it optional (`create_listing`, `create_request`,
  `update_reminder_status`). It's a new value per change and the same one on retry, so an assistant
  retrying after a lost response never posts the same listing twice.

### Excluded

| Operation | Why |
|---|---|
| `generateWeeklyPlan`, `generateGardenReview` | Call an AI model. The assistant using these tools is the model. |
| `getDerivedFeed` | Can generate an AI summary. |
| `listAgentTasks`, `createAgentTask`, `updateAgentTaskStatus` | Agent tasks are instructions a Pro worker later runs through an AI model. |
| `listApiKeys`, `getApiKey`, `createApiKey`, `updateApiKey`, `deleteApiKey`, `listMyApiAccessRequests`, `createApiAccessRequest` | A key must never manage keys: a leaked key could otherwise mint more. Keys are managed in the app. |
| `adminListApiAccessRequests`, `adminApproveApiAccessRequest`, `adminDenyApiAccessRequest` | Admin only; the operator MCP server has them. |
| `handleStripeWebhook` | Called by Stripe only. |
| `trackProEvent` | The app's own usage analytics, not a grower action. |

The tests keep this list honest. Every operation is either a tool or excluded
with a reason. An operation the spec tags `AI`, or any `/me/api-keys` or
`/admin/` path, must be excluded. An exclusion for an operation the spec no
longer has fails the build.

## How tools reach the API

Each tool is one call to the public GRN API, through API Gateway, **with the
grower's own key**, exactly as their own script would make it. The GRN
authorizer checks the key, the key's usage plan throttles and meters it, and
every ownership and tier check in grn-api applies. The MCP server holds no
credentials and no data of its own; its IAM role only writes logs. Each call
carries an `x-correlation-id`, which is also returned to the MCP client.

Logs name a call by its operation id and route template (`getSharedGarden`,
`/gardens/{token}`), never by the filled-in path. That path can hold a
credential, such as a garden share token, or a grower's ids. Keys are logged
only as a short hash.

The key is checked when a request arrives by asking the GRN API who it belongs
to (`GET /me`). A key the API refuses gets 401 at once; if the API can't be
asked, the answer is 503. A good result is remembered for a minute per
container, so a session doesn't pay for the check on every message. The API
still checks the key on every tool call, so revoking it in the app takes
effect immediately for tools. Only that cached check, which lets the server
list its tools, can outlast a revocation, by up to a minute.

Only `grnk_` keys are accepted. Signing in with OAuth, which assistants that
can't take a header need, is the next phase.

## Keeping the tools in sync

`src/generated/operations.json` is generated from `services/grn-api/openapi.yaml`
with every `$ref` inlined and OpenAPI-only keywords translated (`nullable` →
a type that admits `null`). After changing the spec:

```bash
npm run generate --workspace services/grn-mcp
```

`npm run lint` (and the `grn-mcp-static` PR check, which also runs when only
the GRN spec changes) fails if the committed file is out of date.

## Deploying and testing

- `services/grn-mcp/scripts/deploy.sh` reads the GRN API's URL from the
  `ogf-grn-<env>` stack's `ApiUrl` output and deploys `ogf-grn-mcp-<env>`.
  It runs as `deploy-grn-mcp` in `deploy-main.yml`, after `deploy-backend`, and
  as `deploy-staging-grn-mcp` in PR staging validation.
- Unit tests: `npm --workspace services/grn-mcp test`. They cover the catalog
  and its exclusions, request building, key checks, error mapping and argument
  validation, through the real SDK against a fake GRN API.
- API tests: `postman/collections/Good Roots Network MCP`, on every staging
  validation:
  - The Auth folder checks the refusals.
  - The Tools folder calls real tools on the deployed stack. The job runs
    `scripts/staging-smoke-key.sh` to seed a dedicated grower, mint a
    short-lived key from its session and pass it in. `get_me` must return that
    grower's id, which proves the mapping, the bearer forwarding and upstream
    authorization together. The key is revoked when the job ends, pass or
    fail. With `requireKey` set, a missing key fails the run rather than
    skipping it.
