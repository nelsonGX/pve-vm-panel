# Friend Group Auth — integration reference

Base URL (this instance): `https://group.nelsongx.com`
Discovery (RFC 8414): `https://group.nelsongx.com/.well-known/oauth-authorization-server` — lists every endpoint below, including
the non-standard `payment_*` and `device_*` extensions. Point an OAuth client at
it to auto-configure.

## Endpoints
| Purpose            | Method & path                          |
| ------------------ | -------------------------------------- |
| Authorize          | `GET  https://group.nelsongx.com/oauth/authorize`        |
| Token              | `POST https://group.nelsongx.com/api/oauth/token`        |
| Userinfo           | `GET  https://group.nelsongx.com/api/oauth/userinfo`     |
| Revoke             | `POST https://group.nelsongx.com/api/oauth/revoke`       |
| Create pay intent  | `POST https://group.nelsongx.com/api/pay/intent`         |
| User confirms pay  | `GET  https://group.nelsongx.com/pay?intent=…`           |
| Verify pay         | `POST https://group.nelsongx.com/api/pay/verify`         |
| Reverse pay        | `POST https://group.nelsongx.com/api/pay/reverse`        |
| Data get           | `POST https://group.nelsongx.com/api/data/get`           |
| Data set           | `POST https://group.nelsongx.com/api/data/set`           |
| Data delete        | `POST https://group.nelsongx.com/api/data/delete`        |
| Data list          | `POST https://group.nelsongx.com/api/data/list`          |

## Hard rules
- PKCE (S256) is **required** on the authorization request.
- `client_secret` is server-side only — never send it to the browser.
- All token/pay POSTs are `application/x-www-form-urlencoded`.
- Client auth: `client_secret` in the body (`client_secret_post`) **or** HTTP Basic
  (`client_secret_basic`) — either is accepted.
- `redirect_uri` must **exactly** match a registered URI.
- Gate access on `allowed === true` from userinfo; deny otherwise.
- Store the user keyed on `sub` (stable; `id` is the same value). Verify `state` on
  the callback and re-verify payments server-side.

## Scopes (request only what you need, space-separated)
- `identify` : `username`, `global_name`, `avatar`, `discord_id`
- `roles`    : `allowed`, `in_guild` (access status only — role IDs are never exposed)
- `credits`  : `credits` (integer balance)

Requesting a scope the app isn't allowed is rejected with `invalid_scope` (no
silent down-scoping). The granted `scope` is echoed in the token response.

## Login — Authorization Code + PKCE
1. **Begin (server-side):**
   - `code_verifier = base64url(32 random bytes)`
   - `code_challenge = base64url(sha256(code_verifier))`
   - `state = base64url(16 random bytes)`; persist `{code_verifier, state}` in session.
   - Redirect to:
     ```
     GET https://group.nelsongx.com/oauth/authorize?response_type=code
       &client_id={CLIENT_ID}
       &redirect_uri={REDIRECT_URI}
       &scope=identify%20roles
       &state={state}
       &code_challenge={code_challenge}
       &code_challenge_method=S256
     ```
2. **Callback** at `{REDIRECT_URI}`: receives `?code=…&state=…` (or `?error=…&error_description=…&state=…`). Verify `state`.
3. **Exchange code (server-side, form-encoded):**
   ```
   POST https://group.nelsongx.com/api/oauth/token
   grant_type=authorization_code&code={code}&redirect_uri={REDIRECT_URI}
   &code_verifier={code_verifier}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
   ```
   → `{ access_token, token_type:"Bearer", expires_in:3600, refresh_token, scope }`
4. **Userinfo:**
   ```
   GET https://group.nelsongx.com/api/oauth/userinfo
   Authorization: Bearer {access_token}
   ```
   → `{ sub, id, username, global_name, avatar, discord_id, allowed, in_guild, credits }`
   Require `allowed === true`.

### Tokens & refresh
Access tokens last 1h, refresh tokens 30d. Refreshing **rotates** the refresh
token (old one invalidated) — always use the newest. Presenting an already-rotated
refresh token triggers reuse detection and revokes the whole token family;
re-authorize if that happens.
```
POST https://group.nelsongx.com/api/oauth/token
grant_type=refresh_token&refresh_token={rt}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```
Revoke: `POST https://group.nelsongx.com/api/oauth/revoke` with `token={t}` + client auth.

## Pay — charge a user credits (only if the app needs it)
Credit value is FIXED across every app on this server: **1 credit = 1 TWD**. Set
`amount` (integer credits) equal to the price in TWD — never apply your own
conversion, markup, or rounding, so an item costs the same on every platform.

1. **Create an intent (server-side):**
   ```
   POST https://group.nelsongx.com/api/pay/intent
   client_id=…&client_secret=…&amount={positive int}&ref={your idempotency key}
   &redirect_uri={a registered return URL}&description={optional}&state={optional}
   ```
   → `{ intent_id, url, amount, status:"pending", expires_at }`
   Idempotent on (client, ref): same ref + same amount returns the same intent;
   same ref + a different amount/description is rejected `409` — use a fresh ref.
2. **Redirect the user to `url`.** They return with
   `?intent_id=…&ref=…&status=…&state=…`, where `status` ∈
   `{ completed, cancelled, insufficient_funds, access_denied }`.
3. **Verify server-side before granting value:**
   ```
   POST https://group.nelsongx.com/api/pay/verify
   client_id=…&client_secret=…&intent_id={intent_id}
   ```
   → `{ intent_id, status, amount, ref, description, user_id, paid }`. Grant only when `paid === true`.

### Reverse pay - pay/reward a user from app balance
First fund the app's balance in the dashboard (**Manage -> Funding**) or route
new payment income into app balance. Then call this server-side:
```
POST https://group.nelsongx.com/api/pay/reverse
client_id=...&client_secret=...&user_id={sub}&amount={positive int}
&ref={your payout idempotency key}&description={optional}
```
-> `{ payout_id, status:"completed", amount, user_id, ref, duplicate, app_balance, paid:true }`.
Retrying the same ref is safe and will not pay twice. Low app balance returns
`402 insufficient_funds`. Reverse-paid credits are spendable user credits, not
withdrawable developer income. Unused app balance can be moved back to the
owner's regular credit balance in the dashboard by entering a negative funding
amount, but that also is not withdrawable developer income.

### Webhooks (optional, recommended)
Configure a webhook URL on the app in the dashboard (**Manage → Webhook**); saving
reveals a signing secret once. On settle we POST JSON with headers
`X-Webhook-Id` (idempotency key) and
`X-Webhook-Signature: t=<unix>,v1=<base64url HMAC-SHA256 of \`<t>.<rawBody>\`>`.
Verify the signature, de-dupe on the id, and still treat verify as authoritative.
Delivery is best-effort.

## Data store — store/fetch JSON (only if the app needs to persist data)
**When to use this — read first.** This store is a *fallback for apps that have no
database of their own*. If the project already has a database (Postgres, SQLite,
Mongo, Supabase, an ORM, etc.), use that — do **not** reach for this. Only consider
it when there is genuinely no datastore and the user would otherwise have to set
one up. Before using it, **ask the user** ("Your app has no database — want me to
use Friend Group Auth's hosted JSON store instead of setting one up?") and wait for
a yes. Don't wire it in unprompted.

A hosted JSON key–value store scoped to the app, for persisting data from a
serverless/edge backend without its own database. Plain client-authenticated
HTTPS + JSON (no driver/pool). **Server-to-server only — never call it from the
browser.** Authenticate like the pay endpoints (client_id + client_secret in the
JSON body, or HTTP Basic). Two scopes:
- `scope: "user"` — keyed to one user; pass their `sub` (from userinfo) as
  `user_id`. Per-user state/preferences/saves.
- `scope: "app"` — one namespace shared across the whole app; omit `user_id`.

Data is isolated per app. All endpoints are `POST` with a JSON body:
- **Set** `/api/data/set` — `{ client_id, client_secret, scope, user_id?, key, value }`
  → `{ key, ok:true, updated_at }` (upsert, last-write-wins).
- **Get** `/api/data/get` — `{ …, scope, user_id?, key }`
  → `{ key, value, found }` (`value` is null when `found===false`).
- **Delete** `/api/data/delete` — `{ …, scope, user_id?, key }` → `{ key, deleted }`.
- **List** `/api/data/list` — `{ …, scope, user_id?, prefix?, limit?, cursor? }`
  → `{ entries:[{ key, value, updated_at }], next_cursor }` (ordered by key; page
  by passing `next_cursor` back as `cursor` until it's null).

`value` may be any JSON (including `null`) — use `found` to tell a stored null
from a missing key. Limits: key ≤ 256 chars, value ≤ 256 KB JSON-encoded; bad
input → `400 invalid_request`, bad creds → `401 invalid_client`.

## Gotchas
- `redirect_uri` mismatch (scheme/host/path) is the most common failure.
- A user can be `allowed: false` even while logged in (left the server / lost the
  role) — re-check on each login.
- Credits are whole numbers, fixed at 1 credit = 1 TWD — price in credits at that rate.

