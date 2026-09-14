# System Architecture — explained from zero

*Written so you can follow every word without prior context, and defend every
claim if Jay pushes. Each section: what it is → why it works this way → what
the alternative would have cost.*

---

# PART 0 — The mental model

## What actually happens in one phone call

A borrower's phone rings. They say "hello." Roughly a second later a voice
answers, and it sounds like a person. That single second contains:

1. Audio arrives from the phone network
2. Something decides *"they've stopped talking"*
3. Speech is turned into text
4. Text goes to a language model, which writes a reply
5. The reply is turned back into audio
6. Audio goes back down the phone line

Steps 2–5 are where all the engineering lives. Step 2 alone — deciding when
someone has finished a sentence — is the hardest part, and we'll come back to it.

## The three things a voice system must do at once

This is the shape of the whole architecture:

| | What it means | Why it's hard |
|---|---|---|
| **Decide to call** | Which lead, when, is it legal, are we at capacity | Must never double-dial, must respect calling-hours law |
| **Hold the call** | Keep audio flowing, run the pipeline, don't stutter | Real-time. Nothing may block, ever |
| **Remember the call** | Transcript, outcome, recording, cost | Must survive a database being down |

**These three have completely different failure tolerances.** Deciding to call
can be late. Holding a call cannot be interrupted for even 100ms. Remembering
can be delayed but must never be lost.

That difference is why the system is split the way it is. Everything below
follows from it.

---

# PART 1 — Six services, not one program

## What "a service" means

A service is a separate running program in its own container. Six services means
six programs, started independently, that can crash independently.

The alternative — the "monolith" — is one program doing everything.

## What we run

| Service | Its job, in plain terms | If it dies |
|---|---|---|
| **api** | Answers web/app requests. Login, agent settings, "start a call", Twilio's incoming webhooks | No new calls start. Live calls keep going |
| **worker** | Holds live calls. This is where the voice pipeline runs | Those calls drop. Others unaffected |
| **scheduler** | "It's 2pm, this call was scheduled for 2pm — dial it" | Scheduled calls wait |
| **workflow-engine** | Runs multi-day sequences. "Call, wait 2 days, call again" | Sequences stall |
| **maintenance-worker** | Cleanup: replay failed saves, delete old recordings, send daily emails | Nothing user-facing breaks |
| **webhook-worker** | Delivers notifications to customer systems, with retries | Deliveries queue up |
| *tunnel* | Cloudflare pipe so Twilio can reach us from the internet | Inbound calls stop |

## Why split it — the real reason

**Because they must fail differently.**

If everything were one program, a stuck workflow engine would take inbound calls
down with it. A borrower calling in would get nothing, because an unrelated
background loop was wedged.

Concretely, from our own history: **the workflow engine wedged one Friday
evening and no cadence calls went out all weekend.** If inbound calls had lived
in that same process, every borrower calling in over that weekend would have hit
silence too.

Splitting means the blast radius of any single failure is one service.

## The second reason: they scale differently

- The API handles thousands of quick requests. Scale it by adding replicas.
- A worker holds *one call* for several minutes. Scale it by adding processes.
- The scheduler just needs to tick. One is enough.

If they were one program you'd have to scale all of it to scale any of it —
paying for idle API capacity to get more call capacity.

## Why not microservices-per-feature?

You could go further: a separate service per feature (billing, analytics,
agents…). We deliberately didn't.

**Why not:** every split adds a network hop, a failure mode, and a deployment.
These six exist because each has a genuinely different **failure tolerance** or
**scaling shape**. "Analytics" doesn't — it's just HTTP requests, so it's a
router inside the API.

**The rule:** split when failure or scaling differs. Not when the feature
differs.

## The restart policy — a bug wearing a config's clothes

Docker restarts crashed containers. Two settings:

- `restart: always` — restart it even after a human stopped it, including on
  machine reboot
- `restart: unless-stopped` — respect a human stopping it

We were on `always`. Someone stopped an old stack by hand. The VM rebooted.
**The old stack came back to life.**

And because three deployments historically shared one database, that zombie
stack legitimately picked up real work — and **dialed real leads with old code.
23 numbers dialed twice in one day.**

Two fixes:
1. `restart: unless-stopped` on anything that dials
2. A `DIALING_ENABLED` flag that anything placing calls checks first. Staging
   sets it false, so a resurrected staging stack refuses to dial

**Why two fixes for one bug:** the first stops the container coming back. The
second means that even if it does — different machine, bad config, human error —
it still can't dial. Defence in depth, because dialing a real person by accident
isn't recoverable.

---

# PART 2 — The control plane

## What "control plane" means

Borrowed from networking. The **control plane** decides what should happen. The
**data plane** carries the actual traffic. Here: control plane decides a call
should occur; worker plane holds the call.

Useful because it names the thing that matters — **the control plane is never in
the audio path.** A slow API request can't make a caller wait.

## The API

FastAPI, run by gunicorn with several copies. **25 routers** (a router = a group
of related endpoints): agents, auth, analytics, billing, phone, webhooks,
workflows, compliance, and so on.

### Middleware, and why the order matters

Middleware wraps every request, like layers of an onion:

1. **GZip** — compress responses over 1KB. Bandwidth.
2. **Observability** — assign a request ID, time it. First so it can see
   everything.
3. **Audit** — log every change: who, what, when, from where.
4. **TrustedHost** — reject requests with a forged Host header.
5. **CORS** — which websites may call this API.

**Audit skips** `/metrics`, `/health`, `/phone/inbound` and a few others — noise,
and unauthenticated infrastructure. Logging Twilio's webhook on every call would
bury the human actions you actually want to audit.

**Why audit at all:** lenders get examined. "Who changed this agent's script on
August 3rd" needs an answer that isn't "we don't know."

**Why CORS forbids wildcards in production:** `*` means any website can call your
API with a logged-in user's credentials. The config actively refuses a wildcard
in prod — it's not a convention, it's enforced.

## The scheduler, and the atomic claim ⭐

Its job: find calls due now, dial them.

**The hard part — the race condition.** Two scheduler copies both look at 2:00pm,
both see the same call, both dial. The borrower's phone rings twice. From the
same company. About the same loan.

### What "atomic claim" means

Instead of *"read it, then mark it as taken"* — two separate steps, with a gap
where both can read the same row — you do one indivisible database operation:

> "Change this row from `pending` to `claimed` **only if it's still `pending`**,
> and tell me whether you actually changed anything."

The database guarantees only one caller can win. The loser is told "no rows
changed" and moves on.

**Why this specific technique:** the alternative is a distributed lock (Redis
`SETNX`, Zookeeper, etc.) — another system to run, another thing that can be
down, and a lock that can be held by a dead process. The database is already
there and already gives you atomicity. Use what you have.

**The payoff:** *"Atomic claims mean even an accidental second replica is safe."*
Correctness doesn't depend on remembering to run exactly one.

### Why it exists at all

From the code: *"Scheduled outbound calls were previously accepted but NEVER
dialed — there was no runner."* The feature shipped with a UI and a database
table and nothing to execute it. Worth saying out loud — it's honest, and every
engineer has shipped that bug.

## The maintenance worker — where promises get kept

Three jobs, and all three are "a guarantee that wasn't actually enforced":

**1. Outbox replay.** When a call ends we save it. If the database blips, the
record goes into a `call_persist_outbox` table instead. *Something* has to come
back and replay those. Without this worker, they sat there forever — the
"durable persistence" guarantee leaked.

**2. Retention purge.** "We delete recordings after N days" is a GDPR promise.
Nothing was doing the deleting. This worker nulls transcripts and deletes the
audio objects.

**3. Daily report email** — per tenant, at *their* local midnight, not ours.

**The honest framing:** retention was documented policy that nothing enforced
until this process was deployed. Saying that is better than implying it always
worked.

---

# PART 3 — The worker plane, where calls live

## One process per call ⭐

```python
job_executor_type = JobExecutorType.PROCESS
num_idle_processes = <configured>
```

### Process vs thread — the thing to understand

- A **thread** shares memory with its siblings. Cheap. But one thread crashing
  hard — a segfault in a C library — takes the whole program with it.
- A **process** has its own memory. More expensive. But it can die alone.

We chose processes. **One phone call = one OS process.**

### Why

Voice pipelines run C extensions (audio codecs, ML runtimes) and long-lived
WebSocket connections to four different vendors. Any of them can wedge or
segfault.

With threads: one bad call kills every concurrent call on that worker.
With processes: one bad call dies alone.

**The cost:** processes are slower to start — hundreds of milliseconds.

**The fix:** `num_idle_processes` keeps a pool warm and waiting. A new call grabs
a ready process instead of starting one. You pay the startup cost once per
process, not once per call.

**Why not async tasks in one process?** That's the thread argument again, with
an extra edge: one task that blocks the event loop — a synchronous DB call, a
CPU-bound decode — freezes *every* call in that process. And you can't stop it
from outside. Processes give you a hard boundary the OS enforces.

## Prewarm — three latency tricks

`prewarm()` runs once per worker process, before it takes any call.

### 1. Load the VAD once

VAD = Voice Activity Detection. A small ML model that answers "is someone
speaking right now?" It powers interruption handling.

Loading it takes time. Load once per *process*, share across every call that
process handles — instead of loading per call.

### 2. Size the database thread pool

Python's async model is single-threaded: one thing at a time. A blocking
operation — like a database query — would freeze everything. So DB calls are
pushed onto a **thread pool** via `asyncio.to_thread`.

The default pool is small. With several concurrent calls, they queue behind each
other waiting for a thread. So we size it explicitly.

**A real wrinkle in the code:** Python 3.14 removed the implicit event loop, so
at prewarm time there may be no loop to attach an executor to. The code checks,
and skips quietly if there isn't one. The comment says it *"used to print a full
stack on every process init."*

Small, but it's the kind of thing you only fix if you actually read your own
worker logs.

### 3. Warm the OpenAI connection ⭐

This one is genuinely clever and worth telling.

The first HTTPS request to any provider pays:
- DNS lookup
- TCP handshake
- **TLS handshake** (the expensive part)
- Provider-side edge routing

Hundreds of milliseconds, once. And on a voice call, that lands on the **first
reply the caller hears** — the worst possible place.

So prewarm fires a throwaway 1-token completion on a background thread. All that
setup is paid before any real call. The comment: *"so the first real call after
an idle period doesn't pay the full cold-start on its first token."*

**Why background thread:** so it never delays the process being ready. Best
effort — if it fails, nothing breaks.

**How you'd discover this:** watch a first-call-after-idle be mysteriously slower
than every subsequent call, and go looking. You don't get this from docs.

## The room has three participants, not two ⭐

LiveKit organises calls as "rooms." Ours contain:

| Who | Identity looks like | What they are |
|---|---|---|
| Caller | `phone-+1714...` or `user-abc123` | The human |
| Agent | agent identity | Our pipeline |
| Egress | `EG_...` | Recording leg |

**Egress** is LiveKit's recorder. It joins as a participant and captures audio.

### The bug this caused

The code had a guard: *"if a participant leaves, end the call."* Sensible.

It was written as: *"if a participant whose identity starts with `user-` leaves,
end the call."*

`user-` is the **browser** prefix. Phone participants are `phone-+1714…`.

**The guard had never matched a single phone call since the day it was written.**
Calls sat "Active" forever. Egress recorded an empty room for five minutes after
everyone had gone.

**The fix:** any participant leaving ends the call — with two exclusions. Egress
is a *recorder*, not a party, so it leaving means nothing. And a warm transfer
deliberately *moves* the caller to a hold room and back, so they "leave"
briefly by design.

**The lesson:** a prefix match written for one transport silently excludes every
other transport, and can sit dormant from the day it was written.

---

# PART 4 — The pipeline

| Stage | What it does |
|---|---|
| VAD | "Is someone speaking?" — drives interruptions |
| STT | Speech → text |
| Turn detection | "Have they finished?" |
| LLM | Writes the reply |
| TTS | Text → speech |

## Providers behind factory functions

Rather than `ElevenLabs(...)` scattered through the code, there's one
`get_tts()` that reads config and returns whatever is configured.

**Why:** swapping a provider becomes a config change, not a code change.

**Why that matters commercially:** it's what makes *per-call-type model
selection* possible. A reminder call uses cheap fast TTS; a first contact with a
borrower uses the expressive one. That's a business decision expressed as
config, and it's only available because nothing is hardcoded.

## One turn decider at a time

Three ways to decide someone finished talking:

1. **VAD timer** — silence for N milliseconds
2. **EOU model** — a classifier on the text
3. **Flux EOT** — Deepgram's model decides from audio *and* meaning

Exactly one is active. **Never two.**

**Why:** two deciders disagree, and the disagreement is audible — the agent
either talks over people or sits there.

Soniox and the other STT engines do *not* decide turns. They only finalise text
faster. That constraint appears in three separate places in the code — which
tells you how often it got misread.

---

# PART 5 — The gate chain

Before any call is placed, seven checks in order:

```
0. DIALING_ENABLED      is this deployment allowed to dial at all?
1. workflow active      is the campaign switched on?
2. schedule window      is it within the configured window?
3. TCPA calling hours   is it legal to call right now?
4. account lines        is the tenant at their concurrency cap?
5. workflow max_lines   is this campaign at its own cap?
6. atomic claim         take it, exclusively
```

## Why this order — cheap to expensive

Gate 0 is reading a boolean from memory. Gate 6 writes to the database.

Ordering cheap→expensive means a call blocked for a cheap reason never pays for
the expensive checks. At scale — hundreds of enrollments per tick — that's the
difference between a tick taking milliseconds and taking seconds.

## Why "fail closed"

If a gate can't determine the answer, it **blocks**. Never "allow by default."

**Why:** the failure modes are wildly asymmetric. A call that doesn't happen is
a small loss. A call that happens outside legal hours is a **$500 TCPA
liability**. Always fail toward not calling.

## Deferred, not dropped

A blocked enrollment isn't consumed. It's **deferred to the next instant it
would pass.** A lead outside calling hours isn't lost — it's rescheduled to 8am.

**Why this matters:** the naive version drops blocked work and the lead is never
called. Ours moves it to the next legal moment.

## Both caps gate, and the lower wins

Two independent limits:
- **Account `allowed_lines`** — the tenant's plan
- **Workflow `max_lines`** — this campaign's own cap

Both apply. The lower wins. A workflow left at 1 defeats a raised account cap —
which was a real support issue and is now pinned by tests.

## Cross-replica concurrency, and the TTL ⭐

The concurrency cap is enforced in **Redis**, not in memory.

**Why:** with several API replicas, each would keep its own count. Three replicas
with a cap of 10 would allow 30. A shared counter in Redis is the only way to
get one number.

The lifecycle: API checks before issuing a token → worker increments at session
start → decrements exactly once when the call is persisted.

**The TTL is the interesting part.** Each key expires after **3600 seconds**.

**Why:** a worker that dies *between* increment and persist never decrements.
That slot would be held forever, and the tenant would slowly lose capacity until
someone noticed.

The TTL means it self-heals within an hour. It's scar tissue — you don't write
that unless a worker has died on you.

---

# PART 6 — The voice-path rule

## The rule

**No database write is ever awaited during a call turn.**

## Why

Python async is cooperative: code runs until it voluntarily yields. `await`ing a
database write means *"pause here until the database answers."*

If the database takes 800ms, **the caller hears 800ms of silence.** And database
latency is not something you control.

So every write is fire-and-forget: start it, don't wait, keep talking.

## `safe_task()` — and asyncio's trap ⭐

Fire-and-forget in Python is `asyncio.create_task(...)`. Two problems:

**Problem 1: exceptions vanish.** A bare `create_task` drops any exception on the
floor. The write fails and nobody ever knows.

**Problem 2 — the non-obvious one:** the event loop holds only a **weak
reference** to tasks. If nothing else references the task, Python's garbage
collector can collect it **mid-execution**. The write just… stops. Silently.
Halfway.

This is a documented asyncio pitfall and it's easy to hit.

`safe_task()` fixes both: wraps the coroutine so failures are logged and sent to
Sentry, **and keeps a strong reference** so the task can't be collected.

This single detail is probably the most credible thing in the whole architecture
section for an engineer, because it's a trap you only learn about by falling in.

## Durable persistence — the outbox pattern

At hang-up we save the call synchronously. If the database is down, the record
goes to a `call_persist_outbox` table, and the maintenance worker replays it.

**Why not just retry in place:** the call is over, the process is shutting down.
Retrying in a dying process means the record dies with it.

**Why a table and not a queue:** the database is already there, already durable,
already backed up. Adding RabbitMQ or SQS to guarantee durability *for database
writes* means introducing a second thing that can be down.

### The ordering detail

`record_call_usage` runs **inside** `_do_persist`, right after the call row
lands, upserting on `call_id`.

**Why:** because **106 calls had rows and durations yet no usage record, and
nothing ever logged a failure.** The metering code was being *skipped*, not
failing. Moving it inside the same persist path made it structurally impossible
to skip.

**The net property:** a database outage degrades reporting. It never drops a
call.

---

# PART 7 — What breaks, and how far it spreads

| Failure | Blast radius | Recovery |
|---|---|---|
| Worker process crashes | One call | Reconcile redials |
| Worker container dies | Its live calls | Orphans reconciled |
| Postgres slow | Reporting lags | Outbox replay |
| Postgres down | No new calls | Live calls continue |
| Redis down | Falls back in-process | Per-replica cap — degraded, not broken |
| Deepgram down | STT failover, logged loudly | soniox → nova-3 → OpenAI |
| Deepgram down, **Flux agent** | **Agent is deaf** | **No fallback — known gap** |
| ElevenLabs socket wedges | 3s pause | Same-voice standby |
| OpenAI 5xx mid-turn | Falls to mini model | |
| Workflow engine wedges | Cadences stall | Heartbeat → unhealthy in minutes |

## Why failover is loud

Every failover logs at warning level, by name:

```
STT FAILOVER: nova-3 went UNAVAILABLE — switching to
gpt-4o-mini-transcribe. Investigate Deepgram.
```

**Why:** silence is how the whisper-hallucination bug went unnoticed. The old
fallback was whisper-1, which **invents words during silence** — it would
hallucinate text into quiet stretches, corrupting the transcript and poisoning
the LLM's context.

It looked like it was working. **A fallback that appears to work is worse than
one that visibly fails.**

Note the inverse: *constructing* a standby is deliberately quiet, because it
happens on every call and used to look like the primary had failed.

## Why the TTS standby is the same voice

The chain is: primary → **a second connection to the same provider and voice** →
OpenAI as last resort.

**Why the odd middle link:** originally the only standby was OpenAI's default
voice. So a dropped WebSocket — which happens routinely — swapped the agent to a
**completely different voice mid-call.** Customers reported "the voice changes in
between."

Now the first fallback is a reconnect in the caller's own voice. OpenAI is only
for a genuine provider outage, where a different voice beats no voice.

---

# PART 8 — Multi-tenancy

Everything per-customer is a **row**, not a deployment:

- Agent config, prompt, variables, tools
- Voice, TTS model, STT engine, LLM model
- Phone numbers, business hours, timezone
- Retention policy, consent text
- Plan limits: minutes, concurrent lines
- Integration credentials, encrypted at rest

**Why not one deployment per customer:** operationally impossible. 50 customers
means 50 deployments to patch, monitor, and upgrade.

**Why this matters to Addy:** onboarding a lender is inserting rows. No deploy,
no engineering time, no downtime for anyone else.

---

# PART 9 — Where Addy plugs in

```
Addy checklist ──open condition──▶ call brief
                                        │
                                        ▼
                                  voice service
                                        │
                                  borrower call
                                        │
Addy loan file ◀──outcome · transcript · recording──┘
```

## The principle: Addy stays system of record

Voice **reads** a condition and **writes** an outcome. It never owns the loan
file, the borrower relationship, or any durable state Addy would miss if voice
were switched off tomorrow.

**Why this matters commercially:** the fear a founder has about a voice vendor is
that it becomes a second source of truth and starts competing with the platform
for control of the customer. This design makes that structurally impossible.
Turn it off, lose a feature. Never lose data.

**This is shipped, not theoretical.** The same coexistence model runs today
against a CRM: their system stays authoritative and keeps running its own flows;
voice writes outcomes back so the user never leaves their tool.

---

# PART 10 — Questions Jay will ask

**"Why one process per call instead of async tasks?"**
Isolation. Voice pipelines run C extensions and four vendor WebSockets; any can
wedge or segfault. With threads or tasks, one bad call kills every concurrent
call in that process. `num_idle_processes` keeps a warm pool so we pay startup
per process, not per call.

**"What happens if a worker dies mid-call?"**
That call drops. The enrollment is orphaned, reconcile picks it up, the lead is
redialed. The system loses nothing because the worker never held state. The
concurrency slot self-heals via the Redis TTL.

**"How do you prevent double-dialing?"**
Three independent layers. Atomic compare-and-set claims. A unique partial index
on `(workflow_id, phone)` for active enrollments. And E.164 normalization — we
had a race where `4155551212` and `+14155551212` became two enrollments on
interleaved cadences.

**"Why is the scheduler one replica?"**
Efficiency, not correctness. Atomic claims make a second replica safe. That was
designed in from the start.

**"What's your single point of failure?"**
Postgres. Live calls survive it — already in flight, and the outbox absorbs
writes — but no new call can start. Mitigation today is Supabase HA plus the
pooler. There's no multi-region story yet.

**"How does this scale?"**
Concurrency is the constraint, not throughput. Per-call costs are independent,
so latency is flat at call 10 or call 10,000. ~5–10 concurrent is proven today;
200 is designed-for with autoscaling and not yet load-tested. The load test is
specified: p95 < 1.2s, p99 < 2.0s at 2,000 concurrent.

**"What would you change if you started over?"**
Instrument perceived wall-clock from day one instead of per-stage metrics. Most
of our worst incidents shared one property: the thing that failed never emitted
a data point, so the stage histogram was only ever measuring survivors.

---

# PART 11 — Known gaps

State these before he finds them.

1. **Flux has no STT fallback.** Accepted for A/B measurement purity, never
   revisited. A Deepgram outage leaves a Flux agent deaf mid-call.
2. **Only TTS connect options are overridden.** STT and LLM sit at SDK defaults
   with no comment explaining why. A gap, not a decision.
3. **No multi-region.** Single region, single Postgres.
4. **No pager.** Metrics and heartbeats exist; nobody gets woken up.
5. **200 concurrent is validated-by-design.** The load test is specified and
   hasn't run.
6. **Three compose stacks historically shared one database.** Mitigated by the
   dialing gate, but the topology itself is a hazard.

---

# PART 12 — The four properties to close on

1. **State lives in Postgres.** A worker dying loses that call, not the system.
2. **Concurrency is cross-replica.** Redis with a TTL, so a crash can't leak a
   slot forever.
3. **Gates fail closed.** A resurrected stale stack refuses to dial rather than
   winning claims.
4. **Providers are swappable.** Behind factories, so a swap is config — which is
   exactly what makes per-call-type model selection possible.

---

# Appendix — jargon, decoded

| Term | Meaning |
|---|---|
| **Atomic** | One indivisible operation. Either fully happens or doesn't. No half-state |
| **Blast radius** | How much breaks when one thing breaks |
| **Control plane / data plane** | Deciding what happens vs carrying the traffic |
| **Cold start** | First-request cost: DNS, TCP, TLS, model load |
| **Egress** | LiveKit's recorder; joins the room as a participant |
| **EOU / EOT** | End of utterance / end of turn — "have they finished?" |
| **Fail closed** | When unsure, block. Opposite of fail open |
| **Fire-and-forget** | Start work, don't wait for it |
| **Idempotent** | Doing it twice has the same effect as once |
| **Outbox pattern** | Failed writes go to a table; something replays them later |
| **Prewarm** | Do expensive setup before the first real request |
| **Process vs thread** | Separate memory, dies alone vs shared memory, dies together |
| **Race condition** | Two things acting at once, result depends on timing |
| **SIP trunk** | The connection carrying phone calls between us and a carrier |
| **STT / TTS** | Speech→text / text→speech |
| **TTL** | Time to live. Auto-expiry |
| **VAD** | Voice activity detection — "is someone speaking?" |
| **Weak reference** | A pointer that doesn't stop garbage collection |
