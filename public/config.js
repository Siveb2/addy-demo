/* Addy demo — the three agents.
   Share endpoints are PUBLIC (the call key is the credential), so nothing here
   is secret. Calls proxy through /api/share (same origin) — no CORS config. */
window.ADDY_CONFIG = {
  // Agent backend base URL, no trailing slash.
  apiUrl: "https://api.metallabs.io",

  // ---- JACK — the browser voice agent the LOAN OFFICER talks to -------------
  // Male voice. Knows Sarah Mitchell's file. Has a custom tool that calls
  // /api/call-sarah, which dials Alex. Paste his public_call_key here.
  jackCallKey: "f705df7553814fc9be562ab804f7e54c",

  // ---- Fallback for any lead without its own key ---------------------------
  callKey: "f705df7553814fc9be562ab804f7e54c",

  // "prod" = published agent, "draft" = whatever is in the editor.
  env: "prod"
};
