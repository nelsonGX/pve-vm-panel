---
name: friend-group-auth
description: >-
  Integrate this app with Friend Group Auth (https://group.nelsongx.com) — a Discord-gated OAuth 2.0
  + PKCE provider with a shared credit/payment system. Use when the user wants to
  add "login with our group", gate access on Discord membership/role, or charge
  credits. Registers the OAuth app automatically via a browser-approved device
  flow (no manual dashboard setup, no copied secrets) and writes the login,
  callback, and (optional) payment code.
---

# Friend Group Auth integration

This skill connects the current project to **Friend Group Auth** at `https://group.nelsongx.com`.
You will register the OAuth app *for* the user via a browser-approval flow, then
implement the integration. The user's only manual step is clicking **Approve** in
a browser tab.

Read `reference.md` (next to this file) for the exact endpoint contracts. Do not
invent endpoints or parameters beyond what it documents.

## Step 1 — Understand the project
- Detect the web framework, language, and existing session/auth conventions. Match them.
- Determine the **local dev URL** (e.g. `http://localhost:3000`). Check the dev
  script / config for the port; ask the user if ambiguous.
- Choose a callback path that fits the framework (e.g. `/api/auth/callback`,
  `/auth/callback`). The dev redirect URI is `<dev-url><callback-path>`.

## Step 2 — Collect the redirect URIs
- Always include the **dev** redirect URI.
- Ask the user once for their **production base URL** (e.g.
  `https://myapp.example.com`). If they give one, add `<prod-url><callback-path>`.
  If they skip it, proceed with dev only and tell them they can re-run this skill
  later to add prod.
- If the app charges credits, also register a **payment return** URI for each base
  (e.g. `<base>/pay/return`).

## Step 3 — Start the device authorization
POST JSON to the start endpoint. `redirect_uris` is the full list from Step 2;
`scopes` is what the app needs (`identify`, optionally `roles`, `credits`).

```bash
curl -sS -X POST https://group.nelsongx.com/api/manage/device/start \
  -H 'content-type: application/json' \
  -d '{
    "name": "<app name the user will recognise>",
    "redirect_uris": ["http://localhost:3000/api/auth/callback"],
    "scopes": ["identify", "roles"]
  }'
```

Response: `{ device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }`.

## Step 4 — Send the user to approve
Show the user this prominently and wait:

> **Approve the app registration:** open `<verification_uri_complete>`
> (code: `<user_code>`) and click **Approve**.

The approval screen is at `https://group.nelsongx.com/device`. The user must be signed in with a
Discord account that has access to the group.

## Step 5 — Poll for approval and write the credentials straight to .env

On approval the poll endpoint returns `client_secret` **exactly once**. Do **not**
print the poll response, echo the secret, repeat it in chat, or retype it into a
file by hand — and do **not** redact it to a placeholder. All of those are wrong
here. Instead run the command below: it polls until the user approves, then writes
the credentials **directly from the API response into a git-ignored env file**. The
secret flows API → file and is never displayed. That is the correct, safe handling.

Fill in `<device_code>` and `<interval>` from the Step 3 response. The command
prints only the `client_id` and "secret (hidden)" so you can confirm it worked
without ever seeing the secret value.

**POSIX shell (bash/sh):**
```bash
DEVICE_CODE='<device_code from Step 3>'
INTERVAL='<interval from Step 3, e.g. 5>'
while :; do
  RESP=$(curl -sS -X POST https://group.nelsongx.com/api/manage/device/poll -H 'content-type: application/json' \
    -d "{\"device_code\":\"$DEVICE_CODE\"}")
  case "$RESP" in
    *authorization_pending*|*slow_down*) sleep "$INTERVAL"; continue ;;
    *access_denied*) echo "User denied — stop and tell them."; break ;;
    *expired_token*) echo "Expired — restart from Step 3."; break ;;
    *client_secret*)
      node -e 'const fs=require("fs"),r=JSON.parse(process.argv[1]);fs.appendFileSync(".env.local","\nAUTH_BASE_URL=https://group.nelsongx.com\nAUTH_CLIENT_ID="+r.client_id+"\nAUTH_CLIENT_SECRET="+r.client_secret+"\nAUTH_REDIRECT_URI=<dev redirect URI you registered>\n");console.log("Wrote AUTH_CLIENT_ID="+r.client_id+" + secret (hidden) to .env.local")' "$RESP"
      break ;;
  esac
done
```

**PowerShell (Windows):**
```powershell
$DeviceCode = '<device_code from Step 3>'
$Interval   = <interval from Step 3, e.g. 5>
while ($true) {
  $resp = curl.exe -sS -X POST https://group.nelsongx.com/api/manage/device/poll -H 'content-type: application/json' `
    -d (@{ device_code = $DeviceCode } | ConvertTo-Json -Compress)
  if ($resp -match 'authorization_pending|slow_down') { Start-Sleep $Interval; continue }
  if ($resp -match 'access_denied') { Write-Host 'User denied — stop and tell them.'; break }
  if ($resp -match 'expired_token') { Write-Host 'Expired — restart from Step 3.'; break }
  $c = $resp | ConvertFrom-Json
  @(
    "AUTH_BASE_URL=https://group.nelsongx.com"
    "AUTH_CLIENT_ID=$($c.client_id)"
    "AUTH_CLIENT_SECRET=$($c.client_secret)"
    "AUTH_REDIRECT_URI=<dev redirect URI you registered>"
  ) | Add-Content -Path .env.local -Encoding utf8
  Write-Host "Wrote AUTH_CLIENT_ID=$($c.client_id) + secret (hidden) to .env.local"
  break
}
```

## Step 6 — Confirm storage (server-side only)
You did **not** need to see the secret — the command in Step 5 wrote it for you.
Now just confirm:
- `.env.local` (or whichever env file you wrote) is listed in `.gitignore`.
- `client_secret` is used only in server-side code — **never** ship it to the
  browser/client bundle.
- The four keys written are `AUTH_BASE_URL`, `AUTH_CLIENT_ID`,
  `AUTH_CLIENT_SECRET`, `AUTH_REDIRECT_URI`. If the project uses a different env
  file name, move them there (keep the key names).

If the project isn't a Node project, replace the `node -e` parser in Step 5 with
`jq` or your stack's JSON parser — the rule is identical: pipe the response into
the file, never print the secret.

## Step 7 — Implement the integration
Follow `reference.md` exactly:
- A login route that redirects to `/oauth/authorize` with a fresh PKCE pair + state.
- A callback route that verifies `state`, exchanges the code at the token endpoint,
  calls userinfo, and **requires `allowed === true`** before creating a local session.
- Key the local user on `sub` (stable). Store tokens server-side; refresh rotates.
- If charging: a route that creates a payment intent and redirects to its `url`, and
  a return route that calls the verify endpoint and grants value only when `paid === true`.
  Credit value is fixed at **1 credit = 1 TWD** across every app — set `amount` (integer
  credits) equal to the price in TWD; never apply your own conversion or markup.

## Step 8 — Report back
Tell the user which routes/files you created, that the app is registered (it shows
under **Provider apps** in their dashboard at `https://group.nelsongx.com/dashboard`), and how to set
the env vars in production. Remind them to add the prod redirect URI if they
skipped it (re-run this skill or edit the app in the dashboard).

