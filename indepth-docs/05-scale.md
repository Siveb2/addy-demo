# Scale — explained from zero

*This was the weakest answer on call 1. Michael asked "are you doing millions of
calls" and got worker pods and pre-warming — no number, no ceiling, no failure
mode. This is the rebuild, and the rebuild is built on honesty rather than a
bigger number.*

---

# PART 0 — The framing that fixes this section

## Lead with the split, before he asks

> **"~5 to 10 concurrent calls are proven today. 200 is designed-for and not yet
> load-tested. 2,000 is the Phase 4 target with a written plan behind it. Let me
> show you which is which."**

Say that in the first thirty seconds.

**Why this wins rather than loses:** Jay's job is to find the gap between what
you claim and what's true. If you hand him that gap yourself, with the numbers
attached, there's nothing left to find — and everything you say afterwards
inherits the credibility.

If instead you say "we scale to 200" and he asks "have you load-tested that,"
you've lost the room in one question.

Our own documentation states it this way, and you should quote it:

> **Plan for ~5–10 reliable concurrent calls right now.** The 200-concurrent
> figure is a *design target*… **validated-by-design, not in-fact.**

## The three numbers

| Number | Status | What it rests on |
|---|---|---|
| **5–10 concurrent** | **Proven** | Running today on a single VM |
| **200 concurrent** | **Designed** | GKE + KEDA autoscaling, LiveKit Cloud, pooled Supabase, HA Redis — none executed |
| **2,000 concurrent** | **Planned** | Phase 4: async core, event backbone, multi-region |

---

# PART 1 — The thing most people get wrong about voice scale

## Concurrency is the constraint. Throughput isn't.

This is the single most useful idea in the section, and it's counterintuitive
until you see it.

**A web API scales on requests per second.** A thousand requests arrive, each
takes 50ms, one server handles them by interleaving.

**Voice doesn't work like that.** A call occupies a process for the *entire
duration* — three minutes, seven minutes, however long the human talks. You
cannot interleave a phone call.

So the question is never "how many calls per month." It's **"how many at the same
instant."**

| Question | Difficulty |
|---|---|
| 50,000 calls a month | Easy. That's ~2 concurrent at business-hours spread |
| 50 calls at 10:03am | Hard. That's 50 live processes, 50 sets of provider sockets |

**Say it plainly:** *"Fifty thousand a month is easy. Fifty at the same instant
is the engineering problem."*

## Which means latency is flat with volume

Call number 10 and call number 10,000 cost the same milliseconds, because
**nothing is batched or queued across calls.** Each has its own process, its own
provider connections, its own pipeline.

There's no shared queue to saturate, so there's no gradual degradation curve. You
either have capacity for a call or you don't.

**That's a genuinely good property and it's worth naming**, because most systems
degrade as they fill. This one doesn't degrade — it refuses. Which is the right
failure mode for a phone call.

---

# PART 2 — Where the capacity actually lives

## One process per call, warm pool in front

From the worker configuration:

```python
job_executor_type = JobExecutorType.PROCESS
num_idle_processes = 3        # per worker, configurable
initialize_process_timeout = 120.0
```

- **One OS process holds one call.** Isolation — a segfault or a wedged C
  extension takes one call, not the worker.
- **`num_idle_processes`** keeps warm processes waiting, so a new call grabs a
  ready one instead of paying startup.
- Capacity per worker is bounded by memory and CPU, not by a configured limit.

**Scaling out = more worker containers.** There's no coordination between them —
LiveKit dispatches a job to whichever worker has capacity.

## Pre-warming against the calling window

TCPA restricts outbound calling to roughly 8am–9pm in the *recipient's* local
time. So the load profile isn't flat — it has a hard edge at 8am in each
timezone.

Workers pre-warm ahead of that edge: the VAD model loaded, the DB thread pool
sized, and the OpenAI connection warmed with a throwaway token.

**Why it matters:** without pre-warming, the first call of the morning pays DNS,
TCP, TLS and model load — landing on the first reply a borrower hears. The worst
possible place for a cold start.

## Per-tenant caps, enforced across replicas

Plan tiers from the billing code:

| Plan | Monthly minutes | Max concurrent |
|---|---|---|
| free | limited | 2 |
| starter | 1,000 | 10 |
| pro | 5,000 | 50 |
| scale | 20,000 | 200 |
| enterprise | unlimited | unlimited |

Enforced in **Redis**, not in process memory:

- API `/token` checks `current(user_id)` and rejects at the cap
- The worker increments when a session starts
- Decrements exactly once when the call is persisted
- **3600s TTL** on each key so a crashed worker can't leak a slot forever

**Why Redis and not in-memory:** with several API replicas, each would keep its
own count. Three replicas at a cap of 10 would allow 30. A shared counter is the
only way to get one number.

**And both caps gate.** Account `allowed_lines` and per-workflow `max_lines` are
independent, and the lower wins — a workflow left at 1 defeats a raised account
cap. That was a real support issue and is now pinned by tests.

---

# PART 3 — What breaks first, in order

This is the answer to "what's your ceiling" and it's better than a number,
because it shows you know the *shape* of the failure.

| # | Limit | Why it binds first | What you do |
|---|---|---|---|
| **1** | **Carrier calls-per-second** | Twilio caps CPS per account. A burst of 50 simultaneous dials hits it before anything of ours strains | Queue and pace dials. More servers don't help |
| **2** | **Model provider rate limits** | Deepgram/OpenAI/ElevenLabs per-account quotas. 200 concurrent calls is 200 live STT streams | Dedicated quota, or fallback chains absorb it |
| **3** | **Worker pod scheduling** | Cold pods take ~2 min to be ready. A spike outruns autoscaling | Pre-warm to the predicted peak, not the current load |
| **4** | **Database connections** | Each worker holds a pool; 200 workers exhausts Postgres | A pooler — Supavisor or PgBouncer |
| **5** | **Compute** | Last. CPU and memory are the cheapest thing to add | Add nodes |

**The line to say:** *"Compute is the last thing that breaks, and it's the only
one you fix by spending money. Everything above it is a coordination problem."*

## The one most people never mention

**Spam labelling.** High call volume from one number gets flagged by carrier
analytics, and your calls start showing as "Scam Likely" on the recipient's
handset.

It doesn't show up in any metric you own. Your infrastructure is healthy, your
answer rate quietly collapses.

Mitigations: number rotation, branded caller ID / CNAM registration, and
per-number volume caps.

**Why raise it:** almost no voice vendor does, and it's an operational reality
that bites at exactly the volume Addy would be running.

---

# PART 4 — The known architectural ceiling ⭐

Be specific about *why* 200 is the current design limit rather than 2,000. This is
where the section earns real credibility.

From our own Phase 4 plan:

> The `to_thread`-wrapped sync Supabase path and fire-and-forget tasks **work to
> ~200 but won't scale to thousands** without a truly async data path and a
> durable event backbone.

## Unpacked

**The database client is synchronous.** Every DB call is pushed onto a thread via
`asyncio.to_thread`. That works — it's why the thread pool is explicitly sized in
prewarm. But threads are expensive, and at thousands of concurrent calls you run
out of them before you run out of anything else.

**`safe_task` is in-process.** Fire-and-forget background work — webhooks,
events, metering — runs inside the worker. At 200 that's fine. At 2,000, a worker
restart drops whatever was in flight, and there's no backpressure anywhere.

## What Phase 4 changes

| Stopgap today | Phase 4 |
|---|---|
| `to_thread` around a sync driver | `asyncpg` — genuinely async |
| Sized thread pool | Supavisor/PgBouncer pooler |
| In-process `safe_task` | Pub/Sub or Kafka event backbone |
| No backpressure | Idempotent consumers, dead-letter topics |

**Exit gate, written in advance:** sustain 1,000 concurrent in one region at
p95 < 1.2s, with no event loss and no DB connection exhaustion, and downstream
lag draining within SLO after a 3× burst.

**The point to make:** this isn't a vague "we'd scale it later." The bottleneck is
identified, the replacement is chosen, and the acceptance test is written. What's
missing is execution, not understanding.

---

# PART 5 — The load test that hasn't run

## What's specified

From the Phase 4 exit gates:

- **p95 turn latency < 1.2s and p99 < 2.0s at 2,000 concurrent**
- A documented cost-per-minute at that load
- **Kill any one provider and any one carrier under a 500-concurrent load test →
  zero dropped calls**, automatic failover, p95 within budget
- A single abusive tenant at 10× normal load does not degrade others' p95

## Why it hasn't run

Honestly: it requires the deployment it's testing. GKE with KEDA autoscaling,
LiveKit Cloud, a pooled Supabase, HA Redis, and raised vendor ceilings. None of
that is stood up.

**Say it that way.** "We haven't load-tested because we haven't built the thing
the load test targets" is a schedule fact. "We haven't load-tested" alone sounds
like negligence.

## What you'd need from Addy to run it properly

- **Expected peak concurrency** — not monthly volume, the 10am number
- **Call-mix assumptions** — average duration, inbound/outbound split
- **Timezone spread** — a lender across four timezones has four 8am edges,
  which is a much flatter curve than one lender in California

With those three, the load test targets real numbers instead of guesses, and the
cost model becomes real too.

---

# PART 6 — What scaling costs

Variable cost dominates. Fixed infrastructure is noise at any interesting volume.

| Volume | Variable (~$0.14/min) | Fixed | **Total/mo** |
|---|---|---|---|
| 2,000 min | ~$280 | ~$60 | **~$340** |
| 5,000 min | ~$700 | ~$100 | **~$800** |
| 30,000 min | ~$4,200 | ~$300 | **~$4,500** |

**The shape matters more than the numbers:** at 30,000 minutes, infrastructure is
**7% of the bill.** Provider cost is everything.

Which means the scaling lever isn't servers — it's the per-minute stack. Cheaper
TTS and a mini LLM for simple turns takes ~$0.14 toward ~$0.05–0.08.

**And that's only available because providers sit behind factory functions.** On
a bundled platform the per-minute cost is someone else's decision.

---

# PART 7 — Questions Jay will ask

**"How many concurrent calls can you handle?"**
Five to ten proven today on a single VM. Two hundred is the design target with
GKE and KEDA autoscaling — that's validated by design, not in fact, because the
load test needs the deployment it's testing. Two thousand is Phase 4 and it needs
an async data path, which I can walk you through.

**"So you haven't load-tested?"**
No. And the reason is that the load test targets a deployment that isn't stood
up yet — GKE, LiveKit Cloud, a pooled Supabase. The test itself is specified:
p95 under 1.2 seconds and p99 under 2 at 2,000 concurrent, plus killing a
provider and a carrier under 500 concurrent with zero dropped calls.

**"What breaks first?"**
Carrier calls-per-second, then model provider rate limits, then pod scheduling
latency, then database connections. Compute is last — it's the only one you fix
by spending money. Everything above it is a coordination problem.

**"Why does 200 work but 2,000 not?"**
The Supabase client is synchronous, so every database call goes through a thread.
That works to a few hundred and then you run out of threads. And fire-and-forget
background work runs in-process, so there's no backpressure and a worker restart
drops in-flight work. Phase 4 replaces both — asyncpg with a pooler, and a real
event backbone.

**"Does latency degrade under load?"**
It shouldn't, and that's a property rather than a hope. Every per-call cost is
independent — no batching, no shared queue. So the system doesn't degrade as it
fills, it refuses. Which for a phone call is the right failure mode. But I'd want
to prove that under a real load test rather than assert it.

**"What happens when you hit the cap?"**
The API rejects at `/token` with lines-busy before any resource is committed. The
call is deferred, not dropped — for a cadence it's rescheduled to the next allowed
instant.

**"How does this handle our volume?"**
Give me your peak concurrency rather than your monthly volume, plus average call
duration and timezone spread, and I'll build the real capacity and cost model. A
lender across four timezones has a much flatter curve than one in California, and
that changes the answer materially.

---

# PART 8 — The five things to land

1. **Lead with the split.** 5–10 proven, 200 designed, 2,000 planned. Saying
   which is which before he asks is the whole section.

2. **Concurrency is the constraint, not throughput.** 50,000 a month is easy.
   50 at the same instant is the engineering problem.

3. **Latency is flat with volume.** Nothing is batched or queued across calls, so
   the system refuses rather than degrades.

4. **Name what breaks first, in order.** Carrier CPS → model rate limits → pod
   scheduling → DB connections → compute. Compute is last.

5. **The ceiling is identified, not vague.** Sync database driver and in-process
   background work. Replacement chosen, exit gate written. What's missing is
   execution, not understanding.

---

# PART 9 — What's genuinely missing

State these before he finds them.

1. **No load test has been run.** 200 is validated by design only.
2. **No production deployment at scale.** Single VM today.
3. **No SLO or error budget.** We measure; we don't yet commit to a target.
4. **No multi-region.** Single region, single Postgres.
5. **Spam-label mitigation is understood, not implemented.** No number rotation
   or CNAM registration in place.
6. **The async core is planned, not started.** Phase 4 Stage 2 is the ceiling
   remover and it's a document, not code.

---

# Appendix — jargon, decoded

| Term | Meaning |
|---|---|
| **Backpressure** | Slowing producers when consumers fall behind, instead of dropping work |
| **Concurrency vs throughput** | How many at once vs how many per unit time |
| **CPS** | Calls per second — a carrier's rate limit |
| **Dead-letter topic** | Where messages go after repeated delivery failure |
| **Exit gate** | A measurable condition that must pass before a phase is done |
| **KEDA** | Kubernetes autoscaler that scales on custom metrics, e.g. queue depth |
| **p95 / p99** | 95th / 99th percentile. 1 in 20 and 1 in 100 calls are worse |
| **Pooler** | Sits between app and database, multiplexing many clients onto few connections |
| **Pre-warm** | Expensive setup done before the first real request |
| **Spam labelling** | Carriers marking your number "Scam Likely" based on call patterns |
| **TCPA calling window** | Roughly 8am–9pm in the *recipient's* local time |
