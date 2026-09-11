/* Addy demo — edit these values, redeploy, done.
   Both endpoints used are PUBLIC (the call key is the credential), so nothing
   secret lives here and no server proxy is needed. */
window.ADDY_CONFIG = {
  // Agent backend base URL, no trailing slash.
  apiUrl: "https://api.metallabs.io",

  // The agent's public_call_key (32 hex) — the <key> from a /talk/<key> link.
  callKey: "f705df7553814fc9be562ab804f7e54c",

  // "prod" = published agent, "draft" = whatever is in the editor.
  env: "prod"
};
