# Addy Demo — platform mock with live browser voice

A mock of the **Addy AI platform** (not the marketing site): loan-officer
pipeline, demo loan files, and an assistant docked in the right sidebar that
starts a **real voice call in the browser** — your mic, the agent's voice, no
phone number involved.

Four static files. No build, no dependencies, no server code.

```
public/index.html   the platform UI
public/styles.css   Addy theme (violet #8b5cf6, Inter, 22px pills)
public/config.js    <- the only file you edit
public/app.js       lead list + LiveKit browser call
api/share.js        same-origin proxy (removes the CORS dependency)
```

---

## Setup — two values

Open **`public/config.js`**:

```js
window.ADDY_CONFIG = {
  apiUrl:  "https://api.your-backend.com",   // backend base URL, no trailing slash
  callKey: "PASTE_PUBLIC_CALL_KEY_HERE",     // the agent's public_call_key
  env:     "prod"                            // or "draft"
};
```

**Where the call key comes from:** dashboard → the agent → share link. The URL
looks like `/talk/a1b2c3…` — paste just the key part.

Nothing secret goes in this file. The key *is* the credential for that one
public endpoint, calls are charged to the agent owner's plan, and the backend
rate-limits it (10 token requests/min per IP). Switch the share link off in the
agent editor to kill it instantly.

---

## Deploy

```bash
cd ADDY-DEMO
npx vercel --prod
```

Framework preset **Other**; no build command, output directory `public`.

Or via GitHub: push, then import at [vercel.com/new](https://vercel.com/new).

To change the agent later, edit `config.js` and redeploy — that's the whole
update cycle.

---

## Run locally

```bash
npx vercel dev        # http://localhost:3000
```

`npx vercel dev` runs the proxy function too. A plain static server
(`python3 -m http.server`) serves the page but not `/api/share`, so the call
falls back to hitting the backend directly — which then *does* need the origin
allowlisted.

`getUserMedia` requires a secure context — `localhost` counts, other hostnames
need HTTPS.

---

## How it works

The browser calls **its own origin**:

```
GET /api/share?path=meta     -> { name, greeting }
GET /api/share?path=token    -> { token, url }
```

`api/share.js` forwards that server-to-server to the backend's public share
endpoints. Because the browser never makes a cross-origin request, **there is
no CORS preflight and nothing to allowlist on the backend** — the demo works
on any Vercel URL, including every preview deployment, with no server-side
configuration.

Then `livekit-client` (UMD, from cdnjs) joins the room with the returned token
and publishes the mic. The agent worker joins the same room and talks back.

The backend URL and call key are baked into `api/share.js` as fallbacks, so the
page works even if `config.js` is blanked.

## Using it in the demo

1. Open the page — loan-officer pipeline with four demo files.
2. Click any row to select that borrower. The sidebar updates: their file,
   and what Addy will ask for.
3. Click **Talk to Addy**, allow the mic.
4. Speak. You're the borrower; the agent works the file.

The sidebar deliberately reads as an **assistant for the loan officer**, not an
autonomous agent: it shows who it's calling and what it will ask for, and waits
for the LO to press the button.

To change the demo files, edit the `LEADS` array at the top of `app.js`.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Badge says "Setup needed" | `config.js` still has placeholder values |
| "Link not available" | Wrong `callKey`, or the share link is disabled on the agent |
| "Quota exceeded" | Agent owner's plan is out of minutes |
| "All lines busy" | Concurrency cap reached — wait and retry |
| "Microphone permission denied" | Allow the mic; needs HTTPS or localhost |
| Connects, no voice | The agent worker isn't running, or has no TTS configured |
