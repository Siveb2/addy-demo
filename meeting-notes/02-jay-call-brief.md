# Technical Interview Brief — João (Jay) Melo, Head of Engineering

**Format:** ~2 hours, screen share, FigJam board + live demo
**Who he is:** Ex-TechLead for AI at Deloitte. Master's in Computer Engineering,
University of Aveiro. He evaluates; he does not buy. Michael already bought.
**His job in this meeting:** find the holes.
**Your job:** hand him the holes before he finds them, and be right about
everything else.

---

# TIER 1 — MUST LAND

## 1 · System Architecture
*Kills: "Do you understand your own system?"*
**~25 min. This is the anchor — every other section hangs off it.**

1. **The three planes.** Control plane (FastAPI — auth, CRUD, scheduling),
   worker plane (agent processes that hold live calls), data plane (Supabase,
   Redis, object storage). They scale independently and fail independently.

2. **Call lifecycle, outbound.** Scheduler claims an enrollment atomically →
   creates the outbound row → dispatches a LiveKit job → worker joins the room
   → SIP dial → agent + caller + egress in the room → pipeline runs → persist.

3. **Call lifecycle, inbound.** Twilio webhook → business-hours check → room
   created with metadata carrying caller number and call SID → worker joins →
   context fetched by tool call on the first turn.

4. **What is never on the voice path.** No DB write is ever awaited during a
   turn. Everything goes through `safe_task` — logged, Sentry-reported, and
   holding a strong reference so the task cannot be garbage-collected
   mid-flight. That last part is asyncio's documented pitfall and worth saying.

5. **The room has three participants,** not two: caller, agent, and an egress
   leg for recording. This matters for the disconnect guard — egress leaving is
   not the call ending.

6. **State lives in Postgres, not in the worker.** A worker dying mid-call loses
   that call, not the system. Reconcile picks up orphans.

7. **Redis for cross-replica concurrency.** The per-tenant line cap is enforced
   across every replica, not per-process.

8. **Provider abstraction.** STT, LLM, TTS all behind factory functions, so a
   provider swap is a config change and not a code change. This is what makes
   the per-call-type model selection possible.

9. **Multi-tenancy.** Agent config, prompts, voices, numbers, retention policy
   all per-tenant rows. One deployment, many lenders.

10. **Where Addy plugs in.** Their checklist output becomes the call brief;
    outcomes write back to the loan file. Addy stays system of record.

---

## 2 · Latency — measured
*Kills: "Are your numbers real or marketing?"*
**~20 min, combined with §15.**

1. **Show the breakdown first, not the total.** EOU 390ms / transcription 324 /
   LLM TTFT 1021 / TTS TTFB 179 → perceived **1343ms**.

2. **Explain why they sum higher.** Two mechanisms, both matter: stages overlap
   (preemptive generation), and `transcription_delay` is *nested inside*
   `eou_delay` — so summing all five double-counts transcription entirely.

3. **Perceived response is measured, not computed.** Wall clock between two
   session events — user speaking→listening, agent →speaking — with a
   `0 < Δ < 15s` guard to discard the greeting and cross-idle pairings.

4. **State the test conditions unprompted.** Hand-placed test calls, staging
   agent, laptop in India hitting US providers. LLM TTFT runs ~120ms high and
   TTS ~44ms high purely from distance. These are not production aggregates.

5. **The sequential baseline.** 6 Jul: 649 / 418 / 928 / 139 → 1891 perceived.
   Sum ≈ perceived. Nothing overlapped.

6. **The Flux A/B, single variable.** Same agent, same hardware, same LLM and
   TTS: nova-3+EOU → Flux @0.5 moved EOU 556 → 201ms (−64%) and perceived
   2034 → 1638ms (−19%).

7. **The 0.7 threshold regression, and why it's interesting.** At the plugin
   default, EOU went to 1.07s — worse than baseline. Per-turn samples were
   bimodal: clean sentence-ends at 270–480ms, mid-thought pauses at 1.0–1.4s.
   The model was correctly waiting on unfinished speech and the p50 punished
   it. Lowering commit to 0.5 cut the slow cluster.

8. **The tail matters more than the median.** A global `reasoning_effort:
   minimal` was overriding what gpt-5.4-mini wanted (`none`). Median was fine
   at 1.07s; one turn spiked to **6.26s**. Fixing it: max 6.26 → 1.87, and
   worst-case perceived dropped **3.0 seconds**.

9. **The honest disappointment.** Fixing endpointing shrank the window
   preemption needed. Flux commits so fast the eager signal arrives ~20–40ms
   before commit. Expected ~600ms of overlap; measured ~250ms. Two
   optimisations competing for the same 400ms.

10. **What is not measured.** Speculation waste has no counter. A discarded
    generation's tokens are priced identically to a used one. Say this rather
    than estimate it.

---

## 3 · Failure Handling
*Kills: "What happens when it breaks at 2am?"*
**~20 min, combined with §4.**

1. **Five chains, stated plainly.**
   STT default: nova-3 → gpt-4o-mini-transcribe.
   STT extra: soniox → nova-3 → gpt-4o-mini-transcribe (a strict superset, by
   design, so an outage lands on exactly what runs today).
   STT Flux: **none**.
   TTS: primary → second instance of the same provider+voice → OpenAI alloy.
   LLM: primary → gpt-4o-mini.

2. **Why the TTS standby is the same voice.** A dropped ElevenLabs socket used
   to fail over to OpenAI alloy — the agent changed voice mid-call. Now the
   first standby is a reconnect in the caller's own voice; OpenAI is last
   resort only.

3. **Why the STT fallback model changed.** whisper-1 hallucinates text on
   silence — it invented words during quiet stretches, corrupting the
   transcript and the LLM context. A fallback that appears to work is worse
   than one that visibly fails.

4. **Failover is loud on purpose.** `STT FAILOVER: … Investigate Deepgram.`
   A silent swap is how the whisper corruption went unnoticed. Construction of
   a standby is deliberately quiet, because it used to fire on every call and
   looked like a failure.

5. **Timeouts chosen, not inherited.** TTS connect 3s / 1 retry (down from the
   SDK's 10s × 3). LLM 30s, 1 retry. Greeting playout 30s. AMD 1.5s. Custom
   tool 5s. DB query 15s. Each has a recorded reason.

6. **The machine-detection LLM fails open** to "human" — hanging up on a real
   person is the worse failure.

7. **What is deliberately unprotected, and why.** Flux has no fallback,
   accepted for A/B measurement purity and never revisited. An agent already
   on OpenAI TTS or gpt-4o-mini has nothing below it.

8. **A DB failure can never break a call.** `safe_task` wraps every
   fire-and-forget job, logs and reports failures, and holds a strong
   reference so the task isn't collected mid-flight.

9. **Carrier rejection ≠ no answer.** These used to return the same value.
   Six days of 100% transfer failure looked exactly like nobody picking up.

10. **Unknown ≠ success.** The outcome classifier used to fail *open* to
    "completed," which ended cadences on calls that were actually voicemail.

---

## 4 · Monitoring & Observability
*Kills: "Would you even know it broke?"*
**He asked for this by name. It never came up on call 1.**

1. **Eight Prometheus metrics.** Name them; don't inflate the list.

2. **Per-stage latency + perceived response** emitted per turn, accumulated
   per call, and sent to a dev webhook.

3. **Per-call cost breakdown stored on the call row** — token counts, TTS
   characters, STT seconds, and the rate card used. Measured from SDK metrics
   events, not estimated. This means cost questions are a query, not a
   re-estimate.

4. **Heartbeat + container healthcheck.** Each loop touches `/tmp/heartbeat`
   per tick; the healthcheck fails if the file is >3 minutes old. A wedged
   engine now shows `(unhealthy)` in `docker ps` within minutes.

5. **Why that exists.** `run_forever()` catches every tick exception, so the
   process almost never exits — making `restart: always` useless as recovery.
   A wedged tick froze the loop while the container stayed "Up." Engine stalls
   Friday evening → no cadence calls all weekend, and the only symptom is
   silence.

6. **Audit middleware** logs every mutating request — actor, action, resource,
   status, IP, request ID.

7. **Sentry** on every background task failure.

8. **Structured outcomes** per call — promised / refused / wrong number /
   voicemail / transferred / needs-LO — so quality is queryable, not anecdotal.

9. **The general lesson, stated as a principle.** A per-stage metric measures
   only the attempts that *succeeded*. The failure that hurts callers is the
   one that never emits a data point. That's why perceived response is
   measured directly.

10. **What's still missing.** No alerting rules wired to a pager. No
    speculation-waste counter. No false-interruption count. Say so.

---

## 5 · Scale — tested vs designed
*Kills: "Does this survive our volume?"*
**Your weakest answer on call 1. Rebuild it around honesty.**

1. **Lead with the split.** ~5–10 concurrent calls are *proven today*. 200
   concurrent is *designed-for* — GKE + KEDA autoscaling, LiveKit Cloud,
   pooled Supabase, HA Redis — and **not yet load-tested**. Say which is which
   before he asks.

2. **Concurrency is the constraint, not throughput.** 50 simultaneous calls is
   hard; 50,000 a month is not. Every per-call cost is independent — there's
   no shared queue to saturate.

3. **Latency is flat with volume.** Call 10 and call 10,000 cost the same
   milliseconds, because nothing is batched or queued across calls.

4. **Worker pods pre-warm ahead of TCPA calling windows** so the first call of
   the day isn't the cold one.

5. **What breaks first, in order.** Carrier calls-per-second limits →
   model provider rate limits → worker pod scheduling latency → DB
   connections. Compute is last.

6. **Model rate limits hit before compute does.** Needs dedicated quota or
   fallback chains, and the fallback chains already exist.

7. **Spam labelling at volume.** High call volume from one number gets flagged
   by carriers. Needs number rotation and branded caller ID — a real
   operational concern most vendors don't raise.

8. **Per-tenant concurrency caps, Redis-enforced across replicas.** Both the
   account cap and the per-workflow cap gate dialing, and the lower wins.

9. **The exit gate that was defined but not yet run.** p95 turn latency < 1.2s
   and p99 < 2.0s at 2,000 concurrent, with a documented cost-per-minute.
   That's the load test that hasn't happened.

10. **What you'd need from Addy to prove it.** Their expected call mix and peak
    concurrency, then the load test runs against real numbers instead of
    guesses.

---

## 6 · Production-Readiness Gap Analysis
*Kills: "How far is this from shippable?"*

1. **Frame it as a table, not prose.** Exists / missing for Addy / tested vs
   designed.

2. **What exists and is proven.** Inbound and outbound telephony, warm transfer
   with spoken briefing, voicemail detection, mid-call tools, consent gating,
   audit logging, per-call cost tracking, multi-tenancy, fallback chains.

3. **What exists but is under-tested.** Autoscaling, 200-concurrent design,
   carrier failover under real load.

4. **What's missing for Addy specifically.** Encompass/MeridianLink connectors,
   the checklist→brief mapping, the AskAddy tool interface, extension
   integration, their auth and tenancy model.

5. **What's missing generally.** Alerting wired to a pager, speculation-waste
   accounting, a labelled false-interruption count.

6. **Security posture.** RBAC, audit, retention purge, DSAR export/erasure all
   exist. SOC 2 is a process, not a feature — Addy is Type 2, so this becomes
   a joint conversation.

7. **The four-week plan buys** a working call path, deployed, integrated with
   Addy, validated on real files with real loan officers.

8. **What four weeks does NOT buy.** A load-tested 200-concurrent deployment,
   SOC 2 evidence, or two LOS integrations. Be explicit.

9. **The honest sequencing.** Ship narrow and working, then broaden. Phase one
   outbound-only deliberately sidesteps the hardest browser constraint.

10. **What would change the estimate.** Their auth model, their checklist
    schema, and whether MeridianLink is in scope alongside Encompass.

---

## 7 · Live Demo
*Kills: "Does it actually work?"*

1. **Test screen-share-with-audio before the call.** This failed on call 1 and
   cost 45 seconds plus impact.

2. **Fix the $4,100 / $4,200 mismatch** between the agent's speech and the file.

3. **Open on the platform mock** — loan officer pipeline, Sarah Mitchell
   selected, conditions visible in the sidebar.

4. **Run the call.** You play the borrower.

5. **Hit the escalation branch** — "I don't have that statement" → the agent
   offers the loan officer and transfers. Confirm this actually fires
   beforehand; it was fabricating availability.

6. **Switch to Rosa Alvarez** — different agent key, same interface. Shows
   per-file agent routing.

7. **Then show the code.** He will ask. Have files bookmarked:
   the pipeline construction, the fallback chains, the incident comments.

8. **Show the dashboard after the call** — transcript, structured outcome,
   sentiment, per-call cost breakdown with the rate card.

9. **Show an agent config** — system prompt, variables, enabled tools.

10. **Offer failure injection if the room is going well.** Kill a provider
    mid-call and let him watch the failover. High risk, very high reward with
    an engineer.

---

# TIER 2 — WINS THE ROOM

## 8 · The AskAddy Tool Interface ⭐
*Kills: "Did you listen to my CEO?"*
**Michael designed this himself. Arriving with a shape for it is the single
highest-leverage thing on the board. Close the meeting on it.**

1. **Restate his own words back.** "Ask Addy voice agents, can you go make
   this call to do the document collection?" — voice as a callable tool inside
   AskAddy, not a product bolted alongside it.

2. **The core design decision: it's async.** A call takes minutes; a tool call
   returns in milliseconds. The tool returns a handle immediately, not a
   result.

3. **Tool input schema.** Loan file ID, borrower contact, the conditions to
   chase, an optional instruction, and a callback target.

4. **Tool output, immediate.** `call_id`, accepted/rejected, and the reason if
   rejected — no consent, outside calling hours, lines busy, quota.

5. **Result delivery, later.** Webhook back to Addy, or AskAddy polls. Carries
   the structured outcome, transcript, recording URL, documents received, and
   what the agent promised the borrower.

6. **The composition principle.** AskAddy decides *whether* and *why* to call.
   Voice decides *how*. Neither owns the other's job — which is also why
   nothing about the loan file moves out of Addy.

7. **Error contract.** Every failure mode returns a distinct value. No
   collapsing carrier rejection into no-answer — you already have the scar
   from that one.

8. **Idempotency.** An idempotency key on the tool call, so an AskAddy retry
   doesn't dial the borrower twice. You have a production incident on exactly
   this: two enrollments from `4155551212` and `+14155551212`.

9. **Guardrails the tool enforces, not the model.** Consent checked before the
   dial. Calling-hours window. Per-tenant concurrency. The LLM asking for a
   call does not mean a call happens.

10. **Why this is the right shape for Addy.** It makes voice composable with
    everything they already have — SMS, email, the checklist — instead of a
    parallel product. Voice becomes a capability their existing agent layer
    can reach for.

---

## 9 · War Stories
*Kills: "Have you actually run this?"*
**Not a section you present. A bank you draw from during §3 and §4.**

1. **11.7s of dead air, every metric green.** llm_ttft 531ms, tts_ttfb 108ms,
   perceived 11.7s. The ElevenLabs 1006 family: socket connects, never yields
   audio. TTFB can only be recorded on a stream that produced a first byte —
   the histogram was measuring survivors. Fix: 3s timeout, 1 retry.

2. **65 seconds of billed silence, 36 of 39 calls.** Same wedged stream.
   `session.say(opener)` awaited with no timeout. Outcome recorded as
   `silence_timeout`, which reads like the human said nothing. The tell was
   empty transcripts — the agent never spoke at all.

3. **Six days, 6 of 6 warm transfers failed.** Every tenant, inside business
   hours, while Call Now worked fine. A platform caller ID resolved to a stale
   trunk from the carrier migration; the carrier rejected instantly, which
   returned the same value as no-answer. Lost the best inbound lead of the
   week.

4. **The reasoning-effort tail.** Global `minimal` overriding the model's own
   `none`. Median fine at 1.07s, one turn at 6.26s. Fixed: max 1.87s,
   worst-case perceived −3.0s.

5. **The four-commit regression cascade.** Persistence reorder → outbound
   completing instantly without ringing → away policy killing calls mid-ring
   at 30s → away policy suppressed forever, 10 minutes of silence on Bill's
   call. Each fix caused the next. The version that held stopped trusting a
   boolean and checked the actual room roster.

6. **Half of "completed conversation" was the agent talking to a recording.**
   Voicemail detection matched fixed phrases; STT clips machine greetings and
   carriers use unseen wording. The outcome taxonomy was flattering itself.

7. **The agent hung up on a live human-to-human handoff.** Merge at 12:49:27,
   agent said "thank you for your time" at :28, call ended at :28. The tool
   returned a status string to the *model*, which read as task-complete. Fix
   escalated from prompt → tool-result instruction → `StopResponse`. Every
   "please don't" eventually has to become "cannot."

8. **The caller heard their own private briefing.** `move_participant` returns
   when LiveKit *accepts* the move, not when it has happened. The briefing
   started while the caller was still in the room.

9. **PSTN hangups were never detected.** The disconnect guard matched
   identities starting with `user-` — the browser prefix. SIP participants are
   `phone-+1714…`. The guard had never matched a single phone call since the
   day it was written.

10. **Ghost dials.** `restart: always` resurrected manually stopped containers
    on reboot, and three compose stacks shared one database — so a stale stack
    legitimately won atomic claims and dialed real leads with the wrong code.
    Fix: `restart: unless-stopped` plus a hard `DIALING_ENABLED` gate.

---

## 10 · Known Gaps — self-declared
*Kills: "What are you hiding?"*
**Present this immediately after §6. Handing an evaluator the list changes the
dynamic from interrogation to collaboration.**

1. **Flux has no STT fallback.** Accepted for A/B measurement purity, never
   revisited. A Deepgram outage leaves a Flux agent deaf mid-call. This is a
   live risk and it's documented as one.

2. **The legacy agent editor still ships pre-loosening turn-taking values** and
   sends them on every save — the exact failure class the parity test was
   written to prevent. The test only covers the new editor.

3. **The 0.5 eot_threshold isn't in the codebase.** It lives as a per-agent
   JSONB value on the staging agent. The default still reads 0.0 (= plugin
   0.7). Also the clamp floor is 0.3, below Deepgram's documented 0.5 minimum,
   and nothing explains why.

4. **Speculation waste is never counted.** No metric, no log line. Discarded
   tokens are priced identically to used ones.

5. **`gpt-5.5` and three others are missing from the reasoning-none list** —
   all selectable in the frontend, all would receive `minimal`, the exact
   setting that produced the 6.26s spike.

6. **No gpt-5.x rows in the cost model.** The recommended voice model falls
   through to the gpt-4.1-mini rate and is under-costed on output by ~2.8×.

7. **Only `tts_conn_options` is overridden.** STT and LLM connect options sit
   at SDK defaults with no comment explaining why. That's a gap, not a
   decision.

8. **No alerting wired to a pager.** Metrics and heartbeats exist; nobody gets
   woken up.

9. **False-interruption reduction was never quantified.** The mechanism is
   confirmed; a hard count needs a labelled transcript pass that hasn't been
   done.

10. **The 200-concurrent figure is validated-by-design, not in fact.** The load
    test is defined and hasn't been run.

---

## 11 · Cost Model & Unit Economics
*Kills: "Can we make margin on this?"*

1. **Measured from one real 64-second call**, not estimated: 889 TTS
   characters, 18,187 prompt tokens at 58% cached, 191 completion tokens.

2. **Flash v2.5: $0.058/min. Turbo: $0.079/min.** Component breakdown
   available per line.

3. **TTS dominates at ~36–53% of the call.** Everyone assumes the LLM is
   expensive; it's about 5%.

4. **Flash over Turbo saves 26% of variable cost**, halves the TTS line, and
   doubles concurrency headroom on the same ElevenLabs plan. Turbo is also
   deprecated.

5. **V3 Conversational costs latency, not money.** Same price, ~200ms more per
   turn. That makes it a per-call-type choice rather than a budget choice.

6. **Flux is knowingly more expensive than nova-3** — $0.0065 vs $0.0048,
   +35%. Bought for latency and interruption quality, not price, and the −64%
   endpointing justified it.

7. **Every call stores its own usage and rate card.** Re-deriving cost across a
   real week is a query, not a re-estimate.

8. **COGS and revenue are separate numbers on purpose.** `total` is estimated
   provider cost; `billed_usd` is the flat customer rate. The code comments
   say so explicitly.

9. **At ~$0.10 billed against ~$0.06 cost, that's a 39–61% margin** — and it
   drops to 30–49% with recording on. State it honestly.

10. **Managed platforms run $0.13–0.25/min** for the same call. The gap is
    roughly 3× and it scales with every seat.

---

# TIER 3 — ANSWERS THE NEXT QUESTION

## 12 · Integration Architecture
1. Checklist condition → call brief, automatically. Their output is your input.
2. Encompass and MeridianLink as first-class connectors; scope differs if both.
3. The Chrome extension MV3 trap — service workers sleep, media session dies.
4. Offscreen document is the supported path (DOM + getUserMedia).
5. Phase one is outbound-only, so the browser never touches the mic and the
   hardest constraint is sidestepped entirely.
6. Auth and tenancy reuse Addy's existing model — no second login.
7. Write-back: condition status, transcript, recording, structured outcome.
8. Webhooks both directions.
9. Addy stays system of record. Voice never owns the loan file.
10. The coexistence principle, already shipped elsewhere: their system keeps
    running its own flows; voice writes outcomes back.

## 13 · Security & Compliance
1. FCC 2024 ruling put AI voice under TCPA's artificial-voice rules.
2. $500/call statutory damages; Feb 2026 class action against a lender whose
   *vendor* dialed without proper consent.
3. Consent checked before every dial, per contact, and logged.
4. AI disclosure in the opening line; recording notice configurable per state.
5. Audit middleware on every mutating request.
6. RBAC via a role dependency.
7. Retention purge sweeper; DSAR export and erasure.
8. Secrets encrypted at rest; per-tenant isolation.
9. Servicing calls and marketing outreach are different call classes with
   different gates.
10. Not their counsel — compliance sets policy, you build enforcement.

## 14 · Model Selection & Tradeoffs
1. Three config layers: code default → env → per-agent DB.
2. TTS default is Flash v2.5 — price, latency, concurrency headroom, and Turbo
   is deprecated.
3. V3 Conversational offered but not default: ~200ms, same price.
4. STT default nova-3; Flux per-agent for latency; Soniox for price and
   60-language auto-ID.
5. Soniox and the admin engines do *not* decide turns — they finalise text
   sooner and run in the nova-3 lane.
6. LLM migration to gpt-5.x was mandatory — gpt-4o shuts down 2026-10-23.
7. The gpt-5.4-mini hypothesis (TTFT 1.05 → 0.5–0.7s) **did not hold.** Median
   was flat. Only the tail improved.
8. Post-call analysis and machine detection both run on a mini model.
9. Provider abstraction makes all of this config, not code.
10. Open inconsistency: the Soniox price claim appears in two code comments and
    nowhere else, and there's no Soniox row in the cost model.

## 15 · Turn Detection — deep dive
1. Three lanes, one decider: Flux EOT, the EOU model, or the VAD silence timer.
2. Flux is model-integrated — it judges from audio *and* meaning.
3. Only Flux emits the eager signal that preemptive generation needs. Everything
   else just finalises text sooner.
4. The eager signal's transcript is *guaranteed to match the final* — that's
   what makes it safe to start the LLM on.
5. `eager_eot_threshold` 0.4 starts the LLM; `eot_threshold` commits the turn.
6. What was wrong with the VAD timer: 1 word / 0.5s floor cut callers off — a
   cough, an "um", or an STT artifact counted as an interruption.
7. Loosened to 2 words / 1.0s / 0.7s floor / 4.0s ceiling. Costs ~0.2s of
   responsiveness in exchange for not stepping on people.
8. **The config then silently reverted itself** — the editor sent stale defaults
   on every save. Now guarded by a test that parses the `.tsx` directly.
9. The bimodal finding at 0.7 threshold — the model correctly waiting on
   unfinished speech, punished by the median.
10. Flux is deliberately not wrapped in a FallbackAdapter, for measurement
    purity. Specified in advance, pinned by a test, and a documented live risk.

## 16 · The Plan
1. Four weeks, rebuilt for what Jay now knows.
2. Week 1 — scope, workflows, pipeline, consent model. **A real call by Friday.**
3. Week 2 — SIP, tools, deploy, observability. A live URL their team can use.
4. Week 3 — checklist→brief, the AskAddy tool interface, write-back.
5. Week 4 — pilot with 2–3 LOs on live files, tuned from recordings.
6. Accounts in Addy's name from day one.
7. What's needed from them: sandbox LOS creds, checklist schema, consent policy
   sign-off, pilot LOs.
8. Decisions that change scope: MeridianLink in or out; feature vs separate SKU.
9. What four weeks does not buy — say it again here.
10. The close: what would you need to see in four weeks to call this working?

---

# TIER 4 — COMMERCIAL

**Michael asked for all of these by email. Decide the positions before the call.**

## 17 · How I Work
1. Individual contractor or through a company — decide and be consistent.
2. Based in Pune, India (IST).
3. Overlap hours with a US team — state the real window.
4. Availability — hours per week, start date.
5. Communication cadence — daily async, weekly sync.

## 18 · Pricing Model
1. Options: hourly, monthly retainer, or milestone-based on the four weeks.
2. Recommend one; don't present a menu.
3. What's included and what isn't.
4. Infrastructure costs are theirs, in their accounts, from day one.
5. How scope changes are handled.

## 19 · IP & Contract Position ⚠️
1. **Decide this before the call.** The intro came from inside Addy; this may
   be closer to the real agenda than the contract.
2. Work-for-hire on what's built for Addy is the normal expectation.
3. Be clear about what pre-exists and is not assignable.
4. Licence vs assignment vs something longer-term — one sentence each.
5. Don't improvise this at the table.

## 20 · References & Prior Work ⚠️
1. **This is the exposure point.** Michael asked directly.
2. Client work is under NDA — that's a real and normal answer.
3. The honest version: describe capability, offer the system for inspection,
   don't name clients you can't produce.
4. Do not repeat the "big system for the mortgage industry" claim from call 1.
   It isn't true and Michael may have relayed it.
5. What you *can* offer: full code walkthrough, live system access, and a
   build-in-public first week so they see the work rather than take references
   for it.

## 21 · What I Need From Addy
1. Sandbox LOS credentials and the checklist output schema.
2. Extension repo access or a documented integration point.
3. Consent policy sign-off — which call classes are in scope.
4. Carrier and model accounts in Addy's name.
5. Two or three pilot loan officers for week four.
6. A technical point of contact for questions during the build.

---

# Run of show

| Time | Sections |
|---|---|
| 0:00–0:10 | Intro, frame the board |
| 0:10–0:35 | §1 Architecture |
| 0:35–0:55 | §2 Latency + §15 Turn detection |
| 0:55–1:15 | §3 Failures + §4 Monitoring |
| 1:15–1:30 | §5 Scale, §6 Readiness, §10 Known gaps |
| 1:30–1:50 | §7 Demo + code |
| 1:50–2:05 | §8 AskAddy tool interface — **the close** |
| 2:05–2:15 | §11 Cost, §16 Plan, §17–21 Commercial |

§12, §13, §14 stay on the board unshown, ready for when he asks.

---

# Five rules for this meeting

1. **Never assert a number you can't decompose.** He will ask where it came
   from.
2. **State test conditions before he asks.** "Laptop in India hitting US
   providers" costs nothing and buys everything.
3. **Say "not measured" rather than estimating.** The unmeasured things are
   named in §10 for exactly this reason.
4. **Weave §9 into §3 and §4.** War stories are evidence, not a section.
5. **Do not repeat call 1's errors:** it's LiveKit not LiveGate, Flux is STT
   not TTS, ElevenLabs is TTS not STT, and there is no mortgage client.
