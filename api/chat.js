/**
 * POST /api/chat — the Ask Addy assistant.
 *
 * A full assistant for the selected loan file. It answers questions from the
 * file, and it can place a real outbound call when the user asks for one.
 *
 * Runs the tool loop server-side so no key ever reaches the browser:
 *   1. send messages + tool definitions to OpenAI
 *   2. if the model calls place_voice_call, run it against the backend
 *   3. feed the result back and let the model phrase the reply
 *
 * Vercel env vars (Settings -> Environment Variables):
 *   OPENAI_API_KEY   required for chat
 *   AGENT_API_URL    backend base url (defaults to the public one below)
 *   AGENT_API_KEY    platform api key — required only to place real calls
 *   AGENT_ID         which agent dials (optional; falls back to the lead's key)
 *   DEMO_ALLOW       comma-separated E.164 allowlist (strongly recommended)
 */

const FALLBACK_API = 'https://api.metallabs.io';
const MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(200).json({
      reply: "I'm not configured yet — OPENAI_API_KEY is missing on the deployment. " +
             "Add it in Vercel and I'll be able to answer questions about this file.",
      events: [{ type: 'error', text: 'OPENAI_API_KEY not set' }],
    });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const lead = body.lead || {};
  const history = Array.isArray(body.messages) ? body.messages.slice(-20) : [];

  const messages = [{ role: 'system', content: systemPrompt(lead) }, ...history];
  const events = [];

  try {
    // ---- turn 1: does the model want a tool? ----
    let data = await openai(key, { model: MODEL, messages, tools: TOOLS, tool_choice: 'auto' });
    let msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('no completion returned');

    if (msg.tool_calls?.length) {
      messages.push(msg);

      for (const call of msg.tool_calls) {
        const args = safeParse(call.function?.arguments || '{}') || {};
        const result = await runTool(call.function?.name, args, lead, events);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      // ---- turn 2: let the model phrase the reply ----
      data = await openai(key, { model: MODEL, messages });
      msg = data?.choices?.[0]?.message;
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reply: msg?.content || '', events });
  } catch (e) {
    return res.status(200).json({
      reply: "Something went wrong on my side — try that again.",
      events: [{ type: 'error', text: String(e.message || e) }],
    });
  }
}

/* ================= tools ================= */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'place_voice_call',
      description:
        'Start a phone call to this borrower about specific outstanding items on their ' +
        'loan file. The call happens in the background and takes several minutes — this ' +
        'returns immediately with a call id, NOT the result of the call. Use it when the ' +
        'user asks you to call, or when they agree to a call you suggested. ' +
        'After calling this tool, say the call has STARTED. Never say what the borrower ' +
        'said — you do not know yet.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'Which outstanding items to chase, by their short label.',
          },
          note: {
            type: 'string',
            description: 'Optional extra instruction for the calling agent.',
          },
        },
        required: ['items'],
      },
    },
  },
];

async function runTool(name, args, lead, events) {
  if (name !== 'place_voice_call') return { status: 'error', reason: 'unknown_tool' };

  const phone = normalize(lead.phone);
  if (!phone) {
    events.push({ type: 'refused', text: 'No phone number on this file' });
    return {
      status: 'refused',
      reason: 'no_phone',
      detail: `There is no phone number on ${lead.name || 'this file'}. ` +
              'Ask the user to add one in the sidebar.',
    };
  }

  const allow = (process.env.DEMO_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(phone)) {
    events.push({ type: 'refused', text: 'Number not on the demo allowlist' });
    return { status: 'refused', reason: 'not_allowed',
             detail: 'That number is not on the demo allowlist.' };
  }

  const base = (process.env.AGENT_API_URL || FALLBACK_API).replace(/\/+$/, '');
  const apiKey = process.env.AGENT_API_KEY;
  const agentId = process.env.AGENT_ID || lead.callKey;

  if (!apiKey || !agentId) {
    // Demo-safe path: the assistant still behaves correctly, nothing dials.
    const id = 'vc_demo_' + Date.now().toString(36);
    events.push({ type: 'call_started', text: `Simulated call to ${mask(phone)}`, call_id: id, simulated: true });
    return {
      status: 'accepted', call_id: id, simulated: true,
      detail: 'Call accepted in demo mode — no real dial (AGENT_API_KEY not set).',
    };
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
        purpose: buildPurpose(lead, args),
        context: {
          direction: 'outbound',
          contact_name: lead.name,
          source: 'askaddy_demo',
          variables: {
            first_name: (lead.name || '').split(' ')[0] || '',
            loan_file: lead.meta || '',
            loan_officer: 'Danielle Reyes',
          },
        },
      }),
    });

    const text = await r.text();
    const data = safeParse(text) || { raw: text.slice(0, 200) };

    if (!r.ok) {
      const reason = data.reason || data.detail || ('http_' + r.status);
      events.push({ type: 'refused', text: String(reason) });
      return { status: 'refused', reason: String(reason),
               detail: 'The platform refused the call: ' + String(reason) };
    }

    const id = data.outbound_id || data.id || 'vc_' + Date.now().toString(36);
    events.push({ type: 'call_started', text: `Calling ${mask(phone)}`, call_id: id });
    return { status: 'accepted', call_id: id, detail: 'Call queued and dialling now.' };
  } catch (e) {
    events.push({ type: 'error', text: String(e.message || e) });
    return { status: 'error', reason: 'upstream_unreachable', detail: String(e.message || e) };
  }
}

/* ================= prompt ================= */

function systemPrompt(lead) {
  const facts = (lead.facts || []).map(f => `  ${f[0]}: ${f[1]}`).join('\n');
  const checklist = (lead.checklist || [])
    .map(c => `  [${c[0] === 'done' ? 'CLEARED' : c[0] === 'open' ? 'OUTSTANDING' : 'BLOCKED'}] ${c[1]} — ${c[2]}`)
    .join('\n');
  const guidelines = (lead.guidelines || []).map(g => `  ${g[0]}: ${g[1]} — ${g[2]}`).join('\n');
  const outstanding = (lead.ask || []).map(a => `  - ${a}`).join('\n');

  return `You are Addy, an AI assistant helping a mortgage loan officer work a loan file.
You are talking to Danielle Reyes, the loan officer. Not to the borrower.

## THE FILE YOU ARE WORKING
Borrower: ${lead.name || 'unknown'}
${lead.meta || ''}
Phone on file: ${lead.phone ? lead.phone : 'NONE — no number has been added yet'}

Key figures:
${facts || '  (none)'}

Condition checklist:
${checklist || '  (none)'}

Still needed from the borrower:
${outstanding || '  (nothing outstanding)'}

Agency guidelines checked against this scenario:
${guidelines || '  (none)'}

## WHAT YOU CAN DO
Answer anything about this file from the information above — what is outstanding,
what has cleared, whether the numbers sit inside guideline, what is blocking
closing, what you would do next.

You can also PLACE A PHONE CALL to the borrower using the place_voice_call tool.
Only call it when the loan officer asks for a call, or clearly agrees to one you
suggested. Never call it just because documents are outstanding.

## HOW TO BEHAVE
- Be brief and concrete. Two or three sentences unless asked for more.
- Talk like a colleague, not a report. No bullet lists unless they genuinely help.
- Use the real numbers and real condition names from the file above.
- If the answer is not in the file, say so plainly. Never invent a figure.
- You may suggest a call when it is obviously the right next step, but ask first.

## HARD RULES
- NEVER invent loan data, guideline figures, or borrower history.
- NEVER state the loan is approved or will close.
- If there is no phone number on the file and the user asks for a call, say so
  and ask them to add one in the sidebar. Do not call the tool.
- After placing a call, say it has STARTED. You do NOT know what the borrower
  said — the result arrives separately.`;
}

function buildPurpose(lead, args) {
  const items = (args.items && args.items.length ? args.items : (lead.ask || [])).join('; ');
  const note = args.note ? ` Additional instruction: ${args.note}` : '';
  return `Call ${lead.name || 'the borrower'} about ${lead.meta || 'their loan file'}. ` +
         `Collect: ${items}.${note}`;
}

/* ================= helpers ================= */

async function openai(key, payload) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('OpenAI ' + r.status + ': ' + t.slice(0, 200));
  }
  return r.json();
}

function normalize(v) {
  const d = String(v || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d.length >= 10 ? '+' + d : null;
}

function mask(p) { return p ? p.slice(0, -4).replace(/\d/g, '·') + p.slice(-4) : ''; }
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
