# Recruitment CRM Plan — AI-First SaaS Build

## Brief

Build an AI-first recruitment CRM as a SaaS product, with a known anchor customer (a 2–3 person agency replacing Firefish at ~£240/month). The strategic position is two-layered:

- **Anchor customer's driver**: the owner wants the option to sell the agency. Currently his commercial knowledge sits in recruiters' heads — useless to a buyer. The CRM turns tacit value into a documented, queryable, exportable asset.
- **Builder's driver**: launch as a SaaS to other recruitment agencies, with the anchor customer as proof and reference.

Both shape every design choice. Multi-tenancy from day one. AI integrated into the core, not bolted on. Audit-readiness baked in. Recruitment-domain workflows (RTR, commission, source attribution, shortlists) treated as first-class, not retrofitted from a generic CRM template.

## Core requirements (from anchor customer)

1. ATS + CRM + marketing unified in one system
2. Auto-populated candidate records from CV uploads — skills, salary, availability, market temperature
3. Client list with drill-down to per-client management view
4. Full candidate journey tracking — interviews, offers, decline reasons, outcomes
5. Robust repeat-client workflows
6. LinkedIn integration — inbound capture (outbound is a no-go, see § LinkedIn)
7. GDPR consent capture and lifecycle
8. Perm + temp/contract supported (perm first, temp later)
9. **AI-first throughout** — not as a feature but as the spine

---

## Strategic positioning — pick a wedge

"Firefish but cheaper" isn't a winning SaaS thesis. The incumbents have a decade+ of iteration. To carve a real niche, pick one wedge:

| Wedge | What it means | Why it could work |
|---|---|---|
| **Sector specialist** (energy / offshore wind / maritime) | Sector-specific schema, compliance, content. Day rates, IR35, offshore allowances, ticket renewals (BOSIET, MIST) | Your network and credibility live here. Deep beats wide for niche markets. |
| **AI-first** | Native AI throughout — semantic search, match scoring with explanations, voice-to-data, conversation summarisation | Firefish G2 reviews specifically call out their CRM core as dated. Real gap. |
| **Micro-agency price tier** | £20–30/user vs Firefish's £80 | Long tail of 1–2 person agencies are priced out of incumbents today |

These aren't mutually exclusive — "AI-first CRM for offshore wind recruiters at micro-agency prices" is a defensible position. Anchor customer doesn't need the wedge picked yet, but every architecture choice past Phase 3 should reflect it.

---

## Reality check

Single-customer maths don't justify the build — Firefish at ~£240/month is cheap vs ~14+ weeks part-time work. The justification holds only with the SaaS angle:

- Customer 2 onwards is mostly free revenue (marginal cost: hosting + support time)
- 50 customers × £30/user × 2 users avg = ~£36k/year recurring at low marginal cost
- IP and data infrastructure ownership

Failure modes to name up front:

- **Solo SaaS is hard** — competing with funded products as a part-timer means slower velocity and no support team. Customers feel that.
- **Recruitment software has high switching costs** — agencies don't change CRMs lightly. Sales cycles run 3–6 months.
- **Key-person risk in due diligence** — buyer of the anchor's agency may discount the CRM as bespoke risk if you're the only maintainer. Mitigate with documentation and code quality.

---

## Recommended stack

- **Database & backend**: Supabase — Postgres + auth + file storage + row-level security (RLS) + **pgvector** extension for embeddings. RLS enforces multi-tenancy: every query auto-filters to the user's organisation. Free tier covers single-customer testing; £20/mo Pro covers early SaaS stage.
- **Frontend**: Next.js (App Router) on Vercel.
- **UI**: shadcn/ui + Tailwind. Consistent, accessible, themeable per org.
- **AI**: Claude API throughout. Model selection:
  - **Haiku** (cheap, fast) — CV parsing, classification, embeddings preparation, simple categorisation
  - **Sonnet** (default) — matching with explanations, outreach drafting, summarisation, JD generation, voice-note structuring
  - **Opus** (sparingly) — complex multi-step reasoning, e.g. drafting candidate briefs combining CV + notes + interview feedback
- **Embeddings**: Voyage AI (`voyage-3-large` or `voyage-3`) — outperforms OpenAI for retrieval. Stored in pgvector. Re-embed only on material updates.
- **Subscription billing**: Stripe. Not worth building.
- **Transactional email**: Resend.
- **Marketing email** (Phase 4): Resend or SendGrid for campaigns.
- **Background jobs**: Inngest or Trigger.dev for CV parsing, embedding generation, scheduled tasks. Don't block HTTP requests on AI calls.
- **LinkedIn**: Chrome extension (Phase 3) for inbound profile capture.
- **Observability**: Sentry (errors) + PostHog (product analytics, free tier).

Standard Postgres schema means data exports cleanly anywhere. No vendor lock-in.

**Estimated running cost** at single-customer stage: ~£40–80/month including AI (~£20–50/mo Claude + Voyage). At ~20 paying customers: ~£200–400/month.

---

## AI Intelligence Layer — what makes this AI-first, not bolted-on

This is the spine, not a feature. Every module touches it.

### 1. Intelligent CV parsing (Haiku)

Beyond field extraction:
- Career trajectory (level progression, sector switches, gaps with neutral framing)
- Skills with years of experience inferred from context, not just keyword count
- Seniority level inference (junior / mid / senior / lead / principal / director)
- Salary band inference from past roles + location
- Visa / right-to-work signals where present
- Sector tags inferred from employer history
- Confidence scores per extracted field so reviewers know what to verify

Cost: ~£0.005 per CV with Haiku. Trivially affordable.

### 2. Vector embeddings + semantic search (Voyage + pgvector)

Each candidate gets an embedding from a structured representation of their CV (not raw text). Each job gets an embedding from its description + requirements. Searches return ranked results by cosine similarity in Postgres — no separate vector DB needed.

What this enables (impossible with keyword search):
- "Senior Python engineer with offshore wind experience in Aberdeen, open to hybrid" — works as natural language
- "Find me candidates similar to John Smith who we placed at Crown Estate last year"
- Auto-suggest candidates for new jobs as they're created
- Reverse search: "which open jobs might this candidate fit?"

Re-embed on material change only (skills/roles updated). ~£0.0002 per embedding. Storage cost negligible.

### 3. Match scoring with explanations (Sonnet)

When a recruiter views a candidate-job pairing, Sonnet generates:
- Numerical match score (0–100)
- Strengths: 2–3 specific reasons this is a good fit
- Gaps: 1–2 specific concerns
- Suggested screening questions

Cached per candidate-job pair, regenerated on profile update. ~£0.02 per match explanation.

### 4. Spec call → structured JD (Sonnet, voice-to-data)

Real recruitment workflow: client calls and verbally briefs a role. Recruiter currently scrambles to take notes, then writes it up later.

New workflow:
- Recruiter records the call (or dictates after) via web mic
- Whisper transcribes (cheap, fast)
- Sonnet structures into: title, location, salary range, must-haves, nice-to-haves, culture notes, reporting line, urgency
- Recruiter reviews and accepts/edits
- Job is created with structured fields populated

Time saved: ~30 mins per spec. Real ROI.

### 5. Conversation history summarisation (Sonnet)

"What's the history with this candidate?" surfaces:
- Last touchpoint + sentiment
- Open threads / promised follow-ups
- Past placements and outcomes
- Notes summary across all recruiters

Cached and regenerated weekly or on demand. ~£0.05 per summary, cached.

### 6. AI-personalised outreach (Sonnet)

For email marketing campaigns:
- Per-recipient personalisation drawing on their CV + recent activity
- Tone matching based on prior comms with that candidate
- A/B variant generation
- Reply suggestions when candidate responds

### 7. Pipeline intelligence

- Stale candidate alerts ("you haven't contacted X in 30 days")
- Probability-of-placement scoring per application based on historical stage progression
- "Next best action" suggestions ("submit to client", "check availability", "send follow-up")
- Identify candidates similar to recently placed ones for cross-selling

### 8. Job ad generation + inclusivity scoring (Sonnet)

- Generate job ad copy from structured JD
- Score existing ads for inclusivity, clarity, attractiveness (decoder.com-style heuristics + LLM judgment)
- Suggest improvements
- Per-sector templates

### 9. Natural language reporting (Sonnet)

- "Show me Q3 placements by sector"
- "Which clients haven't given us a job in 90 days?"
- "What's our average time-to-fill for Aberdeen energy roles vs Edinburgh tech?"

SQL generated and run with read-only credentials, results returned with NL summary. Validate generated SQL against a schema-aware allowlist before execution.

### 10. Voice notes → structured data (Sonnet)

After a call/interview, recruiter dictates a voice note. AI extracts:
- Key points
- Stage update recommendation
- Action items with suggested due dates
- Updates to candidate fields (salary changed, availability changed, etc.)

Recruiter approves before applying.

### Model selection / cost discipline

| Use case | Model | Approx cost |
|---|---|---|
| CV parsing | Haiku | £0.005 / CV |
| Embeddings | Voyage `voyage-3` | £0.0002 / item |
| Match explanation | Sonnet | £0.02 / explanation |
| Voice transcription | Whisper API | £0.005 / minute |
| Spec call structuring | Sonnet | £0.05 / spec |
| Outreach personalisation | Sonnet | £0.01 / email |
| Reporting query | Sonnet | £0.02 / query |
| Conversation summary | Sonnet | £0.05 / summary (cached) |

Cache aggressively. Regenerate only on material change. Expect £20–50/month per agency at normal usage.

---

## Recruitment domain specifics — first-class, not retrofitted

Things that distinguish a recruitment CRM from a generic CRM. Most of these are missing or weak in generic CRMs (and surprisingly weak in some incumbents too).

### Right to Represent (RTR)

Candidate agrees to be represented by one agency for a specific role. Critical for fee defence if the candidate then applies direct. Tracked as:
- RTR signed (date, role, client)
- Expiry / scope
- Linked to application records
- Visible warning if a candidate is already RTR'd for a competing role

### Source attribution

Where did this candidate come from? Drives marketing ROI. Captured automatically where possible (apply form referrer, LinkedIn extension, email forward, manual add) and reportable as "placements per source" — direct buyer-value signal.

### Shortlists / hot lists

Per-job working set. Recruiters drag candidates onto a shortlist before submitting. Different from "applications" — shortlist is internal working state, applications are formal stages. Often used for spec/float submissions.

### Float / spec CVs

Speculative submission of a candidate to a client without a specific job ("you should meet this person"). Tracked as a special application type so it doesn't pollute the standard pipeline but still counts toward submission stats.

### Commission tracking

Recruiters' commission depends on placements, often tiered (e.g. 10% of fee under threshold, 20% above). Captured at placement time. Per-recruiter monthly commission report. Critical for recruiter engagement and for the agency's P&L visibility (which directly affects sale valuation).

### Referrals

Candidate refers another candidate. If referred candidate is placed, original earns a referral fee. Tracked as a `referrer_candidate_id` on candidates + a payout event on placement.

### Backfill vs new role

Hiring context matters for matching and pricing. Backfills have urgency and known performance bar; new roles have ambiguity. Flag on job records.

### Fee structures

- **Perm**: % of first-year salary (default 20%, configurable per client agreement)
- **Contract/Temp**: margin = (charge rate − pay rate) per timesheet hour
- Client-specific overrides via `client_fee_agreements` table

### Right-to-work / compliance

UK-specific. Track right-to-work check date, document type, expiry. For contract roles also IR35 status. Phase 6 adds onboarding compliance flows for offshore tickets (BOSIET, MIST, OPITO etc.) if the sector wedge is chosen.

---

## Data model (high-level, multi-tenant)

Every table carries `organization_id` with RLS enforcement.

| Table | Purpose |
|---|---|
| `organizations` | Tenants — agencies. Tier, settings, branding |
| `users` | Recruiters within organisations |
| `companies` | Clients of the agency |
| `client_fee_agreements` | Per-client fee terms |
| `contacts` | People at client companies |
| `candidates` | Standard fields + `market_status`, `source`, GDPR fields, `referrer_candidate_id` |
| `candidate_embeddings` | pgvector column, regenerated on material change |
| `candidate_cvs` | File storage + parsed text + AI-extracted structured data + version history |
| `jobs` | Linked to companies, `job_type` (perm/temp/contract), `hiring_context` (new/backfill), status |
| `job_embeddings` | pgvector column |
| `shortlists` + `shortlist_candidates` | Per-job working sets |
| `applications` | Junction candidate↔job with stage, decline reason (structured), `application_type` (standard/spec/float) |
| `rtr_agreements` | Right to represent records |
| `placements` | Completed deals — fee, start date, commission events |
| `commission_events` | Per-recruiter payouts on placements |
| `assignments` (Phase 6, temp) | Pay rate, charge rate, IR35 status, contract dates |
| `timesheets` (Phase 6, temp) | Weekly hours, approval status |
| `activities` | Calls / emails / meetings / notes, polymorphically linked |
| `ai_summaries` | Cached AI outputs (history summaries, match explanations) |
| `documents` | GDPR consents, RTRs, contracts |
| `audit_log` | Who accessed what, when (read-only) |
| `subscriptions` | Stripe-synced billing state per org |

---

## Module breakdown

### 1. Candidate intake & ATS — *anchor priority*

Three intake routes, all auto-populating one record + generating embeddings:

- **Public apply form** — CV upload, availability, salary, GDPR consent. Haiku parses, Voyage embeds, candidate created.
- **CV email inbox** — agency forwards CVs to `apply@…`; webhook parses and creates.
- **LinkedIn Chrome extension** (Phase 3) — one-click capture from profile pages.

`market_status` field: actively / passively / hot (recently made redundant) / placed / cold. Date-stamped.

### 2. Candidate journey / pipeline

Stages: **applied → screening → CV submitted → 1st interview → 2nd interview → offer → placed**, with mandatory structured decline reasons at any rejection. Kanban view per job. Auto-stamps stage changes in activity log. Decline reasons structured so they're analysable.

### 3. Client management & repeat business

List view sortable by activity / revenue / last contact. Per-client drill-down: active + historical jobs, contacts, revenue + LTV, days since last contact, win rate, fee agreement.

**Dormant client view** — auto-flags clients silent for 60/90 days with one-click outreach. Direct lever for sale valuation.

### 4. Semantic search & match — *the killer feature*

Natural-language search across candidates and jobs. Match scoring with Sonnet-generated explanations. "Find similar to this candidate" / "find jobs that might fit this candidate". Auto-suggest candidates when a new job is created.

### 5. LinkedIn integration

**Inbound** (Phase 3): Chrome extension scrapes visible profile, sends to API, creates/updates candidate + embedding. ~3–5 days build.

**Outbound automated marketing**: not building. LinkedIn aggressively detects automation and bans accounts. **Substitute**: excellent email marketing — segmented by `market_status`, AI-personalised via Sonnet, scheduled via Resend.

### 6. GDPR

- **Consent capture**: explicit checkbox on apply form (basis: consent). Sourced candidates: basis = legitimate interest, recorded.
- **Lifecycle**: `consent_basis` + `consent_at` on candidate. Auto-flag review at 12 and 24 months.
- **Self-service**: tokenised link gives candidates a page to view, update, or delete their data. Owner notified.
- **Audit log**: read-only. Critical for compliance and any future diligence.

### 7. Reporting — *the asset-value engine*

Buyer dashboards:
- Placements per recruiter per quarter
- Time-to-fill average + by sector
- Source ROI (placements per source)
- Repeat client rate
- Pipeline value (open jobs × stage probability × fee)
- Database engagement (last contacted, response rates)
- Commission summary per recruiter

Plus natural-language reporting (see AI Layer §9).

### 8. Temp / contract *(Phase 6)*

Assignments, timesheets, IR35, umbrella/PAYE handling, renewal flows, margin reporting. Out of scope for v1. Schema supports it.

### 9. SaaS infrastructure

Built in Phase 5 when ready for customer #2:
- Self-service signup with org creation
- Stripe subscription + billing portal
- Per-org branding (logo, colours on careers site)
- Admin / super-admin support tooling
- Onboarding flow (tour, sample data, CSV import)
- Documentation site + marketing site
- Status page

---

## Phased roadmap

| Phase | Scope | Effort PT |
|---|---|---|
| **1** | Multi-tenant schema with pgvector, auth, candidate + client + jobs CRUD, basic pipeline, CV upload + AI parsing + embedding, GDPR consent, audit log | ~3 weeks |
| **2** | Semantic search + match scoring with explanations, public apply form, Gmail OAuth for email logging, basic dashboards | ~2 weeks |
| **3** | LinkedIn Chrome extension (inbound), spec call → JD flow, AI job ad generation, shortlists, repeat-client view, source attribution reporting | ~2–3 weeks |
| **4** | Email marketing campaigns + AI personalisation, automated reminders, voice-note-to-data, natural-language reporting, full dashboards | ~2 weeks |
| **5** | SaaS shell — signup, Stripe billing, org admin, onboarding, basic marketing site | ~2–3 weeks |
| **6** | Temp / contract — assignments, timesheets, IR35, billing flows | ~3 weeks |

Milestones:
- End Phase 1: anchor customer uses it internally
- End Phase 3: competitive with Firefish core for perm + meaningfully ahead on AI
- End Phase 5: ready for paying customer #2
- End Phase 6: full perm + temp coverage

Total to "ready for customer #2": **~12–14 weeks PT**. With temp: **~15–17 weeks PT**.

---

## Build vs buy vs SaaS market entry

| Item | Build (SaaS) | Use Firefish |
|---|---|---|
| Setup time | ~12+ weeks | ~1 week |
| Build cost | ~12+ weeks PT | £0 |
| Monthly running (1 customer) | £40–80 | £160–240 |
| Monthly running (~20 customers) | £200–400 | n/a |
| Anchor customer cost | £0 | £160–240/mo |
| Maintenance | Ongoing (you) | Vendor |
| Data ownership | Full | Export only |
| Customisation | Full | Limited |
| Buyer perception (for anchor's exit) | Bespoke = key-person risk | Recognised SaaS — easier |
| SaaS revenue potential | Yes if positioning works | None |

---

## Questions for the anchor customer

1. **Sector mix today** — % perm vs temp/contract? Drives Phase 6 urgency.
2. **Invoicing** — CRM generates invoices, or Xero/QuickBooks handles?
3. **What does he actually hate about Firefish?** — gold for where the build can win.
4. **Realistic agency-sale timeline** — 2 years vs 7 years changes how aggressively we optimise for buyer-readiness.
5. **Is he OK being case study + reference customer** for the SaaS? Align early.
6. **Voice workflow appetite** — would he record spec calls / dictate notes? Drives whether Phase 3 voice features earn ROI.

---

## Suggested next step

Get him on a 30-min call to confirm modules match his mental model and lock down sector mix. If go: scaffold Supabase schema + Next.js multi-tenant starter via Claude Code, working Phase 1 together.
