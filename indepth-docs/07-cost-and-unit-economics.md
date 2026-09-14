# Cost & Unit Economics — explained from zero

*Every number here comes from a measured call with its usage stored on the call
row, or from a pricing doc in the repo. Where a figure is an estimate, it says
so.*

---

# PART 0 — Why this section matters to Addy specifically

Michael's team sells to mortgage lenders. A voice feature has to have margin in
it, or it's a cost centre bolted onto a product.

So this section answers three questions:

1. **What does a call actually cost?**
2. **What drives that cost?** (The answer surprises people.)
3. **What can you do about it?**

And one meta-question, which is really what Jay is checking: **do you know your
own numbers, or are you quoting a vendor's marketing page?**

---

# PART 1 — The measurement, not the estimate

## Every call stores its own cost

This is the thing to lead with, because it's unusual.

Each call row carries:
- LLM prompt / completion / cached token counts
- TTS characters synthesised
- STT audio seconds
- **The rate card that was in effect**

All measured from SDK metrics events, **not estimated from duration.**

Two consequences worth stating:

**"What does a call cost" is a query, not a re-estimate.** We don't multiply
minutes by an assumption — we sum what was actually consumed.

**Storing the rate card means a price change doesn't rewrite history.** If
ElevenLabs doubles their price tomorrow, last month's calls still cost what they
cost.

## COGS and revenue are deliberately separate

From the cost model's own comment:

> `total` is the sum of components — the **ESTIMATED provider cost** of the call.
> `billed_usd` stays the flat customer-facing rate. **They are different numbers
> on purpose: one is COGS, one is revenue.**

That separation exists because conflating them is how you end up with a margin
you can't explain.

---

# PART 2 — The measured breakdown

From one real 64-second call: 889 TTS characters, 18,187 prompt tokens at 58%
cached, 191 completion tokens.

| Component | Turbo | Flash v2.5 |
|---|---|---|
| **TTS (ElevenLabs)** | **$0.04165** | **$0.02083** |
| Twilio outbound | $0.01400 | $0.01400 |
| LiveKit agent session | $0.01000 | $0.01000 |
| Deepgram Nova-3 | $0.00480 | $0.00480 |
| LiveKit SIP | $0.00400 | $0.00400 |
| OpenAI gpt-4.1-mini | $0.00420 | $0.00420 |
| Post-call analysis | $0.00020 | $0.00020 |
| **Total** | **$0.0789** | **$0.0580** |

A second independent estimate on the gpt-5.4-mini stack lands at
**$0.062–0.072/min**, which is a useful cross-check.

## The list-price view

The pricing doc gives a wider range, because list prices differ from what you
actually pay at volume:

| Component | Cost/min | Driver |
|---|---|---|
| ElevenLabs Turbo TTS | $0.06–0.13 | Per character — **usually the largest** |
| OpenAI LLM | $0.010–0.020 | Grows with context length |
| LiveKit Cloud | $0.008–0.012 | ~$0 self-hosted |
| Deepgram Nova-3 | $0.007–0.009 | Full audio minute |
| Twilio PSTN inbound | ~$0.0085 | +$1/mo per number |
| Infra amortised | $0.002–0.005 | Supabase, Redis, compute |

**Phone call typical: ~$0.13–0.14/min at list. Web call: a bit less, no Twilio
leg.**

**Be precise about which number you're quoting.** The $0.058 is a measured call
on Flash. The $0.13–0.14 is list price on Turbo. Both are true; they're not the
same thing.

---

# PART 3 — The counterintuitive fact ⭐

## TTS dominates. The LLM is almost free.

| Line | Share of a Turbo call |
|---|---|
| **TTS** | **~53%** |
| Telephony | ~18% |
| LiveKit | ~18% |
| STT | ~6% |
| **LLM** | **~5%** |

**Everyone assumes the model is the expensive part.** It's about a twentieth of
the call.

## Why TTS is so expensive

It's priced **per character**, which means it scales with **how much the agent
talks**, not with clock time.

That has a real design consequence: a verbose agent costs more than a terse one,
on the same call duration. Prompt engineering is a cost lever, not just a
quality lever.

**The line to say:** *"Everyone optimises the model. The model is five percent.
TTS is half the call, and it's priced per character — so how much your agent
talks is a direct cost input."*

---

# PART 4 — The levers, in order of effect

## 1. TTS model — the biggest single lever

| Model | Cost/min | vs Turbo |
|---|---|---|
| Flash v2.5 | $0.0208 | **−50%** |
| Turbo v2.5 | $0.0417 | baseline |

**Flash saves $0.0208/min — about 26% of total variable cost — and halves the
biggest line.**

Three reasons it's the default:
- Half the price
- **Lower latency** (~1.40s perceived vs ~1.55s)
- **Doubles concurrency headroom** on the same ElevenLabs plan
- And Turbo is a **deprecated model you're paying double for**

From the pricing doc: *"Saves $62–625/mo depending on volume, doubles
concurrency headroom, and Turbo is a deprecated model you're paying double
for."*

**The concurrency point was judged the bigger win**, which is worth mentioning —
it's not purely a cost decision.

## 2. V3 Conversational — a latency choice, not a budget one

**Same price as Turbo. ~200ms more per turn.**

So the decision is: does this call warrant expressiveness worth 200 milliseconds?
- Chasing a document from someone expecting the call → no, use Flash
- First contact with a borrower who doesn't know you → maybe yes

**That's a product decision expressed as config**, and it's only available
because providers sit behind factory functions.

## 3. LLM model

| Model | Rate (in/out per 1M) |
|---|---|
| gpt-5.4-nano | $0.20 / $1.25 |
| gpt-4o-mini | $0.15 / $0.60 |
| gpt-4.1-mini | $0.40 / $1.60 |
| gpt-4o | $2.50 / $10.00 |

Routing simple turns to a mini model roughly halves the LLM line. Which is 5% of
the call — so it's a real saving on a small number.

**Prompt caching matters more.** The measured call ran **58% cached input**, and
cached tokens are ~5–10× cheaper. Keeping a stable system prompt prefix is worth
more than switching models.

## 4. STT — where we spend *up* deliberately

| Model | Cost/min |
|---|---|
| Nova-3 | $0.0048 |
| **Flux** | **$0.0065** (+35%) |

From the pricing doc: *"Flux is **more** expensive than Nova-3. Flux is a
conversational-turn-aware model, not a cheaper one — the voice-v2 work adopted
it for latency/interruption quality, and that upgrade costs ~$0.0017/min."*

**Worth calling out**, because it shows the choices aren't all cost-minimising.
We paid 35% more on STT to get a 64% endpointing improvement. That's a
deliberate trade, and saying so is more credible than claiming everything was
optimised for price.

## Combined effect

| Configuration | Cost/min |
|---|---|
| Default stack, list prices | ~$0.13–0.14 |
| Optimised — Flash + mini LLM | **~$0.05–0.08** |

**Roughly a halving, and it's config rather than a rebuild** — but only because
nothing is hardcoded.

---

# PART 5 — Owned vs managed

| | Owned | Managed (Vapi/Retell) |
|---|---|---|
| Per minute | **$0.05–0.08** | **$0.13–0.25** |
| Per hour | $3.00–4.80 | $7.80–15.00 |
| 10,000 min/mo | **~$500–800** | $1,300–2,500 |
| 100,000 min/mo | **~$5,000–8,000** | $13,000–25,000 |

**Roughly 3× on cost of goods**, on the line item that scales with every seat.

**But be honest about the trade.** A managed platform is faster to start and
somebody else carries the operational burden. The argument isn't "managed is
stupid" — it's:

> *"At your volume, on the line item that scales with every seat, the difference
> is about 3×. And you only get to pick a different TTS tier per call type if
> you own the stack."*

---

# PART 6 — Margin, honestly

The current billed rate is a flat `cost_per_minute_usd = 0.10`.

From the pricing doc's own assessment:

> That is only a **~39–61% margin** — and it drops to **~30–49% with recording
> on.**

**Quote that.** A vendor who tells you their own margin is thin is a vendor
telling you the truth about everything else.

The doc's recommendation: at ~$0.14/min cost, **retail of $0.30–0.50/min** is a
common gross-margin target. Quotas on minutes and concurrency already exist
specifically to protect that margin.

---

# PART 7 — Fixed vs variable at volume

| Volume | Variable | Fixed | **Total/mo** |
|---|---|---|---|
| 2,000 min | ~$280 | ~$60 | **~$340** |
| 5,000 min | ~$700 | ~$100 | **~$800** |
| 30,000 min | ~$4,200 | ~$300 | **~$4,500** |

**At 30,000 minutes, infrastructure is 7% of the bill.**

Which is the argument for not over-engineering the deployment early: the money is
in the per-minute stack, not the servers.

---

# PART 8 — Known gaps in the cost model

State these — they're specific and they matter.

**1. No gpt-5.x rows in the rate table.**
The recommended voice model falls through to the gpt-4.1-mini rate and is
**under-costed on output by roughly 2.8×.** A one-line fix that hasn't been done.

**2. No Soniox row.**
A Soniox call is still costed at nova-3's rate. And the "~1/4 of nova-3's price"
claim appears in exactly two code comments and nowhere else — no vendor rate, no
pricing row, no measured figure. **That's an open inconsistency, not a finding.**

**3. Usage constants come from ONE call.**
From the source: *"Usage constants (833 TTS chars/min, 17k prompt tokens/min)
come from ONE measured call… Re-derive from `cost_breakdown.usage` across a real
week once the pilot runs — **every call now stores its own usage and rate card,
so this is a query, not a re-estimate.**"*

That last clause is the good part: the fix is running a query, not redoing the
analysis.

**4. Recording cost isn't in the per-minute model.**
LiveKit Egress is ~$0.005–0.01 per recorded minute on top. Storage is
negligible, but the egress line isn't in the table.

**5. Speculation waste is unpriced.**
Discarded LLM generations are summed into prompt tokens identically to used ones.
It's a small number — LLM is 5% of the call — but it's unknown rather than small.

---

# PART 9 — Questions Jay will ask

**"What does a call cost you?"**
About 5.8 cents a minute on our default Flash stack, measured from a real call
with the usage stored on the row. List prices on Turbo put it nearer 13 to 14
cents. I'd rather show you the breakdown than the headline, because the
components are where the decisions are.

**"What's the biggest line?"**
TTS, at roughly half. The LLM is about 5%. That surprises most people —
everyone optimises the model, and the model is the cheap part.

**"Can you get it lower?"**
Yes, roughly halved — cheaper TTS plus routing simple turns to a mini model takes
it toward 5 to 8 cents. It's a config change rather than a rebuild, but only
because nothing is hardcoded.

**"How does that compare to Vapi?"**
Roughly 3× on cost of goods. But the honest version is that managed platforms are
faster to start and someone else carries the operational load. The argument is
that at your volume, on the line that scales with every seat, 3× matters — and
you only get per-call-type model selection if you own the stack.

**"How confident are you in these numbers?"**
The breakdown is measured, not estimated. The usage *constants* come from one
call, which I'd want to re-derive over a real pilot week — and because every call
stores its own usage, that's a query rather than a re-analysis. There are also
two known holes: no gpt-5.x rows in the rate table, so the recommended model is
under-costed about 2.8× on output, and no Soniox row at all.

**"What would you need to model this for us?"**
Expected call mix — average duration, inbound/outbound split, peak concurrency —
and I'd build the real model against that instead of our assumptions. Our numbers
assume a conversational call with the agent talking about half the time; a
monologue-heavy agent costs more.

---

# PART 10 — The five things to land

1. **Every call stores its own cost and rate card.** Cost is a query, not a
   re-estimate.

2. **TTS is half the call. The LLM is 5%.** Everyone optimises the wrong thing.

3. **TTS is priced per character**, so how much the agent talks is a direct cost
   input. Prompt brevity is a cost lever.

4. **We spent *up* on STT deliberately** — Flux is 35% more than Nova-3, bought
   for a 64% endpointing improvement. Not everything was optimised for price.

5. **The margin is thin and we say so.** ~39–61%, dropping to ~30–49% with
   recording on, straight from our own pricing assessment.
