# The Four-Week Plan — rebuilt for Jay

*The version Michael saw was a sketch from outside the codebase. This one is
written for someone who has just spent two hours interrogating the architecture,
and it's different in three ways: it names what four weeks does NOT buy, it puts
a checkpoint at the end of every week, and it front-loads the decisions that
block everything else.*

---

# PART 0 — What changed since the version Michael saw

| Michael's version | This version |
|---|---|
| "Week 1: foundation & architecture" | Week 1 ends with a real call **and** three decisions closed |
| Implicit scope | Explicit list of what four weeks does **not** deliver |
| No checkpoints | A demoable artefact every Friday |
| One path | Branches on two decisions — tool interface vs sidebar, one LOS vs two |

**Why the change matters:** Jay isn't evaluating whether voice is a good idea —
Michael already decided that. He's evaluating whether you can be trusted to
deliver. A plan with checkpoints and honest exclusions reads as delivery
experience. A plan that promises everything reads as sales.

---

# PART 1 — The three decisions that gate everything

**These must be closed in week one, and two of them aren't engineering
decisions.**

## Decision 1 — Consent semantics ⚠️

**The question:** does Addy's consent record distinguish *AI calls specifically*
from *contact generally*?

**Why it gates everything:** the FCC's 2024 ruling means consent to "receive
calls" may not cover an AI call. If their records don't make the distinction,
phase one may only be able to dial a subset of contacts — or none.

**Who answers it:** their compliance side, not their engineering side.

**If the answer is bad:** the phase-one scope narrows to contacts with explicit
AI consent, and a consent-capture flow becomes part of the work.

## Decision 2 — Tool interface, or sidebar first?

Michael proposed the AskAddy tool interface. That's a different week three from
embedding a voice tab.

| | Tool interface | Sidebar tab |
|---|---|---|
| Who triggers a call | AskAddy's agent | A loan officer, by clicking |
| Work | Endpoint + result contract | UI + extension integration |
| Proves | Composability | The LO experience |
| Michael's framing | What he asked for | What the demo showed |

**Recommendation: tool interface.** It's what the CEO asked for, it's less work,
and the sidebar can consume the same endpoint later.

## Decision 3 — Encompass only, or MeridianLink too?

**Two LOS integrations does not fit in four weeks.** One does.

Say that plainly rather than discovering it in week three.

---

# PART 2 — Week 1: foundation, and a real call by Friday

## What happens

**Scope and design**
- Which conditions get called, which don't
- Call workflows — chase, escalation, voicemail branch
- Success metrics agreed: contact rate, doc-return rate, latency target

**Build**
- LiveKit pipeline standing up — STT, LLM, TTS
- Repo, CI, environments
- Turn detection and interruption tuning against their call profile
- Consent model and audit designed in from day one, not bolted on

**Close the three decisions above.**

## Friday checkpoint

> **A real outbound call, placed live, that you can listen to.**

Not a recording. Not a demo environment. An actual call to a real phone.

**Why this is the right week-one deliverable:** it converts the entire engagement
from a promise into a thing that exists. Everything after is improvement rather
than faith.

## What could go wrong

- Consent answer comes back badly → scope narrows, say so immediately
- Their checklist schema is more complex than expected → week 3 grows

---

# PART 3 — Week 2: deployed, and theirs to break

## What happens

- SIP trunk, outbound dialling, call recording
- Core tools — SMS upload link, warm transfer with spoken briefing
- Voicemail detection and branching
- Deploy to staging, then production
- Observability: per-call latency, transcripts, structured outcomes
- Load and failure testing — carrier drop, model timeout

## Friday checkpoint

> **A live URL. Their team places real calls and listens, without me in the
> room.**

**Why that framing matters:** "you can use it" is a much stronger checkpoint than
"I'll demo it." It means the thing survives contact with someone who isn't its
author.

## What could go wrong

- Carrier provisioning delays — **A2P 10DLC registration takes days, not hours**.
  Start it in week one even though it's needed in week two.
- ElevenLabs enterprise concurrency has a lead time. Same.

---

# PART 4 — Week 3: inside Addy

**This is the week that branches on Decision 2.**

## Path A — tool interface (recommended)

- `POST /tools/voice/call` with the request contract
- Objective → agent-config mapping
- Per-item result vocabulary
- Webhook delivery with HMAC signing, plus a polling fallback
- Idempotency keyed on their turn ID
- Tool registration in AskAddy

## Path B — sidebar

- Voice tab in the Chrome extension
- Auth against their tenancy model
- Loan context from the existing content script
- LO controls — approve before dial, or automatic

## Either path

- **Checklist condition → call brief**, automatically
- **Write-back** — condition status, transcript, recording, outcome
- Structured outcomes: promised / refused / wrong number / needs LO

## Friday checkpoint

> **A condition on a real loan file triggers a call, and the outcome lands back
> on the file.**

The loop closes. That's the demo that matters.

## What could go wrong

- Their auth model is more involved than expected
- The checklist schema needs mapping work nobody scoped

---

# PART 5 — Week 4: real loan officers

## What happens

- Pilot with 2–3 loan officers on live files
- **Tune prompts and voice from actual recordings** — not from imagination
- Latency optimisation pass, EOU delay first
- Retry cadence, calling hours, edge cases
- Review metrics against the week-one criteria
- Scope what comes next from what was learned

## Friday checkpoint

> **Data. Contact rate, document-return rate, measured latency on their traffic,
> and a list of everything that surprised us.**

## Why the pilot is week four and not later

Real borrowers behave differently from test calls. Every serious problem in voice
shows up in the first fifty real conversations, and none of them show up in
testing.

**The last-week framing:** *"Week four isn't a victory lap. It's the week we find
out what's actually wrong."*

---

# PART 6 — What four weeks does NOT buy

**Say this unprompted.** It's the single most credible thing in the section.

| Not delivered | Why | When |
|---|---|---|
| Load-tested 200 concurrent | Needs the GKE deployment first | Phase 2 |
| SOC 2 evidence | A process with an audit period | Their programme |
| Two LOS integrations | One fits, two doesn't | Phase 2 |
| Multi-region | Single region, single Postgres | Phase 4 |
| Async core | Only needed past ~200 concurrent | Phase 4 |
| Alerting and on-call maturity | Days of work, not scoped here | Should be Phase 2 |
| Spam-label mitigation | Number rotation, CNAM registration | Phase 2 |

**The line:** *"A four-week plan that claims everything is a four-week plan
nobody believes. Here's what it doesn't include."*

---

# PART 7 — What I need from Addy

Ordered by when it blocks something.

| Need | Blocks | When |
|---|---|---|
| **Consent policy answer** | Everything | Day 1 |
| Decision: tool interface or sidebar | Week 3 scope | Day 1 |
| Decision: one LOS or two | Week 3 scope | Day 1 |
| Sandbox LOS credentials | Week 1 build | Day 2 |
| Checklist output schema | Call brief mapping | Week 1 |
| Carrier + model accounts **in Addy's name** | Week 2 deploy | Week 1 |
| Extension repo access *(path B)* | Week 3 | Week 2 |
| 2–3 pilot loan officers | Week 4 | Week 3 |
| A technical point of contact | Continuous | Day 1 |

## On the accounts

**Every infrastructure account in Addy's name from day one.**

> *"I'm not building a dependency on me. If this doesn't work out, you own
> everything that got built and I hand over credentials that were always yours."*

That sentence does more for trust than the rest of the plan. It's the opposite of
what a contractor protecting their position would say.

---

# PART 8 — How the estimate could be wrong

Volunteering this is worth more than the estimate itself.

**Most likely to slip:**

1. **Their auth and tenancy model.** I've scoped from outside. If it's unusual,
   week 3 grows.
2. **Consent capture.** If their records don't distinguish AI calls, building
   that flow is real work nobody has scoped.
3. **Carrier provisioning.** A2P 10DLC registration has a lead time outside
   anyone's control.

**Least likely to slip:**

The voice pipeline itself. That's the part that already exists.

**The honest framing:** *"The risk in this plan isn't the voice work — that's
built. The risk is your integration surface, which I can only see properly once
I'm inside it."*

---

# PART 9 — Questions Jay will ask

**"Is four weeks realistic?"**
For one LOS, one objective, and a pilot — yes, because the voice layer already
exists. What I'm building is the integration and the brief mapping. If you want
two LOS integrations, it isn't four weeks and I'd rather say that now.

**"What happens in week one that I can verify?"**
A real call to a real phone, placed live, that you can listen to. Not a demo
environment. And three decisions closed — consent semantics, tool interface
versus sidebar, and one LOS or two.

**"What's the biggest risk?"**
Your integration surface, because I've scoped it from outside. The voice work is
the part that already exists. And separately, the consent question — if your
records don't distinguish AI calls specifically, phase one narrows and a
consent-capture flow becomes part of the work.

**"What if it isn't working by week four?"**
Then you've spent four weeks and you own everything built, because every account
is in your name from day one. And you'd know by the end of week one, not week
four — that's what the Friday checkpoints are for.

**"Who does the work?"**
Me. Which is a real risk and I'd rather name it: one person is a single point of
failure. What I'd do about it is write everything down as I go, so what you're
buying is a documented system rather than my availability.

**"Why should the pilot be week four and not week two?"**
Because a pilot with real borrowers on a system that isn't integrated teaches you
nothing you'd act on. Week four is when the loop is closed and the data means
something. And it isn't a victory lap — it's the week we find out what's actually
wrong.

---

# PART 10 — The five things to land

1. **Three decisions gate week one**, and two of them aren't engineering
   decisions. Consent, tool-vs-sidebar, one LOS or two.

2. **A real call by Friday of week one.** It converts the engagement from a
   promise into a thing that exists.

3. **Week two ships a URL their team uses without me in the room.** That's a
   stronger checkpoint than a demo.

4. **Say what four weeks doesn't buy.** Seven specific exclusions with reasons.

5. **Accounts in Addy's name from day one.** Not building a dependency on
   myself — and saying so is worth more than the rest of the plan.
