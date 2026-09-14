# The AskAddy Demo — spec

*The demo Michael's own idea implies: you chat with Addy about a loan file, and
when you tell it to call someone, it actually calls them.*

---

# PART 1 — What this demonstrates

## The one-sentence version

> **You type a phone number onto a lead, chat with Addy about the file, say "call
> Sarah about the bank statement" — and her phone rings.**

## Why this is a much better demo than the current one

The current demo shows a **voice widget**: click a button, talk to an agent.
That's a feature.

This shows **voice as a capability the assistant reaches for.** That's the
product Michael described:

> *"I want to say, 'At AskAddy voice agents, can you go make this call to do the
> document collection?' And that would be on the tool interface."*

| Current demo | This demo |
|---|---|
| A button that starts a call | An assistant that **decides** to call |
| Voice is the product | Voice is a **tool the LLM uses** |
| Shows the pipeline works | Shows the **integration model** works |
| Michael saw this | Michael **described this** |

**The moment that lands:** you type a sentence, and a phone rings. Nobody clicked
a call button. The LLM decided.

## What it proves technically

1. **Tool calling works** — the LLM chooses `place_voice_call` unprompted
2. **Context flows** — the call brief is built from the file, not typed by hand
3. **The async contract works** — chat returns instantly, the call happens after
4. **Results come back** — the outcome lands in the chat when the call ends
5. **Gates are real** — no phone number, or no consent, produces a refusal *with
   a reason*, not a crash

That fifth one is worth engineering deliberately. **A demo that refuses correctly
is more convincing than one that only succeeds.**

---

# PART 2 — What the user does

## The flow, step by step

**1. Open the dashboard.** Loan-officer pipeline, four demo files, Sarah
Mitchell selected.

**2. Add a phone number to the lead.**
A field in the sidebar — `Phone: [ +1 415 555 0142 ]`. Editable, saved to local
state, shown on the lead card.

*Why this is in the demo:* it makes the call obviously real. A hardcoded number
looks canned; typing your own number in front of someone doesn't.

**3. Open the Ask Addy tab.** A chat interface, not a voice widget.

**4. Ask it things about the file.**

> **You:** what's outstanding on this file?
>
> **Addy:** Two items. Underwriting needs the July bank statement from the Chase
> account ending 4421, and a short letter explaining the $4,200 deposit from the
> 12th. Everything else has cleared — employment, insurance binder, credit.

> **You:** is the LTV okay?
>
> **Addy:** 80% on a conventional purchase, and Fannie allows up to 97% for a
> 1-unit principal residence. Comfortable headroom.

*Why ask these first:* it establishes that the assistant actually knows the file
before you ask it to act on it. Going straight to "call her" skips the setup that
makes the call impressive.

**5. Tell it to call.**

> **You:** call Sarah and chase those two documents

**6. It confirms and dials.**

> **Addy:** Calling Sarah Mitchell at (415) 555-0142 about the July bank
> statement and the deposit explanation. I'll let you know how it goes.
>
> `📞 Call started · vc_01JB8X`

**The phone rings.**

**7. The call happens.** You answer, play the borrower, hit the escalation path
— *"I don't have that statement"* — and the agent offers the loan officer.

**8. The result lands in the chat.**

> **Addy:** Call finished — 1 minute 42 seconds.
>
> **July bank statement** → *promised*. Upload link sent by SMS, she said she'd
> send it tonight.
> **Deposit explanation** → *needs officer*. She asked whether a car sale needs
> documentation — I offered to get Danielle and she's expecting a callback.
>
> Want me to create a task for Danielle?

**That last line is the close.** The assistant isn't reporting, it's continuing
the work.

---

# PART 3 — What to build

## Three pieces

### Piece 1 — Phone number on the lead

**Where:** sidebar, under the lead name.

**Behaviour:**
- Editable text input, E.164 or 10-digit US, normalised on blur
- Persisted to `localStorage` so it survives a reload mid-demo
- Shown on the lead row as a small chip once set
- **If empty, the assistant refuses to call and says why**

That last point matters — it's the refusal path, and demoing it is worth thirty
seconds.

### Piece 2 — The Ask Addy chat tab

**Where:** a fourth tab beside Checklist / Voice / Guidelines.

**Behaviour:**
- Standard chat UI — message list, input, send
- The system prompt carries the **full selected file**: facts, checklist,
  guidelines, phone number, loan officer name
- Streams the reply if the backend supports it; otherwise show a typing
  indicator
- **Tool call renders as a distinct card**, not as text — a violet block saying
  `📞 Call started · vc_…` so it's visually obvious the assistant *did something*
  rather than *said something*

### Piece 3 — The `place_voice_call` tool

**The tool the chat LLM can call.**

```
name: place_voice_call
description:
  Start a phone call to this borrower about specific outstanding items.
  The call happens in the background and takes several minutes — this
  returns immediately with a call id, NOT the result of the call.
  Use when the user asks you to call, or when documents have been
  outstanding long enough to warrant one.
  After calling this, say the call has STARTED. Never say what the
  borrower said — you do not know yet.

parameters:
  items:      which outstanding items to chase (array of ids)
  note:       optional extra instruction for the agent
```

**What it does when called:**

1. Read the phone number from the current lead
2. **If missing → return a refusal with `reason: no_phone`**
3. Build the call brief from the selected items on the file
4. `POST` to the outbound endpoint on the backend
5. Return `{ call_id, status: "accepted" }` to the LLM

**What it must NOT do:** return the call result. It returns a handle. The result
arrives separately.

---

# PART 4 — The backend contract

## What the demo needs from the platform

| Need | Endpoint | Status |
|---|---|---|
| Chat with tool calling | Backend chat endpoint, or OpenAI direct | **Check** |
| Place an outbound call | Existing outbound API | **Exists** |
| Poll call status | `GET /extension/call/{id}` or equivalent | **Exists** |
| Get the outcome | Same, once status is `ended` | **Exists** |

## The simplest version that works

**If the backend chat endpoint supports tools:** use it. The system prompt and
tool definition live server-side, and the demo page just renders messages.

**If it doesn't:** run the chat in the serverless proxy. `/api/chat` takes the
message history, calls OpenAI with the tool definition, and when the model
returns a tool call, the proxy places the outbound call and feeds the result back
into the conversation.

**Recommendation: the proxy.** It's self-contained, it doesn't require backend
changes, and the demo is the only consumer. Roughly 150 lines.

## Status polling

Once a call is placed, poll every 3 seconds. On `ended`, inject a system message
into the chat with the outcome, and let the model phrase the summary.

**Why let the model phrase it:** so the report reads like the same assistant
that placed the call, not like a status dump. That continuity is a large part of
why the demo feels like a product.

---

# PART 5 — Demo script

## Setup, before you share your screen

1. **Your own phone number** in the lead — so the call is unambiguously real
2. **Screen share with audio enabled** — this failed on call 1 and cost 45
   seconds
3. **Backup recording queued** in a tab
4. **Phone on silent, not off** — you need it to ring but not to hear it twice

## The run — about 4 minutes

**Set the scene (15s)**

> *"This is a loan officer's pipeline. Sarah Mitchell, conventional purchase,
> conditionally approved with two items outstanding. And this is Ask Addy — but
> it can do more than answer questions now."*

**Establish context (45s)**

Ask: *what's outstanding on this file?* → it answers from the file.
Ask: *is her LTV within guidelines?* → it answers with the Fannie limit.

> *"So it knows the file. Nothing surprising yet."*

**The moment (30s)**

Type: **`call Sarah and chase those two documents`**

Then stop talking. Let the phone ring.

> *"I didn't click a call button. It decided to call, built the brief from the
> open conditions, and dialled."*

**The call (90s)**

Answer, play Sarah. Hit the escalation: *"I don't have that statement."*
The agent offers the loan officer.

**The return (45s)**

The result lands in the chat, per item.

> *"Per item, not a boolean. Promised versus needs-officer — your agent can act
> differently on each. That's the difference between a transcript and something
> AskAddy can reason about."*

**The refusal — if there's time (30s)**

Switch to a lead with no phone number. Ask it to call.

> **Addy:** I don't have a phone number for David Kim — add one and I'll call.

> *"And it refuses with a reason. Every gate on the real system works the same
> way — no consent, outside calling hours, lines busy. The LLM asking for a call
> doesn't mean a call happens."*

**That refusal is worth more than a second successful call.**

---

# PART 6 — What can go wrong, and what to do

| Risk | Mitigation |
|---|---|
| **Audio not shared** | Test it beforehand. This already cost you once |
| Model doesn't call the tool | Tune the description; test the exact phrasing you'll use |
| Model reports the call result before it happens | The "never say what the borrower said" line in the tool description |
| Call fails to connect | Backup recording. Say "let me show you the recorded one" and lose nothing |
| Chat is slow | Stream it, or show a typing indicator |
| Transfer path misbehaves | **Test this branch specifically** — it was fabricating availability |

## The one to rehearse

**Say the exact sentence you'll type, out loud, several times beforehand.** LLM
tool selection is sensitive to phrasing, and *"call Sarah and chase those two
documents"* behaving differently from *"can you call Sarah"* is exactly the kind
of thing that only shows up live.

---

# PART 7 — How to frame it to Jay

**Open by attributing it:**

> *"Michael said he wanted to be able to tell AskAddy to go make a call. I built
> that."*

**Then the technical point, after the call lands:**

> *"This is the tool interface working end to end. The chat model decided to
> call, built the brief from the open conditions, and the gates ran on our side
> regardless of what it asked for. The result came back per item — promised
> versus needs-officer — because a boolean gives your agent nothing to reason
> about."*

**And be honest about what it is:**

> *"This is a demo, not the production design. The tool definition lives in a
> proxy rather than in your agent framework, and the gates are simplified. But
> the shape is real — and the shape is what I'd want your feedback on."*

---

# PART 8 — Build order

If time is short, build in this order. Each step is demoable on its own.

1. **Phone number field** on the lead — 30 minutes
2. **Chat tab** that answers from the file, no tools — 2 hours
3. **The `place_voice_call` tool** — 2 hours
4. **Status polling and the result message** — 1 hour
5. **The refusal path** for a missing number — 30 minutes

**Steps 1–3 are the demo.** Four and five make it feel finished.

**If you only have an evening:** 1, 2, 3. A call that starts from a sentence is
the whole point; the result landing back can be narrated rather than shown.
