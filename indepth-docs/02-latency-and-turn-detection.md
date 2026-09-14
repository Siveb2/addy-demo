# Latency & Turn Detection — explained from zero

*Written so you can follow every word without prior context, and defend every
number if Jay pushes. Each part: what it is → why it matters → what we measured →
what we got wrong.*

---

# PART 0 — What "latency" actually means on a phone call

## The number that matters is not the one people quote

Most voice vendors quote "time to first token" or "TTS latency." Neither is what
the caller experiences.

**The caller experiences one number: the gap between them finishing a sentence
and hearing a voice come back.** We call it `perceived_response`, and everything
else is a component of it.

Why the distinction matters: components can all look healthy while the caller
waits eleven seconds. That has literally happened to us, and it's covered in
Part 6.

## Why ~1 second is the target

| Gap | How it feels |
|---|---|
| Under 500ms | Unnaturally fast. Reads as "a bot answered before I finished" |
| 800ms – 1.3s | Natural. Human conversation sits here |
| 1.5s – 2s | Slightly slow. Tolerable, noticeable |
| Over 2.5s | "Hello? Are you there?" — people start repeating themselves |
| Over 4s | They hang up |

**Human turn-taking in natural conversation averages around 200ms**, but people
extend that grace substantially on a phone call, especially with a stranger.
Roughly one second is the target zone.

## The five stages

```
caller stops speaking
        │
        ├─ 1. END OF UTTERANCE      "have they finished?"
        ├─ 2. TRANSCRIPTION          audio → text
        ├─ 3. LLM TIME TO FIRST TOKEN  think
        ├─ 4. TTS TIME TO FIRST BYTE   speak
        ▼
agent's voice starts
```

Our measured numbers, from a real call:

| Stage | What it is | p50 |
|---|---|---|
| `eou_delay` | Deciding they stopped | **390 ms** |
| `transcription_delay` | Speech → text finalised | 324 ms |
| `llm_ttft` | Model's first token | **1021 ms** |
| `tts_ttfb` | First audio byte | 179 ms |
| **`perceived_response`** | **What the caller feels** | **1343 ms** |

**Notice: 390 + 324 + 1021 + 179 = 1914ms, but perceived is 1343ms.**

The stages sum to *more* than the total. That's not an error — it's the most
important thing on this page, and Part 3 explains it.

---

# PART 1 — The hardest problem: when did they stop talking?

## Why this is hard

A human listener knows you've finished because of meaning, intonation, breath,
and context. A computer just has audio.

Consider:

> "I want a loan for… *[1.2 second pause]* …about four hundred thousand."

A naive system hears 1.2 seconds of silence and starts talking. **It cuts the
caller off mid-sentence.** That single behaviour is what makes people say "this
is a bot."

Now consider:

> "Yeah that works."

A cautious system waits 2 seconds to be sure. **The caller now thinks the line
dropped.**

**There is no timeout value that handles both.** That's the core problem, and
it's why turn detection is a model problem, not a configuration problem.

## Approach 1 — the silence timer (where everyone starts)

Voice Activity Detection (VAD) answers "is there speech in this audio right
now?" Then you add a timer: *silence for N milliseconds = they're done.*

**Our original settings:**
- `min_interruption_words: 1`
- `min_interruption_duration: 0.5s`
- `min_response_delay: 0.5s` (the endpointing floor)
- `max_endpointing_delay: 3.0s`

**What went wrong**, from the code comment, dated 2 Aug 2026:

> The previous values (1 word / 0.5s floor) **cut callers off mid-sentence**: a
> single "um", a cough, or an STT artifact counted as an interruption, and a
> mid-thought pause of half a second was enough for the agent to start talking
> over them.

Read that carefully. **One word was enough to count as an interruption.** A
cough. An "um." A stray STT artifact from background noise. The agent would
barge in.

**The fix:**
- `min_interruption_words: 2` — one word is not an interruption
- `min_interruption_duration: 1.0s`
- `min_response_delay: 0.7s`
- `max_endpointing_delay: 4.0s` — room to finish a slow sentence

> Costs ~0.2s of responsiveness in exchange for not stepping on the caller.

**That trade is the whole philosophy in one line.** We deliberately made the
system *slower* because being fast and interrupting is worse than being slightly
slow.

## The config that reverted itself ⭐

This is a great story and it's worth telling.

The loosened values were set in the backend. Then they silently went back to the
old ones.

From commit `55f1707`, the same day:

> The editor's `DEFAULT_CALL_CONFIG` still had 1 / 0.5s / 3.0s, and it is sent on
> **EVERY save** — so saving an agent for any reason silently wrote the old
> values back over the backend defaults.

So: someone edits an agent's greeting, hits save, and the frontend helpfully
sends its full default config along — including turn-taking values nobody
touched. The careful fix is undone by an unrelated edit.

**Worse:** the clamp fallbacks inside `turn_handling_options()` were *also*
hardcoded to the old numbers, so any agent whose config predated a field ran the
tight settings regardless.

**The fix is the interesting part.** A test that **parses the frontend `.tsx`
file directly** and asserts its defaults match the backend's. Its docstring:

> The agent editor sends its DEFAULT_CALL_CONFIG on EVERY save, so a stale value
> there overwrites the backend default for any agent that gets saved — which is
> exactly how the loosened turn-taking got silently reverted.

**Known gap, state it:** that parity test only covers the *new* editor. The
legacy editor still carries the pre-loosening values and still ships them on
save. That is the exact failure class the test was written to prevent, still
live in one code path.

## Approach 2 — a semantic EOU model

Instead of timing silence, run a small classifier over the interim transcript:
*does this look like a finished thought?*

"I want a loan for" — clearly unfinished.
"Yeah that works." — clearly finished.

We enabled LiveKit's `EnglishModel`. Result: EOU went 649ms → 556ms.

**A modest win, and the floor was hiding most of it.** The `min_endpointing_delay`
of 0.5s meant the measured minimum was 0.505s — the model was pinned at the
floor. It could not demonstrate a speedup it may have had.

## Approach 3 — Flux, where turn-end lives in the STT model itself ⭐

Deepgram Flux doesn't transcribe and then ask a separate model whether the turn
ended. **The turn-end decision is part of the speech model**, using audio *and*
meaning together — intonation, trailing off, breath, and semantics.

It emits two signals:

| Signal | Threshold | What it means |
|---|---|---|
| **Eager EOT** | 0.4 | "Probably finished — and this transcript is guaranteed to match the final one" |
| **EOT** | 0.7 default | "Committed. The turn is over." |

The eager signal's guarantee is the load-bearing part. Because the transcript
won't change, **you can safely start the LLM on it** before the turn is
confirmed. That's what makes overlap possible at all, and it's covered in
Part 3.

**Only Flux emits that signal.** Every other STT engine — nova-3, Soniox,
ElevenLabs Scribe — just finalises text sooner. They run in what the code calls
the nova-3 lane, where VAD or the EOU model still decides the turn. That
constraint is stated in three separate places in the code, which tells you how
often it got misread.

---

# PART 2 — The A/B, and the result that looked like a failure

## Round 1 — Flux at the default threshold: a regression

**8 July 2026, call `1e9a60a6`.** Flux enabled, `eot_threshold` left at the
plugin default of 0.7.

| stage p50 | nova-3 + EOU | Flux @ 0.7 |
|---|---|---|
| eou_delay | 0.556 | **1.072** ❌ |
| perceived | 2.034 | **2.485** ❌ |

**Endpointing got twice as slow.** On the headline number, Flux was worse than
what it replaced.

Most people stop here and revert.

## The bimodal finding ⭐

Instead of trusting the p50, we pulled the per-turn samples:

```
[1.246, 1.427, 0.475, 0.278, 1.224, 1.072, 0.981, 0.269]
```

**That is not one distribution. It's two.**

| Cluster | Range | What those turns were |
|---|---|---|
| **Fast** | 0.27 – 0.48s | Clean sentence ends |
| **Slow** | 0.98 – 1.43s | Trailing off, mid-thought pauses |

And the test script *deliberately contained* mid-thought pauses — lines like
"I… uh… want a loan."

So Flux was doing **exactly what we bought it for**: committing faster than the
old 0.5s floor ever allowed on clean endings, and correctly waiting on genuinely
unfinished speech.

**The median was punishing the model for doing its job.**

The minimum perceived response on that call was 0.879s — the fast path was
real and already better than anything the old system could produce.

## Round 2 — lower the commit threshold

The eager signal was already firing at 0.4. The problem was the *commit*
threshold at 0.7 being too cautious.

Dropped `eot_threshold` to **0.5**.

**8 July 2026, call `35a796be`** — 31 turns over 144 seconds:

| stage p50 | nova-3 + EOU | Flux @ 0.7 | **Flux @ 0.5** |
|---|---|---|---|
| eou_delay | 0.556 | 1.072 | **0.201** |
| transcription_delay | 0.425 | 1.070 | **0.153** |
| llm_ttft | 0.962 | 1.074 | 1.052 |
| tts_ttfb | 0.183 | 0.184 | 0.183 |
| **perceived** | 2.034 | 2.485 | **1.638** |

**Endpointing: 556ms → 201ms. A 64% cut.**

Same agent, same hardware, same network, same LLM, same TTS. **One variable.**
That's a clean isolation and it's the single most quotable number you have.

## What the trade actually was

Committing at 0.5 instead of 0.7 means acting on less confidence. That is a
real trade: slightly more risk of cutting someone off on a genuine mid-thought
pause.

The fallback if butt-ins appeared was documented in advance — 0.55 to 0.6 — and
was never needed.

**Known gap, state it:** the 0.5 is **not in the codebase**. The default still
reads 0.0, which means "use the plugin's 0.7." The 0.5 exists only as a
per-agent database value on the staging agent. Also the clamp floor is 0.3,
below Deepgram's documented 0.5 minimum, and nothing explains why.

---

# PART 3 — Sequential vs parallel, and why the numbers don't add up

## The naive pipeline

```
caller stops ──▶ decide turn ──▶ transcribe ──▶ LLM ──▶ TTS ──▶ voice
                    650ms          (inside)      930ms    140ms
                    └──────────────── 1.9 seconds ──────────────┘
```

Each stage waits for the last. Our baseline, 6 July 2026, call `0c45aa0b`:

| stage | p50 |
|---|---|
| eou_delay | 0.649 |
| llm_ttft | 0.928 |
| tts_ttfb | 0.139 |
| **perceived** | **1.891** |

649 + 928 + 139 = **1716ms**. Perceived: **1891ms**.

The sum ≈ the total. Nothing overlapped. The verdict in our own handoff doc was
one line:

> Stages run sequentially (sum ≈ perceived → preemptive generation is NOT
> engaging).

## The idea: start before you're sure

If the eager signal says *"probably done, and this transcript is final"* — why
wait for commit? Start the LLM now.

If the caller turns out to be still talking, **throw the generated reply away
and redo it.** You've wasted some tokens. You have not made the caller wait.

Two flags:

| Flag | What it overlaps |
|---|---|
| `preemptive_generation` | LLM starts during the endpointing window |
| `preemptive_tts` | TTS also starts before the LLM finishes |

From our own config comment:

> Overlaps LLM TTFT with the turn-confirmation pause, so perceived latency drops
> from `(eou + llm + tts)` toward `(max(eou, llm) + tts)` — this is how Vapi runs
> the same model ~600ms faster. **Tradeoff: if the caller resumes mid-pause the
> speculative generation is discarded and re-run (small extra LLM spend). Worth
> it.**

## The three weeks where the flag did nothing ⭐

**This is the best story in the latency work. Tell it.**

`preemptive_generation` was enabled on 24 June. It logged "enabled" on every
call. And it produced **zero** overlap for three weeks.

We caught it with arithmetic. From `preemptive-diagnosis.md`:

```
overlap = (eou + llm_ttft + tts_ttfb) − perceived
        = (0.551 + 1.064 + 0.282) − 2.056
        ≈ −0.16 s
```

**Slightly negative.** Pure sequential, plus scheduling overhead.

### The cause

> With VAD-timer endpointing, the final transcript arrives so close to the end of
> the endpointing window (transcription_delay ≈ 0.42s of the ~0.55–0.65s eou
> window) that **there is nothing left to overlap** — preemptive generation is
> enabled but has no window to run in.

A flag that is on, logs that it is on, and **cannot possibly do anything**, because
the window it needs to run in doesn't exist under VAD-timer endpointing.

### We tried a config-only fix, and it failed too

Enabling the semantic EOU model was supposed to open a window between
"transcript known" and "turn committed."

**First attempt failed for an unrelated reason.** `EnglishModel()` threw
`Could not find file "languages.json"`. Root cause: the plugin only registers
itself when the `english` submodule is imported — we imported only the package —
so `download-files` never fetched its weights. The worker had been silently
falling back to VAD endpointing.

**Second attempt, with the model genuinely engaged:** overlap = **−0.33s**.
Still none.

### The honest verdict, written at the time

> Preemptive generation does not overlap on livekit-agents 1.5.1 regardless of
> endpointing mode. **A config-only fix does NOT exist here:** the eou floor
> (0.5s min_endpointing_delay) hides any semantic-EOU speedup, and the LLM/TTS
> stages remain strictly sequential after it.

Two things worth noting about this: the investigation found a *second*
independent bug (the missing ONNX weights) on the way, and the conclusion was
"this needs a library upgrade and a different STT engine," not "we'll tune it."

---

# PART 4 — Why the stages sum to more than the total

Two independent mechanisms. Both need saying, because a careful reviewer will
work out one and assume that's the whole answer.

## Mechanism 1 — overlap

Stages run concurrently. A sum cannot see concurrency.

This is why `perceived_response` is **measured directly** rather than computed.
From the code:

> `perceived_response` — REAL wall-clock the caller experiences: from when they
> stop speaking (user → listening) to when the agent's voice starts (agent →
> speaking). **This is the only number that captures stage OVERLAP; a naive sum
> of stages can't.**

### How it's measured

Two session events, paired:
- `user_state_changed` → speaking-to-listening stamps a timestamp
- `agent_state_changed` → speaking pops it

With a guard: `0.0 < delta < 15.0`. That discards the opening greeting (no
preceding user turn) and any cross-idle pairing where the caller went quiet for
a long time.

## Mechanism 2 — double counting

**`transcription_delay` is contained inside `eou_delay`.** STT finalisation is a
*subset* of the endpointing window, not a stage after it.

Under Flux they become the **same event** and are identical.

So summing all five stages over-counts by the entire `transcription_delay`.

## The artifact that proves the history

The dev webhook still prints the sequential-era assumption:

```
felt {perceived} (max {perceived_max}) = eou {…} + llm {…} + tts {…}
```

That `=` was true when it was written. **The whole project is the story of it
becoming a `>`.**

---

# PART 5 — The tail, and the setting that made things slower

## The problem

**8 July 2026, call `de15f12b`.** Full Phase 3 stack: Flux @0.5, gpt-5.4-mini,
preemptive TTS.

| stage p50 | value | avg | max |
|---|---|---|---|
| eou_delay | 0.330 | 0.340 | 0.712 |
| llm_ttft | 1.073 | **1.515** | **6.261** |
| perceived | 1.541 | 2.073 | **6.590** |

The median was fine. **One turn took 6.26 seconds.** A caller waited six and a
half seconds for a reply.

## The cause

Our code forced `reasoning_effort="minimal"` globally. The plugin's
model-correct default for gpt-5.4-mini is **`"none"`**.

From the code comment:

> gpt-5.x models whose latency-optimal reasoning effort is "none" (the plugin's
> own default). **Forcing "minimal" on these makes them occasionally deliberate**
> → multi-second TTFT spikes on a voice turn (observed: 6.3s on gpt-5.4-mini).

"Minimal" still *permits* deliberation. Most turns it doesn't. Occasionally it
does, and on a voice call that's catastrophic.

**A global "make it fast" setting was slower than the model's own default.**

## The fix, measured

**Call `8db8ba3e`**, same day, same config, one variable changed:

| stage p50 | `minimal` | **`none`** | change |
|---|---|---|---|
| llm_ttft **max** | **6.261** | **1.872** | spike gone |
| llm_ttft p50 | 1.073 | 1.021 | flat |
| tts_ttfb | 0.178 | 0.179 | flat |
| **perceived p50** | 1.541 | **1.343** | −0.20s |
| **perceived max** | 6.590 | **3.576** | **−3.0s** |

**The median barely moved. The worst case improved by three full seconds.**

## The second bug the same call exposed

The LLM connection warmup had been silently failing. `warm_llm_connection` used
`max_tokens=1`; gpt-5.x rejects it with `400: use max_completion_tokens`. So the
warmup never ran, and **every first turn after an idle period paid full
cold-start** — DNS, TCP, TLS, edge routing.

One call surfaced two independent latency bugs.

## The lesson

**On a reasoning model, the median is not the risk. The tail is.**

A p50 of 1.07s looks healthy on any dashboard. The caller who waited 6.26
seconds does not care about your p50.

---

# PART 6 — When every metric lies

## The incident

**11 August 2026.** Inbound calls: the first reply after the greeting took
**11.7 seconds**. The caller heard nothing.

Every stage metric was green:
- `llm_ttft`: **531ms**
- `tts_ttfb`: **108ms**
- `perceived_response`: **11,700ms**

## The cause

The ElevenLabs "1006 family" — a WebSocket that **connects successfully and then
never yields audio.**

The LiveKit SDK's default TTS connect budget is `timeout=10s, max_retry=3`. So
one wedged stream held the reply for ten seconds or more before the fallback
adapter was ever allowed to hand over.

## Why `tts_ttfb` stayed green — the real lesson ⭐

> **Time-to-first-byte can only be recorded on a stream that produced a first
> byte.** The wedged attempt emitted no data point at all.

**The stage histogram was measuring the survivors.**

This is the single most important idea in our observability story, and it
generalises: a per-stage metric measures only the attempts that succeeded. The
failure that hurts users is often the one that never emits a data point.

It's exactly why `perceived_response` exists as a directly measured wall clock
rather than a computed sum.

## The fix

```python
tts_conn_options=APIConnectOptions(max_retry=1, retry_interval=0.5, timeout=3.0)
```

> Healthy TTFB is ~100–500ms, so **3s is a generous ceiling**; one retry, then
> fail over fast.

Worst case is now ~3.5 seconds, and the standby speaks **in the same voice** —
because an earlier version failed over to a completely different voice mid-call,
and customers reported "the voice changes in between."

## The second symptom of the same bug

The same wedged stream produced **65 seconds of billed silence** on outbound
calls. `session.say(opener)` was awaited with no timeout, so a stream that
connected but never yielded hung forever.

The outcome was recorded as `silence_timeout` — which reads like *the human*
said nothing.

**The tell: 36 of 39 "silence_timeout" calls on 10 August had completely empty
transcripts.** Not a quiet human. An agent that never opened its mouth.

Fix: bound the greeting playout at 30 seconds and, on timeout, end the dial so
the lead is redialed rather than burned.

**Known gap, state it:** only `tts_conn_options` is overridden. STT and LLM
connect options sit at SDK defaults with no comment explaining why. That's a
gap, not a decision.

---

# PART 7 — The full arc, and the self-defeating result

## What moved, over four configurations

| stage p50 (s) | baseline VAD | + EOU model | Flux @0.5 (1.5.1) | Phase 3 (1.6.4) |
|---|---|---|---|---|
| `eou_delay` | 0.649 | 0.556 | **0.201** | 0.390 |
| `transcription_delay` | 0.418 | 0.425 | 0.153 | 0.324 |
| `llm_ttft` | 0.928 | 0.962 | 1.052 | 1.021 |
| `llm_ttft` max | — | — | — | 6.26 → **1.87** |
| `tts_ttfb` | 0.139 | 0.183 | 0.183 | 0.179 |
| **`perceived`** | **1.891** | 2.034 | 1.638 | **1.343** |

**Net: endpointing −40%, perceived −29%, worst case −3.0 seconds.**

## The cleanest comparison

Only one variable moved:

> Adam-v2 nova-3+EOU → Adam-v2 flux @0.5, **identical hardware, network, LLM and
> TTS**: eou_delay 0.556 → 0.201s (**−64%**), perceived 2.034 → 1.638s (−19%,
> −396ms). This isolates the Flux contribution with no confounders.

## The result that undercut itself ⭐

**This is the most honest thing you can say all meeting.**

> **`llm_ttft` (1.02s) is now the floor and barely overlaps.** Flux's commit is
> *so* fast that `preemptive_lead_time` is only ~0.02–0.04s — the eager signal
> arrives nearly at commit. Sequential sum ≈ 0.39 + 1.02 + 0.18 = 1.59s vs
> measured 1.34s ⇒ **only ~0.25s of real overlap. Fixing endpointing shrank the
> very window preemption needed.**

We expected ~600ms of overlap. We got ~250ms.

**Two optimisations that each work, competing for the same 400 milliseconds.**

Neither is wrong. They just overlap in the same window, and the second one can
only collect what the first one leaves behind.

Volunteering this — an optimisation that underdelivered, with the arithmetic
showing why — is worth more with an engineer than any number that went the right
way.

---

# PART 8 — Latency is a product decision

Because providers sit behind factory functions, the TTS model is a per-agent
config value. Which makes latency a **choice per call type**, not a fixed
property.

| Model | TTFB | Perceived | Use for |
|---|---|---|---|
| Flash v2.5 | ~75ms | ~1.40s | Reminders, status calls |
| Turbo v2.5 | ~150ms | ~1.55s | Most borrower calls |
| Multilingual v2 | ~250ms | ~1.75s | Other languages |
| V3 Conversational | ~266ms | ~1.85s | First contact, sensitive |

V3 adds expressiveness — it sighs, it chuckles, it carries emotion. It costs
**~200ms per turn and the same money.**

So it's a latency choice, not a budget choice:
- Chasing a document from someone who's expecting the call → Flash
- First contact with a borrower who doesn't know you → V3

**On a bundled platform you take their one tier.** Owning the stack is what makes
this a decision at all.

---

# PART 9 — What we deliberately did not protect

## Flux has no fallback, on purpose

Every other STT engine has a chain. Flux has none. From the code:

> voice-v2 2.1: Flux path — model-integrated end-of-turn. **Deliberately NOT
> wrapped in a FallbackAdapter for the A/B:** a mid-call engine swap back to
> nova-3/Whisper would contaminate the latency measurement.

**Why this is defensible:** if a call silently switched engines mid-way, every
latency sample after the switch would be measuring a different system. The A/B
would be worthless.

It was specified in advance, pinned by a test, and the build log still literally
contains the string `(A/B)` in production today.

**Why it's still a gap:** from our own docs —

> **This is still true and is a live risk:** a Deepgram outage mid-call leaves a
> Flux agent deaf with no failover. Everything else gets
> `soniox → nova-3 → gpt-4o-mini-transcribe` with a loud `STT FAILOVER` log.
>
> Accepted for measurement purity during the A/B; **never revisited.**

Say both halves. The reasoning is sound; leaving it in place afterwards is the
gap.

---

# PART 10 — What we have not measured

State these plainly. The credibility of every number above depends on it.

**1. Speculation waste has no counter.** No metric, no log line. A discarded
speculative generation's tokens are summed into `llm_prompt_tokens` and priced
**identically to a used one**, with no way to separate them. The only signal it
happened at all is an SDK log line we never parse.

There's a code comment that explains the policy:

> Note: no interruption counts — the pipeline doesn't track them today, and
> **inventing the field would be worse than omitting it.**

**2. False-interruption reduction was never quantified.** The mechanism is
confirmed — Flux demonstrably waits on unfinished speech. But *"mechanism
confirmed … a hard count needs a labelled transcript pass."* Never done. The
"no mid-thought butt-ins" check is subjective.

**3. The noise check has no recorded result.** The instruction to verify "noise
no longer interrupts agent" has no outcome recorded anywhere.

**4. Sample sizes are small, and recorded as such.** The 8 July EOU-model call
had `eou_delay` n=7 and `perceived_response` n=5. The Flux @0.5 call was 31 turns
over 144 seconds. **These are hand-placed test calls, not production cohorts.**

**5. The test environment inflates the numbers.**

> The worker is on a Mac in **India South** hitting OpenAI US — that round trip
> alone is a big chunk of the 1.0s.

`llm_ttft` runs ~120ms high and `tts_ttfb` ~44ms high on the staging box purely
from distance.

**6. The headline mixes library versions.** The 201ms EOU is from
livekit-agents 1.5.1. The shipped Phase-3 configuration measures **390ms**. Both
are real; they are not the same configuration.

---

# PART 11 — Questions Jay will ask

**"What's your latency?"**
Perceived response p50 1.34 seconds, measured as wall clock between the caller
stopping and the agent's voice starting. But I'd rather show you the breakdown
than the number, because the components are where the decisions are.

**"Why do your stages sum to more than the total?"**
Two reasons, and both matter. Stages overlap because of preemptive generation.
And `transcription_delay` is nested inside `eou_delay` — it's a subset of the
endpointing window, not a stage after it. Summing all five double-counts
transcription entirely.

**"How do you know these numbers are real?"**
They're emitted per turn from SDK metrics events and accumulated per call.
Perceived response is measured directly, not computed, by pairing two session
state-change events. And I'd flag the conditions: these are hand-placed test
calls from a laptop in India hitting US providers. The LLM number carries about
120ms of pure network distance.

**"Why is your LLM TTFT a full second?"**
Mostly geography. Same model from a box near the providers should land
materially lower. It's also now the floor — after the endpointing work, the LLM
is the largest single stage.

**"What's the biggest remaining win?"**
Moving the worker closer to the providers. The code is done — the spike is gone,
overlap is engaged, every stage is healthy. What's left is an infrastructure
result, not a code one.

**"Did preemptive generation actually help?"**
Less than I expected, and I can show you why. We predicted ~600ms of overlap and
measured ~250ms. Flux's commit is so fast that the eager signal arrives 20 to 40
milliseconds before commit — fixing endpointing shrank the very window preemption
needed. Two optimisations competing for the same 400ms.

**"What happens if the caller keeps talking after you've started generating?"**
We throw the speculation away and re-run. It costs tokens, not time. And I'll be
straight: we don't count how often that happens. There's no metric for
speculation waste, so I can't tell you the exact cost.

**"How do you handle someone interrupting the agent?"**
VAD stays active even under Flux, specifically for interruptions. Two-word
minimum and a one-second duration floor, because at one word a cough would barge
in.

---

# PART 12 — The five things to land

1. **Turn-taking matters more than raw speed.** A fast agent that interrupts
   feels worse than a slower one that waits. We deliberately gave up 0.2s to
   stop cutting people off.

2. **The A/B was clean and the first result looked like a failure.** 0.7 was a
   regression; the per-turn samples were bimodal; the model was being punished
   by the median for correctly waiting on unfinished speech. Lowering commit to
   0.5 gave 556ms → 201ms, one variable.

3. **A per-stage metric measures survivors.** 11.7 seconds of dead air with
   every stage green, because TTFB can only be recorded on a stream that
   produced a first byte.

4. **The tail is the risk, not the median.** A global "make it fast" setting was
   slower than the model's own default. Median flat, worst case −3 seconds.

5. **Our own optimisation underdelivered and we can show why.** Fixing
   endpointing shrank the window preemption needed. ~250ms of overlap against a
   predicted ~600ms.

---

# Appendix — jargon, decoded

| Term | Meaning |
|---|---|
| **Bimodal** | A distribution with two clusters, not one. A median describes it badly |
| **Commit / EOT** | The moment the system decides the turn is definitely over |
| **Eager EOT** | An earlier "probably over" signal whose transcript is guaranteed final |
| **Endpointing** | Deciding when a speaker has finished |
| **EOU** | End of utterance — same idea, different vendor's word |
| **Floor** | A minimum wait, enforced regardless of what the model says |
| **p50 / p95** | Median / 95th percentile. Half of calls are better than p50 |
| **Perceived response** | Caller stops speaking → agent's voice starts. The only number they feel |
| **Preemptive generation** | Starting the LLM before the turn is confirmed |
| **Reasoning effort** | How much a reasoning model deliberates before answering |
| **Speculation** | Work done on a guess, thrown away if the guess was wrong |
| **Tail** | The slow outliers. p99, or the max |
| **TTFB** | Time to first byte — first audio out of TTS |
| **TTFT** | Time to first token — first word out of the LLM |
| **VAD** | Voice activity detection — "is there speech right now?" |
