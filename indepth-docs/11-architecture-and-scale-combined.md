# Architecture & Scale — combined, explained from zero

*These go together: the architecture only makes sense once you see what each
piece has to survive at volume. This doc adds the two things that weren't
explained properly before — what the data plane actually does, and what
middleware is — plus a cloud-agnostic scaling plan for both GCP and AWS.*

---

# PART 1 — What the data plane actually does

## The name first

"Control plane" and "data plane" come from networking. A router has a control
plane (deciding where packets *should* go) and a data plane (actually moving
them). The names got borrowed because the split is useful anywhere.

For us:

| Plane | What it does |
|---|---|
| **Control plane** | Decides a call should happen. API, scheduler, workflow engine |
| **Worker plane** | Holds live calls. Runs the pipeline |
| **Data plane** | **Stores and serves state.** Postgres, Redis, object storage |

**The data plane is where all the state lives.** That's its whole job — and
because state is the thing you can't recreate, it's the part that has to be
right.

## The three stores, and why each exists

### Postgres — the source of truth

Everything durable: agents, prompts, calls, transcripts, enrollments, users,
tenants, consent records, audit logs, usage.

**Why Postgres and not something else:**

- **Transactions.** The atomic claim — "change this row from pending to claimed,
  only if it's still pending" — needs a database that guarantees atomicity. That
  single feature is what prevents double-dialing.
- **Constraints.** The unique partial index on active enrollments per phone
  *enforces* no-duplicates rather than hoping application code remembers.
- **It's already durable and backed up.** Which is why the outbox is a table
  rather than a queue — adding SQS to guarantee durability for database writes
  means adding a second thing that can be down.

**Access pattern:** the workers touch it as little as possible. Never during a
call turn.

### Redis — the coordination layer

Redis holds exactly one important thing: **the live concurrency count per
tenant.**

```
tarsha:concurrency:{user_id}  →  3     (TTL 3600s)
```

**Why it can't be in Postgres:** it changes on every call start and end, and it's
read before every dial. Hitting Postgres for that would put database latency on
the path to placing a call.

**Why it can't be in process memory:** with three API replicas, each keeps its
own count. Three replicas at a cap of 10 would allow 30. **A shared counter is
the only way to get one number.**

**Why the TTL:** a worker that dies between incrementing and persisting never
decrements. Without expiry that slot is held forever and the tenant slowly loses
capacity until someone notices. The TTL self-heals it within an hour.

**The key property: Redis is not the source of truth.** If Redis vanishes, the
system falls back to per-replica counting — degraded, not broken. Nothing
permanent is lost.

### Object storage — the big files

Call recordings. Audio is large (~0.5–1 MB/minute) and you never query inside
it, so it doesn't belong in a database.

**What the data plane provides here:** cheap bulk storage with a lifecycle
policy. The retention purge deletes the object; the database row keeps the
metadata.

## What the data plane does NOT do

This is the clarifying part:

- **No business logic.** It doesn't decide anything.
- **It's never in the audio path.** No call turn waits on it.
- **It doesn't know about calls.** It stores rows; the control plane gives them
  meaning.

## Why the split matters practically

| | Control plane | Worker plane | Data plane |
|---|---|---|---|
| Holds state? | No | Only for its own call | **Yes — all of it** |
| Scales by | Adding replicas | Adding processes | Bigger instance / pooler |
| If it dies | New calls stop | Those calls drop | **Everything degrades** |
| Rebuild cost | Redeploy | Redeploy | **Restore from backup** |

**Because the control and worker planes are stateless, you can kill and replace
them freely.** That's the single property that makes scaling and deployment easy
— and it's only true because state was pushed into the data plane deliberately.

---

# PART 2 — What middleware is, and what ours does

## The concept

Middleware is code that runs **around** every request, rather than inside one
handler. Think of layers of an onion:

```
request arrives
   ↓ middleware 1  (before)
   ↓ middleware 2  (before)
   ↓ middleware 3  (before)
        [ your actual endpoint runs ]
   ↑ middleware 3  (after)
   ↑ middleware 2  (after)
   ↑ middleware 1  (after)
response leaves
```

Each layer can inspect or modify the request on the way in, the response on the
way out, or both.

**Why it exists:** you want request logging, auth checks and compression on
*every* endpoint. Writing that into 200 endpoint functions means 200 places to
forget it. Middleware makes it structural.

## Our five layers, in order

The order is deliberate — a layer only sees what the layers above it let through.

### 1. GZip — compress responses over 1KB

Pure bandwidth. A large JSON response compresses well; below 1KB the CPU cost
isn't worth it.

**Why first (outermost):** it compresses the final response, so it has to wrap
everything else.

### 2. Observability — request ID and timing

Assigns a unique ID to every request and records how long it took.

**Why this layer:** that request ID flows into every log line for that request.
When something goes wrong, you can pull the whole story with one ID rather than
guessing which log lines belong together.

**Why near the top:** it needs to time everything, so it has to wrap the layers
below it.

### 3. Audit — who changed what

Logs every **mutating** request: actor, action, resource, status, IP, request ID.

**Why it matters for a lender:** *"Who changed this agent's script on August
3rd?"* needs an answer that isn't "we don't know." Examination is a real thing in
this industry.

**What it deliberately skips:** `/metrics`, `/health`, `/livez`, `/readyz`,
`/phone/inbound`, `/billing/webhook`. Those are noise and unauthenticated
infrastructure — logging Twilio's webhook on every inbound call would bury the
human actions you actually want to audit.

**Note it only logs mutations.** A GET doesn't change anything, so auditing reads
would be enormous volume for almost no value.

### 4. TrustedHost — reject forged Host headers

Checks the `Host` header against an allowlist.

**What it prevents:** host-header injection, where an attacker sends a request
claiming to be for a different domain to poison password-reset links or caches.

### 5. CORS — which websites may call this API

The browser's rule: a page on `site-a.com` can't read a response from
`api-b.com` unless `api-b.com` explicitly allows it.

**Our config forbids wildcards in production** — and it's enforced, not
conventional. From the config validation:

> `CORS_ORIGINS` must not contain a wildcard in production

**Why that matters:** `*` with credentials means any website can call your API
using a logged-in user's session. It's one of the most common and most damaging
misconfigurations in web software.

## The general lesson worth saying out loud

**Middleware is where cross-cutting concerns live.** If a requirement applies to
every request — logging, auth, compression, audit — it belongs in middleware, not
copy-pasted into handlers. The moment it's in a handler, it's optional by
accident.

---

# PART 3 — How each service scales, individually

They scale differently, and knowing which is which is the answer to "how does
this scale."

| Service | Scales by | Constraint | Stateless? |
|---|---|---|---|
| **api** | **Horizontal** — add replicas | DB connections | ✅ Yes |
| **worker** | **Horizontal** — add pods, ~20–25 calls each | Memory, provider limits | ✅ Per-call only |
| **scheduler** | **Doesn't need to** — 1 replica | Tick duration | ✅ Atomic claims |
| **workflow-engine** | **Doesn't need to** — 1 replica | Tick duration | ✅ Atomic claims |
| **webhook-worker** | **Horizontal** — add replicas | Customer endpoint speed | ✅ Yes |
| **maintenance-worker** | **Doesn't need to** — 1 replica | Batch size | ✅ Yes |
| **Postgres** | **Vertical** + pooler + read replicas | Connections, then IOPS | ❌ **Stateful** |
| **Redis** | **Vertical** — tiny working set | Basically never binds | ❌ Stateful |

## The three patterns

### Horizontal — just add more

**api, worker, webhook-worker.**

No coordination needed. Any replica can serve any request; any worker can take
any call. This is the easy case and it's where almost all your capacity comes
from.

**The worker is the one that matters for voice.** From the deployment guide:

> Start pods at ~**20–25 calls each**, let KEDA add pods as `tarsha_active_calls`
> rises.

So 200 concurrent ≈ 8–10 worker pods. That's the actual sizing arithmetic.

### Single-replica-by-design — scheduler, workflow-engine, maintenance-worker

These don't scale out, and **they don't need to.** They tick on a timer,
claim work atomically, and place it. The heavy work happens in the worker plane.

**The important nuance:** a second replica would be *safe* — atomic claims
guarantee no double-dialing. It's just unnecessary.

**Say it that way.** "Safe but unnecessary" is very different from "would break."

**When they'd need attention:** if a tick takes longer than the tick interval,
work backs up. The fix is faster ticks or batched work, not more replicas.

### Vertical — the data plane

**Postgres** is the one true scaling constraint.

Three stages:
1. **Bigger instance** — works to a point
2. **Connection pooler** (Supavisor / PgBouncer / RDS Proxy) — this is the real
   fix. Each worker holds a pool; 200 workers exhausts Postgres. A pooler
   multiplexes many clients onto few real connections.
3. **Read replicas** for analytics, so reporting queries don't compete with the
   call path

**Redis basically never binds.** The working set is one integer per active
tenant.

---

# PART 4 — The GCP plan

This is the path the deployment guide already documents, and there are K8s
manifests in the repo.

## Service mapping

| Our piece | GCP |
|---|---|
| api | **GKE Deployment** (or Cloud Run — it's stateless HTTP) |
| worker | **GKE Deployment + KEDA** |
| scheduler / engine / maintenance | GKE Deployments, 1 replica |
| webhook-worker | GKE Deployment |
| Postgres | **Supabase** (managed Postgres) + pooler |
| Redis | **Memorystore** |
| Object storage | **GCS** |
| Metrics | Managed Prometheus |
| Secrets | Secret Manager |
| Ingress | GCLB + Cloud Armor (WAF) |

## The autoscaling mechanism

**KEDA scales worker pods on `tarsha_active_calls`** — our own Prometheus gauge.

That's the important detail: it scales on **live call count**, not CPU. CPU is a
poor proxy for voice load, because a call holding open sockets and waiting on a
model uses little CPU but occupies a slot entirely.

```
tarsha_active_calls rises → KEDA adds worker pods
                          → each pod holds ~20–25 calls
```

## Why the API could be Cloud Run

From the guide: *"The API could run on Cloud Run (it's stateless HTTP) —
reasonable."*

**Why it works for the API:** stateless, request/response, scales to zero.

**Why it does NOT work for workers:** Cloud Run has request timeouts and a
request-scoped lifecycle. A voice call is a long-lived WebSocket session, not a
request. It needs a persistent process.

**That distinction is worth saying** — it shows you know why the same platform
suits one service and not another.

## Rough fixed cost

| Stage | Fixed/month |
|---|---|
| Single VM (today) | $30–110 |
| Dedicated VM + Supabase Pro | $75–200 |
| Control VM + 1–3 worker VMs | $150–400 |
| **GKE + Memorystore + pooler + WAF** | **$300–700+** |

---

# PART 5 — The AWS plan

Same architecture, different names. Nothing about the design is GCP-specific.

## Service mapping

| Our piece | AWS | Note |
|---|---|---|
| api | **ECS Fargate** or EKS | Fargate is simpler |
| worker | **ECS Fargate + KEDA on EKS**, or EC2 ASG | See below |
| scheduler / engine / maintenance | ECS Fargate, desired count 1 | |
| webhook-worker | ECS Fargate | |
| Postgres | **RDS Postgres** or Aurora + **RDS Proxy** | Proxy = the pooler |
| Redis | **ElastiCache** | |
| Object storage | **S3** | Lifecycle rules for retention |
| Metrics | **AMP** (Managed Prometheus) + Grafana | |
| Secrets | **Secrets Manager** | |
| Ingress | **ALB + WAF** | |

## The one real decision: Fargate or EC2 for workers

| | Fargate | EC2 ASG |
|---|---|---|
| Ops burden | **Low** — no nodes to manage | Higher |
| Cost at steady load | Higher per vCPU | **Lower** |
| Scale-up speed | ~30–60s | ~2 min (node boot) |
| Right when | Bursty, unpredictable | Predictable daily curve |

**Recommendation: start on Fargate.** The voice load has a predictable shape —
the TCPA window creates a daily curve — so EC2 becomes cheaper at steady volume.
But that's an optimisation to make with real usage data, not a day-one decision.

## Autoscaling on AWS

The mechanism differs, and it's the main thing to get right:

**Option 1 — EKS + KEDA.** Identical to GCP. Same manifests, same
`tarsha_active_calls` metric. **If they already run Kubernetes, this is the
answer** — zero conceptual difference.

**Option 2 — ECS + Application Auto Scaling on a custom CloudWatch metric.**
Publish `tarsha_active_calls` to CloudWatch, scale the service on a target
tracking policy.

Slightly more wiring than KEDA, but it avoids running Kubernetes if they aren't
already.

**What NOT to do on either cloud: scale on CPU.** A voice call uses very little
CPU while holding a slot entirely. CPU-based scaling under-provisions badly.

## Rough fixed cost

Comparable to GCP within noise — $300–700/month for the equivalent managed
footprint. **Provider cost dominates either way**: at 30,000 minutes/month,
infrastructure is about 7% of the bill.

---

# PART 6 — GCP vs AWS, the honest comparison

| Dimension | GCP | AWS | Verdict |
|---|---|---|---|
| Managed K8s | GKE Autopilot — very good | EKS — more assembly | **GCP easier** |
| Serverless containers | Cloud Run — excellent | Fargate — good | GCP slightly ahead |
| Managed Postgres | Cloud SQL / Supabase | RDS / Aurora — more mature | **AWS ahead** |
| Pooler | Supavisor / PgBouncer | RDS Proxy — managed | **AWS easier** |
| Managed Redis | Memorystore | ElastiCache | Even |
| Prometheus | Managed Prometheus | AMP | Even |
| Enterprise procurement | Fine | **Often already approved** | **AWS ahead** |

## The actual recommendation

> **Deploy where Addy already is.**

The architecture is genuinely portable — containers, Postgres, Redis, object
storage, Prometheus. Every one has a first-class managed equivalent on both.

**The reasons to match their cloud are not technical:**

1. **One vendor relationship, one bill, one security review**
2. **Data residency** — keeping borrower PII in the same account boundary
   simplifies their SOC 2 scope considerably
3. **Their team already knows it** — this has to be operable by someone other
   than me
4. **Network egress** — calls between our services and theirs stay internal

**What genuinely differs, and it's small:** the autoscaling wiring. KEDA on GKE
is slightly cleaner than ECS custom-metric scaling. That's a day of work, not an
architectural concern.

**The line to say:**

> *"The architecture doesn't care. Containers, Postgres, Redis, object storage,
> Prometheus — all first-class on both. I'd deploy where you already are, because
> the reasons to match are about your security review and your team's
> familiarity, not about the technology. The only real difference is a day of
> autoscaling wiring."*

---

# PART 7 — The scaling path, cloud-agnostic

| Stage | Concurrent | Shape | Fixed/mo |
|---|---|---|---|
| **A — today** | 5–10 | One VM, everything on it | $30–110 |
| **B — dedicated** | 10–30 | Bigger VM, managed Postgres | $75–200 |
| **C — split** | 30–60 | Control host + worker hosts | $150–400 |
| **D — orchestrated** | 200 | K8s/ECS + autoscaling + pooler | $300–700 |
| **E — Phase 4** | 2,000+ | Async core, event backbone, multi-region | — |

**They're stages, not rivals.** From the guide: *"They're stages, not rivals."*

**What changes between D and E is code, not infrastructure.** The sync database
driver and in-process background tasks work to ~200 and don't scale past it. No
amount of cloud fixes that — it needs asyncpg and a real event backbone.

**Say that clearly.** It's the difference between "we'd throw servers at it" and
"we know exactly what the ceiling is made of."

---

# PART 8 — Questions Jay will ask

**"What does the data plane actually do?"**
It holds all the state. Postgres is the source of truth and gives us
transactions, which is what makes the atomic claim work. Redis holds one thing —
live concurrency per tenant — because that changes on every call and gets read
before every dial, so it can't be database latency. And object storage holds
recordings. No business logic anywhere in it, and it's never in the audio path.

**"Why is Redis not just Postgres?"**
Because it's read before every single dial. Putting database latency on the path
to placing a call would be a self-inflicted wound. And it's not the source of
truth — if Redis vanishes we fall back to per-replica counting. Degraded, not
broken.

**"What's your middleware doing?"**
Five layers. Compression, request ID and timing, audit logging on every mutation,
host-header validation, and CORS. The audit one matters most for a lender —
"who changed this agent's script on August 3rd" needs an answer. And our CORS
config actively refuses a wildcard in production; it's enforced, not
conventional.

**"How does each service scale?"**
Three patterns. The API, workers and webhook worker scale horizontally — just add
replicas, no coordination. The scheduler, engine and maintenance worker run one
replica each, and a second would be *safe* because of atomic claims, just
unnecessary. And Postgres scales vertically plus a pooler, which is the real
constraint.

**"Are you tied to GCP?"**
No. Containers, Postgres, Redis, object storage, Prometheus — all first-class on
both clouds. I'd deploy where you already are, and the reasons are your security
review and your team's familiarity, not technology. The only real difference is
the autoscaling wiring — KEDA on GKE versus ECS custom metrics — and that's a day
of work.

**"How would you autoscale on AWS?"**
If you're on EKS, KEDA — identical to GCP, same manifests. If you're on ECS,
publish the active-calls metric to CloudWatch and use target tracking. The thing
to get right on either cloud is scaling on **live call count**, not CPU. A voice
call uses almost no CPU while occupying a slot entirely, so CPU-based scaling
under-provisions badly.

**"How many pods for 200 concurrent?"**
Eight to ten. Pods are sized at roughly 20–25 calls each, and KEDA adds them as
the active-call gauge rises.

---

# PART 9 — The six things to land

1. **The data plane holds all the state — and nothing else.** No logic, never in
   the audio path. That's what makes everything else disposable.

2. **Redis exists for one number** that changes too often for Postgres and must
   be shared across replicas.

3. **Middleware is where cross-cutting concerns live.** In a handler, they're
   optional by accident.

4. **Three scaling patterns, not one.** Horizontal for the stateless three,
   single-replica-by-design for the tickers, vertical-plus-pooler for Postgres.

5. **Scale on active calls, not CPU.** The most common way to get voice
   autoscaling wrong.

6. **Deploy where they already are.** The architecture is genuinely portable; the
   reasons to match are procurement and familiarity, not technology.
