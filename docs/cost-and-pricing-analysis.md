# Altus Recruit — Monthly Cost Breakdown & Starter SaaS Pricing Analysis

_Last updated: June 2026. All third-party prices verified against current (2026) published pricing — sources cited inline and at the foot. USD→GBP converted at **£1 = $1.27** (i.e. £ = $ ÷ 1.27), stated wherever a conversion is applied. Figures are rounded for decision-usefulness, not accounting precision._

> **TL;DR.** Fixed platform cost is **~£42/month** (Supabase Pro + Vercel Pro + domain; everything else sits inside free tiers at this scale). The **marginal cost of one active 2–3 person agency is ~£8–11/month**, dominated by Claude match-scoring and CV parsing. At those numbers a starter price of **£59–£79 per seat/month** (or **~£149/org/month** for a 3-seat agency) clears an 80%+ gross margin with room for AI guardrails. See §4–5.

---

## 1. Usage assumptions — ONE active 2–3 person UK perm desk

These are the levers. Everything downstream is computed from them, so adjust here and the costs move proportionally. Numbers chosen for a **small but busy** perm desk (2–3 recruiters, perm-focused, replacing Firefish).

| # | Driver | Assumed monthly volume | Rationale |
|---|--------|------------------------|-----------|
| A | **CVs parsed** (Haiku extract) | **400 / mo** | ~15–20 new candidates/recruiter/working day across 2–3 desks, plus bulk inbox imports. Each CV → one Haiku structured-extraction call. |
| B | **Candidates embedded** (Voyage) | **400 / mo** new + occasional re-embeds | One embed per parsed CV; re-embed only on material CV change (tracked via `embedding_version`). |
| C | **Job descriptions embedded** (Voyage) | **20 / mo** | A 2–3 person desk runs ~15–25 live roles; embed on creation + material JD edits. |
| D | **Searches/day → query embeds** (Voyage) | **40 / day ≈ 880 / mo** | Semantic search is the core loop; ~13–15 searches/recruiter/day. Every query is embedded. |
| E | **Match-score generations** (Sonnet, cached explanation) | **600 / mo** | ~20–30 candidates scored per role across ~20 active roles, precomputed + on-demand. Each = 1 Sonnet call, cached in `ai_summaries`/match table; regenerate only on change. |
| F | **Writing/summarisation** (Sonnet: outreach drafts, job ads, summaries) | **300 / mo** | Per-candidate outreach drafts, job-ad generation, conversation summaries. |
| G | **Spec-call minutes transcribed** (Whisper) | **120 min / mo** | ~8–10 spec calls/mo × ~12–15 min each. Transcript → Sonnet structuring (counted under F). |
| H | **Emails sent** (Resend) | **1,500 / mo** | Invites, transactional, candidate/client outreach + light campaign. Well under Resend's 3,000 free/mo. |
| I | **Stored data** (Supabase DB + Storage) | **< 2 GB DB, < 5 GB CV storage** in year 1 | 400 candidates/mo × CV PDFs (~300 KB–1 MB each) ≈ 2–5 GB storage in year one; DB rows are tiny by comparison. |

**Token sizing used for AI cost (typical, conservative-high):**

- CV extract (Haiku): ~4k input (CV text + tool schema) + ~1k output per call.
- Match score (Sonnet): ~3k input (candidate + JD + prompt) + ~0.8k output (`max_tokens: 800`, confirmed in `src/lib/ai/match.ts`).
- Writing/summarisation (Sonnet): ~3k input + ~1.2k output average.
- Voyage embed: a CV averages ~1.5k tokens; a query ~25 tokens; a JD ~1k tokens.
- **Prompt caching is in use** (the app caches static tool schemas / system prompts). Cache hits cost **0.1× base input** (90% off) on the cached portion. We model a conservative **40% of Sonnet input tokens served from cache** to stay safe; the real saving is likely higher.

---

## 2. Per-service variable cost — derivation

### 2a. Anthropic Claude API
Current published rates (per MTok): **Haiku 4.5 = $1.00 input / $5.00 output**; **Sonnet 4.6 = $3.00 input / $15.00 output**; Opus 4.x = $5 / $25 (rarely used → excluded). Prompt-cache **hit = 0.1× input** (90% discount); 5-min cache write = 1.25× input. ([Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)). The repo's own cost table (`src/lib/ai/claude.ts`) encodes the same rates in pence.

| Workload | Calls/mo | In tok/call | Out tok/call | Input cost | Output cost | Sub (USD) |
|----------|---------:|------------:|-------------:|-----------:|------------:|----------:|
| CV extract (Haiku) | 400 | 4,000 | 1,000 | 1.6M × $1 = $1.60 | 0.4M × $5 = $2.00 | **$3.60** |
| Match score (Sonnet) | 600 | 3,000 | 800 | see below | 0.48M × $15 = $7.20 | **$10.50** |
| Writing/summ. (Sonnet) | 300 | 3,000 | 1,200 | see below | 0.36M × $15 = $5.40 | **$7.07** |

Sonnet input with 40% cache hits: combined Sonnet input = (600+300)×3,000 = 2.7M tok. Uncached 60% = 1.62M × $3 = $4.86; cached 40% = 1.08M × $0.30 = $0.32; + amortised cache-write overhead ≈ $0.10. **Sonnet input ≈ $5.28**, split ~$3.30 (match) / ~$1.67 (writing) by volume — folded into the sub-totals above.

**Claude total ≈ $21.2 / mo ≈ £16.7** for one heavy desk. _(This is the single biggest marginal driver and the main guardrail target — see §5.)_ A typical/median desk runs closer to **$12–15 (£9–12)**; a quiet desk ~$6.

### 2b. Voyage AI (voyage-3 embeddings)
**$0.06 / MTok**, with the **first 200M tokens/account free** ([Voyage pricing](https://docs.voyageai.com/docs/pricing), [MongoDB Voyage docs](https://www.mongodb.com/docs/voyageai/models/)).

- CVs: 400 × 1.5k = 0.6M tok • JDs: 20 × 1k = 0.02M • Queries: 880 × 25 = 0.022M → **~0.64M tok/mo per tenant**.
- Even at 20 tenants that's ~13M tok/mo — **inside the 200M free tier**. Billable cost today: **$0.00**.
- Modelled cost if billed (post-free-tier, e.g. at large scale): 0.64M × $0.06 = **$0.038/tenant/mo** — negligible. The real risk is _not adding a card_ → throttling (see Caveats).

### 2c. OpenAI Whisper (spec-call transcription)
**$0.006 / min** ([OpenAI API pricing](https://openai.com/api/pricing/), [BrassTranscripts 2026](https://brasstranscripts.com/blog/openai-whisper-api-pricing-2025-self-hosted-vs-managed)). 120 min/mo × $0.006 = **$0.72/mo ≈ £0.57**. (gpt-4o-mini-transcribe at ~$0.003/min would halve this if migrated.)

### 2d. Resend (email)
**Free tier = 3,000 emails/mo** (100/day); Pro = $20–35/mo for 50k–100k ([Resend pricing](https://resend.com/pricing)). At 1,500 emails/tenant/mo, **one tenant is free**. Free tier covers ~2 tenants of this profile; beyond that the org needs Pro ($20/mo flat, not per-tenant). Modelled: **$0 at 1 tenant**, **$20 fixed from ~2 tenants onward** (see scenarios).

### 2e. Supabase (Pro plan) — _fixed, shared across all tenants_
**Pro = $25/mo**, includes **8 GB DB, 100 GB file storage, 250 GB egress, 100k MAU, 2M edge-fn invocations**, plus a **$10/mo compute credit** (covers a Micro instance). Overages: storage $0.125/GB, egress $0.09/GB uncached, file storage $0.021/GB ([Supabase pricing](https://supabase.com/pricing)). At year-1 scale (a few GB storage, low egress) **we stay inside included limits → $25/mo flat**. Compute may step up to Small (~+$15/mo) once several tenants share the instance — flagged in scenarios.

### 2f. Vercel (Pro plan) — _fixed, shared_
**Pro = $20/mo per seat** (1 builder seat for a solo dev), includes **$20 usage credit, 1 TB fast data transfer, 10M edge requests, ~1,000 GB-hrs functions, 6,000 build min** ([Vercel pricing](https://vercel.com/pricing)). At this scale the $20 credit absorbs all function/bandwidth usage → **$20/mo flat**. Adding a second team seat later is +$20.

### 2g. Sentry / PostHog / Inngest — _free at this scale_
- **Sentry** free Developer: 5k errors, 1 user → $0 (Team $26/mo only if error volume grows). ([Sentry via PostHog comparison](https://posthog.com/blog/posthog-vs-sentry))
- **PostHog** free: 1M events, 5k replays, 100k errors/mo → $0 across all three scenarios. ([PostHog pricing](https://posthog.com/pricing))
- **Inngest** free: 50k executions/mo, 3 users → $0. Our jobs (parse/embed/match-precompute) at 20 tenants ≈ low-thousands of runs/mo, inside free. Paid starts $75/mo only at real scale. ([Inngest pricing](https://www.inngest.com/pricing))

### 2h. Domain — _fixed_
altusrecruit.com .com ≈ **$14/yr ≈ £11/yr ≈ £0.92/mo** (Namecheap-class .com renewal ~$14; [Namecheap](https://www.namecheap.com/domains/)). Amortised: **~£1/mo**.

### 2i. Stripe (Phase 5) — _pass-through, not infra_
UK cards **1.5% + £0.20**; **Stripe Billing +0.7%** of recurring volume ([Stripe pricing](https://stripe.com/pricing), [WeAreFounders 2026](https://www.wearefounders.uk/stripe-fees-uk-2026/)). On a £149/org/mo plan that's ~£3.50/org/mo (~2.4%), deducted from revenue — it reduces _net_ price realised, it is **not** an infra cost line. Bake ~2.5% into margin maths.

---

## 3. Cost table — fixed vs marginal

### (a) Platform / fixed costs — exist whether or not you have customers

| Service | Plan | Monthly (USD) | Monthly (GBP) |
|---------|------|--------------:|--------------:|
| Supabase | Pro | $25 | £19.7 |
| Vercel | Pro (1 seat) | $20 | £15.7 |
| Sentry | Free | $0 | £0 |
| PostHog | Free | $0 | £0 |
| Inngest | Free | $0 | £0 |
| Domain | .com amortised | ~$1.2 | £0.9 |
| **TOTAL FIXED** | | **~$46.2** | **≈ £36.4** |

> **Total fixed monthly cost ≈ £36–42/mo.** (Use **£42** as a safe planning number — it leaves headroom for a Supabase compute step-up to Small once a few tenants share the box.)

### (b) Marginal cost of ONE active agency/tenant — heavy desk

| Service | Driver | Monthly (USD) | Monthly (GBP) |
|---------|--------|--------------:|--------------:|
| Claude API | CV parse + match + writing | $21.2 | £16.7 |
| Voyage | embeddings (free tier) | $0.00 | £0.00 |
| Whisper | 120 spec-call min | $0.72 | £0.57 |
| Resend | 1,500 emails (free) | $0.00 | £0.00 |
| Supabase overage | storage/egress (in-tier) | ~$0 | £0 |
| Vercel overage | (absorbed by credit) | ~$0 | £0 |
| **MARGINAL / TENANT (heavy)** | | **~$22** | **≈ £17** |
| **MARGINAL / TENANT (typical)** | | **~$13** | **≈ £10** |

> **Marginal cost per active tenant ≈ £8–11/mo (typical), up to ~£17/mo for a heavy desk.** Use **£11** as the planning number for an active desk; **Claude is ~95% of it.**

---

## 4. Three scenarios — total monthly cost & cost-per-tenant

Assumes **typical** (not heavy) desks at **£10 marginal/tenant**, GBP. Step-ups flagged.

| | **1 tenant (anchor)** | **5 tenants** | **20 tenants** |
|---|---:|---:|---:|
| Fixed: Supabase Pro | £19.7 | £19.7 | £35.4¹ |
| Fixed: Vercel Pro | £15.7 | £15.7 | £15.7 |
| Fixed: domain | £0.9 | £0.9 | £0.9 |
| Resend | £0 (free) | £15.7² | £15.7² |
| Marginal AI/usage (£10 × N) | £10 | £50 | £200 |
| Sentry/PostHog/Inngest | £0 | £0 | £0 |
| **TOTAL / MONTH** | **≈ £46** | **≈ £102** | **≈ £283** |
| **COST PER TENANT** | **£46** | **£20** | **£14** |

¹ Supabase compute bumped to Small (~+£12/mo) assumed at 20 tenants as storage/connections grow.
² Resend Pro ($20≈£15.7) kicks in once aggregate email > 3,000/mo (≈ 2+ active tenants).

**Read-out:** fixed costs (£36–48) amortise hard — cost/tenant falls from £46 (anchor alone) → £20 (5) → £14 (20). The marginal £10–11/tenant is the floor the price must clear with margin.

---

## 5. Pricing recommendation

**Target: 80%+ gross margin.** At £11 worst-case marginal cost/active tenant, an 80% margin needs price ≥ **£55/active org/mo** on a fully-loaded basis (incl. amortised fixed). Recruitment-CRM incumbents anchor far above this:

- **Firefish** ~£65–105 per **user**/mo (tiered Basic→Enterprise). ([iSmartRecruit](https://www.ismartrecruit.com/tools/firefish), [Capterra](https://www.capterra.com/p/226344/Firefish/))
- **Vincere** ~£69 up to £349 per **user**/mo. ([Vincere vs Firefish](https://www.vincere.io/vincere-vs-firefish/))
- **Bullhorn** — quote-only, generally the most expensive. ([Bullhorn pricing](https://www.bullhorn.com/pricing/))

So the market pays **£65–105/seat/mo** for tools _without_ Altus's built-in AI. That is enormous pricing headroom — Altus's marginal cost is ~£4/seat (on a 3-seat desk) and the AI is the differentiator, so price on **value vs Firefish**, not on cost.

### Recommended starter pricing — **per seat/month**

| Tier | Price/seat/mo | Seats | Included AI usage (the guardrail) | Margin @ heavy use |
|------|--------------:|-------|-----------------------------------|--------------------|
| **Starter** | **£59** | 1–3 | 300 match-scores, 200 CV parses, 1,000 searches, 30 spec-call min /seat/mo | ~90% (heavy desk ~£6/seat cost) |
| **Pro** _(default)_ | **£89** | up to 8 | 800 match-scores, 600 CV parses, 5,000 searches, 120 spec-call min /seat/mo | ~90% |
| **Scale** | **£129** | 8+ | High caps + priority precompute + bulk import | ~88% |

Equivalent **per-org** framing for the 2–3 person anchor: **~£149/org/mo** (≈ Pro, 2 seats) — lands just under Firefish for a single seat while bundling AI the incumbents charge extra for.

**Recommendation for the anchor:** put them on **Pro at £89/seat** (≈ £178–267/mo for 2–3 seats). Fully-loaded cost ≈ £36 fixed + £17 heavy marginal = ~£53 → **gross margin ~75–80% even at heavy use on a single tenant**, rising past 90% as more tenants join and fixed costs amortise.

### Where to put the AI-usage guardrails (so one heavy tenant can't blow margin)

1. **Meter the three expensive Claude paths per tenant per month** — match-scores, CV parses, writing/summarisation calls — against the tier caps above. The app already logs every call to **`ai_usage` (org_id, model, tokens, purpose)** — use that table as the meter; no new plumbing.
2. **Soft cap → hard cap.** At 80% of cap, in-app banner + email. At 100%, switch on-demand match-scoring to "use cached only / queue overnight" and require a top-up or upgrade for fresh generations. CV parsing should _queue_, not block onboarding.
3. **Overage pricing** rather than hard stop for parses/scores: e.g. **£0.05/extra match-score, £0.04/extra CV parse** (≈ 4–5× marginal cost → margin-safe and self-throttling).
4. **Cache aggressively** (already a core principle): match explanations cached in `ai_summaries`, embeddings re-run only on material change. The 40% cache-hit assumption is conservative — push it higher to protect margin further.
5. **Default Sonnet, justify Opus.** Opus at 5× Sonnet input / 1.67× output would meaningfully dent margin if it crept into high-volume paths. Keep Opus out of match/parse/writing loops (it already is).
6. **Whisper minutes** capped per tier; migrate to gpt-4o-mini-transcribe (~$0.003/min) for a 50% cut if spec-call volume grows.

---

## 6. Caveats & cost-variance risks

**Biggest variance risks (watch these):**

1. **AI usage per tenant is the dominant variable — and it scales with how _good_ the product is.** A power-desk doing 2× the assumed match-scores/CV-parses pushes Claude to ~£30+/tenant/mo. This is _exactly_ why the per-tenant caps + overage pricing in §5 are non-optional, not nice-to-have. Without them, your best (heaviest-using) customers are your worst-margin customers.
2. **Voyage throttling if unbilled.** Embeddings are free to ~200M tok/mo, but an account with **no payment method attached can get throttled/rate-limited** rather than billed — which would silently degrade search (the core feature). **Add a card now** even though the bill is £0; it's an availability risk, not a cost risk.
3. **Supabase compute & storage as data grows.** Storage and egress are cheap and in-tier in year 1, but (a) CV PDFs accumulate (~5 GB/tenant/yr) and (b) shared compute on the Pro Micro instance will need a Small/Medium step-up as tenants and connection counts grow. Budget a **+£12–40/mo compute step** somewhere between 10–20 active tenants. This is the main fixed-cost creep.
4. **Resend tier jumps** are step functions (free → $20 Pro → $90 Scale), not smooth — a campaign-heavy month across many tenants can trip the next tier. Cheap (£15.7), but model it as fixed-from-2-tenants, not free.
5. **Opus leakage / model drift.** Any feature quietly switched to Opus, or a prompt that balloons input tokens (large JD + many candidates inlined), changes the marginal cost materially. The `ai_usage` per-call log is the early-warning system — alert on cost/tenant outliers.

**Cost classification — what scales with what:**

| Cost class | Services | Behaviour |
|------------|----------|-----------|
| **Fixed** (independent of tenants) | Vercel Pro, domain, baseline Supabase Pro | Flat ~£36/mo; amortises across tenants. |
| **Step-with-tenants** | Resend (free→Pro at ~2), Supabase compute (step at ~10–20), extra Vercel seat | Jumps at thresholds, not linear. |
| **Scales-with-usage** (the margin risk) | **Claude (95% of marginal)**, Whisper, Voyage (post-free-tier) | Linear in per-tenant activity; guard with caps + overage. |

---

### Sources
- [Anthropic — Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing) (Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, cache hit 0.1× input)
- [Voyage AI — Pricing](https://docs.voyageai.com/docs/pricing) and [MongoDB Voyage models](https://www.mongodb.com/docs/voyageai/models/) (voyage-3 $0.06/MTok, 200M free)
- [OpenAI — API Pricing](https://openai.com/api/pricing/) and [BrassTranscripts Whisper 2026](https://brasstranscripts.com/blog/openai-whisper-api-pricing-2025-self-hosted-vs-managed) ($0.006/min)
- [Resend — Pricing](https://resend.com/pricing) (3,000/mo free; Pro $20–35)
- [Supabase — Pricing](https://supabase.com/pricing) (Pro $25; 8GB DB/100GB storage/250GB egress; $10 compute credit)
- [Vercel — Pricing](https://vercel.com/pricing) (Pro $20/seat; $20 credit; 1TB transfer)
- [PostHog — Pricing](https://posthog.com/pricing) and [Sentry comparison](https://posthog.com/blog/posthog-vs-sentry); [Inngest — Pricing](https://www.inngest.com/pricing) (free tiers)
- [Stripe — Pricing](https://stripe.com/pricing) and [WeAreFounders Stripe UK 2026](https://www.wearefounders.uk/stripe-fees-uk-2026/) (1.5%+20p; Billing +0.7%)
- [Firefish (iSmartRecruit)](https://www.ismartrecruit.com/tools/firefish), [Vincere](https://www.vincere.io/vincere-vs-firefish/), [Bullhorn](https://www.bullhorn.com/pricing/) (competitor per-seat anchors)
- [Namecheap domains](https://www.namecheap.com/domains/) (.com renewal ~$14/yr)
