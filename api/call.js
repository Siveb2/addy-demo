/**
 * POST /api/call  — places one outbound call through the agent backend.
 *
 * The browser never sees AGENT_API_KEY: it posts {phone, note} here, and this
 * function adds the credential server-side. Set these in Vercel → Settings →
 * Environment Variables:
 *
 *   AGENT_API_URL   e.g. https://your-backend.example.com
 *   AGENT_API_KEY   the extension/API token for that account
 *   AGENT_ID        (optional) pin a specific agent
 *   DEMO_ALLOW      (optional) comma-separated E.164 numbers allowed to be dialed
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ reason: 'method_not_allowed' });
  }

  const base = process.env.AGENT_API_URL;
  const key = process.env.AGENT_API_KEY;
  if (!base || !key) {
    return res.status(500).json({ reason: 'not_configured', detail: 'Set AGENT_API_URL and AGENT_API_KEY in Vercel.' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const phone = normalize(body.phone);
  const note = String(body.note || '').slice(0, 2000);

  if (!phone) return res.status(400).json({ reason: 'bad_phone', detail: 'Use E.164, e.g. +14155550142' });

  // Optional allowlist so a public demo URL can't dial arbitrary numbers.
  const allow = (process.env.DEMO_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(phone)) {
    return res.status(403).json({ reason: 'not_allowed', detail: 'This number is not on the demo allowlist.' });
  }

  const payload = {
    prospect_id: 'addy-demo-' + Date.now(),
    page_phones: [phone],
    note,
  };
  if (process.env.AGENT_ID) payload.agent_id = process.env.AGENT_ID;

  try {
    const r = await fetch(base.replace(/\/+$/, '') + '/extension/call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'X-API-Key': key,
        'Idempotency-Key': payload.prospect_id,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    const data = safeParse(text) ?? { raw: text };

    if (!r.ok) {
      return res.status(r.status).json({
        reason: (data && (data.reason || data.detail)) || 'upstream_error',
        detail: typeof data.raw === 'string' ? data.raw.slice(0, 300) : undefined,
      });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ reason: 'upstream_unreachable', detail: String(e.message || e) });
  }
}

function normalize(v) {
  const digits = String(v || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits.length >= 11 ? digits : null;
  if (digits.length === 10) return '+1' + digits;           // US without country code
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return digits.length >= 10 ? '+' + digits : null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
