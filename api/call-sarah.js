/**
 * POST /api/call-sarah — the webhook Jack's tool calls.
 *
 * Jack is the browser voice agent the loan officer talks to. When the LO asks
 * him to call the borrower, his custom tool POSTs here, and this places the
 * real outbound call with Alex (the phone agent).
 *
 * Register this in the dashboard as a custom tool on Jack:
 *   name:        call_borrower
 *   webhook_url: https://<your-vercel-url>/api/call-sarah
 *   method:      POST
 *   parameters:  items (string) — what to ask for
 *
 * The response string is spoken back to the loan officer, so it is written to
 * be said out loud, not read.
 *
 * Vercel env:
 *   SARAH_PHONE      the number to dial (also settable from the UI)
 *   AGENT_ID_ALEX    the phone agent's uuid
 *   AGENT_API_KEY    platform api key — without it this stays simulated
 *   AGENT_API_URL    backend base url
 *   DEMO_ALLOW       E.164 allowlist
 */

const FALLBACK_API = 'https://api.metallabs.io';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed.' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const items = String(body.items || 'the outstanding documents').slice(0, 500);

  // The number: from the request if the UI passed one, else the env default.
  const phone = normalize(body.phone || process.env.SARAH_PHONE);

  if (!phone) {
    return res.status(200).json({
      message: "I don't have a phone number for Sarah on file. Add one in the " +
               "sidebar and I'll call her straight away.",
    });
  }

  const allow = (process.env.DEMO_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(phone)) {
    return res.status(200).json({
      message: "That number isn't on the approved list for this demo, so I " +
               "haven't placed the call.",
    });
  }

  const base = (process.env.AGENT_API_URL || FALLBACK_API).replace(/\/+$/, '');
  const apiKey = process.env.AGENT_API_KEY;
  const agentId = process.env.AGENT_ID_ALEX;

  if (!apiKey || !agentId) {
    return res.status(200).json({
      message: `Alright — calling Sarah now about ${items}. I'll let you know ` +
               `how it goes.`,
      simulated: true,
    });
  }

  try {
    const r = await fetch(base + '/outbound/calls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        agent_id: agentId,
        phone,
        purpose: `Call Sarah Mitchell about loan 4471. Collect: ${items}.`,
        context: {
          direction: 'outbound',
          contact_name: 'Sarah Mitchell',
          source: 'jack_tool',
          variables: {
            first_name: 'Sarah',
            loan_file: 'Loan 4471 · Conventional Purchase',
            loan_officer: 'Danielle Reyes',
          },
        },
      }),
    });

    const text = await r.text();
    const data = safeParse(text) || {};

    if (!r.ok) {
      const reason = data.reason || data.detail || ('error ' + r.status);
      return res.status(200).json({
        message: `I couldn't place that call — ${String(reason)}.`,
      });
    }

    return res.status(200).json({
      message: `Calling Sarah now about ${items}. I'll let you know how it goes.`,
      call_id: data.outbound_id || data.id || null,
    });
  } catch (e) {
    return res.status(200).json({
      message: "I couldn't reach the calling system just then. Want me to try again?",
    });
  }
}

function normalize(v) {
  const d = String(v || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d.length >= 10 ? '+' + d : null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
