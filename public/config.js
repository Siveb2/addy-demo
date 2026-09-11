/* Addy demo — edit these two values, redeploy, done.
   Both endpoints used are PUBLIC (the call key is the credential), so nothing
   secret lives here and no server proxy is needed. */
window.ADDY_CONFIG = {
  // Agent backend base URL, no trailing slash.
  apiUrl: "https://api.your-backend.com",

  // The agent's public_call_key (32 hex). Dashboard → agent → share link:
  // the /talk/<key> URL — paste just the <key> part here.
  callKey: "PASTE_PUBLIC_CALL_KEY_HERE",

  // "prod" = published agent, "draft" = whatever is in the editor.
  env: "prod"
};
