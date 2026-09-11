/**
 * GET /api/status?id=<outbound_id> — polls call status through the backend.
 * Same credential handling as /api/call: the key stays server-side.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ reason: 'method_not_allowed' });
  }

  const base = process.env.AGENT_API_URL;
  const key = process.env.AGENT_API_KEY;
  if (!base || !key) return res.status(500).json({ reason: 'not_configured' });

  const id = String(req.query.id || '').trim();
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return res.status(400).json({ reason: 'bad_id' });
  }

  try {
    const r = await fetch(base.replace(/\/+$/, '') + '/extension/call/' + encodeURIComponent(id), {
      headers: { 'Authorization': 'Bearer ' + key, 'X-API-Key': key },
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) return res.status(r.status).json({ reason: (data && data.reason) || 'upstream_error' });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ reason: 'upstream_unreachable', detail: String(e.message || e) });
  }
}
