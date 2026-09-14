# Integration & Compliance — explained from zero

*Two sections that sit together because they're both about the boundary between
our system and theirs — technically, and legally.*

---

# PART A — INTEGRATION

---

## A0 — The principle everything follows from

**Addy stays the system of record. Always.**

Voice **reads** a condition and **writes** an outcome. It never owns the loan
file, the borrower relationship, or any durable state Addy would miss if voice
were switched off tomorrow.

### Why this is the first thing to say

The fear a platform founder has about a voice vendor is that it becomes a second
source of truth and starts competing for control of the customer. This design
makes that structurally impossible.

**Turn it off, lose a feature. Never lose data.**

### And it's shipped, not theoretical

The same coexistence model runs today against a CRM. From that integration's own
header comment:

> **Coexistence model (client requirement):** [the CRM] stays the lead system of
> record and keeps running its own SMS/email drips; **we own voice.** After each
> call we push a note onto the matching prospect so the loan officer sees call
> outcomes without leaving [their tool].

**That comment is worth putting on screen.** It's a documented, shipped answer to
the exact anxiety Michael has — written before he ever asked the question.

---

## A1 — The loop

```
Addy checklist
      │  open condition
      ▼
  call brief  ──▶  voice service  ──▶  borrower
                        │
Addy loan file  ◀───────┘
  condition status · transcript · recording · outcome
```

**Their output is our input. Our output is their input.** Neither system needs to
understand the other's internals.

## A2 — What we need from Addy

| Need | Why | Effort on their side |
|---|---|---|
| **Checklist output schema** | Conditions become call briefs | Documentation |
| **Auth token / tenancy model** | Reuse their session, no second login | Hours |
| **Write-back endpoint** | Where outcomes land | Hours, or we use their API |
| **A slot in the side panel** | One tab, their design system | Hours |
| **Sandbox LOS credentials** | Build against real data shapes | Access |

## A3 — What we explicitly do NOT need

Say this list out loud. It's shorter than they expect and that's the point.

- **No changes to their checklist logic** — it's the input, untouched
- **No new data store** — Addy stays system of record
- **No new manifest permissions** for phase one
- **No extension rewrite** — additive only
- **No borrower-facing app** — an SMS link is enough

---

## A4 — The Chrome extension, and the MV3 trap ⭐

Their extension already exists with 8,000 users. Voice becomes a fifth tab beside
Checklist, Guidelines and Pricing.

But there's a constraint worth naming before week one rather than after.

### What Manifest V3 changed

Chrome extensions used to have a persistent background page. MV3 replaced it with
a **service worker** — a script that wakes, does a short task, and sleeps.

Service workers:
- **Have no DOM access**
- **Can be suspended by Chrome at any time**
- Often suspend when idle

### Why that breaks voice

A live call needs `getUserMedia` and a WebRTC connection held open for minutes.

**If you put the media session in the service worker, Chrome suspends it
mid-call.** Most teams discover this after building it.

### The supported fix

An **offscreen document** — an invisible HTML page the extension creates from the
service worker. It's the only MV3 context with full DOM access, including
`getUserMedia`, `RTCPeerConnection` and `MediaRecorder`.

One per extension, and it survives the worker sleeping.

### The judgment call that matters more than the knowledge

**Phase one is outbound-only.** The server dials over SIP; the browser never
touches the microphone. No offscreen document needed, no MV3 constraint at all.

> *"I'd rather ship narrow and working than broad and fragile. Browser-side
> calling comes later, when it's earning its keep."*

Knowing the trap is worth something. **Designing around it so phase one doesn't
need it is worth more.**

## A5 — Two call paths, and how they differ

| | Outbound to borrower | Browser call / LO listens in |
|---|---|---|
| Who dials | Server, via SIP | Browser, via WebRTC |
| Microphone | Not involved | Required |
| MV3 offscreen doc | Not needed | Required |
| Phase | **One** | Later |

## A6 — The write-back contract

What lands on the loan file after a call:

- **Condition status** per item — received / promised / refused / needs_officer /
  not_reached
- **Transcript** and **recording** URLs
- **Structured outcome** for the call as a whole
- **Consent basis** — what permission the call was placed under
- **Actions taken** — SMS sent, transfer attempted

**The per-item results are the part that matters.** A boolean "call completed"
gives their system nothing to act on. Per-item results let Addy start a follow-up
timer on `promised` and create an LO task on `needs_officer`.

---

# PART B — COMPLIANCE

---

## B0 — Why raise this before they do

Every voice vendor pitching mortgage right now skates past compliance. Raising it
yourself moves you from vendor to advisor in about thirty seconds.

And for a lender, it's not theoretical. It's the thing that can generate a class
action.

---

## B1 — TCPA and AI voice

### The rule

The **FCC's February 2024 declaratory ruling** classified AI-generated voice
calls as "artificial or prerecorded voice" under the TCPA.

**Consequence:** consent to "receive calls" may not cover an AI call. General
consent and consent-that-names-artificial-voice are different things.

### The exposure

- **$500 per call** in statutory damages, trebled to $1,500 for wilful violations
- Class actions in 2025–26 settled in the **$5M–20M** range
- A **February 2026** case targeted a lender whose **vendor** dialled without
  proper consent

**That last one is the one to name.** The vendor's design choices became the
lender's liability. Which is exactly the relationship being discussed here.

### What's proposed beyond the ruling

An August 2024 Notice of Proposed Rulemaking proposes **mandatory in-call AI
disclosure** plus consent language that specifically references AI use.

Designing for that now is cheaper than retrofitting it.

---

## B2 — What the platform enforces today

| Control | How |
|---|---|
| **Consent gate** | Checked before every dial, per contact, logged |
| **AI disclosure** | Configurable preamble prepended to the greeting |
| **Recording notice** | Same mechanism, per-tenant text |
| **Calling hours** | TCPA window per recipient timezone, in the gate chain |
| **Audit log** | Every mutating request — actor, action, resource, status, IP |
| **Retention purge** | Transcripts nulled, recordings deleted past N days |
| **DSAR** | Export and erasure per user |
| **RBAC** | Role dependency on protected routes |
| **Secrets** | Integration credentials encrypted at rest |

**The consent gate is a gate, not a setting.** It sits in the dial chain and
fails closed. An LLM asking for a call doesn't bypass it.

## B3 — Call classes are not the same

This distinction matters legally and it should matter architecturally.

| Class | Consent standard |
|---|---|
| **Servicing** — existing borrower, existing loan | Lower bar. Established relationship |
| **Marketing** — new prospect, promotional | **Prior express written consent** |

**Design for the first, gate the second hard.** Document collection on an active
loan file is servicing. Refi outreach to a past customer is closer to marketing.

**Say this explicitly**, because it shows you understand that "can we call
people" has more than one answer.

## B4 — The line to use

> *"Every borrower call is a $500 liability if the consent isn't right. I'd
> rather build that gate on day one than retrofit it after your first complaint.*
>
> *I'm not your counsel — your compliance team sets policy. I build the thing
> that enforces it."*

That second sentence is the important one. **You are not offering legal
judgment.** You're offering enforcement of theirs.

## B5 — SOC 2

Addy is **SOC 2 Type 2 compliant** — it's on their homepage. So this will come up.

**The honest position:**

- SOC 2 is a **process with an audit period**, not a feature you ship
- The technical controls that an audit looks for largely exist: access control,
  audit logging, encryption at rest, retention policy, incident response
- What's missing is the **evidence trail and the formal process**
- If voice runs inside Addy's boundary, it inherits their programme — but it
  becomes in-scope for their next audit

**Don't claim SOC 2 readiness.** Say: *"The controls an audit looks for mostly
exist. The evidence and process don't. If this runs inside your boundary it
becomes in-scope for your next audit, and I'd want your compliance team to tell
me what that requires."*

---

## B6 — Compliance gaps

**1. Consent semantics are the tenant's to define.** We enforce a flag. We don't
know whether their consent record distinguishes AI calls specifically from
contact generally. **That's a question for Addy, and it gates phase one.**

**2. No per-state calling-hours nuance beyond the federal window.** Some states
have tighter rules. Currently one window.

**3. Retention purge has never run against a large dataset.** Correct, untested
at volume.

**4. No formal DPA or subprocessor list.** Needed for enterprise lender
procurement.

**5. No SOC 2 evidence trail.** See above.

---

# PART C — Questions they'll ask

**"How deep does the integration go?"**
Shallow on purpose. Your checklist output is our input; our outcome is your
input. Neither system needs to understand the other's internals. Addy stays
system of record — voice never owns the loan file.

**"What do we have to build?"**
A webhook endpoint or acceptance that we start with polling, and tool
registration if we go the AskAddy route. Both are hours. What takes longer is
documenting your checklist schema and your consent model — and the second is a
policy question, not an engineering one.

**"What about the Chrome extension?"**
One tab in the sidebar you already ship. And there's a constraint worth knowing
before week one: MV3 service workers sleep, so a media session there dies
mid-call. The supported fix is an offscreen document — but phase one is
outbound-only, so the server dials and the browser never touches the microphone.
We skip the constraint entirely.

**"Are we exposed on TCPA?"**
Potentially, and that's why I'd rather raise it than wait. The FCC put AI voice
under the artificial-voice rules in 2024. Damages start at $500 a call, and there
was a case this February against a lender whose *vendor* dialled without proper
consent. The gates exist on our side — consent checked before every dial, AI
disclosure in the greeting, full audit trail. But the consent *semantics* are
yours to define, and I'd need to know whether your records distinguish AI calls
specifically.

**"Does this affect our SOC 2?"**
If it runs inside your boundary, it becomes in-scope for your next audit. The
technical controls an audit looks for mostly exist — access control, audit
logging, encryption at rest, retention. What doesn't exist is the evidence trail
and formal process. I wouldn't claim readiness; I'd want your compliance team to
tell me what's required.

**"Who's liable if the agent says something wrong?"**
Architecturally, the agent doesn't improvise on regulated facts — it works from a
brief and escalates anything outside it. Your platform is the source of truth on
guidelines; voice never is. Commercially, that's a contract question and I'd want
it written down rather than assumed.

---

# PART D — The five things to land

1. **Addy stays system of record.** Voice reads a condition, writes an outcome,
   owns nothing. Turn it off and you lose a feature, never data.

2. **It's a shipped pattern, not a promise.** The same coexistence model runs
   against a CRM today, and the code comment says so.

3. **The MV3 trap, and the design that avoids it.** Knowing service workers sleep
   is worth something. Making phase one not need the workaround is worth more.

4. **TCPA before they ask.** $500 a call, a February case where the *vendor's*
   design became the lender's liability, and gates that already exist.

5. **"I'm not your counsel. I build the enforcement."** You're not offering legal
   judgment — you're offering to implement theirs.
