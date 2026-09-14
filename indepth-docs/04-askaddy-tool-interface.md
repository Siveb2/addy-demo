# The AskAddy Tool Interface — design

*Michael proposed this himself on the first call. This is the design he asked
for, worked out properly. Nothing here is built yet — it's a proposal, and it
says so. But every mechanism it relies on already exists in the platform, and
this doc names which.*

---

# PART 0 — What he actually asked for

His words, from the transcript:

> "Can we make a unified tool interface? Because we have this product called
> AskAddy. And what we want to be able to do is, I want to say, **'At AskAddy
> voice agents, can you go make this call to do the document collection?'**
> Like — and that would be on the tool interface."

## Why this is the most important thing he said

Read it carefully. He is not asking for a voice product sitting next to Addy.

He's asking for voice to be a **capability his existing agent can reach for** —
the same way it already reaches for document parsing or guideline search.

That changes the shape of the whole engagement:

| The pitch he was offered | What he actually asked for |
|---|---|
| A voice product with its own UI | A tool AskAddy invokes |
| Loan officers learn a new surface | Nobody learns anything new |
| Voice competes for attention | Voice composes with what exists |
| Integration = embedding a panel | Integration = registering a tool |

**The second column is a smaller ask and a bigger product.** Arriving with a
design for it is the difference between being a good candidate and being someone
already working the problem.

---

# PART 1 — The one decision that shapes everything

## A tool call returns in milliseconds. A phone call takes minutes.

This is the whole design problem in one sentence.

When AskAddy's LLM calls a tool, it is mid-conversation with a loan officer.
It needs a response now — a few hundred milliseconds at most. If a tool blocks
for four minutes, the LLM turn dies, the loan officer sees a hang, and the whole
interaction is broken.

But the work the tool triggers — actually phoning a borrower — takes minutes.

**So the tool cannot return the result. It must return a handle.**

```
AskAddy calls the tool      →  ~200ms  →  { call_id, accepted }
                                              │
                        (minutes pass, a call happens)
                                              │
Addy receives a webhook     ←────────────────┘  { outcome, transcript, ... }
```

This is standard async job design, but it has a specific consequence worth
stating: **the LLM must be told, in the tool's description, that it is starting
something rather than finishing it.** Otherwise it will report to the loan
officer that the call happened, when all that happened is that it was queued.

## Three response shapes, not two

Most designs have "success" and "failure." This one needs three:

| Response | Meaning | What AskAddy says |
|---|---|---|
| **accepted** | The call is queued and will happen | "I'll call Sarah now and let you know." |
| **refused** | We looked, and we won't dial | "I can't call her — she hasn't consented to AI calls." |
| **error** | Something is broken on our side | "Something went wrong — I've flagged it." |

**"Refused" is the important one**, and it's the one most designs collapse into
error. A refusal is a *correct, expected outcome* carrying a reason the loan
officer needs to hear. Out of calling hours. No consent on file. All lines busy.
Quota exhausted.

We have a scar on exactly this: carrier rejection and no-answer returned the same
value for six days, and every warm transfer failed at 100% while looking like
nobody picked up. **Distinct outcomes need distinct return values.**

---

# PART 2 — The tool contract

## What AskAddy sends

```json
POST /tools/voice/call
Authorization: Bearer <addy-tenant-token>
Idempotency-Key: <askaddy-turn-id>

{
  "loan_file_id": "4471",
  "contact": {
    "name": "Sarah Mitchell",
    "phone": "+14155550142"
  },
  "objective": "collect_documents",
  "items": [
    {
      "id": "cond_8821",
      "label": "July bank statement",
      "detail": "Chase checking ending 4421, two most recent months"
    },
    {
      "id": "cond_8822",
      "label": "Letter of explanation",
      "detail": "$4,200 deposit on 07/12 — source and documentation"
    }
  ],
  "context": {
    "loan_officer": "Danielle Reyes",
    "lender_name": "Pacific Home Lending",
    "loan_type": "Conventional purchase"
  },
  "callback_url": "https://api.addy.com/hooks/voice"
}
```

### Why each field is shaped this way

**`items` is a list of objects, not a string.** A free-text "ask her for the bank
statement" gives the agent nothing to report against. With structured items, the
result can say *which* item was promised and which wasn't — and that maps back to
Addy's own condition IDs.

**`id` on each item is Addy's ID, echoed back untouched.** We never invent our
own identifier for their conditions. The write-back is then a straightforward
join on their side.

**`objective` is an enum, not free text.** It selects the agent configuration —
prompt, voice, tools, guardrails. `collect_documents` behaves differently from
`speed_to_lead` or `status_update`. Free text would mean the LLM choosing agent
behaviour, which is exactly what shouldn't happen.

**`context` is speakable facts only.** Name, lender, loan officer. Not the DTI,
not the FICO, not anything the agent should never say out loud. What goes in
context can be spoken; that's the rule.

**`callback_url` is per-request**, so staging and production route separately
without a config change on our side.

## What comes back, immediately

**Accepted:**

```json
{
  "status": "accepted",
  "call_id": "vc_01JB8X...",
  "estimated_start": "2026-09-13T18:42:10Z",
  "agent": "Document collection · Pacific Home Lending"
}
```

**Refused — and this is the response that does the most work:**

```json
{
  "status": "refused",
  "reason": "outside_calling_hours",
  "detail": "Local time 7:14 PM in 415. Calling window opens 08:00.",
  "retry_after": "2026-09-14T15:00:00Z"
}
```

The reason vocabulary, fixed and closed:

| `reason` | What happened |
|---|---|
| `no_consent` | No consent on file for AI calls to this contact |
| `outside_calling_hours` | TCPA window closed for their timezone |
| `lines_busy` | Tenant at their concurrency cap |
| `quota_exceeded` | Plan minutes exhausted |
| `bad_phone` | Unusable or unreachable number |
| `own_number` | The number belongs to the tenant — a feedback loop |
| `duplicate` | Same idempotency key already accepted |
| `dialing_disabled` | This deployment is not permitted to place calls |

**Every one of those is a real gate that already exists in the platform.** The
tool interface isn't inventing policy — it's surfacing gates that already run,
in a vocabulary AskAddy can speak back to a human.

`own_number` deserves a note: it exists because a warm transfer rang a human from
the tenant's own number, their CRM created a prospect for that "unknown caller",
and the workflow dialed it — **our outbound agent ended up talking to our inbound
agent.** A tool interface that lets an LLM request calls needs that gate more,
not less.

---

# PART 3 — Delivering the result

## The webhook, when the call is over

```json
POST {callback_url}
X-Voice-Signature: sha256=<hmac>

{
  "call_id": "vc_01JB8X...",
  "loan_file_id": "4471",
  "status": "completed",
  "outcome": "partial",
  "duration_seconds": 142,
  "items": [
    { "id": "cond_8821", "result": "promised",
      "note": "Upload link sent by SMS; said she'd send tonight" },
    { "id": "cond_8822", "result": "needs_officer",
      "note": "Asked whether a car sale needs documentation" }
  ],
  "actions": [
    { "type": "sms_sent", "detail": "Secure upload link to +1415…0142" },
    { "type": "transfer_attempted", "detail": "To Danielle Reyes — no answer" }
  ],
  "transcript_url": "https://…",
  "recording_url": "https://…",
  "sentiment": "cooperative",
  "consent_basis": "esign_2026-08-19"
}
```

### The per-item result vocabulary

This is where the design earns its keep:

| `result` | Meaning |
|---|---|
| `received` | They sent it during the call |
| `promised` | They agreed to send it |
| `refused` | They declined |
| `needs_officer` | Beyond the agent — a human must answer |
| `not_reached` | Call ended before this item came up |

**AskAddy can act on each of these differently**, which is the point. `promised`
starts a follow-up timer. `needs_officer` creates a task for Danielle.
`not_reached` queues a second call. A single "call completed: true" gives the
agent nothing to reason about.

### Signing

HMAC-SHA256, same as the existing webhook system — which already signs payloads
with `X-Tarsha-Signature: sha256=<digest>` and has durable retry with backoff.

**Nothing new is needed here.** The delivery infrastructure exists, is durably
recorded, and retries on a schedule with a dedicated worker.

## Polling, as the fallback

```
GET /tools/voice/call/{call_id}
```

Same body, plus `status` of `queued | dialing | in_progress | completed |
failed`.

**Why offer both:** a webhook is better, but it requires Addy to expose an
endpoint and handle signature verification. Polling lets them integrate in an
afternoon and add the webhook later. Never make the better-engineered path the
only path.

---

# PART 4 — What the tool description says to the LLM

This is easy to overlook and it determines whether the whole thing behaves.

```
Name: place_voice_call

Description:
  Start a phone call to a borrower about specific outstanding items on
  their loan file. The call happens in the background and takes several
  minutes — this tool returns immediately with a call_id, NOT with the
  result of the call.

  Use when: the loan officer asks you to call someone, or when documents
  have been outstanding long enough to warrant a call.

  Do NOT use for: anything urgent that needs an answer in this
  conversation, or any contact whose consent status you are unsure of —
  the tool will refuse and tell you why.

  After calling this tool, tell the user the call has been STARTED.
  Never tell them what the borrower said; you do not know yet.
```

**That last line is load-bearing.** Without it the model will confabulate a call
outcome, because the tool returned successfully and success reads as completion.

We have a production scar that's exactly this shape: a transfer tool returned
*"The caller has been connected to the team"* as a status string **to the model**,
and under the agent's closing guidance that read as task-complete — so it said
"thank you for your time" and hung up **over a live human-to-human conversation.**

The fix there escalated from prompt → tool-result instruction → a structural
`StopResponse`. The lesson transfers directly: **what a tool returns to a model
is a prompt, not a status code.** Write it as one.

---

# PART 5 — Composition: who decides what

```
┌──────────────────────────────────────────────────┐
│  AskAddy                                         │
│  decides WHETHER to call, and WHY                │
│  · reads the loan file                           │
│  · knows what's outstanding                      │
│  · knows what the LO asked for                   │
└────────────────────┬─────────────────────────────┘
                     │  place_voice_call(...)
                     ▼
┌──────────────────────────────────────────────────┐
│  Voice service                                   │
│  decides HOW to call, and enforces WHETHER IT MAY │
│  · consent gate · calling hours · concurrency    │
│  · runs the conversation                         │
│  · handles escalation                            │
└────────────────────┬─────────────────────────────┘
                     │  webhook
                     ▼
┌──────────────────────────────────────────────────┐
│  Addy loan file                                  │
│  system of record — always                       │
└──────────────────────────────────────────────────┘
```

## The rule that keeps this safe

**An LLM asking for a call does not mean a call happens.**

Every gate runs on our side, in code, regardless of what the model requested.
The model can ask to dial someone with no consent at 11pm; it will get a refusal
with a reason, and no call will be placed.

That matters more with a tool interface than without one. The moment an LLM can
trigger a phone call, **the gates stop being a policy and start being a
containment boundary.** The design has to assume the model will sometimes ask for
the wrong thing.

---

# PART 6 — Idempotency

## Why it's not optional here

LLM tool calls retry. The runtime retries on timeout, the model retries when it
doesn't like a response, a user re-sends a message. **Every one of those can
produce a duplicate call request.**

A duplicate HTTP request is a nuisance. A duplicate phone call to a borrower is
an incident.

## The design

`Idempotency-Key` on the request — AskAddy's turn ID works well, since it's
already unique per LLM invocation.

- First request with a key → processed, key stored with the resulting `call_id`
- Repeat with the same key → returns the **same** `call_id`, `status: duplicate`
- Never a second dial

## Two scars this borrows from

**The dedup claim must release on failure.** From the intake path:

> Everything below runs under a claimed dedup id: on ANY failure the claim is
> released so the sender's retry can actually re-process — a 500 after the SET NX
> left the lead **permanently dropped**, because the retry answered
> "duplicate_event".

Claiming the key and then failing means the retry is told "already done" when
nothing was done. **The claim has to be released on any failure path.**

**Normalise the phone before deduping.** We had a race where the same lead as
`4155551212` and `+14155551212` became two active enrollments on interleaved
cadences. Dedup on the normalised E.164 number, not the string as sent.

---

# PART 7 — Beyond document collection

Michael already sketched the sequence himself: *"we can attack one of the first
use cases, which is the voice calling to request documents… and then we can add
additional use cases."*

The tool interface makes each of those a new `objective`, not a new integration:

| `objective` | Trigger | Agent behaviour |
|---|---|---|
| `collect_documents` | Conditions outstanding | The wedge. Chase, send link, escalate |
| `speed_to_lead` | New application arrives | Call within minutes, qualify, book |
| `status_update` | Milestone reached | Proactive — stops "where is my loan?" calls |
| `refi_outreach` | Rate moves | Against the existing book |
| `appointment_reminder` | Before a scheduled call | Cheap, fast voice tier |

**One integration, five products.** Addy adds a use case by passing a different
objective — no new endpoint, no new auth, no new webhook handler.

That's the argument for building it as a tool interface rather than a feature:
**it makes the second use case nearly free.**

---

# PART 8 — What this needs from Addy

Short list, and it's short on purpose.

1. **An endpoint to receive the webhook**, or acceptance that we start with
   polling.
2. **The condition schema** — what a checklist item looks like, so `items` maps
   cleanly to their IDs.
3. **Consent data** — where it lives, what it records, and whether it
   distinguishes AI calls specifically from contact generally.
4. **Tool registration** in AskAddy — whatever their agent framework needs to
   expose a new tool.
5. **A decision on objectives** — which use cases are in scope for v1.

Items 1 and 4 are hours of work. Item 3 is a policy question, not an engineering
one, and it gates everything.

---

# PART 9 — What already exists vs what's new

Being precise here is the point: this is a thin layer over proven parts.

| Piece | Status |
|---|---|
| Outbound dialing, SIP, recording | **Exists** |
| Consent gate before dial | **Exists** |
| Calling-hours / TCPA gate | **Exists** |
| Per-tenant concurrency + quota gates | **Exists** |
| Own-number feedback-loop gate | **Exists** |
| Structured call outcomes | **Exists** |
| HMAC-signed webhooks, durable retry | **Exists** |
| Event dedup by idempotence ID | **Exists** |
| Per-agent prompts, voices, tools | **Exists** |
| Mid-call tools (SMS, transfer) | **Exists** |
| — | — |
| The `/tools/voice/call` endpoint | **New — thin** |
| Objective → agent-config mapping | **New — configuration** |
| Per-item result vocabulary | **New — the design work** |
| Tool description tuned for the LLM | **New — prompt work** |

**Realistic estimate: the endpoint and the mapping are days, not weeks.** The
genuinely new thinking is the per-item result vocabulary and getting the tool
description right — and those are design problems, not build problems.

Say that plainly. Overstating the work is as damaging as understating it.

---

# PART 10 — Questions Jay will ask

**"Why async? Can't it just block?"**
A tool call needs to return in a few hundred milliseconds; the LLM is
mid-conversation with a loan officer. A phone call takes minutes. Blocking kills
the turn. So the tool returns a handle and the result arrives by webhook.

**"What if the webhook fails?"**
Durable retry with backoff, and delivery is recorded per attempt — that's the
existing webhook system, not something new. Plus a polling endpoint as a
fallback, so you can integrate without exposing anything.

**"What stops the LLM from calling someone it shouldn't?"**
Every gate runs on our side regardless of what the model asked for. Consent,
calling hours, concurrency, quota, own-number. The model can request a call at
11pm to someone with no consent — it gets a refusal with a reason, and no call is
placed. The gates are a containment boundary, not a policy.

**"How do we avoid double-dialing on a retry?"**
An idempotency key on the request; your turn ID works. Same key returns the same
call_id and never dials twice. And the key is released on any failure path — we
had an incident where claiming a dedup ID and then failing meant the retry was
told "already done" when nothing had been done.

**"What does the agent actually know about the loan?"**
Only what's in `context` and `items`. That's deliberate — what goes in context
can be spoken aloud. DTI, FICO, approval odds and anything about guidelines stay
out, because the agent must never improvise on regulated facts. It works from the
brief or it escalates.

**"Can AskAddy cancel a call in flight?"**
`DELETE /tools/voice/call/{id}`. Before dial it's a cancel; mid-call it's a
graceful hang-up. Worth having for the case where a borrower emails the document
thirty seconds after the call was queued.

**"How is this different from just giving us your API?"**
An API is a surface your engineers integrate against. A tool is something your
agent invokes on its own. The difference is that you don't build a feature for
each use case — you pass a different objective, and the second use case is nearly
free.

---

# PART 11 — How to present this

**Close the meeting on this section.** It's the one that says you listened to his
CEO rather than just prepared well.

**Open by quoting him.** *"You said you wanted to be able to tell AskAddy to go
make a call. Here's what I think that looks like."* Attribute the idea to him —
it's his, and saying so is both accurate and disarming.

**Lead with the async constraint.** It's the decision everything else follows
from, and it shows you thought about their side of the integration rather than
just ours.

**Spend your time on the result vocabulary.** `received / promised / refused /
needs_officer / not_reached` is where the actual design judgment is. A generic
"completed: true" is what a weaker proposal would return, and the difference is
obvious to an engineer.

**Be honest that it's a proposal.** Say plainly that nothing is built, that the
endpoint is days rather than weeks because the gates and webhooks already exist,
and that the shape will change once you see their condition schema.

**Then ask the question that matters:** *"Does this match what you had in mind,
or were you thinking about it differently?"* His answer tells you more about the
engagement than anything else in two hours.
