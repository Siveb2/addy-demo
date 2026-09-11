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
cd public && python3 -m http.server 8000
```

Then open `http://localhost:8000`. No serverless functions, so a plain static
server is enough.

`getUserMedia` requires a secure context — `localhost` counts, other hostnames
need HTTPS.

---

## How it works

Two public endpoints on the backend, called straight from the browser:

```
GET  {apiUrl}/share/{callKey}/meta     -> { name, greeting }
POST {apiUrl}/share/{callKey}/token    -> { token, url }
```

Then `livekit-client` (UMD, from cdnjs) joins the room with that token and
publishes the mic. The agent worker joins the same room and talks back.

The CORS origin of your deployment must be allowed by the backend. If the call
fails with a CORS error in the console, add the Vercel URL to the backend's
allowed origins.

---

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
| CORS error in console | Add the deployed URL to the backend's allowed origins |
| Connects, no voice | The agent worker isn't running, or has no TTS configured |
