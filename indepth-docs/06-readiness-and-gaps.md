# Production Readiness & Known Gaps — explained from zero

*Michael asked what it would take to get this production-ready for Addy. This is
that answer, and it's built in two halves: what exists, then what's wrong with
it. The second half is the more valuable one.*

---

# PART 0 — Why you present the gaps yourself

## The dynamic you're managing

Jay's job in this meeting is to find the holes. That's what a Head of
Engineering does in a technical evaluation, and he'll be good at it.

You have two options:

**Option A — present strengths, let him find gaps.** Every gap he finds is a
point against you, and worse, each one makes him wonder what else you didn't
mention. The meeting becomes adversarial by default.

**Option B — present readiness, then hand him the gap list.** Now he's not
hunting. He's reviewing your assessment of your own system, which is a
fundamentally different activity. And anything he finds that's *on your list*
confirms your judgment rather than undermining it.

**Option B is strictly better**, and the only cost is being willing to say
uncomfortable things out loud.

## The one rule

**Every gap gets a status, not an apology.**

- ✅ *"No pager. Metrics and heartbeats exist; nobody gets woken up. It's on the
  list."*
- ❌ *"Unfortunately we haven't quite got round to alerting yet, sorry."*

Same fact. The first sounds like someone running a system. The second sounds
like someone who got caught.

---

# PART 1 — What "production ready" actually means

It isn't one thing, and being precise about the categories is half the answer.

| Category | The question |
|---|---|
| **Functional** | Does it do the job? |
| **Reliable** | Does it keep doing it when things break? |
| **Observable** | Would you know if it stopped? |
| **Operable** | Can someone other than the author run it? |
| **Compliant** | Will it survive an examination? |
| **Scalable** | Does it hold at the volume you need? |

**Our honest scoring:**

| Category | Status |
|---|---|
| Functional | **Strong** — shipped and running |
| Reliable | **Strong** — fallbacks, gates, durable persistence |
| Observable | **Good, with a hole** — we can reconstruct; nobody gets paged |
| Operable | **Weak** — deploy is manual, runbooks are thin |
| Compliant | **Good foundations** — consent, audit, retention, RBAC |
| Scalable | **Designed, not proven** — see §5 |

**Say the weak one out loud first.** "Operable is our weakest category" is a
sentence that buys you the rest.

---

# PART 2 — What exists and is proven

These are running today, in production, with real calls.

## Voice
- Inbound and outbound telephony over SIP, two carriers wired
- Warm transfer with a **spoken briefing** to the human before connection
- Voicemail detection with branching behaviour
- Mid-call tools — SMS, email, booking, knowledge search
- Interruption handling and turn detection across three engines
- Per-agent voice, model, and prompt configuration

## Platform
- Multi-tenant: everything per-customer is a row, not a deployment
- Auth, RBAC, API keys
- Per-tenant quota and concurrency caps, enforced cross-replica
- Webhooks with HMAC signing and durable retry
- Custom no-code tool builder
- CRM write-back integration

## Reliability
- Five fallback chains across STT, TTS and LLM
- Timeouts chosen from measured distributions, not inherited
- Durable persistence with an outbox and replay
- The seven-gate dial chain, failing closed
- Heartbeat liveness on every background loop

## Compliance
- Recording-consent preamble, configurable per tenant
- Audit log on every mutating request
- Retention purge — transcripts nulled, recordings deleted
- DSAR export and erasure
- Role-based access control

## Testing
- **93 backend test files**, 19 frontend
- Regression tests replaying actual production transcripts
- A test that parses the frontend config file to prevent a specific
  silent-revert bug

**On the test count:** don't say "93 tests" as though it's a quality score. Say
what they *cover* — *"regression tests that replay the actual production
transcripts from the voicemail-detection incident"* is worth more than any
number.

---

# PART 3 — What's built but under-tested

The honest middle category. It exists, it should work, nobody has proven it.

| Thing | Status |
|---|---|
| Autoscaling (KEDA) | Configured, never scaled under real load |
| 200-concurrent design | Validated by design, not in fact |
| Carrier failover | Works in isolation; untested under load |
| Multi-provider STT routing | Works; the Soniox path has little production time |
| Retention purge at volume | Correct; never run against a large dataset |

**Why name this category at all:** most people have only two buckets — done and
not done. Having a third that says *"built, plausible, unproven"* is a sign of
someone who distinguishes between code existing and code working.

---

# PART 4 — What's missing specifically for Addy

This is the part Michael asked for. It's short, and short is the point.

| Needed | Size |
|---|---|
| **Encompass connector** | Weeks — depends on their integration surface |
| **MeridianLink connector** | Weeks — doubles week 3 if both are in scope |
| **Checklist → call brief mapping** | Days once we see the schema |
| **The AskAddy tool interface** | Days — thin layer over existing gates |
| **Extension integration** | Days — one tab, their design system |
| **Auth against Addy's tenancy model** | Days — depends on their model |
| **Objective → agent-config mapping** | Configuration, not code |

**The framing:** *"Nothing on this list is hard. Most of it is days. What's
genuinely unknown is your integration surface — and that's a question I can only
answer after seeing it."*

---

# PART 5 — What four weeks buys, and what it doesn't

Be explicit about both. Overpromising here is the fastest way to lose a
technical evaluator.

## Buys

- A working outbound call path on real loan files
- Deployed where their team can use it
- Integrated into their sidebar, writing back to the file
- The tool interface, if that's the priority
- A pilot with two or three loan officers
- Tuned from real call recordings

## Does **not** buy

- A load-tested 200-concurrent deployment
- SOC 2 evidence — that's a process, not a sprint
- Two LOS integrations (one, realistically)
- Multi-region
- An async core — that's Phase 4
- Alerting and on-call maturity

**Say the second list unprompted.** A four-week plan that claims everything is a
four-week plan nobody believes.

---

# PART 6 — The complete gap list

Present this immediately after readiness. Grouped by category so it reads as an
assessment rather than a confession.

## Reliability

**1. Flux has no STT fallback.**
Accepted for A/B measurement purity — a mid-call engine swap would contaminate
every latency sample after it. Specified in advance, pinned by a test. But never
revisited after the A/B finished. A Deepgram outage leaves a Flux agent deaf
mid-call.
*Fix: wrap it now that measurement is done. Hours.*

**2. Only TTS connect options are overridden.**
STT and LLM connect options sit at SDK defaults with no comment explaining why.
Given the 11.7-second incident came from exactly this class of default, that's a
gap rather than a decision.
*Fix: audit and set them from measured distributions. Hours.*

**3. ~12 timeouts have no recorded rationale.**
`retry_async(retries=3, base_delay=0.2)`, a circuit breaker at
`failure_threshold=5, reset_timeout=30.0`, and a dozen scattered values. Those
are defaults someone typed, not decisions someone made.
*Fix: review each, document or change. A day.*

## Observability

**4. No alerting wired to a pager.**
This is the biggest one. We can reconstruct any incident after the fact. Nobody
gets woken up during one.
*Fix: alertmanager rules on the existing metrics. Days.*

**5. No SLO or error budget.**
We measure; we don't commit to a target. Which means no shared definition of
"too slow" or "too many failures."
*Fix: needs Addy's input on what matters to them.*

**6. Speculation waste is never counted.**
Discarded LLM generations are priced identically to used ones. No metric, no
parsed log line. The code comment says *"inventing the field would be worse than
omitting it"* — which is the right call, but it leaves a number we can't quote.

**7. False-interruption reduction was never quantified.**
The mechanism is confirmed — Flux demonstrably waits on unfinished speech. A
hard count needs a labelled transcript pass that hasn't been done.

## Configuration

**8. The 0.5 EOT threshold isn't in the codebase.**
It lives as a per-agent JSONB value on the staging agent. The default still
reads 0.0, meaning the plugin's 0.7 — the value that was measurably a
regression. Also the clamp floor is 0.3, below Deepgram's documented 0.5
minimum, and nothing explains why.
*Fix: commit the value, document the clamp. An hour.*

**9. The legacy agent editor still ships pre-loosening turn-taking values.**
And sends them on every save — the exact failure class the parity test was
written to prevent. The test only covers the new editor.
*Fix: extend the parity test or retire the legacy editor. Hours.*

**10. `gpt-5.5` and three others are missing from the reasoning-none list.**
All four are selectable in the frontend, and all would receive `"minimal"` — the
exact setting that produced the 6.26-second spike.
*Fix: one line. Minutes.*

**11. No gpt-5.x rows in the cost model.**
The recommended voice model falls through to the gpt-4.1-mini rate and is
under-costed on output by roughly 2.8×.
*Fix: add the rows. Minutes.*

## Scale & operations

**12. No load test has been run.** See §5.

**13. No multi-region.** Single region, single Postgres.

**14. Three compose stacks historically shared one database.**
Mitigated by the dialing gate, but the topology itself is a hazard that should
be separated properly.

**15. Deploy is manual.** No CI/CD to production. Runbooks are thin.

**16. Spam-label mitigation is understood, not implemented.**
No number rotation, no CNAM registration.

---

# PART 7 — Ranked by what you'd actually fix first

Handing over a flat list is good. Handing over a *prioritised* list is better —
it shows judgment, not just inventory.

| Priority | Gap | Why first | Effort |
|---|---|---|---|
| **1** | Alerting to a pager | The only one where a failure runs unattended | Days |
| **2** | Flux STT fallback | A live single point of failure for those agents | Hours |
| **3** | Commit the 0.5 threshold | The shipped default is a known regression | Hours |
| **4** | gpt-5.x reasoning + cost rows | Two one-line fixes with real consequences | Minutes |
| **5** | STT/LLM connect options | Same class as the worst incident we've had | Hours |
| **6** | Legacy editor parity | A known silent-revert path | Hours |
| **7** | Load test | Needs the deployment first | Weeks |
| **8** | Async core | Phase 4, only needed past ~200 | Months |

**The line:** *"If you gave me a week before anything else, I'd do one through
six. That's most of the list, and none of it is hard — it's just work that
hasn't been prioritised over shipping features."*

---

# PART 8 — Questions Jay will ask

**"What would it take to be production-ready for us?"**
Depends what you mean by ready. Functionally it's there — it makes real calls
today on real files. What's missing for Addy specifically is the connectors, the
checklist mapping, and auth against your tenancy model, which is days once I see
your surface. What's missing generally is alerting, a load test, and the async
core for past 200 concurrent.

**"What's your weakest area?"**
Operability. The deploy is manual, the runbooks are thin, and nobody gets paged.
The code is in better shape than the operations around it — which is what
happens when one person builds something that works.

**"Why haven't you fixed the gaps you know about?"**
Most of them are hours of work that lost to shipping features. The honest answer
is prioritisation, not difficulty. The Flux fallback is an exception — that one
was a deliberate trade for measurement purity and then nobody went back.

**"How do I know this list is complete?"**
You don't, and I wouldn't claim it is. What I can tell you is how it was built —
I went through the codebase looking for dated comments, TODOs, and places where
a decision was recorded as temporary. If you find something not on here, I'd
genuinely want to know.

**"What's the risk of starting before the gaps are closed?"**
For a pilot with two or three loan officers, low — we're nowhere near the scale
limits, and the reliability layer is the part that's strongest. The real risk is
operational: if something breaks at 2am during the pilot, nobody gets woken up.
That's fixable in days and I'd do it first.

**"How many tests do you have?"**
93 backend files, 19 frontend. But the count isn't the interesting part — the
interesting ones replay actual production transcripts from incidents, and one
parses the frontend config file to prevent a specific silent-revert bug we hit.

---

# PART 9 — The five things to land

1. **Readiness isn't one thing.** Functional, reliable, observable, operable,
   compliant, scalable — and they score differently.

2. **Name the weakest category first.** "Operability is our weakest area" buys
   credibility for everything else.

3. **Three buckets, not two.** Done / built-but-unproven / not done. The middle
   one is where honesty lives.

4. **Say what four weeks doesn't buy.** A plan that claims everything is a plan
   nobody believes.

5. **A prioritised gap list beats a complete one.** It shows judgment rather
   than inventory.
