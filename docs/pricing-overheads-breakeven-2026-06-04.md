# Altus Recruit — Overheads, One-Anchor Break-Even & Pricing (Decision-Ready)

_June 2026. GBP-first. USD->GBP at £1 = $1.27 where a conversion is applied. All vendor unit prices re-verified against the June 2026 baseline; no unit price moved. Figures rounded for decision-use, not accounting precision. Arithmetic shown for the break-even._

---

## 1. TL;DR

- **Full monthly overhead INCLUDING the £200 Claude Max dev subscription is ~£253/mo** (typical) to ~£259/mo (heavy): £42 fixed infra + £200 Claude Max (fixed dev/R&D) + £11-17 anchor runtime usage.
- **Claude Max (£200) is by far the largest line** — bigger than infra + all runtime AI combined. It is a fixed, fully amortizable cost, NOT a per-tenant runtime cost (that runtime Anthropic API spend is the separate £11-17 marginal line).
- **Single-anchor full-load break-even** (one client carries 100% of the £200): **~£260/mo org**, i.e. **~£130/seat at 2 seats** or **~£87/seat at 3 seats** (after a target margin buffer + 2.5% Stripe; bare cost-recovery is ~£253-266).
- **Recommended anchor price (founding-customer deal): £89/seat/mo, AI fully bundled.** -> 2 seats = **£178/mo**, 3 seats = **£267/mo**.
- **Verdict: CAN one anchor cover ALL overheads incl. the full £200 Max? It hinges on seat count.** A **3-seat anchor at £89/seat (£267 gross, ~£260 net) covers the entire loaded overhead — yes, fully.** A **2-seat anchor at a competitive ~£99/seat (£198 gross, ~£193 net) covers ~70% of the £200 Max** plus all infra and runtime — close, but not the whole £200 unless you push to ~£129/seat (which reads enterprise for 2 seats).
- **Honest read:** loading the entire £200 on one 2-person desk is the aggressive case the founder already flagged. At 3 seats it works at a market-normal price; at 2 seats, aim to recover ~£190-200/mo (most of the Max) and let the next 1-2 clients retire the rest — that is exactly what de-risks the whole thing.

---

## 2. Overheads — the full monthly picture

Three blocks. The thing to internalise: **(b) Claude Max £200 dwarfs everything**, and it is a fixed dev tool — it does NOT scale per tenant and must NOT be confused with the runtime Anthropic API spend in block (c).

| Block | Line item | Plan / driver | Monthly (GBP) |
|---|---|---|---:|
| **(a) FIXED INFRA** | Supabase | Pro ($25, incl. $10 compute credit) | £19.7 |
| | Vercel | Pro, 1 builder seat ($20, $20 credit) | £15.7 |
| | Domain (.com) | amortised | £0.9 |
| | Sentry / PostHog / Inngest | free tiers at anchor scale | £0 |
| | Resend | free tier (anchor ~1,500/mo < 3,000 free) | £0 |
| | **Subtotal fixed infra** | | **~£36-42** |
| **(b) FIXED DEV / R&D** | **Claude Max 20x ($200/mo)** | **Claude Code — building + bug-fixing the product. Fixed overhead. NOT runtime API. NOT per-tenant.** | **£200.0** |
| | **Subtotal fixed dev** | | **£200.0** |
| **(c) VARIABLE per active tenant** | Anthropic API runtime | CV parse (Haiku) + match-score + writing (Sonnet), cached | £10-16.7 |
| | Whisper | ~120 spec-call min @ $0.006 | £0.6 |
| | Voyage embeddings | inside 200M/mo free tier | £0.0 |
| | Resend / Supabase / Vercel overage | in-tier at 1 tenant | £0.0 |
| | **Subtotal marginal / active tenant** | typical £11 / heavy £17 | **£11-17** |

**Totals (1 anchor live):**

| | Typical | Heavy |
|---|---:|---:|
| Fixed infra | £42 | £42 |
| Fixed dev (Claude Max) | £200 | £200 |
| Marginal (1 tenant) | £11 | £17 |
| **TOTAL OVERHEAD / MONTH** | **~£253** | **~£259** |

> **The £200 Claude Max is ~79% of total overhead at 1 client.** Without it, you are running the whole platform for ~£53/mo. With it, your "cover everything from one client" goal is essentially a question of *how much of the £200 you ask one desk to carry*. That single line is the entire story of this report.

**Why Claude Max is kept separate (no double-count):** Claude Max (£200) is a consumer subscription powering *your* dev work (writing code, fixing bugs). The product's *runtime* Claude calls (the AI features the anchor actually uses) are metered separately through the Anthropic API and already sit in block (c) at £10-17. Same vendor, two completely different cost centres — billed on different accounts. Loading both would overstate cost by ~£190/mo.

---

## 3. One-anchor-client break-even — the core answer

Method: **break-even price = total overhead grossed up for the ~2.5% Stripe fee** (so the *net* received covers overhead). Stripe gross-up = overhead / 0.975. Marginal cost is *per tenant*, so the org total is identical at 2 or 3 seats — only the per-seat division changes.

### (a) FULL-LOAD — one client bears 100% of the £200 Claude Max

| Step | Typical marginal (£11) | Heavy marginal (£17) |
|---|---:|---:|
| Fixed infra | £42.0 | £42.0 |
| + Claude Max (full) | £200.0 | £200.0 |
| + Anchor marginal | £11.0 | £17.0 |
| **= Total overhead** | **£253.0** | **£259.0** |
| **Break-even org price** (/ 0.975 for Stripe) | **£259.5/mo** | **£265.6/mo** |
| -> per seat @ **2 seats** | **£129.7** | **£132.8** |
| -> per seat @ **3 seats** | **£86.5** | **£88.5** |

**Read-out:**
- **3-seat anchor:** full-load break-even is **~£87-89/seat** — squarely inside the competitive band (Firefish £80-105, Vincere core £69, Recruit CRM £79). **One 3-seat anchor can carry the entire loaded overhead, including the full £200 Max, at a market-normal price.** This is the founder's goal, achieved.
- **2-seat anchor:** full-load break-even is **~£130/seat** — above Firefish, into "enterprise" perception (JobAdder/Bullhorn territory). Technically coverable, but you would be charging a 2-person desk a premium price *purely* to absorb your dev tool. That is the aggressive case the founder flagged as "unrealistic." Better to recover most of it (see §5) and amortize the rest.

(For reference, on the £36 infra floor the full-load break-even is £253-259/mo org; £127-130/seat at 2 seats, £84-87/seat at 3 seats — essentially the same picture.)

### (b) PROPORTIONATE / AMORTIZED — Claude Max + infra spread across N clients

Here the £200 Max and fixed infra are shared; each client still carries its own ~£11 runtime marginal. Infra steps modelled: +£15.7 Resend Pro from 2 clients, +£12 Supabase compute from ~10 clients.

| Clients (N) | Claude Max / client | Fixed infra / client | + Marginal / client | **Overhead / client** | **Break-even / client** (incl. Stripe) |
|---:|---:|---:|---:|---:|---:|
| **1** | £200.0 | £42.0 | £11.0 | **£253.0** | **£259.5** |
| **3** | £66.7 | £19.2 | £11.0 | **£96.9** | **£99.4** |
| **5** | £40.0 | £11.5 | £11.0 | **£62.5** | **£64.1** |
| **10** | £20.0 | £7.0 | £11.0 | **£38.0** | **£38.9** |

**Read-out — why covering it on the anchor de-risks everything:**
- The £200 Max per client collapses fast: **£200 -> £67 -> £40 -> £20** as you go 1 -> 3 -> 5 -> 10.
- If the anchor alone covers the full £253, then **every client after #1 is almost pure margin** — their break-even is just ~£11 runtime + a shrinking infra slice (~£12-19/client). At £89/seat, clients 2, 3, 4... each throw off ~£150-250/mo of contribution against ~£25-50 of true incremental cost.
- That is the founder's actual objective restated: *get one client to retire the fixed nut, and the business is structurally profitable from client #2 onward with no sales pressure.* The amortized table is the proof — break-even/client more than halves by client #3 and is below £40 by client #10.

---

## 4. Competitor landscape & positioning

| Vendor | Model | GBP / seat / mo | Built-in AI? | UK relevance |
|---|---|---|---|---|
| **Firefish** | Per-user (quote-only since 2025) | ~£80-105 | Yes — but retrofitted onto boolean core (2024-25 agents) | **Highest** — the incumbent Altus replaces |
| **Vincere (Access)** | Per-user core + AI "Smart Packs" | £69 core + AI extra | Partial — AI is a paid add-on | High |
| **Bullhorn** | Quote-only, annual + implementation | ~£78-248 (+ impl. £790-39k) | Add-on (Copilot extra) | Low for 2-3 (enterprise) |
| **JobAdder** | Quote-only, tailored | ~£79-157 | Limited | Medium |
| **Recruit CRM** | Self-serve, transparent | ~£79-130 | Yes, bundled (but match volume gated/credits) | High — direct comparable |
| **Crelate** | 5-seat min, annual only | ~£94 (floor ~£469/mo) | Partial (full AI on higher tiers) | Low-med (5-seat floor disqualifies) |
| **Manatal** | Self-serve | ~£12-28 | Yes, cheap & bundled | Medium (lightweight generalist) |
| **Zoho Recruit** | Self-serve | ~£20-59 | Gated — AI only from Pro (£39+) | Med-high price, lower fit |
| **Loxo** | Free + paid, sourcing credits | free / ~£109-133 | AI-native but credit-metered | Medium (sourcing tool) |
| **Recruiterflow** | Self-serve + AIRA AI plan | ~£117 (+ AIRA upsell) | Yes on AIRA (separate plan) | Med-high (archetype rival) |
| **Spott** | Self-serve, annual | ~£86-117 | Yes — genuinely AI-native (vector/semantic) | Medium (architectural twin) |
| **Tracker / RDB / Mercury / iSmart** | Quote/per-user | £39-78+ | Limited / legacy | UK-native but AI-light or opaque |

**Where Altus sits.** Altus owns the one quadrant no incumbent fully holds: **UK-perm-native AND AI-native-by-default AND transparent self-serve at small-team economics**. UK incumbents (Firefish, Vincere, RDB, Mercury) own UK fit but treat AI as a bolt-on or paid add-on; AI-native challengers (Spott, Recruiterflow, Recruit CRM, Manatal) own modern AI but are non-UK generalists with no IR35 / UK-perm / Firefish-migration story. The clean message is **"AI isn't an add-on or a higher tier — it's the product,"** with uncapped semantic search and no surprise sourcing credits — a contrast to every rival that gates, packs, or meters AI. This maps directly to the codebase (per-tenant `ai_usage` tracking + aggressive caching) that makes flat-rate bundled AI economically safe.

**ROI framing (the decisive argument).** A UK perm fee is 15-25% of first-year salary: a £45k placement at 20% = **£9,000**. The anchor's *entire annual* Altus spend (~£2,100-3,200/yr at £89/seat x 2-3) is recovered by a fraction of **one** placement. The price gap across the *whole* market is at most ~£2,000/yr per desk — under a quarter of one fee. So the sale is never "we're cheaper than Firefish"; it is **"about the same as Firefish, but the bundled AI pays for itself with a single faster placement, and there's no add-on bill waiting for you."** Sell on placement velocity, not seat cost.

---

## 5. Pricing recommendation

### Headline: **£89/seat/mo, AI fully bundled, no seat minimum, no AI tier, no sourcing credits.**

This (i) **matches/undercuts the Firefish they are leaving** (£80-105/seat) while *including* the AI Firefish only recently bolted on; (ii) sits **below** Recruit CRM, Spott, Recruiterflow, Bullhorn, JobAdder; and (iii) sits **above** the cut-price generalists (Manatal, Zoho) — correctly signalling "serious tool," not "toy."

### Concrete anchor recommendation

| Anchor size | Per-seat | **Org / mo (gross)** | Net after 2.5% Stripe | Covers full £253-259 overhead? |
|---|---:|---:|---:|---|
| **3 seats** | **£89** | **£267** | ~£260 | **Yes — covers everything incl. the full £200 Max** (surplus ~£0-7) |
| **2 seats** | **£89** (founding) | £178 | ~£174 | Covers infra + runtime + **~60% of the Max**; remainder amortizes onto client #2 |
| **2 seats** (stretch) | **£99** | £198 | ~£193 | Covers infra + runtime + **~70% of the Max** |
| **2 seats** (full-load) | **£129** | £258 | ~£252 | Covers **~96-100%** of full overhead, but reads enterprise for 2 seats |

**Decision:**
- **If the anchor is 3 seats -> price £89/seat (£267/mo).** This hits the founder's goal exactly: one client retires the entire loaded overhead including the full £200 Max, at a price that still undercuts Firefish. Recommended.
- **If the anchor is 2 seats -> price £89-99/seat (£178-198/mo) as a founding-customer deal.** Don't force the full £200 onto two people at a £129 enterprise rate — it damages the "cheaper-than-Firefish, AI-included" wedge. Instead recover ~£190-200/mo (all infra, all runtime, ~60-70% of the Max) and let client #2 — whose break-even/client is already only ~£99 (§3b) — retire the last ~£60-80. That is the de-risking play, not a compromise.

**Founding-customer framing:** position £89/seat as a *locked founding rate* (e.g. "founding price held for 24 months while list price rises to £99-109"). It rewards the anchor for being the proof-of-concept, anchors a higher future list price for SaaS clients, and gives the anchor a switching-cost reason to stay.

### Usage guardrails (so one heavy desk can't blow margin)
- **Meter the three expensive Claude paths** — match-scores, CV parses, writing/summarisation — per tenant per month via the existing **`ai_usage`** table (org_id, model, tokens, purpose). No new plumbing.
- **Soft cap (80%):** in-app banner + email. **Hard cap (100%):** on-demand match-scoring falls back to cached-only / overnight queue; CV parsing *queues* (never blocks onboarding).
- **Overage, not hard stop:** ~£0.05/extra match-score, ~£0.04/extra CV parse (~4-5x marginal -> margin-safe + self-throttling).
- **Cache aggressively** (already core): the modelled 40% Sonnet cache-hit rate is conservative; pushing it higher widens margin. **Keep Opus out** of the high-volume match/parse/writing loops. Migrate Whisper -> gpt-4o-mini-transcribe (~$0.003/min) for a 50% cut if spec-call volume grows.

---

## 6. Risks & assumptions

1. **Claude Max is the dominant, amortizable cost — and the whole "one client covers it" thesis rests on it.** At £200 it is ~79% of overhead at 1 client. The risk is psychological/strategic, not technical: don't let "the anchor must pay for my dev tool" distort the price into uncompetitiveness. The right frame is amortization (§3b) — the Max retires fast across 1->3->5 clients. If dev intensity drops later, you can downgrade Max 20x -> Max 5x (£100) and the entire break-even halves.
2. **AI-usage variance is the margin risk** (not the Max — that's fixed). A power-desk doing 2x assumed match-scores/parses pushes runtime Claude to £25-30+/tenant. This is why per-tenant caps + overage are non-optional: your heaviest-using customers must not become your worst-margin ones. The `ai_usage` per-call log is the early-warning system — alert on cost/tenant outliers and Opus leakage.
3. **FX.** Vendor list prices are USD; £ outputs move only with the FX assumption (£1 = $1.27 used here), not with any vendor repricing — every unit price was re-confirmed unchanged. Note the founder's "~£200" Max likely reflects UK VAT (20%) and/or platform premium on the $200 base (a pure spot conversion of $200 at 1.27 would be ~£157); the model conservatively treats the dev-tool overhead as the full £200 the founder actually pays.
4. **Vendor step-functions** (not smooth): Resend free->Pro (~£16) at ~2 clients; Supabase compute Micro->Small (~+£12) around 10-20 clients; an extra Vercel seat (+£16) if a second builder joins. The amortized table (§3b) bakes the first two in; budget for them rather than being surprised.
5. **Seat-count assumption is load-bearing for the verdict.** The single biggest swing in this whole analysis is 2 vs 3 anchor seats — it moves full-load break-even from £130/seat (uncompetitive) to £87/seat (market-normal). Confirm the anchor's actual seat count before fixing the contract; it changes whether "one client covers everything" is comfortable or a stretch.
6. **Margin definition.** Break-even here = bare cost-recovery (overhead grossed up for Stripe). The recommended £89/seat is a *price*, not a margin target — at 3 seats it lands right at full-load cover; from client #2 the business runs at SaaS-typical 80%+ gross margin as fixed costs amortize.

---

## 7. Sources

- Anthropic — [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) (Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, cache-hit 0.1x input) and [Max plan](https://support.claude.com/en/articles/11049741-what-is-the-max-plan) (Max 5x $100, Max 20x $200).
- Voyage AI — [Pricing](https://docs.voyageai.com/docs/pricing) (voyage-3 $0.06/MTok, 200M tok/mo free; now a MongoDB product).
- OpenAI — [API Pricing](https://openai.com/api/pricing/) (whisper-1 $0.006/min; gpt-4o-mini-transcribe ~$0.003/min).
- Resend — [Pricing](https://resend.com/pricing) (free 3,000/mo; Pro $20 / 50,000).
- Supabase — [Pricing](https://supabase.com/pricing) (Pro $25; 8GB DB / 100GB storage; $10 compute credit).
- Vercel — [Pricing](https://vercel.com/pricing) (Pro $20/seat; $20 credit).
- Sentry / PostHog / Inngest — free tiers at anchor scale ([Sentry](https://sentry.io/pricing/), [PostHog](https://posthog.com/pricing), [Inngest](https://www.inngest.com/pricing)).
- Stripe — [Pricing](https://stripe.com/pricing) (UK 1.5% + 20p; Billing +0.7%; ~2.5% modelled).
- Competitors — Firefish ([firefishsoftware.com/pricing](https://firefishsoftware.com/pricing), [Capterra](https://www.capterra.com/p/226344/Firefish/)), Vincere ([vincere.io/pricing](https://www.vincere.io/pricing)), Bullhorn ([bullhorn.com/pricing](https://www.bullhorn.com/pricing/)), JobAdder, Recruit CRM ([recruitcrm.io/pricing](https://recruitcrm.io/pricing)), Crelate, Manatal ([manatal.com/pricing](https://www.manatal.com/pricing)), Zoho Recruit ([zoho.com/recruit/pricing](https://www.zoho.com/recruit/pricing.html)), Loxo, Recruiterflow ([recruiterflow.com/pricing](https://recruiterflow.com/pricing)), Spott ([spott.io/pricing](https://spott.io/pricing)).
- Internal baseline — `docs/cost-and-pricing-analysis.md` (validated June 2026 cost model: fixed ~£36-42/mo, marginal ~£8-11/mo typical / ~£17 heavy, Claude ~95% of marginal).