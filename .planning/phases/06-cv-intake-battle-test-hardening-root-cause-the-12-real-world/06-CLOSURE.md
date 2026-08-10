# 06-CLOSURE — Phase 6: CV Intake Battle-Test & Hardening

**Closed:** 2026-08-10
**Prod deploy:** main `2a9ddf9` (phase merged at `c0bc1c8`, smoke hardening on top)

## Wave 8 — retry of the 12 real production failures

Founder authorization: 2026-08-10 ("I am happy for you to push the changes
yourself") — retries driven server-side by the orchestrator via the original
`cv/uploaded` events (dedup ids `phase6-retry12:<cvId>`), re-parsing the
customer's own stored files through the FIXED pipeline. The only customer-org
write of the phase, exactly as the plan scoped it.

| Metric | Result |
|---|---|
| Retried rows | 12 (10 PDF, 2 DOCX — the 5-6 Aug bulk-upload failures) |
| Reached `complete` | **12 / 12** |
| Distinct candidates with populated profiles (skills > 0) | **10 / 10** |
| Rows still failed | 0 |
| AI cost | ~12 Haiku parses + embeds, pennies, customer org (their own files) |

Attribution: deterministic layer-2 regression tests (tests/integration/
cv-write-path.test.ts) reproduce each fixed class against real Postgres, so
this green is attributable to the Wave-4 coercion/sanitisation boundary —
not luck. Forensics (06-FORENSICS.md) had already proven all 12 extract
clean and parse successfully; only the write stage ever failed.

## Migration status (enumerated fresh from disk + live ledger, 2026-08-10)

Applied ledger tail: `20260708120000` (nothing after). **ALL SIX pending:**

| File | Status | What it does |
|---|---|---|
| 20260804120000_candidate_cvs_parse_error_detail.sql | UNAPPLIED | durable PII-free failure cause (code degrades gracefully until applied) |
| 20260804120100_revoke_anon_execute_security_definer.sql | UNAPPLIED | SECURITY: revoke anon EXECUTE on 11 SECURITY DEFINER fns |
| 20260804130000_set_created_by_trigger.sql | UNAPPLIED | created_by attribution trigger (5 tables) |
| 20260804130100_stripe_webhook_event_status.sql | UNAPPLIED | webhook status ledger columns |
| 20260804140000_record_audit_view_dedupe.sql | UNAPPLIED | audit view-dedupe (search events excluded) |
| 20260804140100_revoke_anon_execute_set_created_by.sql | UNAPPLIED | revoke anon on set_created_by() |

Apply via the founder's manual flow ONLY: `pnpm exec supabase db push --linked`
(GitHub auto-apply unreliable; MCP apply_migration drifts the ledger version —
known since 2026-07-08; both CLI and MCP paths are also permission-blocked for
the agent in this environment — attempted and refused 2026-08-10).

## The three-layer regression harness (permanent)

1. `pnpm test` — extraction corpus (26 fixtures incl. BOM/junk-prefixed PDFs) +
   coercion/sanitiser units + PII tripwire. DB-free, runs everywhere.
2. `pnpm test:integration` — real local Postgres write path (fails LOUD if the
   stack is down; `CI_SKIP_INTEGRATION=1` opts out loudly).
3. `pnpm smoke:auth` (cv-intake spec) — live browser against prod, founder org
   only (fail-closed `SMOKE_ALLOWED_USER_ID` guard), asserted cleanup.
   Regenerate fixtures: `pnpm fixtures:regen` (byte-stable).

## Contract now enforced in production

Every upload parses OR fails immediately with a message naming the specific
cause; retry appears only where retrying can work. Verified 8/8 in a live
browser on production, 2026-08-10.
