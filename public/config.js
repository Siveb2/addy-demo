/* Addy demo — agent keys and demo data.
   The share endpoints are PUBLIC (the call key is the credential), so nothing
   secret lives here. Calls are proxied through /api/share (same origin), so no
   CORS allowlisting is needed on the backend. */
window.ADDY_CONFIG = {
  // Agent backend base URL, no trailing slash.
  apiUrl: "https://api.metallabs.io",

  // Fallback agent for any lead without its own key.
  callKey: "f705df7553814fc9be562ab804f7e54c",

  // "prod" = published agent, "draft" = whatever is in the editor.
  env: "prod"
};
