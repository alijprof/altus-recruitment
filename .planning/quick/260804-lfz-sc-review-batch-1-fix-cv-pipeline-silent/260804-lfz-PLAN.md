---
phase: quick-260804-lfz
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [SF-1, SF-2, SF-4, SF-5, SF-7, SEC-ANON-RPC]
source: .planning/audits/STEELE-CHARLES-FEATURE-REVIEW-2026-07-31.md (sections 2 + 4, Batch 1)
branch: quick/sc-review-fixes-260804 (already cut from main @ f7f7b50 — clean base, 0 ahead/0 behind)

files_modified:
  # Task 1 — Sentry
  - instrumentation-client.ts            # NEW (replaces sentry.client.config.ts)
  - sentry.client.config.ts              # DELETED
  # Task 2 — contracts + parse-cv truth-telling + apply unswallow (sub-steps 2.1-2.4)
  - src/lib/cv/parse-messages.ts         # NEW (shared copy + predicates)
  - src/lib/cv/reconcile-decisions.ts    # NEW (pure decision logic)
  - src/lib/ai/profile-completeness.ts   # NEW (pure predicate)
  - src/lib/db/candidate-cvs.ts
  - src/lib/inngest/functions/parse-cv.ts             # ALSO touched by Task 3 (Step 5 embed guard)
  - src/app/(public)/apply/[orgSlug]/actions.ts
  - supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql  # NEW (file only)
  - tests/unit/lib/cv/reconcile-decisions.test.ts        # NEW
  - tests/unit/lib/ai/profile-completeness.test.ts       # NEW
  - tests/unit/app/apply/confirm-action-inngest-fallback.test.ts  # UPDATED (behaviour changed)
  # Task 3 — reconciler + UI honesty + visibility + contamination guards (sub-steps 2.5-2.9)
  - src/lib/inngest/functions/reconcile-cv-parses.ts  # NEW
  - src/app/api/inngest/route.ts
  - src/lib/inngest/functions/embed-batch.ts
  - src/lib/inngest/functions/precompute-matches-for-job.ts
  - src/lib/ai/claude.ts
  - src/lib/db/dashboard.ts
  - src/app/(app)/candidates/[id]/cv-review-panel.tsx
  - src/app/(app)/page.tsx
  - src/app/(app)/_dashboard/cv-parse-health-widget.tsx  # NEW
  - src/app/(app)/jobs/[id]/matches/match-card.tsx
  # Task 4 — security
  - supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql  # NEW (file only)

must_haves:
  truths:
    - "A scanned/no-text PDF ends 'failed' with an honest 'no extractable text — retrying won't work' message that SURVIVES the Inngest onFailure handler, and the UI offers re-upload guidance instead of a doomed retry button."
    - "A failed candidate-profile merge no longer lands as 'complete': parse-cv throws on !result.ok so Inngest retries and onFailure marks the row honestly."
    - "The two existing production casualties (candidates 62783324-…, 3bf8ffe0-…) self-heal on the first reconciler run after deploy — their stored extracted_data is re-merged onto the candidate row."
    - "A candidate_cvs row stuck at 'pending' for >15 min is either re-enqueued (Storage object present) or flipped to 'failed' with an honest reason (object missing) — never an indefinite spinner."
    - "A budget-capped parse genuinely resumes automatically once the org's cap allows, making the existing 'resumes automatically' UI copy true."
    - "confirmApplyAction marks the CV row 'failed' when inngest.send throws, so the recruiter's Retry button actually renders."
    - "After the 5-minute poll cap the candidate page shows a 'taking too long — retry' state, not a permanent 'Parsing…'."
    - "Browser-side errors reach Sentry under Next 16 Turbopack via instrumentation-client.ts."
    - "Failed Claude attempts are recorded in ai_usage at 0 tokens / 0 cost, closing the calls-vs-parses telemetry gap."
    - "The dashboard surfaces an org-level count of failed + stale-pending CV parses (only when > 0) linking to the affected candidates."
    - "Candidates whose profile is effectively empty are not embedded and not match-scored; any pre-existing score is badged 'Profile incomplete'."
    - "anon can no longer EXECUTE the audited SECURITY DEFINER functions (migration staged as a file for the founder's manual push); record_audit_anonymous keeps working."
  artifacts:
    - path: "instrumentation-client.ts"
      provides: "Next 16 / Turbopack client-side Sentry init (SF-7)"
      contains: "Sentry.init"
    - path: "src/lib/cv/parse-messages.ts"
      provides: "Single source of truth for parse-failure copy + isBudgetCapped / isUnparseableSource predicates shared by server + client"
    - path: "src/lib/cv/reconcile-decisions.ts"
      provides: "Pure, unit-tested stuck-pending decision function (requeue / fail-no-file / fail-stuck / skip)"
    - path: "src/lib/ai/profile-completeness.ts"
      provides: "isProfileEffectivelyEmpty() — the embed + match-score contamination guard"
    - path: "src/lib/inngest/functions/reconcile-cv-parses.ts"
      provides: "15-min cron sweep: stuck-pending reconcile, budget-cap resume, unmerged-profile self-heal"
      contains: "reconcileCvParses"
    - path: "src/app/(app)/_dashboard/cv-parse-health-widget.tsx"
      provides: "Org-level failed + stale-pending CV parse visibility"
    - path: "supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql"
      provides: "parse_error_detail column for durable root-cause capture (FILE ONLY — founder pushes)"
    - path: "supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql"
      provides: "REVOKE EXECUTE FROM anon on the audited SECURITY DEFINER functions (FILE ONLY — founder pushes)"
  key_links:
    - from: "src/lib/inngest/functions/parse-cv.ts"
      to: "markCandidateFieldsFromCV result"
      via: "checked .ok + throw inside step.run('write-extracted')"
      pattern: "mergeResult.*\\.ok"
    - from: "src/lib/inngest/functions/parse-cv.ts (onFailure)"
      to: "existing honest parse_error"
      via: "preserveExistingMessage read-before-write in markCvFailed"
      pattern: "preserveExistingMessage"
    - from: "src/lib/inngest/functions/reconcile-cv-parses.ts"
      to: "cv/uploaded event"
      via: "inngest.send re-enqueue for stuck-pending rows with a Storage object"
      pattern: "cv/uploaded"
    - from: "src/lib/inngest/functions/reconcile-cv-parses.ts"
      to: "markCandidateFieldsFromCV"
      via: "heal-unmerged-profiles step (SF-2 remediation path)"
      pattern: "markCandidateFieldsFromCV"
    - from: "src/app/api/inngest/route.ts"
      to: "reconcileCvParses"
      via: "serve({ functions: [...] }) registration"
      pattern: "reconcileCvParses"
    - from: "src/app/(app)/candidates/[id]/cv-review-panel.tsx"
      to: "src/lib/cv/parse-messages.ts"
      via: "isBudgetCapped / isUnparseableSource predicates"
      pattern: "isUnparseableSource"
    - from: "src/lib/db/candidate-cvs.ts"
      to: "candidate_cvs.parse_error_detail"
      via: "defensive write with PGRST204 column-missing fallback"
      pattern: "PGRST204"
---

<objective>
Close the CV-pipeline silent-failure cluster found by the 2026-07-31 Steele Charles
feature review (SF-1, SF-2, SF-4, SF-5), resurrect the browser-side Sentry that would
have caught all of them (SF-7), and stage the anon-RPC lockdown migration.

Purpose: the anchor customer's recruiter fought a CV parse for 7 hours and lost with
nothing telling anyone; two candidates parsed "complete" but their data never reached
their profiles; four apply-form CVs are permanently stuck 'pending'; and the UI promises
a budget-cap auto-resume that no code performs. Every one of these is a lie the product
currently tells its only paying customer.

Output: honest failure states end-to-end, a reconciler that heals what is already broken
in production, org-level visibility, and two migration FILES for the founder to push.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/audits/STEELE-CHARLES-FEATURE-REVIEW-2026-07-31.md

Primary sources to read before editing (each ONCE — extract everything in one pass):
@src/lib/inngest/functions/parse-cv.ts
@src/lib/db/candidate-cvs.ts
@src/lib/inngest/functions/embed-batch.ts
@src/app/(app)/candidates/[id]/cv-review-panel.tsx
@src/app/(public)/apply/[orgSlug]/actions.ts

Pattern analogs (read only the cited region):
- Sweep function shape: `src/lib/inngest/functions/embed-batch.ts` (cron + concurrency 1 + per-org try/catch + PII-safe Sentry)
- Storage-object existence check: `src/app/(public)/apply/[orgSlug]/actions.ts` lines ~505-530 (`storage.list(dir, { search: basename, limit: 1 })`)
- Mark-failed-on-send-failure: `src/app/(app)/candidates/[id]/actions.ts` lines 219-250 (this is the pattern confirmApplyAction must copy)
- Sweep unit test: `tests/unit/lib/inngest/spec-audio-retention-sweep.test.ts` (shallow chained-mock capture style)
- Dashboard widget: `src/app/(app)/_dashboard/stale-applications-widget.tsx`
- Prior REVOKE-from-anon migration + its rationale: `supabase/migrations/20260605120000_security_guard_user_role_and_lock_ai_usage.sql`
</context>

<interfaces>
<!-- Verified against the repo. Use these directly — no exploration needed. -->

`DbResult<T>` (src/lib/db/types.ts) is `{ ok: true; data: T } | { ok: false; code: string }`.

Existing, unchanged:
```ts
// src/lib/db/candidate-cvs.ts
export type UpdateCandidateCVParseInput = {
  id: string
  status: ParsingStatus            // 'pending' | 'complete' | 'failed'
  extractedData?: unknown
  parseError?: string | null
}
export async function updateCandidateCVParse(
  supabase: SupabaseClient<Database>, input: UpdateCandidateCVParseInput,
): Promise<DbResult<{ id: string }>>

export async function markCandidateFieldsFromCV(
  supabase: SupabaseClient<Database>,
  args: { candidateId: string; parsed: ParsedCVSubset },
): Promise<DbResult<{ fieldsPopulated: string[] }>>   // returns {ok:false} — NEVER throws
```

```ts
// src/lib/ai/embed-text.ts  (fields that make a candidate findable)
type CandidateEmbedFields = Pick<Tables<'candidates'>,
  'full_name'|'current_role_title'|'current_company'|'location'|'skills'|
  'seniority_level'|'years_experience'|'sector_tags'>
```

```ts
// src/lib/stripe/cap-enforcement.ts
export async function checkCap(orgId: string, purpose: string):
  Promise<{ allow: boolean; mode: 'normal'|'soft'|'hard'; bucket: string }>  // fails OPEN, does not throw
```

`cv/uploaded` event payload (the ONLY producer shape — reconciler must match it byte-for-byte):
```ts
{ organization_id: string, candidate_id: string, candidate_cv_id: string,
  storage_path: string, mime_type: string, user_id: string | null }
```

VERIFIED FACTS (do not re-derive):
- `ai_usage.purpose` is `text not null` (migration 20260513152244:375) → the `<purpose>_failed`
  suffix needs NO migration and NO enum change.
- `record_audit_anonymous` is ALREADY revoked from anon and granted only to service_role
  (migration 20260519092947:53-58) → it is not in the REVOKE set; nothing to do but exclude it.
- `rls_auto_enable` does NOT exist anywhere in `supabase/migrations/` (grep returns nothing) →
  a hard-coded REVOKE on it would fail. Task 4's generic loop handles this.
- Supabase's default privileges auto-grant EXECUTE to anon on new public functions, which is why
  `revoke ... from public` in the original migrations did NOT remove anon access (this is the exact
  reasoning already documented in 20260605120000).
</interfaces>

<hard_rules>
Inherited constraints — violating any of these fails the task:

1. **pnpm only.** Never npm/yarn.
2. **Migrations are append-only FILES ONLY.** Write the `.sql` file and stop. NEVER run
   `supabase db push`, NEVER use the Supabase MCP `apply_migration`, NEVER execute DDL or
   any write against production. The founder applies migrations manually.
3. **Production is live with real customer data.** No destructive or irreversible operation.
4. **TypeScript strict.** No `any` without an inline `// reason: ...` comment.
5. **Server Components by default**; `'use client'` only where interactivity already exists.
6. **Match existing patterns** (no-semicolons, single quotes, 2-space, 100 cols, named exports,
   `@/` imports, `DbResult` returns, PII-safe Sentry: never pass a raw error object — only
   `err.name` + a status/subop label).
7. **Never log PII** (CV text, candidate names/emails) to Sentry. Org/user/candidate IDs only.
8. **Local gates are `pnpm typecheck`, `pnpm lint`, `pnpm test`.** `pnpm build` requires real env
   vars and the Vercel build is the authoritative build gate — a `pnpm build` failure that is
   purely env-validation (`@t3-oss/env-nextjs` invalid-env error) is NOT a task failure. Do not
   chase it, and do not add `skipValidation` to `src/lib/env.ts`.
9. **One atomic commit per task**, conventional-commit style, referencing the SF IDs closed.
10. **No new dependencies.** Everything here uses packages already in `package.json`.
    (Package Legitimacy Gate: N/A — zero package-manager installs in this plan.)
</hard_rules>

<tasks>

<task type="auto">
  <name>Task 1: Resurrect browser-side Sentry (SF-7)</name>
  <files>instrumentation-client.ts (new), sentry.client.config.ts (delete)</files>
  <action>
Next 16 builds with Turbopack by default, which never loads `sentry.client.config.ts`.
`instrumentation.ts` already wires the server + edge SDKs correctly — only the browser side
is dead. This must land FIRST: it is the observability layer that proves Task 2's fixes work.

1. Create `instrumentation-client.ts` at the repository root (sibling of `instrumentation.ts`,
   NOT inside `src/`). Move the entire `Sentry.init({...})` body from `sentry.client.config.ts`
   verbatim — same DSN env var (`process.env.NEXT_PUBLIC_SENTRY_DSN`), same
   `tracesSampleRate: 0.1`, same `replaysSessionSampleRate: 0` / `replaysOnErrorSampleRate: 0`
   (keep the existing comment explaining why replay is off — candidate names in the DOM),
   same `sendDefaultPii: false`.
2. Add a `beforeSend` to the client init that mirrors the server-side scrub in
   `sentry.server.config.ts`: delete `event.request.cookies` and `event.user.email`. Do NOT
   copy the whole recursive `scrub()` helper — the client sends no `extra`/`contexts` payloads
   of ours; the two deletes plus `sendDefaultPii: false` are sufficient and keep the file small.
   Add a one-line comment stating the rule: org_id / user_id tags only, never PII.
3. Export the router-transition hook so client navigations are instrumented:
   `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart`.
   FIRST verify the export exists in the installed SDK — the client entrypoint is where it
   lives in @sentry/nextjs 10.53.1, NOT the root `index.d.ts`:
   `grep -rn "captureRouterTransitionStart" node_modules/@sentry/nextjs/build/types/client/`
   (verified during planning: it is exported from
   `build/types/client/index.d.ts`, so this line SHOULD be wired). Only if that grep comes back
   empty may you omit the export — and then note the omission in the commit body. Do not invent
   an alternative API.
4. `git rm sentry.client.config.ts`. Before deleting, confirm nothing references it:
   `grep -rn "sentry.client.config" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.json" . | grep -v node_modules`
   (`next.config.ts`'s `withSentryConfig` auto-detects — it does not import the file.)
5. Leave `src/lib/env.ts` UNCHANGED: `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` stay
   `.optional()` (the founder sets them in Vercel). Sentry's SDK no-ops cleanly when `dsn` is
   `undefined` — do not add a throw, a warning, or a required-env change. Add a short comment
   in `instrumentation-client.ts` stating that an unset DSN is a deliberate silent no-op.
  </action>
  <verify>
    <automated>test -f instrumentation-client.ts && ! test -f sentry.client.config.ts && grep -q "Sentry.init" instrumentation-client.ts && grep -q "sendDefaultPii: false" instrumentation-client.ts && ! grep -rn "sentry.client.config" --include="*.ts" --include="*.tsx" --include="*.mjs" . | grep -v node_modules && pnpm typecheck && pnpm lint</automated>
  </verify>
  <done>
`instrumentation-client.ts` exists at the repo root with a PII-safe `Sentry.init`;
`sentry.client.config.ts` is deleted with zero dangling references; `src/lib/env.ts` is
untouched; typecheck + lint pass. Committed atomically.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Shared contracts + parse-cv truth-telling + apply unswallow (SF-1, SF-2, SF-4a)</name>
  <files>
src/lib/cv/parse-messages.ts, src/lib/cv/reconcile-decisions.ts,
src/lib/ai/profile-completeness.ts, src/lib/db/candidate-cvs.ts,
src/lib/inngest/functions/parse-cv.ts,
src/app/(public)/apply/[orgSlug]/actions.ts,
supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql,
tests/unit/lib/cv/reconcile-decisions.test.ts,
tests/unit/lib/ai/profile-completeness.test.ts,
tests/unit/app/apply/confirm-action-inngest-fallback.test.ts
  </files>

  <behavior>
Write these tests FIRST (they are pure functions — no mocking needed):

`tests/unit/lib/cv/reconcile-decisions.test.ts` — `decideStuckPendingAction({ ageMs, hasStorageObject })`:
  - age 5 min, object present            → 'skip'        (inside the grace window)
  - age 20 min, object present           → 'requeue'
  - age 40 min, object present           → 'requeue'
  - age 50 min, object present           → 'fail-stuck'  (re-enqueue budget exhausted)
  - age 20 min, object absent            → 'fail-no-file'
  - age 5 min, object absent             → 'skip'        (client PUT may still be in flight)
  - boundary rule (state it in the module, assert it in the test): the grace threshold is
    INCLUSIVE of the boundary — `ageMs >= 15 min` leaves the grace window (so exactly 15 min
    with an object present → 'requeue'), and the requeue budget is EXCLUSIVE at its top —
    `ageMs >= 45 min` → 'fail-stuck' (so exactly 45 min with an object present → 'fail-stuck').
    Exactly 15 min with NO object → 'fail-no-file'.

`tests/unit/lib/ai/profile-completeness.test.ts` — `isProfileEffectivelyEmpty(candidate)`:
  - name only, everything else null/`[]`                     → true
  - name + one real skill                                    → false
  - name + current_role_title only                           → false
  - name + years_experience 0                                → false (0 is a real value, not empty)
  - name + `location: '   '` (whitespace)                    → true
  - name + sector_tags `['energy']`                          → false
  (Guards the constraint: manually-entered candidates with real fields are NEVER blocked.)

`tests/unit/app/apply/confirm-action-inngest-fallback.test.ts` — UPDATE the existing test
(its asserted behaviour changes): still returns `ok: true` with the success redirect and still
captures the PII-safe Sentry event, but MUST now additionally flip the row to
`parsing_status: 'failed'`. Extend the service-client mock with an `update()` chain that records
the patch, and assert `parsing_status === 'failed'`.
  </behavior>

  <action>
Work through these steps IN ORDER — 2.1 defines the contracts every later step consumes.

**2.1 — Shared contracts (do these first).**

(a) `src/lib/cv/parse-messages.ts` — NEW, NO `import 'server-only'` (a Client Component
    imports it). Single source of truth for parse-failure copy:
    - `CV_PARSE_FAILED_MESSAGE` — byte-identical to the current `FAILED_USER_MESSAGE` literal
      in parse-cv.ts:28-29. Do not reword: it is locked to UI-SPEC §Error States.
    - `CV_BUDGET_CAPPED_MESSAGE` — byte-identical to `BUDGET_CAPPED_USER_MESSAGE`
      (parse-cv.ts:36). The substring `AI budget` is load-bearing for the UI predicate.
    - `CV_NO_TEXT_MESSAGE` — NEW honest copy for scanned/no-text PDFs. Must contain the stable
      sentinel substring `no extractable text` and must say plainly that retrying the same file
      cannot work and a text-based version is needed. Suggested:
      `'This PDF has no extractable text — it looks like a scan or photo. Retrying the same file won’t work; upload a text-based PDF or Word version instead.'`
    - `CV_UPLOAD_INCOMPLETE_MESSAGE` — `'The CV file never finished uploading. Please upload it again.'`
    - `CV_STUCK_MESSAGE` — `'Parsing didn’t start. You can retry now, or upload the CV again.'`
    - Predicates: `isBudgetCapped(parseError: string | null | undefined): boolean` (matches
      `AI budget`) and `isUnparseableSource(parseError: string | null | undefined): boolean`
      (matches `no extractable text`). Comment each sentinel as load-bearing.
    Then replace the two local literals in parse-cv.ts with imports from this module, keeping
    the existing explanatory comments attached.

(b) `src/lib/ai/profile-completeness.ts` — NEW, NO `server-only` (an RSC card imports it).
    `isProfileEffectivelyEmpty(c)` over exactly the `CandidateEmbedFields` set MINUS
    `full_name`: `current_role_title`, `current_company`, `location`, `seniority_level`,
    `years_experience`, `skills`, `sector_tags`. Returns true only when ALL are empty
    (null/undefined/whitespace-only string/empty array). `years_experience === 0` counts as
    PRESENT, not empty. Input type: a `Partial<>`-style structural type so both
    `CandidateForEmbedding` and `CandidateByIdRow` satisfy it without casts; treat a missing
    key as empty. Document why full_name is excluded: a name alone makes a candidate neither
    findable nor scorable — that is exactly the SF-1 contamination shape.

(c) `src/lib/cv/reconcile-decisions.ts` — NEW, pure, no imports beyond types. Export
    `STUCK_PENDING_GRACE_MS = 15 * 60_000`, `STUCK_PENDING_REQUEUE_LIMIT_MS = 45 * 60_000`, and
    `decideStuckPendingAction({ ageMs, hasStorageObject }): 'skip' | 'requeue' | 'fail-no-file' | 'fail-stuck'`.
    Rationale to put in the header comment: the age window IS the re-enqueue cap. With a 15-min
    sweep and a 15→45-min requeue window each row is re-enqueued at most twice, so no attempt-
    counter column is needed — which means the reconciler works correctly even before the
    `parse_error_detail` migration reaches production.

(d) In `src/lib/db/candidate-cvs.ts`, export a shared mapper
    `toParsedCVSubset(extracted: unknown): ParsedCVSubset` that converts a stored
    `extracted_data` JSON blob into the `ParsedCVSubset` shape. Move the exact field mapping
    currently inlined in parse-cv.ts lines 283-305 into it (same keys, same `?? null`
    handling, same `currency: null` note). Then have parse-cv.ts step 4 AND the reconciler's
    heal step both call it — one mapping, no drift. Export `ParsedCVSubset` as a type.

**2.2 — parse-cv.ts: stop discarding the merge result (SF-2) and stop clobbering honest
messages (SF-1 root cause).**

(a) Line ~281: capture the result —
    `const mergeResult = await markCandidateFieldsFromCV(supabase, { candidateId: candidate_id, parsed: toParsedCVSubset(parsed) })`
    then `if (!mergeResult.ok) throw new Error(\`markCandidateFieldsFromCV: ${mergeResult.code}\`)`.
    Keep it INSIDE `step.run('write-extracted', ...)` so Inngest retries the step, and after
    retries `onFailure` marks the row failed. Mirror the `updateCandidateCVParse` check two
    lines above (parse-cv.ts:275-277) exactly. Update the D-08 comment to state that a merge
    failure now fails the run rather than landing a lying 'complete'.

(b) **The honest-message clobber.** Today the scanned-PDF branch (lines 243-252) writes a
    specific message and then throws `NonRetriableError`, which fires `onFailure` (line 108),
    which calls `markCvFailed` with the GENERIC `FAILED_USER_MESSAGE` — overwriting it. This is
    exactly why the audit found "the stored parse_error is the generic UI string; no root cause
    persisted anywhere". Fix: give `markCvFailed` a `preserveExistingMessage?: boolean` option.
    When true it first reads the row (`getCandidateCV` via the service client); if
    `parsing_status === 'failed'` and `parse_error` is a non-empty string, it leaves
    `parse_error` alone (and still writes `parse_error_detail` if that column accepts it).
    `onFailure` passes `preserveExistingMessage: true`. Every in-body call site keeps the
    current overwrite behaviour. Add a comment naming this as the SF-1 root cause.

(c) Replace the scanned-PDF copy with `CV_NO_TEXT_MESSAGE` and pass a detail string
    (`extract-text yielded N chars for mime <type>` — N and the mime type only, never the text).
    Keep the `NonRetriableError` throw for Inngest-dashboard visibility.

**2.3 — Durable root-cause capture (`parse_error_detail`).**

(a) Migration FILE `supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql`:
    `alter table public.candidate_cvs add column if not exists parse_error_detail text;`
    plus a `comment on column` explaining it holds the PII-free technical cause (never CV text)
    and is recruiter-invisible. No RLS change (inherits the table's policies). DO NOT PUSH.

(b) `src/lib/db/candidate-cvs.ts`: extend `UpdateCandidateCVParseInput` with
    `parseErrorDetail?: string | null`. **The code must be defensive — this migration reaches
    production only when the founder pushes it, possibly AFTER this code deploys.** So:
    attempt the update including `parse_error_detail`; if it errors with PostgREST code
    `PGRST204` (column not found in the schema cache) or an error message mentioning
    `parse_error_detail`, immediately RETRY the identical update WITHOUT that key and return
    that result. Emit a `Sentry.addBreadcrumb` (level `info`) on the fallback — NOT a
    `captureException` (a pre-migration deploy is an expected state, not an error).
    The user-facing status write must NEVER be blocked by the detail write.
    Because `src/types/database.ts` is generated and will not contain the new column until the
    founder regenerates it, build the patch as a `Record<string, unknown>` and cast at the
    boundary with a `// reason:` comment — the same idiom already used at lines 91-100 and
    406-409 of this file. **Do NOT run `pnpm db:types`** (it needs a linked DB).

(c) Thread `parseErrorDetail` through `markCvFailed` in parse-cv.ts, and pass PII-safe details
    at every call site: pre-flight budget cap, mid-parse `CapExceededError`, the no-text branch,
    the generic catch (`${name}: ${status}`), and `onFailure` (`${error.name}: ${status}`).

**2.4 — confirmApplyAction stops swallowing the send failure (SF-4).**

In `src/app/(public)/apply/[orgSlug]/actions.ts`, the `catch (sendErr)` block around
`inngest.send` (~line 574-592) currently only logs to Sentry and returns ok, with an "M-8
fallback" comment claiming Phase 1's Retry button covers it. That comment is FALSE: the row
stays 'pending' and `PendingState` renders no retry. Mirror the recruiter-upload path
(`src/app/(app)/candidates/[id]/actions.ts` lines 232-250): after the Sentry capture, call
`updateCandidateCVParse(supabase, { id: args.candidateCvId, status: 'failed', parseError: CV_STUCK_MESSAGE, parseErrorDetail: \`apply-confirm: inngest.send ${errName}\` })`.
Keep returning `{ ok: true, redirectTo: ... }` — the applicant's CV genuinely is in Storage and
they should reach the success page. REWRITE the comment to state the truth: the row is marked
failed so the recruiter's Retry button renders on the candidate page. Then update
`tests/unit/app/apply/confirm-action-inngest-fallback.test.ts` per `<behavior>`.

  </action>

  <verify>
    <automated>pnpm typecheck && pnpm lint && pnpm test -- --run && grep -q "mergeResult" src/lib/inngest/functions/parse-cv.ts && grep -q "preserveExistingMessage" src/lib/inngest/functions/parse-cv.ts && grep -q "toParsedCVSubset" src/lib/inngest/functions/parse-cv.ts && grep -q "PGRST204" src/lib/db/candidate-cvs.ts && grep -q "status: 'failed'" "src/app/(public)/apply/[orgSlug]/actions.ts" && test -f supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql && test -f src/lib/cv/parse-messages.ts && test -f src/lib/cv/reconcile-decisions.ts && test -f src/lib/ai/profile-completeness.ts</automated>
    <automated>! grep -rniE "supabase db push|apply_migration" src/ supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql</automated>
  </verify>

  <done>
`pnpm typecheck`, `pnpm lint` and `pnpm test` pass, including the two new pure-logic suites and
the updated apply-fallback suite. The three shared contract modules exist and are consumed by
parse-cv.ts; the merge result is checked and thrown on; the honest scanned-PDF message survives
`onFailure` via `preserveExistingMessage`; `parse_error_detail` writes degrade gracefully when
the column is absent (PGRST204 fallback); `confirmApplyAction` marks the row 'failed' and its
comment tells the truth. The migration exists as a FILE ONLY — nothing pushed. Committed
atomically.
  </done>
</task>

<task type="auto">
  <name>Task 3: Reconciler + UI honesty + visibility + contamination guards (SF-1, SF-4, SF-5)</name>
  <files>
src/lib/inngest/functions/reconcile-cv-parses.ts, src/app/api/inngest/route.ts,
src/lib/inngest/functions/parse-cv.ts (Step 5 embed guard only),
src/lib/inngest/functions/embed-batch.ts,
src/lib/inngest/functions/precompute-matches-for-job.ts, src/lib/ai/claude.ts,
src/lib/db/dashboard.ts, src/app/(app)/candidates/[id]/cv-review-panel.tsx,
src/app/(app)/page.tsx, src/app/(app)/_dashboard/cv-parse-health-widget.tsx,
src/app/(app)/jobs/[id]/matches/match-card.tsx
  </files>

  <action>
Consumes the contracts created in Task 2 (`parse-messages`, `reconcile-decisions`,
`profile-completeness`, `toParsedCVSubset`) — do not redefine any of them. Continue the
sub-step numbering from Task 2. `parse-cv.ts` is touched a SECOND time here, in Step 5
(`embed-candidate`) only — do not revisit the sub-step 2.2/2.3 regions.

**2.5 — The reconciler (SF-4 + SF-5 + SF-2 remediation).**

New `src/lib/inngest/functions/reconcile-cv-parses.ts`, exporting `reconcileCvParses`.
Model it structurally on `embed-batch.ts`: `inngest.createFunction` with
`{ id: 'reconcile-cv-parses', triggers: [{ cron: 'TZ=Europe/London */15 * * * *' }],
concurrency: { limit: 1 }, retries: 1 }`, `createServiceClient()` inside each `step.run`,
per-iteration try/catch, PII-safe Sentry (`err.name` + `readStatus` from
`@/lib/observability/inngest`), and a hard per-step row cap.

Step A — `sweep-stuck-pending` (cap 50 rows):
  select `id, organization_id, candidate_id, storage_path, mime_type, created_at` from
  `candidate_cvs` where `parsing_status = 'pending'` and `created_at < now - 15 min`,
  ordered oldest-first. For each row: check the Storage object using the exact
  `storage.list(dir, { search: basename, limit: 1 })` idiom from confirmApplyAction
  (split `storage_path` on the last `/`), then call `decideStuckPendingAction`:
    - `requeue`      → `inngest.send({ name: 'cv/uploaded', data: {...row, user_id: null} })`
                       (payload shape byte-identical to the `<interfaces>` block)
    - `fail-no-file` → `updateCandidateCVParse` status 'failed',
                       `parseError: CV_UPLOAD_INCOMPLETE_MESSAGE`, detail
                       `'reconciler: no storage object'`
    - `fail-stuck`   → status 'failed', `parseError: CV_STUCK_MESSAGE`, detail
                       `'reconciler: still pending after 45m'`
    - `skip`         → no-op
  A `storage.list` error for one row must not abort the sweep — log and continue.

Step B — `resume-budget-capped` (cap 50 rows):
  select failed rows whose `parse_error` matches the budget message
  (`.ilike('parse_error', '%AI budget%')`). Group by `organization_id` (reuse the `groupByOrg`
  shape from embed-batch — copy it locally, do not export from embed-batch). Call
  `checkCap(orgId, 'cv_parse')` ONCE per org per sweep. If `allow` is true: for each of that
  org's rows set status 'pending' with `parseError: null`, then send `cv/uploaded`
  (`user_id: null`). If `allow` is false, skip the org silently — that is an expected state,
  not an error (same reasoning as embed-batch's `CapExceededError` continue). This is what makes
  the existing "Parsing resumes automatically…" copy true.

Step C — `heal-unmerged-profiles` (cap 25 rows) — **REQUIRED, this is the SF-2 remediation
path**. A manual SQL backfill was ruled out, so this sweep IS how the two known production
casualties (candidates `62783324-4ec4-4d53-8405-cf913bfe7195` and
`3bf8ffe0-d54f-4649-aa1e-0949adb73b2c` in the Steele Charles org) get healed:
  select `id, candidate_id, extracted_data` from `candidate_cvs` where
  `parsing_status = 'complete'` and `extracted_data is not null`, newest-first, cap 25.
  For each: fetch the candidate's embed-relevant fields (reuse
  `getCandidateForEmbedding(supabase, candidateId)` from `@/lib/db/candidates` — it already
  selects exactly the field set `isProfileEffectivelyEmpty` needs). Skip unless
  `isProfileEffectivelyEmpty(candidate)`. Otherwise call
  `markCandidateFieldsFromCV(supabase, { candidateId, parsed: toParsedCVSubset(row.extracted_data) })`,
  CHECK `.ok`, and on `!ok` capture a PII-safe Sentry exception tagged
  `subop: 'heal-unmerged-profile'` with the candidate id. On success, add a Sentry breadcrumb
  with the count of `fieldsPopulated`.
  Idempotency: D-08 guarantees fill-empty-only (never overwrites), and the
  `isProfileEffectivelyEmpty` guard means a healed candidate is not re-processed on the next
  sweep. Skip rows where `toParsedCVSubset` yields no usable fields.
  **Verify and record in the summary:** grep the `invalidate_candidate_embedding` trigger
  definition in `supabase/migrations/` and confirm the columns this merge writes (skills,
  current_role_title, current_company, location, seniority_level, years_experience,
  sector_tags) are watched by it. If they are, the merge automatically NULLs
  `candidate_embedding` and `embed-batch` re-embeds the healed candidate on its next 10-min
  run — no extra code. If any column is NOT watched, say so explicitly in the summary; do not
  add a manual embedding reset in this task.

Register `reconcileCvParses` in `src/app/api/inngest/route.ts` (import + `functions` array,
with a short comment naming the audit).

**2.6 — Candidate-page UI honesty (SF-4 + SF-5).**

In `src/app/(app)/candidates/[id]/cv-review-panel.tsx`:
  - `PendingState`: today the 5-minute cap only stops the poll and leaves "Parsing…" forever.
    Add a `timedOut` boolean state set when the interval detects the cap; when true, render a
    "This is taking longer than expected" panel with a Retry button wired to `retryParseAction`
    (copy `FailedState`'s `onRetry` transition + toast handling) and a line telling the user
    they can also re-upload the CV. Keep the existing lazy `useState(() => Date.now())`
    initializer — do not call `Date.now()` in the render body (`react-hooks/purity`).
  - `FailedState`: replace the inline `(parseError ?? '').includes('AI budget')` check with
    `isBudgetCapped(parseError)` and add an `isUnparseableSource(parseError)` branch.
    Unparseable branch: honest copy, NO "Try again" button (retrying the same bytes is doomed),
    and instead direct the user to upload a text-based PDF or Word version (the existing upload
    control on the candidate page remains the re-upload path — do not add a new uploader).
  - Budget-capped branch: KEEP the "View AI budget" link and ADD a "Try again now" outline
    button wired to the same `onRetry`, with honest microcopy (if the budget has since reset or
    been raised, a retry works now). This restores the retry affordance the audit flagged.

**2.7 — Org-level visibility (SF-4).**

  - `src/lib/db/dashboard.ts`: add `getCvParseHealth(supabase)` returning
    `{ failed: number; stalePending: number; candidates: Array<{ id: string; fullName: string }> }`
    (up to 5 affected candidates). Use TWO queries — candidate_cvs first, then a
    `.in('id', ids)` select on `candidates` for names. Do NOT use PostgREST embedded selects:
    there is no precedent for them in `src/lib/db/`. RLS scopes both queries to the org; follow
    the existing helper style in this file (return plain values, log errors to Sentry, degrade
    to zeros rather than throwing — the dashboard must never crash on this widget).
  - `src/app/(app)/_dashboard/cv-parse-health-widget.tsx`: NEW RSC widget modeled on
    `stale-applications-widget.tsx`. Renders ONLY when `failed + stalePending > 0`. Shows the
    counts and links each listed candidate to `/candidates/{id}`.
  - `src/app/(app)/page.tsx`: add `getCvParseHealth` to the existing `Promise.all` and render
    the widget in the main return (NOT in the `isEmpty` early-return branch), placed above
    `StaleApplicationsWidget` in the right-hand column.

**2.8 — Stop downstream contamination (SF-1).**

  - `src/lib/inngest/functions/parse-cv.ts`, Step 5 `embed-candidate` (~lines 317-357): its
    ONLY current guard is `embeddingText.trim().length === 0`, which can never fire — the
    50-char extraction gate at line 243 guarantees `text` is non-empty, so a CV whose text
    extracted but whose structured fields all came back empty (Haiku returned nothing usable,
    or the merge in 2.2a failed) still gets embedded from raw bytes with no profile behind it.
    Add the structured-profile check BEFORE calling `embed()`: skip the embed when
    `isProfileEffectivelyEmpty(candidate)` (the `candidate` already fetched by
    `getCandidateForEmbedding` on line 320). Keep the existing empty-string guard as well.
    Comment it as the same SF-1 contamination guard applied at the reactive-embed site.
    Without this, the must_have truth "empty profiles are not embedded" is only half true.
  - `src/lib/inngest/functions/embed-batch.ts`, `sweep-candidates`: extend the existing
    `usable` filter to also drop rows where `isProfileEffectivelyEmpty(row)`. This is where the
    SF-1 candidate actually got embedded from nothing (a bare `Name: X.` string passes the
    current non-empty-text filter). Comment it. Skipped rows keep a NULL embedding and are
    re-evaluated on later sweeps — correct, because a name-only candidate is not searchable
    anyway.
  - `src/lib/inngest/functions/precompute-matches-for-job.ts`: inside the per-candidate
    `step.run(\`score-${candidate.id}\`)`, immediately after the existing cross-tenant
    verification that already calls `getCandidateForEmbedding` (~line 218-232), `return` early
    when `isProfileEffectivelyEmpty(candForVerifyResult.data)` — no Sonnet call, no ai_usage
    row, no misleading score. Add a `Sentry.addBreadcrumb` (level info) recording the skip with
    the candidate id.
  - `src/app/(app)/jobs/[id]/matches/match-card.tsx`: when a `summary` exists AND
    `isProfileEffectivelyEmpty(candidate)`, render a `<Badge variant="outline">Profile
    incomplete</Badge>` beside the score badge with a `title` explaining the score was generated
    from a near-empty profile and should not be trusted. First confirm `CandidateByIdRow`'s
    select list actually includes the predicate's fields (`grep -n "CandidateByIdRow" -A 20
    src/lib/db/candidates.ts`); if any are missing, extend that select rather than weakening
    the predicate. This badges the existing misleading score on candidate `03b2a9dd` without
    deleting anything (the delete-vs-badge choice is the founder's, and badge is the
    non-destructive half).

**2.9 — Failed-attempt AI telemetry (closes the 20-uploads-vs-14-parses gap).**

`src/lib/ai/claude.ts`: `ai_usage.purpose` is `text` (VERIFIED — see `<interfaces>`), so use a
`_failed` suffix and add NO migration.
  - Factor the existing `record_ai_usage` RPC block (lines 104-131) into a local
    `async function logUsage({ model, purpose, inputTokens, outputTokens, costPence, latencyMs, userId, organizationId })`
    that never throws, and call it from the success path unchanged.
  - On terminal failure — the path where the retry loop is exhausted or a non-retriable error
    aborts, i.e. immediately before `runWithLogging` throws `lastError` — call `logUsage` once
    with `purpose: \`${args.purpose}_failed\``, `inputTokens: 0`, `outputTokens: 0`,
    `costPence: 0`, `latencyMs: Date.now() - started`. Exactly ONE row per failed
    `runWithLogging` invocation, not one per retry attempt.
  - Do NOT log a `_failed` row for `CapExceededError`: no API call was attempted, so it is a
    cap decision, not a failed attempt. Comment this.
  - `src/lib/ai/voyage.ts` and `src/lib/ai/whisper.ts`: apply the identical pattern ONLY if each
    file has a single centralised usage-logging site (whisper.ts has one around lines 179-205 —
    check voyage.ts with `grep -n "record_ai_usage" src/lib/ai/voyage.ts`). If a file would need
    more than two edit sites, SKIP it and say so in the commit body — do not restructure those
    wrappers in this task.
  - Cost/cap safety check: confirm `PURPOSE_CAP_BUCKETS` (`src/lib/stripe/usage.ts`) tolerates an
    unmapped purpose (it does — `checkCap` handles `bucket === undefined`), and that the £
    ceiling sums `cost_pence` (0 for these rows). Then check the billing surface: `grep -rn
    "ai_usage_month_by_purpose" src/` — if `/settings/billing` renders a raw per-purpose list,
    either filter out purposes ending in `_failed` there or label them "failed attempts (no
    cost)". Do not leave a raw `cv_parse_failed` string in customer-facing UI.
  </action>

  <verify>
    <automated>pnpm typecheck && pnpm lint && pnpm test -- --run && grep -q "reconcileCvParses" src/app/api/inngest/route.ts && test -f src/lib/inngest/functions/reconcile-cv-parses.ts && grep -q "isProfileEffectivelyEmpty" src/lib/inngest/functions/parse-cv.ts && grep -q "isProfileEffectivelyEmpty" src/lib/inngest/functions/embed-batch.ts && grep -q "isProfileEffectivelyEmpty" src/lib/inngest/functions/precompute-matches-for-job.ts && grep -q "isProfileEffectivelyEmpty" "src/app/(app)/jobs/[id]/matches/match-card.tsx" && grep -q "isUnparseableSource" "src/app/(app)/candidates/[id]/cv-review-panel.tsx" && grep -q "getCvParseHealth" "src/app/(app)/page.tsx" && test -f "src/app/(app)/_dashboard/cv-parse-health-widget.tsx" && grep -q "_failed" src/lib/ai/claude.ts</automated>
    <automated>! grep -rniE "supabase db push|apply_migration" src/</automated>
  </verify>

  <done>
`pnpm typecheck`, `pnpm lint` and `pnpm test` all pass (Task 2's suites still green). The
reconciler exists, is registered in the Inngest route, and covers all three cases (stuck-pending,
budget-cap resume, unmerged-profile heal). The candidate page has no dead-end spinner and no
doomed retry for unparseable files, and the budget-capped state has its retry affordance back.
The dashboard surfaces failed + stale parses when > 0. Empty profiles are skipped at ALL FOUR
sites (parse-cv Step 5, embed-batch sweep, precompute scoring, match-card badge). Failed Claude
attempts land in `ai_usage` at zero cost with no customer-facing raw `_failed` string.
Committed atomically.
  </done>
</task>

<task type="auto">
  <name>Task 4: REVOKE anon EXECUTE on the audited SECURITY DEFINER functions</name>
  <files>supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql</files>
  <action>
Append-only migration FILE closing the security finding from §3 of the audit: 11 SECURITY
DEFINER functions are executable by `anon` over PostgREST RPC — the same class as the
`record_ai_usage` hole fixed on 2026-06-05.

**Step 1 — verify before writing (read-only, repo greps only).** For each name below, confirm
it exists in `supabase/migrations/` and note its argument list:
```
for fn in delete_candidate delete_company delete_job record_audit handle_new_user \
          current_organization_id assert_same_org bump_candidate_last_contacted_at \
          rls_auto_enable job_ads_same_org_guard spec_drafts_same_org_guard; do
  echo "### $fn"; grep -rn "function public\.$fn *(" supabase/migrations/*.sql | head -3
done
```
Already verified during planning — reuse unless your grep disagrees:
`rls_auto_enable` does NOT exist in this repo. Do not hard-code a REVOKE for it.
`record_audit_anonymous` is ALREADY anon-less (20260519092947 revokes it from
public/authenticated/anon and grants only service_role) — it is therefore NOT in the target
list, and the public apply form (which calls it through the service-role client) is unaffected.
State both facts in the migration header.

**Step 2 — write the migration** as a single idempotent `do $$ ... $$` block that iterates a
hard-coded array of the target function names, looks each up in `pg_proc` joined to
`pg_namespace` for `nspname = 'public'`, and for every match executes
`revoke execute on function <oid>::regprocedure from anon`. Rationale for the loop form
(put it in the header comment): it handles overloads without enumerating signatures, it is a
no-op for names that do not exist (e.g. `rls_auto_enable`, or a function dropped by a later
migration), and it is safely re-runnable. Explicitly EXCLUDE `record_audit_anonymous` from the
array and comment why. `anon` ONLY — `authenticated` and `service_role` grants are untouched
(several of these are legitimate authenticated callers: `record_audit`,
`current_organization_id`, the delete RPCs).

**Step 3 — document the two non-obvious safety analyses in the header comment.**

(a) *Trigger functions are unaffected.* `handle_new_user`, `bump_candidate_last_contacted_at`,
    `job_ads_same_org_guard` and `spec_drafts_same_org_guard` are trigger functions. PostgreSQL
    checks EXECUTE on a trigger function at CREATE TRIGGER time, not at fire time, so revoking
    anon cannot break trigger firing. `handle_new_user` additionally fires as
    `supabase_auth_admin`, never as anon.

(b) *`current_organization_id` blast radius.* Most RLS policies are declared `to authenticated`,
    so anon never evaluates the function on those tables. Four policies omit the role clause and
    call it: `plan_overrides`, `voice_notes`, `email_campaigns`, `email_campaign_recipients`
    (verify with:
    `grep -rn "current_organization_id" supabase/migrations/*.sql | grep -c ""` and inspect the
    policies in `20260604130000_phase5_admin_overrides.sql` and `20260610000000_phase4_hardening.sql`).
    After this migration, an anon PostgREST read of those four tables returns
    `42501 permission denied for function current_organization_id` instead of an empty set —
    still fails closed, no data exposure. Confirm no app path hits them as anon before writing:
    every `(public)` route (`apply`, `unsubscribe`) uses `createServiceClient()`, and the only
    anon-role query in the codebase is `/status`'s probe of `organizations`, whose policies ARE
    `to authenticated` and therefore never invoke the function for anon. Re-verify with:
    `grep -rn "createClient\|createServiceClient" "src/app/(public)" src/app/status src/app/api | head -20`
    If that grep contradicts the analysis, STOP and report rather than shipping the REVOKE for
    `current_organization_id` — the other functions can ship independently.

**Step 4 — do NOT push.** File only. No `supabase db push`, no MCP `apply_migration`, no DDL
against production. Both migration files from this plan (`20260804120000` and `20260804120100`)
go into the founder handoff notes in the summary. Also note there — as a one-line non-code
follow-up, not a task — that leaked-password protection (HaveIBeenPwned) is still disabled in
the Supabase dashboard and is a single toggle.
  </action>
  <verify>
    <automated>test -f supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql && grep -q "from anon" supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql && grep -q "record_audit_anonymous" supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql && ! grep -vE "^\s*--" supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql | grep -q "authenticated" && pnpm lint</automated>
  </verify>
  <done>
The migration file exists, revokes EXECUTE from `anon` only (no non-comment line touches
`authenticated`), excludes `record_audit_anonymous` with a documented reason, tolerates the
non-existent `rls_auto_enable`, and carries the trigger-function and `current_organization_id`
safety analyses in its header. Nothing was pushed to any database. Committed atomically.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| anon (PostgREST) → Postgres RPC | Unauthenticated callers can POST /rest/v1/rpc/* for any function they hold EXECUTE on |
| Public apply form → Storage + Inngest | Unauthenticated applicant supplies a file and triggers an AI pipeline |
| Inngest event payload → service-role client | Service role bypasses RLS; the event payload is the only tenancy signal |
| Reconciler cron → AI spend | An automated sweep can re-enqueue paid AI work without a human in the loop |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-lfz-01 | Elevation of Privilege | anon EXECUTE on SECURITY DEFINER fns (delete_candidate/company/job, record_audit, …) | mitigate | Task 4: REVOKE EXECUTE FROM anon via idempotent pg_proc loop; authenticated + service_role untouched |
| T-lfz-02 | Denial of Service | Reconciler re-enqueue loop driving unbounded Haiku spend | mitigate | Age-window cap (≤2 re-enqueues/row) + 50-row per-step cap + per-org `checkCap` before any budget-cap resume |
| T-lfz-03 | Information Disclosure | `parse_error_detail` persisting CV text or candidate PII | mitigate | Detail strings are restricted to error name/status, extracted char COUNT, and mime type — never extracted text; same R4 rule as the existing Sentry captures |
| T-lfz-04 | Information Disclosure | Browser Sentry capturing candidate data once re-enabled | mitigate | `sendDefaultPii: false`, replays off, `beforeSend` deletes cookies + user.email (mirrors sentry.server.config.ts) |
| T-lfz-05 | Tampering | Forged `cv/uploaded` event from the reconciler pointing at another tenant's Storage path | mitigate | Payload is built from the row's own `organization_id`/`candidate_id`/`storage_path`; parse-cv's existing tenant-boundary check (lines 160-168) re-validates before any download |
| T-lfz-06 | Repudiation | Failed AI attempts leaving no record (20 uploads vs 14 parses) | mitigate | Task 3 (sub-step 2.9): `<purpose>_failed` ai_usage rows at 0 tokens / 0 cost |
| T-lfz-07 | Elevation of Privilege | Heal step writing over recruiter-entered candidate data | accept | `markCandidateFieldsFromCV` is D-08 fill-empty-only and is additionally gated behind `isProfileEffectivelyEmpty`; no overwrite path exists |
| T-lfz-SC | Tampering | npm/pip/cargo installs | n/a | Zero package installs in this plan — Package Legitimacy Gate does not apply |
</threat_model>

<verification>
Autonomous gates (all four tasks):
1. `pnpm typecheck` — clean
2. `pnpm lint` — clean
3. `pnpm test -- --run` — all suites pass, including the two new pure-logic suites and the
   updated apply-fallback suite
4. `git status` — only the files listed in `files_modified`; no `src/types/database.ts` churn

Behavioural greps (fast, deterministic):
```
grep -q "preserveExistingMessage" src/lib/inngest/functions/parse-cv.ts
grep -q "PGRST204" src/lib/db/candidate-cvs.ts
grep -q "reconcileCvParses" src/app/api/inngest/route.ts
grep -c "isProfileEffectivelyEmpty" src/lib/inngest/functions/embed-batch.ts src/lib/inngest/functions/precompute-matches-for-job.ts "src/app/(app)/jobs/[id]/matches/match-card.tsx"
```

NOT part of this plan's gates (owned by the orchestrator / founder, per HARD RULE #1):
- `/gsd-code-review` over the changed files
- Vercel preview deploy + browser pre-smoke of the candidate CV panel and dashboard widget
- Founder's manual `pnpm exec supabase db push --linked` for BOTH migration files
- Supabase dashboard toggle for leaked-password protection

Do not declare the work "ready to test" — hand back to the orchestrator for the review +
pre-smoke pipeline.
</verification>

<success_criteria>
- Every `must_haves.truth` above is demonstrably satisfied by code in the diff.
- Four atomic commits, one per task, each naming the SF IDs it closes.
- Two migration files staged, ZERO database writes performed by the executor.
- No new dependencies, no `any` without a `// reason:`, no PII in any log or persisted detail.
- The scope is exactly the batch above — no Batch 2 items (match scores on applications, search
  instrumentation, attribution triggers, Stripe webhook columns, analytics) leak in.
</success_criteria>

<output>
Create `.planning/quick/260804-lfz-sc-review-batch-1-fix-cv-pipeline-silent/260804-lfz-SUMMARY.md`
when done. It MUST include:
- Which SF findings are closed and how (file:line for each fix)
- The `invalidate_candidate_embedding` trigger-coverage finding from step 2.5C (does the heal
  auto-trigger a re-embed, yes/no)
- Whether voyage.ts / whisper.ts got the `_failed` telemetry or were skipped, and why
- Whether `captureRouterTransitionStart` exists in the installed Sentry SDK
- A **FOUNDER ACTIONS** section: push `20260804120000_candidate_cvs_parse_error_detail.sql` and
  `20260804120100_revoke_anon_execute_security_definer.sql` via
  `pnpm exec supabase db push --linked`; set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` in Vercel
  (code no-ops silently until then); enable leaked-password protection in the Supabase dashboard.
</output>
