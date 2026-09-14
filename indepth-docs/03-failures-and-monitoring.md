# Failures & Monitoring — explained from zero

*These two belong together: monitoring is how you find out a failure happened,
and most of our monitoring exists because a failure hid. Each part:
what it is → why it works this way → what it cost us to learn.*

---

# PART 0 — The organising idea

## Two questions, one answer

Every failure story below is an answer to one of two questions:

1. **What happens when a thing we don't control breaks?** (Deepgram, ElevenLabs,
   OpenAI, Twilio, Postgres)
2. **How would we know?**

The second is harder, and it's where the real lessons are. Our worst incidents
weren't outages — they were failures that **looked like normal operation.**

## The three ways a failure hides

This is the spine of the whole section:

| How it hides | Example | What we changed |
|---|---|---|
| **It never emits a data point** | 11.7s dead air, every stage green | Measure wall clock directly |
| **It looks like a legitimate outcome** | 6 days of failed transfers reading as "no answer" | Distinct return values |
| **Nothing is watching** | Engine wedged, no calls all weekend | Heartbeat + healthcheck |

Once you see those three categories, everything else on this page is an instance
of one of them.

---

# PART 1 — What a fallback chain actually is

## The basic idea

Every provider we depend on will fail. Not "might" — will, on some call, at some
point. So each has a **chain**: if the primary fails, try the next thing.

```
primary → standby → last resort
```

The interesting engineering is not *having* a chain. It's **what you put in it**
and **whether you can tell it fired.**

## Our five chains

| Layer | Chain |
|---|---|
| **STT** (default) | nova-3 → gpt-4o-mini-transcribe |
| **STT** (extra engine) | soniox → nova-3 → gpt-4o-mini-transcribe |
| **STT** (Flux) | **none** — deliberate, covered in Part 8 |
| **TTS** | primary → *same provider, same voice* → OpenAI alloy |
| **LLM** | primary → gpt-4o-mini |

Two of those rows have a story behind them.

## Why the STT fallback model changed ⭐

The fallback used to be OpenAI's `whisper-1`. It's now
`gpt-4o-mini-transcribe`. From the code:

> Replaces whisper-1, which **HALLUCINATES text on silence** (it would invent
> words during quiet stretches, corrupting the transcript + LLM context).

Think about what that means in practice. The caller goes quiet for two seconds.
Whisper, given silence, *invents words.* Those invented words enter the
transcript. The transcript is the LLM's context. **So the model now believes the
caller said something they never said, and replies to it.**

And nothing errors. Nothing logs. The transcript looks plausible.

**The lesson: a fallback that appears to work is worse than one that visibly
fails.** A hard failure gets fixed. A quiet corruption ships.

## Why the TTS chain has an odd middle link ⭐

Look at the chain again:

```
ElevenLabs → a SECOND ElevenLabs connection, same voice → OpenAI alloy
```

Why connect to the same provider twice? From the code, dated 11 Aug 2026:

> The first standby is a SECOND instance of the SAME provider+voice, so a dropped
> ElevenLabs websocket (the 1006s) triggers a RECONNECT in the caller's own voice
> — previously the only standby was OpenAI "alloy", so any mid-call WS blip
> **swapped the agent to a completely different default voice for the rest of the
> call ("the voice changes in between")**. OpenAI stays as the last resort for
> real provider outages.

A dropped WebSocket is routine — it happens on healthy networks. The old chain
treated a routine blip as a catastrophic outage and switched voices mid-sentence.

The customer report was literally *"the voice changes in between."*

**The general principle: your first fallback should be the smallest possible
step away from normal.** Reconnecting to the same provider is nearly invisible.
Switching vendors is very visible. Only escalate that far when you have to.

---

# PART 2 — Loud failover, quiet construction

## The rule

```python
def _on_stt_availability(ev):
    # Fires when the adapter marks an STT available/unavailable — i.e. the
    # ACTUAL failover moment. Loud by design: a silent STT swap is how the
    # whisper-hallucination corruption went unnoticed.
```

The log line itself:

```
STT FAILOVER: DeepgramSTT went UNAVAILABLE — switching to fallback
(gpt-4o-mini-transcribe). Investigate Deepgram.
```

Note it names the action required. Not "an error occurred" — *investigate
Deepgram.*

## The counterpart: construction is deliberately quiet

From the fallback's own docstring:

> **Construction is quiet** — building the standby doesn't mean it's in use; the
> LOUD log fires only when the FallbackAdapter actually fails over.

This matters more than it sounds. An earlier version logged when the *standby was
built*, which happens on **every single call**. So the logs were full of "using
fallback LLM" messages on perfectly healthy calls, and it looked like the primary
was constantly failing.

**A log that fires on every healthy call teaches people to ignore it.** By the
time it means something, nobody reads it.

**Two rules, and they're opposites on purpose:**
- The moment something goes wrong → as loud as possible
- Routine setup → silent

---

# PART 3 — Timeouts chosen, not inherited

## Why default timeouts are usually wrong

Every SDK ships defaults. Those defaults are tuned for **batch work**, where
waiting 30 seconds and retrying three times is sensible.

**On a voice call, waiting 30 seconds means the caller has hung up.**

So every timeout in the voice path is set deliberately, and the reasoning is in
the code next to it.

## The flagship: the TTS connect budget

```python
tts_conn_options = APIConnectOptions(max_retry=1, retry_interval=0.5, timeout=3.0)
```

SDK default was `timeout=10s, max_retry=3`. That's **up to 30 seconds** before
the fallback is allowed to try.

The reasoning, from the code:

> Healthy TTFB is ~100-500ms, so **3s is a generous ceiling**; one retry, then
> fail over fast.

Look at how that's argued. Not "3 seconds feels right" — *we know healthy is
100–500ms, so 3 seconds is six times the worst healthy case. Anything past that
is broken, not slow.*

**That's the method: set the timeout from the measured healthy distribution, not
from intuition.**

## The full list

| Value | Where | The reason, from the code |
|---|---|---|
| TTS connect 3s, 1 retry | voice path | Healthy TTFB is 100–500ms; 3s is generous |
| LLM 30s, 1 retry | LLM provider | *"bound a hung request; a voice turn is seconds, not minutes"* |
| Greeting playout 30s | worker | A TTS stream that connects but never yields *"hung the await forever"* |
| AMD (machine detect) 1.5s | config | Bounded so a slow call only delays the first two turns |
| Screening quiet exit 2.5s | worker | *"8s of dead air reads as a spam call and people hang up into it"* |
| Screening peek 8.0s | settings | Raised from 4s: *"Apple's prompt is ~6-7s of audio, so the 4s peek expired mid-prompt"* |
| Custom tool 5s | config | *"a slow webhook can't stall the live turn"* |
| DB query 15s | config | *"Without it the client has NO timeout and one slow query can hang a thread forever"* |

**The honest note:** many other timeouts in the codebase have no recorded
rationale — `retry_async(retries=3, base_delay=0.2)`, a circuit breaker at
`failure_threshold=5, reset_timeout=30.0`, and roughly a dozen scattered
`timeout=` values. Those are defaults someone typed, not decisions someone made.
Saying so is better than pretending the whole codebase was reasoned.

**Known gap:** only `tts_conn_options` is overridden at session level. STT and
LLM connect options sit at SDK defaults with no comment explaining why.

---

# PART 4 — A database failure can never break a call

## The rule, and why it's absolute

Python's async model is cooperative — `await` means *pause here until this
finishes.* Awaiting a database write during a call turn means the caller hears
silence for however long the database takes.

**And database latency is not something you control.**

So every write during a call is fire-and-forget.

## `safe_task()` — two problems, one of them invisible ⭐

Fire-and-forget in Python is `asyncio.create_task(...)`. It has two traps.

**Trap 1 — exceptions vanish.** From the module docstring:

> A bare create_task drops any exception on the floor.

The write fails. Nothing raises. Nobody knows.

**Trap 2 — the task itself can vanish.** This one is genuinely non-obvious:

> The module also keeps a **STRONG reference** to every pending task: the event
> loop holds only weak refs to tasks, so a fire-and-forget task whose only
> reference was the discarded return value could be **garbage-collected
> mid-flight** — asyncio's documented pitfall.

Read that again. You start a database write. You don't keep the task object,
because you don't need it. Python's garbage collector sees an object nobody
references and collects it — **while it's running.** The write stops halfway.
Silently.

This is documented in Python's own asyncio docs as a pitfall, and it is extremely
easy to hit.

`safe_task` fixes both: wraps the coroutine so failures log and go to Sentry,
and holds the task in a module-level set so it can't be collected.

**The bonus:** that same registry doubles as a teardown drain. `wait_pending()`
lets the worker finish in-flight background work before shutting down, instead of
killing writes mid-flight on every deploy.

## The outbox pattern

At hang-up we save the call synchronously — this one *should* block, because the
call is over and there's no caller to keep waiting.

If it fails:

```python
except Exception:
    logger.exception("Synchronous call persist failed — enqueueing to outbox")
    await asyncio.to_thread(db.enqueue_call_persist, room_name, payload)
```

The record goes to a `call_persist_outbox` table. The maintenance worker replays
it later.

**Why a table and not a message queue:** adding SQS or RabbitMQ to guarantee
durability *for database writes* means introducing a second thing that can be
down. The database is already there, already durable, already backed up.

**Why not just retry in place:** the call has ended and the process is shutting
down. Retrying in a dying process means the record dies with it.

## The 106 calls that were never metered ⭐

A related bug, and a good one.

**106 calls had rows and durations, yet no usage record — and nothing ever
logged a failure.** Billing was quietly under-counting.

The code wasn't *failing*. It was being **skipped** — an early-teardown path
returned before metering ran.

**The fix is structural, not defensive.** `record_call_usage` was moved *inside*
`_do_persist`, right after the call row lands, upserting on `call_id`. Now
metering happens on the same path as persistence — it's not possible to save a
call without metering it, because they're the same operation.

**The lesson: "no error in the logs" and "the code ran" are different claims.**

---

# PART 5 — Failures that look like success

This is the second of our three hiding categories, and it's the one that runs
longest before anyone notices.

## Six days, 6 of 6 transfers failed ⭐

**17–22 August 2026.** Every warm transfer failed. Every tenant. Inside business
hours. Including accounts with no business-hours restriction.

**Call Now worked perfectly the whole time.**

Every failure came back as: `TRANSFER FAILED — did not pick up.`

Which is a completely normal thing for a transfer to say. Sometimes people don't
answer.

### The cause

The transfer dial used a **platform** caller ID whose trunk resolution fell
through to a stale global trunk — still pointing at a dead Twilio trunk after a
carrier migration.

The carrier rejected the dial **instantly**. And `dial_into_room` returns `None`
for a carrier rejection — which is **byte-identical** to "rang, nobody home."

> Same stale-global-trunk disease as the 17 Aug workflow-dial failure, third call
> site.

Third occurrence of the same root cause, at a third call site.

### What it cost

From that week's analysis: *"~78% of dials never reached a human. Of the calls
that did, **zero transfers and zero appointments** came from real leads."*

The best inbound lead of the week — a live caller asking to be connected — was
lost to it.

### The fix

Resolve the **tenant's own** number once at call setup: outbound uses the number
that dialed the lead, inbound uses the number the caller dialed, web uses the
tenant's first active number. Only then fall back to the platform default.

Twelve tests now cover it.

**The lesson: when a failure mode is indistinguishable from an expected outcome,
it can run at 100% for a week without a single alarm.** Carrier rejection and
no-answer must be different return values.

## Half of "completed conversation" was a recording

Clients saw "Completed conversation" for calls where the agent had been talking
to an answering machine.

Voicemail detection matched a fixed list of phrases. But STT clips machine
greetings, and carriers use wording the list had never seen — *"Forwarded to an
automated voice messaging system"* (note **messaging**, not mail), or voicemail
menus like *"To replay your message, press 1."*

**The outcome distribution looked better than reality.** That's the dangerous
direction for a metric to be wrong in — nobody investigates good news.

Fix: regex patterns checked alongside the phrase list, which repairs both the
live detector and the after-the-fact relabelling in one place. Anchors keep
humans safe — someone saying *"my mailbox is full"* still classifies as human.

## "Unknown" failing open to "success"

Cadences configured to stop on `completed` were terminating on calls that were
actually no-answer or voicemail. The lead was never called again.

The classifier fell through to `return "completed"` when it couldn't determine
the outcome — a missing call_id link, a fetch error, an outcome not yet
persisted.

Fix: `return None`. From the code:

> This used to FAIL OPEN to "completed" — end_on=[completed] cadences ended on
> calls that were actually voicemail/no-answer whenever the call_id link was
> lost, the persist lagged, or the fetch hit a transient error. **Not
> classifiable yet: the next tick resolves it.**

**"Unknown" and "success" must be different return values.** Same lesson as the
transfer bug, different system.

## Failed transfers counted as successful handoffs

A `transfer_call` that returned `TRANSFER FAILED` produced the outcome
`transferred`, which matched as `warm_transfer`, which **ended the cadence as a
success for a lead who was never connected.**

The outcome was keyed on the tool's *name*. The result was never inspected.

There was a quieter half too: `warm_transfer_failed` existed as a configurable
value, but **no code path could ever produce it.** Steps configured with it were
silent no-ops.

**A tool's name is not its result. And an enum value nothing can emit is a
feature that silently does nothing.**

---

# PART 6 — Monitoring: how you find out

## Eight metrics — the complete list

Not "we have comprehensive monitoring." Eight, by name:

| Metric | Type | What it answers |
|---|---|---|
| `tarsha_http_requests_total` | Counter | Request volume by method, path, status |
| `tarsha_http_request_duration_seconds` | Histogram | API latency |
| `tarsha_active_calls` | Gauge | Live calls right now |
| `tarsha_voice_stage_latency_seconds` | Histogram | Per-stage pipeline latency |
| `tarsha_webhook_deliveries_total` | Counter | Delivery attempts by result |
| `tarsha_provider_errors_total` | Counter | Errors by provider |
| `tarsha_call_outcomes_total` | Counter | Completed calls by outcome |
| `tarsha_post_call_analysis_total` | Counter | Analysis runs by result |

The voice-stage histogram has hand-picked buckets:
`0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0`

Dense between 0.2 and 1.0 because **that's where the interesting range is.**
Default Prometheus buckets would put almost everything in one bin and tell you
nothing.

The whole module is guarded so the app still runs if `prometheus_client` is
absent — helpers become no-ops. **Monitoring must never be able to take down the
thing it monitors.**

## Per-call cost, stored on the call row ⭐

Every call stores its own cost breakdown *and the rate card used*:
- LLM prompt / completion / cached token counts
- TTS characters synthesised
- STT audio seconds

**Measured from SDK metrics events, not estimated.**

Why that matters: "what does a call cost" becomes a **query**, not a
re-estimate. And because the rate card is stored alongside, a price change
doesn't retroactively rewrite history.

The code also separates two numbers deliberately:

> `total` is the sum of components — the ESTIMATED provider cost of the call.
> `billed_usd` stays the flat customer-facing rate. **They are different numbers
> on purpose: one is COGS, one is revenue.**

## The heartbeat, and why it exists ⭐

The best monitoring story, and it's about a failure nothing was watching.

From the module docstring:

> Every worker loop (`run_forever`) catches its own tick exceptions, so the
> process almost never exits — `restart: always` is **useless as recovery**, and
> a WEDGED tick (an await hanging without a timeout) froze the loop while the
> container stayed "Up". An engine stalled on a Friday evening meant **no cadence
> calls all weekend, with silence as the only symptom.**

Unpack that:

1. The loop catches every exception so it doesn't die on one bad tick — sensible
2. Therefore the process basically never exits
3. Therefore Docker never restarts it
4. A *wedged* tick — an await with no timeout — freezes the loop entirely
5. `docker ps` says **Up**. Everything looks fine.
6. It's Friday evening. Nothing dials all weekend. **The only symptom is silence.**

### The fix

```python
def beat() -> None:
    """Touch the heartbeat file. Never raises — liveness reporting must not
    take the loop down."""
```

Each loop touches a file once per tick. The container healthcheck asserts the
file is fresh. A stall flips the service **unhealthy within ~2 minutes** instead
of never.

Note the docstring guarantee: **`beat()` never raises.** A liveness check that
can crash the loop it's watching is worse than no check.

### The wedging mechanism

Worth naming, because it's the actual root cause: `db.get_call_by_id` was the one
**synchronous** Supabase call on the engine's event loop. With up to 500 in-flight
enrollments, one slow request stalled every placement and reconcile.

Moved to `asyncio.to_thread`.

**The lesson: "container Up" is a liveness signal for the process, not for the
work.**

## The zombie reaper — a fix that nearly recreated a solved bug ⭐

**The original, July 2026:**

> Caddy runs as PID 1 in its container and does not reap children, so every
> healthcheck `wget` (~2,880/day at 30s intervals) leaked a zombie. **By Jul 27
> the host reported 16,748 zombies.**

**The near-repeat, August 2026** — when the heartbeat healthchecks were added:

> The Caddy incident happened because healthcheck processes are reparented to the
> container's PID 1 when they exit, and Caddy never reaped them. Our worker
> containers run *python* as PID 1, which also does not reap orphans — so the new
> checks **WOULD have leaked ~1,440 zombies/day per service.** Fixed the same way:
> `init: true` on all four heartbeat-checked services.
>
> (The `api` service never had this problem despite its curl healthcheck:
> gunicorn's master reaps all children.)

**The fix for one silent failure nearly reintroduced a previously solved one.**
Institutional memory caught it at design time — which is the only place it's
cheap.

## Everything else

- **Audit middleware** — every mutating request: actor, action, resource, status,
  IP, request ID
- **Sentry** — every background task failure via `safe_task`
- **Structured outcomes** — promised / refused / wrong number / voicemail /
  transferred / needs-LO, so call quality is queryable rather than anecdotal
- **Per-call latency** emitted per turn, accumulated per call, sent to a webhook

---

# PART 7 — The blast radius table

| Failure | Blast radius | Recovery |
|---|---|---|
| Worker process crashes | One call | Reconcile redials |
| Worker container dies | Its live calls | Orphans reconciled |
| Postgres slow | Reporting lags | Outbox replay |
| Postgres down | No **new** calls | Live calls continue |
| Redis down | Falls back in-process | Per-replica cap — degraded, not broken |
| Deepgram down | STT failover, logged loudly | soniox → nova-3 → OpenAI |
| Deepgram down, **Flux agent** | **Agent is deaf** | **No fallback — known gap** |
| ElevenLabs socket wedges | ~3s pause | Same-voice standby |
| OpenAI 5xx mid-turn | Transparent | gpt-4o-mini |
| Workflow engine wedges | Cadences stall | Unhealthy within ~2 min |

**The property to point at: nothing has a blast radius bigger than it needs.**

---

# PART 8 — What we deliberately don't protect

Four things, each a decision rather than an oversight.

**1. Flux has no STT fallback.** From the code:

> Deliberately NOT wrapped in a FallbackAdapter for the A/B: a mid-call engine
> swap back to nova-3/Whisper would **contaminate the latency measurement.**

The reasoning is sound — if a call silently switched engines halfway, every
latency sample after the switch measures a different system, and the A/B is
worthless. It was specified in advance and pinned by a test.

**But:** from our own docs — *"This is still true and is a live risk... Accepted
for measurement purity during the A/B; **never revisited.**"* The decision was
right; leaving it in place afterwards is the gap.

**2. An agent already on OpenAI TTS** has nothing below it.

**3. An agent already on gpt-4o-mini** — the fallback *is* the primary.

**4. Machine detection fails open**, on purpose:

> Fails open to 'human' on timeout/error — **hanging up on a person is the worse
> failure.** Costs ~1 output token on a mini model, only ever on the first 2 turns.

Note it's the *opposite* of the gate-chain rule. Gates fail closed because
calling illegally is worse than not calling. Machine detection fails open because
hanging up on a real person is worse than wasting a minute on a machine.

**Fail-closed and fail-open are both correct — in different places. What matters
is deciding which failure is worse and designing toward it.**

---

# PART 9 — What's still missing

State these before he finds them.

1. **No alerting wired to a pager.** Metrics exist, heartbeats exist, nobody gets
   woken up.
2. **Only TTS connect options are overridden.** STT and LLM sit at SDK defaults
   with no recorded reason.
3. **Flux has no fallback** — covered above.
4. **No speculation-waste counter.** Discarded LLM generations are priced
   identically to used ones.
5. **No false-interruption count.** The mechanism is confirmed; a hard number
   needs a labelled transcript pass that hasn't been done.
6. **Many timeouts have no recorded rationale.** A dozen scattered values that
   someone typed rather than decided.
7. **No SLO or error budget.** We measure, we don't yet commit to a target.

---

# PART 10 — Questions Jay will ask

**"What happens when Deepgram goes down mid-call?"**
For a nova-3 agent, the FallbackAdapter swaps to gpt-4o-mini-transcribe and logs
loudly by name. For a Flux agent, nothing — that's a known gap we took
deliberately for measurement purity and haven't revisited.

**"How would you know if the system stopped working?"**
Depends on the failure. A crash shows in Sentry. A wedged loop shows as
`(unhealthy)` within two minutes via the heartbeat file. A *silent* failure —
one that looks like a legitimate outcome — is the hard case, and we've been
bitten by it three times. That's why outcome taxonomy is treated as telemetry.

**"What's your alerting?"**
Metrics and healthchecks exist. Paging does not. That's an honest gap and it's on
the list.

**"How do you know a fallback actually fired?"**
It logs at error level, names the provider, and says what to investigate.
Deliberately loud — a silent swap is how the whisper hallucination corruption
went unnoticed. And construction of a standby is deliberately *quiet*, because
logging it on every call made the primary look permanently broken.

**"Why is there no circuit breaker on the voice path?"**
There's one on Supabase readiness. On the voice path the FallbackAdapter plays
that role — it marks an engine unavailable and stops routing to it. Adding a
second mechanism would mean two things deciding availability, which is how you
get flapping.

**"What's your worst outage?"**
Six days where every warm transfer failed, at 100%, and looked exactly like
nobody picking up. Carrier rejection returned the same value as no-answer. It
cost us the best inbound lead of that week.

**"What would you improve first?"**
Alerting. We can reconstruct any incident after the fact, but nobody gets woken
up during one.

---

# PART 11 — The five things to land

1. **A per-stage metric measures survivors.** The failure that hurts users often
   emits no data point at all. That's why perceived response is wall clock.

2. **When a failure looks like a legitimate outcome, it runs forever.** Carrier
   rejection as no-answer for six days. Voicemail as completed conversation for
   half a week. "Unknown" failing open to "success."

3. **Loud when it matters, silent when it doesn't.** A log that fires on every
   healthy call teaches people to ignore it.

4. **Fail closed or fail open — but decide which.** Gates fail closed because
   calling illegally is worse. Machine detection fails open because hanging up on
   a person is worse.

5. **"Container Up" is liveness for the process, not for the work.** An engine
   stalled Friday evening, nothing dialed all weekend, and the only symptom was
   silence.

---

# Appendix — jargon, decoded

| Term | Meaning |
|---|---|
| **Blast radius** | How much breaks when one thing breaks |
| **Circuit breaker** | Stop calling a failing service for a while instead of hammering it |
| **Counter / Gauge / Histogram** | Only goes up / current value / distribution of values |
| **Fail open / fail closed** | When unsure, allow / when unsure, block |
| **FallbackAdapter** | Wrapper that routes to a standby when the primary is unavailable |
| **Golden signals** | Latency, traffic, errors, saturation — the four standard metrics |
| **Healthcheck** | A command Docker runs to decide if a container is working |
| **Outbox pattern** | Failed writes go to a table; something replays them later |
| **PID 1** | The first process in a container; responsible for reaping orphans |
| **Reaping / zombie** | Cleaning up finished child processes / one that wasn't cleaned up |
| **SLO / error budget** | A reliability target / how much you're allowed to miss it |
| **Structured outcome** | A fixed vocabulary of call results, so quality is queryable |
| **Wedged** | Stuck waiting forever, without crashing |
