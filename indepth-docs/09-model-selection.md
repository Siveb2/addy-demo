# Model Selection — explained from zero

*How every model in the stack was chosen, what it cost, and the two places the
hypothesis was wrong. §15 turn-detection detail lives in doc 02; this is the
provider and model layer.*

---

# PART 0 — Why this section exists

Jay will want to know whether the models were **chosen** or **defaulted to**.

The difference shows up in one question: *"why that model?"* If the answer is "it
was in the tutorial," that's a different engineer from one who can say "we tried
the alternative, here's what it measured, here's what it cost."

This section is that answer for every layer.

---

# PART 1 — Three config layers

A model isn't set in one place. It resolves through three:

```
code default  →  environment variable  →  per-agent DB value
   (fallback)        (deployment)            (wins)
```

**Example, TTS:**
- Code default: `eleven_flash_v2_5`
- `.env`: `ELEVENLABS_MODEL=eleven_turbo_v2_5`
- Per-agent DB: `eleven_v3_conversational`

All three can differ, and the most specific wins.

**Why it's built this way:** the code default must be safe for a fresh install.
The env var is the deployment's opinion. The per-agent value is what makes
per-call-type selection possible — which is the whole commercial argument for
owning the stack.

**The practical consequence for the meeting:** when asked "what model do you
run," the honest answer is *"depends on the agent — here's the default and here's
what overrides it."* That's a better answer than a single model name.

---

# PART 2 — The full picture

| Layer | LLM | STT | TTS |
|---|---|---|---|
| DB / API default | `gpt-4o` | `nova-3` | `elevenlabs` |
| Platform default | — | `nova3` engine | `eleven_flash_v2_5` |
| Fallback | `gpt-4o-mini` | `gpt-4o-mini-transcribe` | same voice, then OpenAI `alloy` |
| Post-call analysis | `gpt-4o-mini` | — | — |
| Machine detection | `gpt-4o-mini` | — | — |
| Prompt builder (admin) | `gpt-5.5` | — | — |
| Client-selectable | picker incl. `gpt-5.4-mini` | nova-3, nova-2, flux, soniox | Flash v2.5, V3 Conversational |

Note the **client-selectable TTS list is exactly two.** Not "any ElevenLabs
model" — two, chosen deliberately. Fewer options is a design decision: every
extra one is a way for a customer to make their own calls worse.

---

# PART 3 — TTS: price, latency, concurrency, and a deprecation

## Why Flash v2.5 is the default

Four reasons, and only one of them is price:

1. **Half the cost** — $0.0208/min vs $0.0417
2. **Lower latency** — ~1.40s perceived vs ~1.55s
3. **Doubles concurrency headroom** on the same ElevenLabs plan
4. **Turbo is deprecated** — you're paying double for a model being retired

From the pricing doc: *"Saves $62–625/mo depending on volume, doubles concurrency
headroom, and Turbo is a deprecated model you're paying double for."*

**The concurrency point was judged the bigger win.** Worth saying — it shows the
decision wasn't purely a cost exercise.

## V3 Conversational — offered, not default

| | |
|---|---|
| Price | **Same as Turbo** |
| Latency | **~200ms more per turn** |
| What it adds | Audio-tag expressiveness — sighs, chuckles, emotion |
| Constraint | Honours only the Stability slider |

From the agent editor's own help text: *"Expressive = V3 Conversational
(audio-tag expressiveness, ~200ms more per turn, same price, honours only the
Stability slider)."*

**So it's a latency decision, not a budget one.** Which makes it a genuine
per-call-type choice:

- Reminder to someone expecting the call → Flash
- First contact with a borrower who doesn't know you → V3

---

# PART 4 — STT: where we deliberately spent more ⭐

This is the most useful thing in the section, because it breaks the pattern.

| Model | Cost/min | vs nova-3 |
|---|---|---|
| Nova-3 | $0.0048 | baseline |
| **Flux** | **$0.0065** | **+35%** |

From the pricing doc:

> **Flux is *more* expensive than Nova-3** ($0.0065 vs $0.0048, +35%). Flux is a
> conversational-turn-aware model, **not a cheaper one** — the voice-v2 work
> adopted it for **latency/interruption quality**, and that upgrade costs
> ~$0.0017/min.

**We paid 35% more on STT to get a 64% endpointing improvement.**

**Why to lead with this:** if every model choice in your stack is the cheap
option, a reviewer assumes you optimised for cost and hoped quality followed. One
deliberate spend-up proves the choices were actually evaluated.

## The engines, and what each actually does

| Engine | Decides the turn? | Why it exists |
|---|---|---|
| **Flux** (`flux-general-en`) | **Yes** — model-integrated EOT | Latency + interruption quality |
| **Nova-3** | No | Default. Multi-language |
| **Nova-2** | No | Slightly faster, older |
| **Soniox** (`stt-rt-v5`) | No | Price + 60-language auto-ID |
| Admin-only: ElevenLabs Scribe, Inworld, xAI, Gradium | No | Evaluation |

**Only Flux decides turns.** Everything else finalises text sooner and runs in
what the code calls the nova-3 lane, where VAD or the EOU model still decides.

That constraint appears in **three separate places** in the code — which tells you
how often it got misread.

**Flux is English-only**, so multi-language agents stay on nova-3 regardless of
the flag.

---

# PART 5 — LLM: a forced migration and a wrong hypothesis

## The migration wasn't optional

**gpt-4o shuts down 2026-10-23.** So the move to gpt-5.x was a deadline, not a
choice.

## The hypothesis, and why it was wrong ⭐

**Expected:** gpt-5.4-mini would cut `llm_ttft` from ~1.05s to 0.5–0.7s, based on
its stated low-latency profile.

**Measured:** median TTFT went 1.073 → 1.021. **Flat.**

Only the *tail* improved — and only after the reasoning-effort fix.

**Say this plainly.** A migration that was supposed to help latency and didn't is
a much better story than one that went to plan, because it demonstrates you
measured rather than assumed.

## Where the residual actually goes

From the results doc:

> ~1.0s TTFT for gpt-5.4-mini is **network-bound from this box.** The worker is on
> a Mac in **India South** hitting OpenAI US — that round trip alone is a big
> chunk of the 1.0s.

**That's a hypothesis the deployment was supposed to test and hasn't.** Say it as
a hypothesis, not a fact.

## The reasoning-effort trap

Covered fully in doc 02, but it belongs here as a model-selection lesson:

```python
_REASONING_NONE_MODELS = ("gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini")
```

We forced `reasoning_effort="minimal"` globally. The plugin's model-correct
default for these is `"none"`. **"Minimal" still permits deliberation** — most
turns it doesn't, occasionally it does, and on a voice call that's a 6.26-second
reply.

**A global "make it fast" setting was slower than the model's own default.**

### The gap in that fix

`_REASONING_NONE_MODELS` lists four models but **not** `gpt-5.5`, `gpt-5.5-pro`,
`gpt-5.4-pro` or `gpt-5.4-nano` — **all four selectable in the frontend**, and all
would receive `"minimal"`, the exact setting that produced the spike.

One line to fix. Not done.

## Where mini models are used deliberately

- **Post-call analysis** — summary and sentiment. Not latency-sensitive.
- **Machine detection** — bounded at 1.5s, only ever on the first two turns,
  **fails open to "human"** because hanging up on a person is the worse failure.
- **Fallback LLM** — gpt-4o-mini when the primary 5xxes mid-turn.

---

# PART 6 — Why the provider abstraction matters commercially

Every provider sits behind a factory function: `get_stt()`, `get_llm()`,
`get_tts()`.

**Technical consequence:** swapping a provider is a config change, not a code
change.

**Commercial consequence — the one that matters:** it's what makes per-call-type
model selection possible at all.

| Call type | TTS | LLM | Why |
|---|---|---|---|
| Appointment reminder | Flash | mini | Cheap, fast, nobody's listening for warmth |
| Document chase | Flash | mini | They're expecting the call |
| First contact | V3 | standard | Worth 200ms for expressiveness |
| Multi-language | Multilingual | standard | Flux is English-only |

**On a bundled platform you take their one tier.** That's the argument, and it's
the same argument as the 3× cost point from a different angle — two independent
reasons converging on the same architecture.

---

# PART 7 — Open inconsistencies

Name these; they're specific and they're real.

**1. The Soniox price claim has no source.**
"~1/4 of nova-3's per-hour price" appears in exactly **two code comments and
nowhere else.** No vendor rate, no pricing-doc row, no measured figure.

**2. And `cost_model.py` has no Soniox row**, so a Soniox call is still costed at
nova-3's $0.0048/min. The cheaper engine is being billed at the more expensive
rate.

**3. No gpt-5.x rows in the rate table at all.** The recommended voice model falls
through to gpt-4.1-mini's rate and is **under-costed on output by ~2.8×.**

**4. `gpt-5.5` and three siblings missing from the reasoning-none list.** Covered
above. One line.

**5. The 0.5 EOT threshold isn't committed.** It lives as a per-agent DB value on
staging. The default still reads 0.0 — meaning the plugin's 0.7, which measured
as a regression.

**All five are minutes-to-hours of work.** Which is worth saying: these aren't
architectural problems, they're maintenance that lost to feature work.

---

# PART 8 — Questions Jay will ask

**"What models are you running?"**
Depends on the agent, and that's deliberate. Default TTS is ElevenLabs Flash
v2.5, STT is Deepgram nova-3 with Flux available per-agent, LLM is the
gpt-5.4-mini class. But each resolves through three layers — code default, env
var, per-agent value — because per-call-type selection is the point.

**"Why Flash and not Turbo?"**
Four reasons. Half the price, lower latency, doubles concurrency headroom on the
same plan, and Turbo is deprecated so you're paying double for a model being
retired. The concurrency point was actually the bigger win.

**"Why did you pick a more expensive STT?"**
Flux is 35% more than nova-3. We bought it for latency and interruption quality,
not price, and it measured a 64% endpointing improvement — 556 to 201
milliseconds on identical hardware. That's the one place we deliberately spent
up.

**"Did gpt-5.4-mini help?"**
Less than expected, and I can show you. The hypothesis was TTFT dropping from
1.05 to 0.5–0.7 seconds. Median went 1.073 to 1.021 — flat. Only the tail
improved, and only after fixing a reasoning-effort setting we'd got wrong. The
residual is probably network distance from the test box, but that's a hypothesis
the deployment was supposed to test and hasn't.

**"How do you decide which model for which call?"**
It's config per agent, which is only possible because providers sit behind
factories. A reminder call to someone expecting it gets Flash and a mini model.
First contact with a borrower who doesn't know you might get V3 Conversational —
same price, 200 milliseconds more, and worth it there.

**"What's wrong with your model config today?"**
Five things, all small. gpt-5.5 and three siblings aren't in the reasoning-none
list, so they'd get the setting that caused a six-second spike. There are no
gpt-5.x rows in the cost model, so the recommended model is under-costed about
2.8× on output. There's no Soniox cost row, so it's billed at nova-3's rate. And
the 0.5 EOT threshold that measured best isn't committed — it only exists on the
staging agent.

---

# PART 9 — The five things to land

1. **Three config layers.** Code default, env, per-agent. The most specific wins,
   and that's what makes per-call-type selection possible.

2. **Flash over Turbo for four reasons**, and the concurrency headroom mattered
   more than the price.

3. **We spent 35% more on STT deliberately** and got a 64% endpointing
   improvement. Not everything was optimised for cost.

4. **The gpt-5.4-mini hypothesis was wrong.** Median TTFT was flat. Saying that
   is worth more than a migration that went to plan.

5. **Five open inconsistencies, all small.** Missing cost rows, a missing model
   in the reasoning list, an uncommitted threshold. Maintenance that lost to
   feature work.
