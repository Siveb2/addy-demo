/**
 * Same-origin proxy for the agent's public share endpoints.
 *
 * The browser calls /api/share?path=meta  or  /api/share?path=token, which is
 * its OWN origin — so no CORS preflight, nothing to allowlist on the backend,
 * and no environment variable to keep in sync. This function then calls the
 * backend server-to-server, where CORS does not apply at all.
 *
 * Backend URL and call key live in public/config.js and are passed through,
 * with the values below as the fallback so the page works even if config.js
 * is edited to blanks.
 */

const FALLBACK_API = 'https://api.metallabs.io';
const FALLBACK_KEY = 'f705df7553814fc9be562ab804f7e54c';

export default async function handler(req, res) {
  const path = String(req.query.path || 'meta');
  if (path !== 'meta' && path !== 'token') {
    return res.status(400).json({ reason: 'bad_path' });
  }

  const base = String(req.query.api || FALLBACK_API).replace(/\/+$/, '');
  const key = String(req.query.key || FALLBACK_KEY);

  if (!/^https:\/\/[a-z0-9.-]+(\.[a-z]{2,})(:\d+)?$/i.test(base)) {
    return res.status(400).json({ reason: 'bad_api_url' });
  }
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(key)) {
    return res.status(400).json({ reason: 'bad_key' });
  }

  const url = base + '/share/' + encodeURIComponent(key) + '/' + path;

  try {
    const upstream = await fetch(url, {
      method: path === 'token' ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: path === 'token'
        ? JSON.stringify({ env: (req.query.env === 'draft' ? 'draft' : 'prod') })
        : undefined,
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(502).json({
      reason: 'upstream_unreachable',
      detail: String((e && e.message) || e),
    });
  }
}
