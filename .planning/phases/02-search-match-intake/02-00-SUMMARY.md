---
phase: 02-search-match-intake
plan: "00"
subsystem: database
tags: [voyage-ai, pgvector, supabase, migrations, rls, inngest, encryption, turnstile, typescript]

# Dependency graph
requires:
  - phase: 01-internal-ats
    provides: "candidates/jobs tables, audit_log, RLS helpers, Inngest client, claude.ts wrapper, Phase 1 migrations"
provides:
  - "Voyage AI embed wrapper (voyage.ts) with mandatory ai_usage cost logging"
  - "embed-text.ts helpers for building candidate/job embedding inputs"
  - "match.ts wrapper (scoreCandidateForJob) — calls claude.ts without new Anthropic instance"
  - "encryption.ts AES-256-GCM helpers for token storage"
  - "turnstile.ts Cloudflare server-side verification"
  - "apply-form-blocklist.ts disposable email domain filter"
  - "Six Phase 2 migrations: ai_summaries, outlook_credentials, apply_form_rate_limits, record_audit_anonymous, hnsw_build_state, organizations extensions"
  - "match_candidates + match_jobs RPCs (RRF k=60 hybrid semantic+trigram)"
  - "invalidate_candidate_embedding + invalidate_job_embedding triggers"
  - "src/lib/db/{embeddings,ai-summaries,outlook-credentials}.ts db helper skeletons"
  - "(public) route group with minimal layout"
  - "Middleware updated: /apply, /api/outlook/callback, /api/outlook/webhook allowed without auth"
affects: [02-01-semantic-search, 02-02-ai-match-scoring, 02-03-public-apply-form, 02-04-outlook-integration]

# Tech tracking
tech-stack:
  added:
    - "voyageai@^0.2.0 — ESM-only; requires serverExternalPackages in next.config.ts"
    - "@azure/msal-node@^5 — MSAL for Outlook OAuth (replaces googleapis after Gmail pivot)"
    - "@microsoft/microsoft-graph-client@^3 — Graph API client"
    - "@marsidev/react-turnstile — Cloudflare Turnstile widget"
  patterns:
    - "Single VoyageAIClient instance in voyage.ts (grep invariant: must stay one line)"
    - "runWithLogging exported from claude.ts so match.ts can call it without new Anthropic"
    - "All embed costs written to ai_usage via record_ai_usage() — non-negotiable"
    - "AES-256-GCM packed format: base64(iv):base64(authTag):base64(ciphertext)"
    - "<table>_verify_same_org_check trigger naming convention (v > s alphabetical sort ensures guard fires after set_org)"
    - "record_audit_anonymous granted to service_role only — anonymous actor audit path"

key-files:
  created:
    - "src/lib/ai/voyage.ts"
    - "src/lib/ai/embed-text.ts"
    - "src/lib/ai/match.ts"
    - "src/lib/encryption.ts"
    - "src/lib/integrations/turnstile.ts"
    - "src/lib/legal/apply-form-blocklist.ts"
    - "src/lib/db/embeddings.ts"
    - "src/lib/db/ai-summaries.ts"
    - "src/lib/db/outlook-credentials.ts"
    - "src/app/(public)/layout.tsx"
    - "supabase/migrations/20260519092943_phase2_organizations_extensions.sql"
    - "supabase/migrations/20260519092944_ai_summaries.sql"
    - "supabase/migrations/20260519092945_outlook_credentials.sql"
    - "supabase/migrations/20260519092946_apply_form_rate_limits.sql"
    - "supabase/migrations/20260519092947_record_audit_anonymous.sql"
    - "supabase/migrations/20260519092948_hnsw_build_state.sql"
    - "supabase/migrations/20260519092949_match_candidates_rpc.sql"
    - "supabase/migrations/20260519092950_match_jobs_rpc.sql"
    - "supabase/migrations/20260519092951_invalidate_embeddings_triggers.sql"
    - "tests/unit/lib/ai/embed-text.test.ts"
    - "tests/unit/lib/encryption.test.ts"
    - "tests/unit/lib/legal/apply-form-blocklist.test.ts"
  modified:
    - "src/lib/ai/claude.ts — export runWithLogging"
    - "src/lib/env.ts — Phase 2 server/client env vars"
    - "src/lib/supabase/middleware.ts — PUBLIC_PATHS extended"
    - "src/types/database.ts — regenerated"
    - ".env.example — Phase 2 block added"
    - "package.json — Phase 2 deps"
    - "next.config.ts — serverExternalPackages: ['voyageai']"

key-decisions:
  - "D2-04: Hybrid search via single RPC + RRF k=60 — semantic + trigram fusion in one Postgres function"
  - "D2-05: HNSW deferred — bootstrap-vector-index signals operator; actual CREATE INDEX CONCURRENTLY runs manually via Supabase Dashboard"
  - "D2-16: Generalised EMAIL_TOKEN_ENCRYPTION_KEY (not OUTLOOK_*) so Gmail adapter in Phase 5 can reuse"
  - "D2-20: _verify_same_org_check suffix on FK guard triggers (alphabetical sort ensures correct order)"
  - "voyageai ships ESM-only: next.config.ts serverExternalPackages required"
  - "Gmail pivot to Outlook (Microsoft 365) before any code shipped — anchor agency runs M365"

patterns-established:
  - "Single VoyageAIClient instance: grep -rn 'new VoyageAIClient' src/ must return exactly one line"
  - "Embed cost always logged to ai_usage via record_ai_usage() — never skip"
  - "AES-256-GCM packed format for token encryption"
  - "record_audit_anonymous: service_role only, actor_user_id = null"
  - "Trigger naming: <table>_verify_same_org_check sorts after <table>_set_org"

requirements-completed: []

# Metrics
duration: "unknown — backfilled"
completed: "2026-05-19"
---

# Phase 2 Plan 0: Hardening & Infrastructure Summary

_Backfilled on 2026-05-23 from VERIFICATION/LEARNINGS/REVIEW + git log; some execution-time detail (exact durations, granular deviation list) is approximate._

**Voyage AI wrapper, AES-256-GCM encryption, hybrid RRF search RPCs, six Phase 2 migrations with FK guards, and (public) route group — the complete foundation layer for Phase 2 feature plans**

## Performance

- **Duration:** unknown — backfilled
- **Started:** unknown
- **Completed:** 2026-05-19
- **Tasks:** 4
- **Files modified:** ~30

## Accomplishments
- Installed and wired Voyage AI SDK (voyage-3 embeddings) with mandatory ai_usage cost logging; single-instance grep invariant established
- Created six migrations: ai_summaries (with cross-tenant FK guard), outlook_credentials, apply_form_rate_limits, record_audit_anonymous, hnsw_build_state, organizations extensions
- Shipped match_candidates + match_jobs RPCs with RRF k=60 hybrid semantic+trigram fusion and embedding invalidation triggers
- Exported runWithLogging from claude.ts enabling match.ts to call Sonnet without a second Anthropic instance; encryption.ts, turnstile.ts, blocklist.ts skeletons all with server-only enforcement
- Regenerated src/types/database.ts from linked Supabase; cleared Phase 1 // reason: pending regen casts

## Task Commits

1. **Task 0.1: Phase 2 env vars + deps install** — `56a9d86` (feat)
2. **Task 0.2: Voyage/match/encryption/Turnstile skeletons** — `56c46c3` (feat)
3. **Task 0.3: Six Phase 2 migrations** — `6208e7b` (feat)
4. **Task 0.4: match RPCs + invalidation triggers + db helpers + (public) group** — `59e964b` (feat)
5. **Type regen follow-up** — `9cf5c78` (chore)

## Files Created/Modified
- `src/lib/ai/voyage.ts` — VoyageAIClient singleton + embed() with ai_usage write
- `src/lib/ai/embed-text.ts` — candidateEmbeddingText / jobEmbeddingText pure helpers
- `src/lib/ai/match.ts` — scoreCandidateForJob via exported runWithLogging
- `src/lib/ai/claude.ts` — runWithLogging exported (one-line delta)
- `src/lib/encryption.ts` — AES-256-GCM encrypt/decrypt with packed iv:authTag:ciphertext
- `src/lib/integrations/turnstile.ts` — Cloudflare Turnstile server-side verification
- `src/lib/legal/apply-form-blocklist.ts` — disposable email domain blocklist
- `src/lib/db/embeddings.ts` — hybridSearchCandidates/Jobs, getTopCandidatesByVector helpers
- `src/lib/db/ai-summaries.ts` — getMatchSummary, upsertMatchSummary, listMatchSummariesForJob, deleteStaleMatchSummaries
- `src/lib/db/outlook-credentials.ts` — token CRUD helpers (all fields are ciphertext)
- `src/app/(public)/layout.tsx` — minimal layout with "Powered by Altus" footer
- `src/lib/supabase/middleware.ts` — /apply + /api/outlook/* added to PUBLIC_PATHS
- `src/lib/env.ts` — VOYAGE_API_KEY, EMAIL_TOKEN_ENCRYPTION_KEY, OUTLOOK_*, TURNSTILE_* vars
- `next.config.ts` — serverExternalPackages: ['voyageai']
- Six migrations under supabase/migrations/2026051909294*

## Decisions Made
- voyageai ships ESM-only; Next.js bundler trips on it → serverExternalPackages required (LEARNINGS §4)
- D2-05: HNSW CREATE INDEX CONCURRENTLY cannot run inside supabase-js (no raw DDL path); committed to manual-DDL option (b) — function signals operator via Sentry breadcrumb
- D2-20: _verify_same_org_check trigger name sorts after _set_org alphabetically — load-bearing for trigger ordering (Phase 1 regression lesson)
- Gmail → Outlook pivot completed before any email code shipped (LEARNINGS §D2-15)

## Deviations from Plan
This is a backfilled summary. Per VERIFICATION/REVIEW, all eight VERIFICATION patches (3 BLOCKERs + 5 WARNINGs) were applied inline before execution:
- M-1 (BLOCKER): HNSW DDL → manual operator gesture only (bootstrap-vector-index writes state, does not run DDL)
- M-2 (BLOCKER): storagePath tenant assertion added explicitly in Plan 3 Task 3.2
- M-3 (BLOCKER): webhook fail-closed on missing env (adapted to OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET in Plan 4)
- W-1 through W-4: applied as code comments and documentation

## Issues Encountered
- voyageai ESM-only build break: fixed via serverExternalPackages (LEARNINGS §4)
- Multiple type regen rounds as new migrations landed through the phase

## User Setup Required
- VOYAGE_API_KEY (Voyage AI)
- EMAIL_TOKEN_ENCRYPTION_KEY (32 random bytes, hex-encoded: openssl rand -hex 32)
- OUTLOOK_* env vars (see docs/outlook-integration-setup.md)
- TURNSTILE_SECRET_KEY / NEXT_PUBLIC_TURNSTILE_SITE_KEY (Cloudflare Turnstile)

## Next Phase Readiness
- All Phase 2 feature plans (01–04) can build directly on the infrastructure shipped here
- Single-instance invariants (Anthropic, VoyageAIClient) established and enforced
- Hybrid search RPCs callable by Plans 1–2; apply form infrastructure ready for Plan 3; encryption + Outlook credential helpers ready for Plan 4

---
*Phase: 02-search-match-intake*
*Completed: 2026-05-19*
