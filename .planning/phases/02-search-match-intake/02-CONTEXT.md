# Phase 2: Search, Match & Intake — Context

**Gathered:** 2026-05-18
**Status:** Ready for planning
**Note:** No discuss-phase run for Phase 2. Decisions below were locked from the 10 open questions surfaced in `02-RESEARCH.md` after the user accepted all recommended defaults.

<domain>
## Phase Boundary

Phase 2 delivers the **differentiating AI capability** that makes Altus competitive with established CRMs: semantic search across the candidate database, AI-scored match explanations on each job, a public apply form, and Gmail-imported inbound email logged automatically to candidate timelines. These are the features that justify the "AI-first, not bolted-on" positioning.

**In scope:**
- Voyage AI `voyage-3` embeddings on candidates + jobs, populated on CV parse / JD change
- Hybrid Reciprocal Rank Fusion search across pgvector cosine + pg_trgm trigram
- Sonnet-generated match scores (0–100) with 2–3 strengths + 1–2 gaps + 3 screening questions, cached in a new `ai_summaries` table
- Public `/apply/[org_slug]` form with GDPR consent, signed-upload-URL CV ingestion, layered abuse defence (Turnstile + rate limit + honeypot + blocklist)
- Gmail OAuth "Connect Gmail" flow with `gmail.readonly` scope; inbound emails sync via Gmail Pub/Sub push notifications; activity rows store subject + 200-char snippet only
- `organizations.slug` column for apply-form URL shape

**Out of scope (deferred):**
- LinkedIn capture, voice spec calls, shortlists (Phase 3)
- Outbound email campaigns, voice notes, reporting dashboards (Phase 4)
- HNSW vector index build at scale (manual Inngest trigger once ≥100 candidates accumulate — Phase 2 builds the trigger function, doesn't fire it)
- Storing full Gmail bodies (deferred to Phase 4 if voice/marketing needs it)
- Google OAuth as the sign-in provider (Phase 5 SaaS shell if useful)

</domain>

<decisions>
## Implementation Decisions

### Embeddings & Search

- **D2-01 (Q1):** Candidate embedding input is **hybrid** — a structured summary block (parsed `name`, `current_role_title`, `current_company`, `location`, `skills[]`, `seniority_level`, `years_experience`, `sector_tags[]` concatenated with field labels) PLUS the first ~30,000 characters of raw CV text. Truncate to fit Voyage's 32k token limit. Job embedding mirrors with `title`, `location`, `job_type`, `hiring_context`, salary range + `description` body.
- **D2-02:** Voyage SDK (`voyageai` npm package), gated through a new `src/lib/ai/voyage.ts` wrapper that mirrors `claude.ts` — model selection, retry/backoff, **mandatory `record_ai_usage` write** on every embed call (CLAUDE.md non-negotiable; cost ~£0.005 per CV).
- **D2-03:** Re-embed only when source changes materially. Track `embedding_version` integer and `embedded_at` timestamp on both `candidates` and `jobs` rows (columns already exist from Phase 1 schema). Inngest functions `embedCandidateOnCVParse` (extends Plan 2's `parseCVOnUpload`) and `embedJobOnJDChange` (fires on job create + description update).
- **D2-04 (Q3):** Search ranking is **Reciprocal Rank Fusion** — a single Postgres RPC `search_candidates_hybrid(query_text, query_embedding, limit, offset)` that blends pgvector cosine distance (`<=>` with `halfvec_cosine_ops`) rank with pg_trgm similarity rank using RRF (k=60). No UI toggle. Trigram path already exists from Phase 1; semantic path is additive.
- **D2-05 (Q10):** HNSW vector index is **manually triggered** via an Inngest event once the org has ≥100 candidates with embeddings. The migration creates an `hnsw_build_state` table tracking per-org build status; the function uses `CREATE INDEX CONCURRENTLY` (per org? or global? — global per migration; HNSW must apply at table level not per tenant). Phase 2 ships the trigger/utility; building can happen later.

### Match scoring (Sonnet)

- **D2-06 (Q2):** Match scoring is **hybrid** — on job create, an Inngest function precomputes match scores for the top-10 candidates returned by the hybrid search RPC. On job-detail page render, any missing top-N matches are filled on-demand. Cache hits skip Sonnet entirely.
- **D2-07:** `ai_summaries` table caches each `(candidate_id, job_id, candidate_embedding_version, job_embedding_version)` match. Cache invalidates automatically when either embedding version increments. Schema includes `score smallint`, `strengths text[]`, `gaps text[]`, `screening_questions text[]`, `model text`, `cost_pence integer`, plus the standard `organization_id` + audit cols.
- **D2-08:** Sonnet tool-use with a strict JSON schema (similar to Phase 2's CV extract). Cap input at the candidate's structured summary + JD structured summary (no raw CV / JD body) to control cost — match scoring should be ~0.7p per call.
- **D2-09:** All match scoring goes through `src/lib/ai/match.ts` (new wrapper around `src/lib/ai/claude.ts`). The Sonnet call writes `record_ai_usage` with `purpose='match_score'`.

### Public apply form

- **D2-10 (Q4):** Route is **path-based** at `/apply/[org_slug]` under the existing `(public)` route group. New `organizations.slug` column with `text not null unique check (slug ~ '^[a-z0-9-]{3,40}$')` constraint. Org-create flow (Phase 1 settings) extended to auto-generate slug from name (kebab-cased, deduplicated).
- **D2-11 (Q5):** CV upload uses **Supabase signed upload URLs** — server action mints a single-use upload URL scoped to `{org_id}/applicants/{uuid}.pdf`, browser uploads direct to Storage, then a follow-up server action confirms upload + creates the candidate row. Bypasses Next.js 4.5 MiB body limit, supports 10 MiB cap from Phase 1.
- **D2-12 (Q9):** **Layered abuse defence**: Cloudflare Turnstile token validation on submit; per-IP+email rate limit (5 submissions per 24h via Inngest Concurrency or a simple in-memory + Postgres-backed counter); honeypot hidden field; email blocklist (env-configured list of bouncing domains); required GDPR consent checkbox with explicit consent text.
- **D2-13:** Apply-form creates `candidates` row with `source='apply_form'`, `market_status='actively_looking'`, `consent_basis='consent'`, `consent_at=now()`, `consent_text_version=CURRENT_CONSENT_VERSION`. Triggers the existing Inngest `parseCVOnUpload` event so the CV parses in the background.
- **D2-14:** `record_audit` is extended to support an anonymous actor (the apply path has no `auth.uid()`). New helper `record_audit_anonymous(action, entity_type, entity_id, source)` or extend the existing function with a nullable actor. Apply-form submissions audit-log as `action='create', entity_type='candidate', actor=null, metadata={"source":"apply_form","ip":"..."}`.

### Gmail integration

- **D2-15 (Q6):** Magic-link sign-in stays as the primary auth path. Gmail integration is a **separate** "Connect Gmail" flow in settings: starts a Google OAuth handshake with `gmail.readonly` scope using the `googleapis` SDK (NOT Supabase Auth Google provider — Supabase's standard scopes don't include Gmail).
- **D2-16 (Q7):** Refresh + access tokens stored in a new `gmail_credentials` table, **encrypted application-side with aes-256-gcm**. Encryption key in env (`GMAIL_TOKEN_ENCRYPTION_KEY`, 32 random bytes hex-encoded). Decrypt only inside `src/lib/integrations/gmail.ts` server-side helpers; never sent to client. RLS scopes the row to `user_id = auth.uid()`.
- **D2-17:** Inbound sync uses **Gmail History API + Pub/Sub push notifications** (not polling). One-time setup: register a Pub/Sub topic, subscribe Gmail's `watch` endpoint pointed at our webhook. JWT-verified push deliveries hit a route handler at `/api/gmail/push` which dispatches an Inngest event per message. Re-register `watch` every 7 days via a daily Inngest schedule (Gmail's `watch` expires after 7 days).
- **D2-18 (Q8):** Activity rows for Gmail-imported emails store **subject + 200-character snippet only** (not full body). `kind='email'`, `body='{subject}'`, `metadata={"snippet":"...", "gmail_message_id":"...", "thread_id":"...", "from":"...", "to":"..."}`. Data minimisation; full-body storage deferred to Phase 4 if voice features need it.
- **D2-19:** Inbound-to-candidate matching: the email's from/to addresses are looked up against `candidates.email` and `contacts.email` within the org. Orphans (no match) are skipped — not stored, not logged. A future Phase 3 task may surface orphans for manual association.

### Cross-cutting

- **D2-20 (R1):** **Every new FK to a tenant-scoped table needs a `verify_same_org_check` trigger** following the Phase 1 bugfix pattern (commit `3f748f8`). New tables this phase: `ai_summaries` (FKs to `candidates` + `jobs`), `gmail_credentials` (FK to `users`, but `users` is already tenant-scoped via `organization_id`). Use `<table>_verify_same_org_check` naming so trigger sorts AFTER `<table>_set_org` alphabetically.
- **D2-21:** Re-generate `src/types/database.ts` **early in Phase 2** (Plan 0 of this phase, before any new code). Phase 1 left it pre-regen with `// reason: pending regen` casts. Plans should attempt `pnpm db:types` against the cloud (`--linked`) or fall back to a snapshot strategy. Cleaning this up gives Phase 2 code typed access to `move_application`, `search_candidates`, `search_clients`, `client_activity_timeline`.
- **D2-22:** All Voyage + Sonnet match calls log to `ai_usage` per CLAUDE.md non-negotiable. Per-tenant cost tracking via `purpose='cv_embed' | 'jd_embed' | 'match_score' | 'gmail_sync'` (no AI cost for Gmail sync; it's only there as a token-bucket category if useful for ops).

### Claude's Discretion

- Specific Inngest function granularity (one function per task vs grouped) — planner can decide based on retry semantics
- The exact RRF k constant (60 is the convention; could go 30–100; planner picks)
- Pub/Sub topic naming + Cloud project setup specifics (out-of-band IaC; planner produces a runbook entry)
- Whether `gmail_credentials.user_id` should be the only key (one Gmail account per recruiter) or composite with `organization_id` (recruiter has different Gmail in different orgs — unlikely for Phase 1 anchor)
- The exact apply-form Turnstile site key + secret key wiring (env vars + free-tier signup)
- Whether to emit a separate Inngest function `matchCandidateToJob` or have `matchJobAgainstCandidatePool` iterate top-N — planner picks based on parallelism tradeoffs

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs and conventions
- `CLAUDE.md` — Core principles, conventions, tech-stack lock, "what to never do"
- `docs/plan.md` — Strategic plan, full data model, AI integration patterns, cost model
- `docs/ai-integration.md` — AI patterns and model selection
- `docs/recruitment-glossary.md` — Domain term definitions

### Phase 2 planning artifacts
- `.planning/phases/02-search-match-intake/02-CONTEXT.md` — this file
- `.planning/phases/02-search-match-intake/02-RESEARCH.md` — full research output with code skeletons, library picks, pitfalls
- `.planning/phases/02-search-match-intake/02-PATTERNS.md` — to be produced by pattern-mapper

### Phase 1 carry-forward (read for context + invariants)
- `.planning/phases/01-internal-ats/01-LEARNINGS.md` — 35 entries; especially the trigger-ordering bug and the FK guard pattern
- `.planning/phases/01-internal-ats/01-CONTEXT.md` — Phase 1 locked decisions; many invariants (D-08, D-16, RLS-first, single Claude wrapper) carry forward unchanged
- `.planning/phases/01-internal-ats/01-PATTERNS.md` — file-by-file conventions, propagated to Phase 2

### Project state
- `.planning/PROJECT.md` — Project context, requirements, Key Decisions
- `.planning/REQUIREMENTS.md` — REQ-IDs; Phase 2 covers SEARCH-01..04, MATCH-01..03, APPLY-01..02, EMAIL-01
- `.planning/ROADMAP.md` — Phase 2 entry with the 4 success criteria

### Migrations (read-only — never edit)
- All 14 migrations in `supabase/migrations/` (Phase 1 + the trigger-order fix). `candidates` + `jobs` already have `*_embedding halfvec(1024)`, `embedding_version`, `embedded_at` columns reserved for Phase 2.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets from Phase 1
- `src/lib/ai/claude.ts` — Claude wrapper with `record_ai_usage` logging, retry on 429/529. **Phase 2's match scoring extends this; Voyage gets its own sibling `src/lib/ai/voyage.ts`.**
- `src/lib/inngest/client.ts` + `src/app/api/inngest/route.ts` — Inngest is registered; Phase 2 adds 4 new functions to the registered array.
- `src/lib/inngest/functions/parse-cv.ts` — Plan 2 of Phase 1 establishes the 4-step Inngest pattern. Phase 2's `embedCandidateOnCVParse` extends or chains from this.
- `src/lib/db/candidates.ts`, `src/lib/db/jobs.ts`, `src/lib/db/applications.ts` — db helpers exist; Phase 2 adds `src/lib/db/ai-summaries.ts`, `src/lib/db/gmail-credentials.ts`.
- `record_audit()`, `record_ai_usage()` SQL functions — extend `record_audit` to accept anonymous actor (D2-14).
- Storage bucket `cvs` from Phase 1 — Phase 2 reuses for the apply-form CV uploads. New path prefix `{org_id}/applicants/` may be added; RLS policies remain (only same-org reads).
- `src/lib/legal/consent.ts` — CURRENT_CONSENT_VERSION pattern; bump version when Phase 2 adds the apply-form-specific consent copy.

### New Phase 2 modules
- `src/lib/ai/voyage.ts` — Voyage SDK wrapper, mirrors `claude.ts` shape
- `src/lib/ai/match.ts` — Sonnet match-score wrapper, structured output via tool-use
- `src/lib/encryption.ts` — aes-256-gcm helper for Gmail token storage (D2-16)
- `src/lib/integrations/gmail.ts` — googleapis client wrapper, watch registration, History API consumer
- `src/lib/integrations/turnstile.ts` — Cloudflare Turnstile verify helper
- `src/lib/db/ai-summaries.ts` — match cache helpers
- `src/lib/db/gmail-credentials.ts` — encrypted token storage helpers
- `src/lib/db/embeddings.ts` — hybrid search RPC wrapper (returns ranked candidates)
- `src/inngest/functions/embed-candidate-on-cv-parse.ts` — Voyage embedding on CV parse complete
- `src/inngest/functions/embed-job-on-jd-change.ts` — Voyage embedding on job create/update
- `src/inngest/functions/precompute-matches-for-job.ts` — Sonnet match scoring batch
- `src/inngest/functions/sync-gmail-inbox.ts` — Gmail History API consumer
- `src/inngest/functions/refresh-gmail-watch.ts` — daily scheduled `watch` re-registration

### New routes
- `src/app/(app)/search/page.tsx` — semantic search UI (recruiter-facing)
- `src/app/(app)/jobs/[id]/matches/page.tsx` — auto-matched candidates with scores + explanations
- `src/app/(app)/settings/integrations/page.tsx` — Connect Gmail UI
- `src/app/(public)/apply/[orgSlug]/page.tsx` — public apply form
- `src/app/api/gmail/callback/route.ts` — OAuth callback (separate from existing `/auth/callback` magic-link route)
- `src/app/api/gmail/push/route.ts` — JWT-verified Pub/Sub push webhook
- `src/app/api/inngest/route.ts` — extend `functions: []` array with the 5 new functions above

</code_context>

<specifics>
## Specific Ideas

- The apply form should clearly show "Powered by Altus" branding for SaaS hygiene (Phase 5 makes per-org branding; Phase 2 ships the generic version).
- Match scoring's "strengths/gaps/screening questions" output structure is the *primary differentiator* in the demo. The output quality matters more than score numeric precision.
- The semantic search UI should support "natural language" queries explicitly, e.g., the search input placeholder reads: "e.g. senior Python developer with offshore wind experience in Aberdeen" — this is the ROADMAP success criterion verbatim.
- Gmail's `watch` expires every 7 days. Failing to refresh = silent sync failure. The daily Inngest schedule is non-negotiable; surface a Sentry alert if refresh fails.
- Pub/Sub push needs a publicly-accessible HTTPS endpoint (Vercel works; local dev needs `ngrok` or Inngest's dev mode). Document the local-dev path in the README.
- Voyage's `voyage-3` accepts up to 32k tokens (~120k chars) per input — but billing is per token, so cost-conscious truncation matters. 30k chars ≈ 7.5k tokens ≈ £0.0045 per embed. Stay well under the limit.

</specifics>

<deferred>
## Deferred Ideas

- **HNSW index actually built and serving searches** — Phase 2 ships the trigger; first build happens manually once anchor has ≥100 candidates. Empty-index searches use sequential scan (fine at small scale).
- **Full email body storage** — Phase 4 if voice / marketing features need it. Phase 2 stores subject + snippet only.
- **Outbound email** — Phase 4 (Resend integration, personalised campaigns).
- **Match scoring v2 with more context** (recruiter notes, candidate-job interaction history) — Phase 3+; v1 is structured-summary-only.
- **Recruiter-facing match feedback UI** ("this score was useful / not useful") — Phase 4 if we want to fine-tune Sonnet prompts based on signal.
- **Gmail outbox sending** — Phase 4. Phase 2 is read-only (`gmail.readonly` scope).
- **Multi-Gmail-account-per-user** — Phase 5 SaaS shell if needed.
- **`/match/[id]` standalone explanation page** — Phase 3. Phase 2 surfaces match in the job-detail "Matches" tab.

</deferred>

---

*Phase: 02-search-match-intake*
*Context locked: 2026-05-18 (defaults accepted from 02-RESEARCH.md Q1–Q10)*
