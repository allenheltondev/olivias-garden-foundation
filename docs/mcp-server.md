# Operator MCP server

The foundation exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server for the **site operator**: point an AI agent (Claude Code, Claude Desktop,
any MCP client) at it and run the back office in conversation — add or change
store products and workshops, mark seed requests done, review okra photos and
API access requests, edit the site's impact numbers and testimonials, and read
activity and revenue.

It is modeled on kids-and-dragons' MCP server (`packages/server/src/mcp/` there):
spec revision **2026-07-28** over Streamable HTTP, served statelessly by
`@modelcontextprotocol/server`, with 2025-era clients (those that open with
`initialize`) served through the SDK's stateless fallback.

- **Endpoint:** `POST https://api.<domain>/mcp` (stack output `McpServerUrl` of
  `ogf-mcp-<env>`). One per environment: a staging key does nothing on prod.
- **Auth:** `Authorization: Bearer ogfmcp_…`, a key from `npm run mcp:keys`.
- **Code:** `services/mcp-api/`: `src/mcp/handler.mjs` (key, operator and origin
  checks, the SDK), `src/mcp/server.mjs` (assembly and scopes), `src/mcp/tools/*.mjs`
  (one module per area), `src/mcp/keys.mjs` (minting and checking keys),
  `src/mcp/backends.mjs` (how tools reach the services). The Lambda adapter is
  `src/handlers/mcp.mjs`.

## Connecting a client

```bash
# Claude Code
claude mcp add --transport http ogf https://api.<domain>/mcp \
  --header "Authorization: Bearer ogfmcp_…"
```

Any client that speaks Streamable HTTP and can send a header works the same way.
Then ask, for example: *"What's pending?"*, *"Mark the Austin seed request done,
mailed today"*, *"Create a draft $18 okra tee in S/M/L"*, *"Close sign-ups for the
spring workshop"*.

## Keys

| | |
|---|---|
| Mint | `npm run mcp:keys -w services/mcp-api -- create --env prod --label "laptop claude" --operator you@example.org --scope all:write [--days 90]` |
| List | `npm run mcp:keys -w services/mcp-api -- list --env prod` (label, operator, scopes, expiry, last use; never the key) |
| Revoke | `npm run mcp:keys -w services/mcp-api -- revoke --env prod <id>`. The next request with it is refused. |

Run with your AWS credentials against the environment's keys table (the
`McpKeysTableName` output of `ogf-mcp-<env>`; `--table` overrides it). Being able to write that table is what lets someone mint a key: nothing
reachable over the internet can, and a key cannot mint another.

**A key acts as an operator.** `--operator` names an admin user by email; the CLI
finds them in the Cognito user pool and refuses anyone not in the `admin` group.
On **every** request the server checks the key's row (so revoking is immediate)
and then asks Cognito whether that person is still an admin (so removing someone
from the admin group switches off all their keys at once; if Cognito cannot
answer, the request is refused). Every change a tool makes is recorded in the
owning service as that person, exactly as if they had used the admin app.

A key is `ogfmcp_<id>.<secret>`, shown once. The row keeps the SHA-256 of the
secret, the scopes, the operator, the expiry (90 days by default, at most 366) and
when it was last used. Expired, revoked, unknown and wrong keys are all refused
the same way.

## Scopes

A key is granted per area: `store`, `workshops`, `content`, `queues`, `reports`,
each `:read` or `:write` (`all:read` / `all:write` grant every area). With
`<area>:write` a key gets every tool in that area; with `<area>:read` only the
tools annotated `readOnlyHint`. A tool a key may not use is never registered: it
is absent from `tools/list`, and calling it is an unknown-tool error.

## Tools

| Tool | Area | What it does |
|---|---|---|
| `whoami` | every key | The key's label, scopes, expiry and its operator's email. |
| `list_store_products` | `store:read` | Every product, drafts and archived included, as compact rows; filter by status or search. |
| `get_store_product` | `store:read` | One product in full, by id or slug. |
| `list_store_orders` | `store:read` | Recent orders (up to 500), filterable by payment and fulfillment status. |
| `create_store_product` | `store:write` | Add a product (and its Stripe product and price). Starts as a draft. |
| `update_store_product` | `store:write` | Change only the given fields; images, options and everything else are kept. |
| `archive_store_product` | `store:write` | Take a product out of the store (archived, restorable). |
| `request_product_image_upload` / `complete_product_image_upload` | `store:write` | A presigned URL to PUT a photo to, then start its processing. |
| `list_workshops` / `get_workshop` / `list_workshop_signups` | `workshops:read` | Workshops with sign-up counts; one workshop; who signed up. |
| `create_workshop` / `update_workshop` | `workshops:write` | Add a workshop; change only the given fields (open or close sign-ups, mark past). |
| `delete_workshop` | `workshops:write` | Permanently delete; the slug must be passed to confirm. Prefer status `past`. |
| `request_workshop_image_upload` | `workshops:write` | A presigned URL for a cover image; set the returned `s3Key` as `image_s3_key`. |
| `get_impact_metrics` / `get_testimonials` | `content:read` | The site's impact numbers and testimonials. |
| `set_impact_metrics` / `set_testimonials` | `content:write` | Replace the whole list (get it first, send it back changed). |
| `whats_pending` | `queues:read` | Open seed requests, okra photos to review, API access requests to decide: counts and the few waiting longest. |
| `list_seed_requests` / `list_okra_submissions` / `list_api_access_requests` | `queues:read` | Each queue by status. Seed requests list newest first, or `order: "oldest"`. |
| `mark_seed_request_done` | `queues:write` | Seeds sent: counts the packet and, as the admin app does, pins it on the public map (see "Seed request pins"). |
| `add_seed_request_map_pin` | `queues:write` | Pin a done request that has none: one done before pins existed, or whose city could not be found. |
| `cancel_seed_request` / `reopen_seed_request` | `queues:write` | Close without sending; move back to open (undoing "done" un-counts it and removes the pin). |
| `review_okra_submission` | `queues:write` | Approve onto the map, or deny with a reason. |
| `decide_api_access_request` | `queues:write` | Approve or deny Good Roots Network API access. |
| `get_dashboard_stats` / `list_activity` / `get_revenue` | `reports:read` | Dashboard numbers, the activity feed, revenue by day, week or month. |

Writes that the services make idempotent (store products) take an optional
`idempotency_key`; reuse it when retrying the same change.

### Seed request pins

`mark_seed_request_done` places the public "seeds sent" pin the way the admin
app's **Mark done** does. When the requester may have a pin (the okra API's
`pinVisibility`), it looks up their city with OpenStreetMap's Nominatim, using
the admin app's rules (`src/mcp/seed-pins.mjs`, after
`apps/admin/src/services/seed-pin-geocoder.ts`): a mailed request is located
from city, region, postal code and country only, never its street lines, name
or email. A street is looked up only for an in-person exchange an admin gave a
map address. Nothing is looked up for a request told it would get no pin, or
when the caller passes `map_location`.

The result's `map_pin` says what happened: `placed`, or a `reason` (no pin was
promised) or a `warning` (the city could not be found). In that last case the
seeds are still recorded as sent, and `add_seed_request_map_pin` adds the pin
later, with a lookup or a given `map_location`.

The okra API lists seed requests newest first. For `whats_pending` and
`order: "oldest"`, the tools read the total and fetch the last pages, so the
requests waiting longest come first.

## How tools reach the services

The MCP function holds no database connection and no business rules. Each tool
invokes the **owning service's existing API Lambda** directly (IAM
`lambda:InvokeFunction`) with an API Gateway REST proxy event built in
`backends.mjs`. The event carries the authorizer context that service's own
authorizer attaches for an admin — `userId`/`isAdmin` for admin-api, store-api
and grn-api, `sub`/`groups` for the okra admin API — with the key's operator in
it, plus an `x-correlation-id` that is also returned to the MCP client.

So a tool runs exactly the code path an admin-app click does: the same
validation, idempotency, audit rows, Stripe calls and domain events. There is no
second implementation to drift.

| Service | Function (stack output) | Used for |
|---|---|---|
| admin-api | `ApiFunctionArn` of `ogf-admin-<env>` | products, product images, workshops, impact metrics, testimonials, activity, revenue |
| okra-api | `AdminApiFunctionArn` of `ogf-okra-<env>` | seed requests, okra submissions, dashboard stats |
| store-api | `ApiFunctionArn` of `ogf-store-<env>` | orders |
| grn-api | `ApiFunctionArn` of `ogf-grn-<env>` | API access requests |

Only an IAM principal allowed to invoke a function can deliver such an event:
through API Gateway, `requestContext.authorizer` is written by API Gateway itself
and a client cannot set it. store-api has no authorizer and verifies its bearer
token in the handler, so it now also honors an authorizer context when one is
present (`services/store-api/src/services/auth.mjs`), as the other three do.

### What a tool returns

Whatever a tool returns goes into the model's context. The queue tools return
what supporters wrote — names and mailing addresses for seed requests — because
the operator needs them to send seeds; that is why they need an operator's own
key and `queues:read`. Lists of products and workshops return compact rows.

## Deploying

`services/mcp-api/scripts/deploy.sh` reads the four function ARNs from their
stacks' outputs and deploys `ogf-mcp-<env>`, so it runs after them: the
`deploy-mcp-backend` job in `deploy-main.yml`, and `deploy-staging-mcp` in PR
staging validation. With a domain configured the server is mapped to
`https://api.<domain>/mcp` on the shared API domain.

The keys table belongs to the stack. Deleting or replacing the stack deletes it,
which revokes every key: that fails safe, and new keys are minted the same way.
A first create that fails leaves the stack in `ROLLBACK_COMPLETE`; the deploy
script deletes such a stack (it holds nothing) and creates it again.

## Testing

- Unit tests: `npm --workspace services/mcp-api test` — keys, event building, the
  endpoint end-to-end through the SDK with fake services, scopes, merge-updates.
- API tests: `postman/collections/Operator MCP`. The Auth folder (every request
  without a live key is refused the same way) runs on every staging validation.
  The Tools folder runs only when `mcpKey` is set to a live staging key.
