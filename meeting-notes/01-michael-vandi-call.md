# Call 1 — Michael Vandi (CEO, Addy AI)

**Date:** 11 Sep 2026
**Attendees:** Vivek Baraiya, Michael Vandi
**Intro via:** Amraj (recently joined Addy)
**Duration:** ~25 min, cut short — Michael had to leave for the office
**Outcome:** ✅ Advanced to technical interview with Head of Engineering

---

## Result

Michael asked for a follow-up with **João (Jay) Melo, Head of Engineering**,
before the demo had even finished. He called the demo "phenomenal" and the
platform "great." He also asked for commercial terms — contractor vs company,
pricing, IP — which is a buying signal, not a screening question.

Booking link: https://calendly.com/joao-addy-ai

---

## What Michael actually asked for

Ranked by how much weight he put on it.

### 1. Context injection into the call — his first real question

> "We have Addy AI, we process documents, we calculate income, we have all
> that context in the background. We want to be able to tap into that context
> when making the customer call. How do you do that?"

This is the question the whole engagement turns on. Answered with the
system-prompt-plus-variables model: a generalised agent, variables resolved
per lead from the database (name, loan file number, amount, outstanding
documents), so the agent opens already knowing the file.

### 2. A unified tool interface — he proposed the product himself

> "Can we make a unified tool interface? Because we have this product called
> AskAddy. What I want to be able to do is say 'Ask Addy voice agents, can
> you go make this call to do the document collection?' And that would be on
> the tool interface."

**This is the single most important thing said on the call.** Michael is not
asking for a voice vendor — he wants voice exposed as a *tool* his existing
AskAddy agent can invoke. That reframes the work from "bolt voice onto the
product" to "voice becomes a callable capability inside Addy's own agent
layer."

Everything in the Jay conversation should be shaped around this.

### 3. Scale

> "The systems that you have built, how do they scale? Are you doing, like,
> millions of calls?"

Answered with GCP + Kubernetes, worker pods, pre-warming ahead of TCPA
calling windows. **The answer was thin and he moved on.** Jay will not.

### 4. Use-case sequencing — he chose the wedge himself

> "We can attack one of the first use cases, which is the voice calling to
> request documents... I think the doc collection use case is one of the
> primary ones."

Confirms the wedge. Outbound to leads is phase two in his own framing.

---

## What landed

- **Turn-taking explained from first principles** — silence timer, why it
  fails on a thinking pause, then Deepgram Flux giving a probability of
  turn-end from context. Michael: "Yeah" — he knows Deepgram.
- **The parallel pipeline.** Michael: "I see what you mean." The speculate-
  and-discard explanation worked.
- **Mid-call tool calls** — SMS the upload link *during* the conversation.
  Michael echoed it back: "During the call." That surprised him.
- **Voicemail → inbound callback with context re-fetch.** Unprompted, and it
  showed a workflow he hadn't considered.
- **The third-pillar framing** — SMS and email exist, voice joins them on the
  same intelligence layer. Landed without pushback.
- **The demo.** "This is phenomenal." Built overnight, in his brand, with the
  Sarah Mitchell file and a working escalation path.

---

## What went wrong

### Mechanical
- **Audio was not shared.** The first demo run was silent; Michael had to
  explain how to re-share with computer audio. Cost ~45 seconds and a chunk
  of the demo's impact.
- **"LiveGate" instead of LiveKit**, repeatedly. Mispronounced the core piece
  of infrastructure, three times, to an ex-AWS engineer.
- **The agent said $4,100; the file says $4,200.** Michael did not catch it.
  Jay might.

### Substantive
- **Scale answer was weak.** "Worker pods, pre-warm, TCPA windows" is not an
  answer to "do you do millions of calls." No concurrency number, no load
  test, no failure behaviour. This is the single biggest gap for Jay.
- **No war stories were told.** The prepared incidents — 11.7s dead air, six
  days of failed transfers, the reasoning-effort tail — none of them came
  out. These are the strongest credibility material available and they went
  unused.
- **Latency numbers were asserted, not shown.** "1.4 seconds perceived"
  without the breakdown, the overlap explanation, or the measured A/B.
- **Ran out of time.** Cost the second half of the demo and any close.

### Fabrication risk — must not repeat
- Described **Deepgram Flux as TTS** and ElevenLabs models as STT. Reversed.
- Said **"I have a big system for them as well"** when Michael mentioned the
  mortgage industry. There is no mortgage client. Michael may repeat this to
  Jay or to Amraj.

---

## Michael's follow-up email (11 Sep)

> great talking this morning. the voice AI pipeline was helpful to see live,
> especially the approach around turn-taking, SIP trunking/LiveKit routing,
> Deepgram/ElevenLabs, pre-warmed infrastructure, warm transfers,
> SMS/document links, and pulling customer context into the call.
>
> next step is to spend time with Jay/Joao for a deeper technical interview,
> presentation, and evaluation. please use this link to grab time with him:
> https://calendly.com/joao-addy-ai
>
> for that conversation, please be ready to walk through the architecture,
> demo the current system, explain how you handle latency/failures/monitoring,
> and talk through what it would take to get this production-ready for Addy AI.
>
> also, can you send over a little more detail on how you work and operate?
> specifically whether you work as an individual contractor or through a
> company, your availability/time zone, pricing model, contract/IP
> expectations, examples or references from similar work, and what you would
> need from us to move quickly.
>
> we'll compare notes after you and Jay talk.

### What the email tells us

The list of things he found helpful maps exactly to what was explained well.
Nothing about scale, and nothing about reliability — because neither was
covered convincingly.

**The four asks for Jay:**
1. Walk through the architecture
2. Demo the current system
3. Explain latency / failures / **monitoring** ← not covered at all on call 1
4. What it takes to get **production-ready for Addy**

**The commercial asks — answer carefully:**
- Individual contractor or through a company?
- Availability / time zone
- Pricing model
- **Contract / IP expectations** ← decide the position before replying
- **Examples or references from similar work** ← the exposure point
- What's needed from Addy to move quickly

---

## Open risks

| Risk | Note |
|---|---|
| **References** | Michael asked directly. No named client work exists. Needs an honest answer that doesn't invent one. |
| **"Big system for the mortgage industry"** | Said on the call, untrue. If Jay probes it, correct it rather than build on it. |
| **Scale claims** | "Millions of calls" was implied-adjacent. Jay will ask for concurrency numbers, load-test results, and p95 under load. |
| **IP** | Unanswered. The intro came from inside Addy; this may be closer to the real agenda than the contract. |

---

## For the Jay conversation

**He is the Head of Engineering — ex-TechLead for AI at Deloitte, Master's in
Computer Engineering. He evaluates, he does not buy.**

Must be ready with:
1. **Real concurrency and load numbers**, or an honest statement of what's
   been tested vs designed for
2. **Monitoring and observability** — metrics, alerting, what's instrumented,
   what happens when a provider degrades
3. **The failure stories, told properly** — the 11.7s incident is the single
   most convincing thing available
4. **Latency with the breakdown and the overlap explanation**
5. **The AskAddy tool-interface design** — Michael's own idea; arriving with
   a shape for it is the highest-leverage prep
6. **Production-readiness gap analysis** — what exists, what's missing, what
   4 weeks buys

Do not repeat: LiveGate, the STT/TTS reversal, or the mortgage-client claim.
