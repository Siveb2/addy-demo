# Addy Demo — platform mock + live voice widget

A one-page mock of the Addy AI platform with a voice assistant docked in the
bottom-right corner. The widget places a **real outbound call** through your
agent backend.

Static HTML/CSS/JS plus two serverless functions. No build step, no framework,
no dependencies — deploys in well under a minute.

---

## What's here

```
public/index.html    the Addy platform page
public/styles.css    theme (violet #8b5cf6, Inter, 22px pills)
public/widget.js     the voice widget
api/call.js          POST → places the call (keeps the API key server-side)
api/status.js        GET  → polls call status
```

The browser never sees your API key. It posts `{phone, note}` to `/api/call`,
and the serverless function adds the credential before calling your backend.

---

## Deploy

### 1. Push to GitHub

```bash
cd "ADDY-DEMO"
git init && git add -A && git commit -m "Addy demo"
gh repo create addy-demo --private --source=. --push
```

### 2. Import in Vercel

[vercel.com/new](https://vercel.com/new) → pick the repo → **Deploy**.
Framework preset: **Other**. Leave build/output settings empty.

### 3. Set environment variables

Vercel → Project → **Settings → Environment Variables**:

| Variable | Required | Value |
|---|---|---|
| `AGENT_API_URL` | yes | Backend base URL, no trailing slash |
| `AGENT_API_KEY` | yes | API / extension token for the account |
| `AGENT_ID` | no | Pin one agent; otherwise the account default |
| `DEMO_ALLOW` | recommended | Comma-separated E.164 numbers allowed to be dialed |

Redeploy after adding them (Deployments → ⋯ → Redeploy).

**Set `DEMO_ALLOW`.** Without it, anyone who finds the URL can dial any number
on your account. With it, only the numbers you list can be called.

### Or deploy straight from the CLI

```bash
npx vercel --prod
npx vercel env add AGENT_API_URL production
npx vercel env add AGENT_API_KEY production
npx vercel env add DEMO_ALLOW production
npx vercel --prod          # redeploy to pick up the vars
```

---

## Run locally

```bash
cp .env.example .env.local   # fill in your values
npx vercel dev               # http://localhost:3000
```

Plain `python3 -m http.server` will serve the page but **not** the `/api`
routes, so the call button won't work. Use `vercel dev`.

---

## Using it in the demo

1. Open the page — it looks like the Addy platform.
2. Click the violet mic button, bottom right.
3. Enter a phone number (yours, or one on the allowlist).
4. Edit the request text if you want. It's prefilled with the Sarah M. /
   loan 4471 scenario matching the loan file on the page.
5. **Start the call.** The phone rings, the widget shows live status.

The panel shows the borrower, the consent record, and what the agent will ask
for — all framed as an **assistant for the loan officer**, not an autonomous
agent. It asks before it dials.

---

## Backend contract

`api/call.js` posts to `POST {AGENT_API_URL}/extension/call`:

```json
{ "prospect_id": "addy-demo-...", "page_phones": ["+14155550142"], "note": "..." }
```

Expects back `{ "outbound_id": "...", "status": "dialing", "agent_name": "..." }`.

`api/status.js` polls `GET {AGENT_API_URL}/extension/call/{id}` every 3s until
status is `ended`, `completed` or `failed`.

If your endpoints differ, edit those two files — the paths are the only thing
that changes.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `not_configured` | Env vars missing, or set but not redeployed |
| `not_allowed` | Number isn't in `DEMO_ALLOW` |
| `upstream_unreachable` | `AGENT_API_URL` wrong, or backend not publicly reachable |
| `bad_phone` | Use E.164 (`+14155550142`). Bare 10-digit US numbers are auto-prefixed |
| 401 / 403 from upstream | `AGENT_API_KEY` wrong or lacks permission |
| Call button does nothing locally | You're on a static server — use `npx vercel dev` |

Check function logs in Vercel → Deployments → the deployment → **Functions**.

---

## Notes

- Everything on the page besides the widget is static mock content.
- Phone numbers are saved to `localStorage` for convenience only.
- The widget is self-contained — `widget.js` plus the `.av-*` styles. It can be
  lifted into a real sidebar or extension panel with no changes.
