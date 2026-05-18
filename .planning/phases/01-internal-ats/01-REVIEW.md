---
phase: 01-internal-ats
reviewed: 2026-05-18T00:00:00Z
depth: deep
files_reviewed: 142
findings:
  critical: 1
  high: 3
  medium: 9
  low: 11
  total: 24
status: issues_found
---

# Phase 1 Code Review

**Reviewer:** gsd-code-reviewer
**Date:** 2026-05-18
**Scope:** 24 commits, `bbc3bfb..cbaf0eb` (Plans 0–5)
**Files reviewed:** ~142 (src/app, src/lib, src/components/app, supabase/migrations 7 new, sentry config, tests, package.json)
**LOC reviewed:** ~6,200

## Summary

Verdict: **APPROVE WITH FIXES** — one CRITICAL cross-tenant data corruption hole in the CV upload + Inngest path must land before this ships; the rest are tightenings.

The Phase 1 implementation is in good shape overall. The R1–R10 verification patches landed faithfully: decline_reason enum reconciliation, `organizations.logo_url` migration, `set_organization_id` search_path hardening, R4 PII-scrubbed Sentry catch in Inngest, R5 `markCandidateFieldsFromCV` mapping, R7 `useSyncExternalStore` matchMedia (replaces the matchMedia approach the verification asked for with a slightly more SSR-friendly hook variant — fine), R8 user-scoped role check before service-role admin call, R9 10 MiB cap, R10 CV step skipped in Playwright. D-08, D-09, D-10, D-12, D-13, D-14, D-15, D-16 are all honoured. Tests cover the D-08 invariant well.

The cross-tenant FK trigger guards landed for contacts, jobs, and applications — but the analogous guard for `candidate_cvs.candidate_id → candidates.id` is missing, and combined with the service-role write inside the Inngest parser this opens a cross-tenant data poisoning path (C1 below). The other high-severity items are: (H1) Inngest dispatch on `uploadCVAction` swallows errors silently leaving the CV in a permanent 'pending' UI state, (H2) `listApplicationsForJob` doesn't `select` `decline_reason` but `ApplicationsList` tries to render it — dead-on-arrival display, and (H3) the client activity timeline tab passes timeline entries without `actor`, so every entry on a client's Activity tab renders as "System".

Top three to fix before release:
1. Add the cross-tenant FK guard for `candidate_cvs.candidate_id` (C1).
2. Wire decline_reason into `listApplicationsForJob` SELECT and either capture Inngest dispatch errors explicitly or move the dispatch out of `try/catch{}` (H1, H2).
3. Resolve actor names for the client Activity tab so the timeline isn't all "System" (H3).

## Findings

### CRITICAL

#### C1: Missing cross-tenant FK guard on `candidate_cvs.candidate_id` enables cross-org candidate data poisoning via the Inngest CV parser

**File:** `supabase/migrations/20260517204500_cross_tenant_fk_guards.sql` (gap) + `src/app/(app)/candidates/[id]/actions.ts:155-179` + `src/lib/inngest/functions/parse-cv.ts:155-260`
**Severity:** CRITICAL
**Category:** multi-tenancy / cross-tenant write

**Finding:**

The Plan 0 cross-tenant FK guard migration installs `assert_same_org` checks on:

- `contacts.company_id → companies` ✔
- `jobs.company_id → companies` ✔
- `applications.candidate_id → candidates` and `applications.job_id → jobs` ✔

…but **not** on `candidate_cvs.candidate_id → candidates`. The schema's bare FK only checks that `candidate_id` exists somewhere — not that it belongs to the same org as the inserting user.

Combined with the parser's service-role bypass, this creates a real cross-tenant data poisoning path:

1. Attacker (signed in to org A) calls `uploadCVAction` with `candidateId = <UUID of a candidate in org B>`. UUIDs are not secret — they appear in URLs visible to anyone who's ever had access to that candidate, and they can leak via logs, screenshots, exports.
2. `uploadCVAction` (`src/app/(app)/candidates/[id]/actions.ts:114-157`) validates `candidateId` only as a UUID string — it does NOT check the candidate exists in the caller's org. `slugifyFilename` + the `storagePath` template (`${organizationId}/${candidateId}/${cvUuid}-${safeName}.${ext}`) puts the file under `{attacker_org}/{victim_candidate_uuid}/…`, which the storage RLS policy at `supabase/migrations/20260517204501_storage_cvs_bucket.sql:24-29` permits (it only checks the **first** folder == caller's org).
3. `createCandidateCV` (`src/lib/db/candidate-cvs.ts:75-104`) inserts a row. The `candidate_cvs_set_org` BEFORE INSERT trigger fills `organization_id = caller's org`, so RLS WITH CHECK passes. The plain FK on `candidate_id` only checks existence — no org match. The row commits with `organization_id = attacker_org, candidate_id = victim_candidate_uuid`.
4. `uploadCVAction` dispatches `inngest.send({ name: 'cv/uploaded', data: { organization_id: attacker_org, candidate_id: victim_candidate_uuid, storage_path: 'attacker_org/victim_candidate_uuid/...', mime_type, user_id } })`.
5. The Inngest parser's "tenant boundary check" (`src/lib/inngest/functions/parse-cv.ts:155-157`) is `storage_path.startsWith(\`${organization_id}/${candidate_id}/\`)` — this PASSES because all three values were forged consistently by the attacker.
6. The parser then uses `createServiceClient()` (RLS bypass) to download the attacker's PDF, parse via Claude, and call `markCandidateFieldsFromCV(service_role, { candidateId: victim_candidate_uuid, parsed })`. Inside the helper, the SELECT and UPDATE both run as service-role and so are not constrained by RLS. The D-08 empty-only check survives — the attacker can only fill fields the victim hasn't filled — but they can still poison empty columns on a **different tenant's** candidate (e.g., set their phone to an attacker-controlled number, plant skills tags, drop in a sector_tags array that affects future matching).

The "tenant boundary" comment at line 147-154 explicitly acknowledges the Inngest event might be forged, then defends only by checking that `storage_path` is consistent with `organization_id` + `candidate_id`. It does NOT verify that `candidate_id` belongs to `organization_id`. That's the missing check.

**Why it matters:**

CLAUDE.md "What to never do" rule one: *"Never disable RLS to make it work for now. Fix the policy."* Service-role usage IS RLS bypass. The Inngest function relies on the tenant boundary check to compensate, but the check is unsound. This is the single most damaging bug class in a multi-tenant app — silent cross-tenant writes.

**Recommended fix:** Add a 5th trigger to the cross-tenant FK guard migration (new additive migration; do not edit the committed one):

```sql
-- supabase/migrations/<new-ts>_candidate_cvs_same_org_guard.sql
create or replace function public.candidate_cvs_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org('public.candidates'::regclass, new.candidate_id, new.organization_id);
  return new;
end;
$$;

create trigger candidate_cvs_same_org_check
  before insert or update of candidate_id, organization_id on public.candidate_cvs
  for each row execute function public.candidate_cvs_same_org_guard();
```

**Also** harden the app-side defence (defence in depth): in `uploadCVAction` (line 142-145) and `retryParseAction` (line 258-273), reject when the looked-up candidate row isn't in the caller's org. Today only `getCandidateCV` is used in retry; in upload, no candidate fetch happens at all. Adding a `select id from candidates where id = candidateId` round-trip (RLS-scoped) before the storage write gives a clean error to the legitimate user too. The DB-side trigger is the security control; this is the UX layer.

Finally, audit the Inngest payload schema: rather than trusting the producer to keep `organization_id`/`candidate_id`/`storage_path` consistent, derive them in the parser from the `candidate_cvs` row itself (look up by `candidate_cv_id`, then read its `organization_id`, `candidate_id`, `storage_path` from the trusted DB row, and use **those** for the rest of the pipeline). The event then carries only `candidate_cv_id`. This is the principled fix — boundary check by querying source of truth, not by string-matching the payload.

---

### HIGH

#### H1: Inngest dispatch errors swallowed silently in `uploadCVAction` / `retryParseAction` — stuck "pending" with no Sentry breadcrumb

**File:** `src/app/(app)/candidates/[id]/actions.ts:195-211` and `:258-273`
**Severity:** HIGH
**Category:** error handling / UX

**Finding:**

Both action paths wrap `inngest.send(...)` in an empty `catch {}` with a comment claiming "Sentry capture is handled by the global instrumentation hook." This is incorrect on two counts:

1. Server Actions are not wrapped by Next's `onRequestError` instrumentation in the way HTTP route handlers are. The Sentry config's `beforeSend` only scrubs known PII keys; it doesn't *generate* events. Without an explicit `Sentry.captureException`, a failed dispatch is invisible to ops.
2. The user is shown "CV uploaded — parsing…" and the row sits in `parsing_status = 'pending'` forever. The CV review panel renders `<PendingState>` with a spinner indefinitely. The user has no Retry button (Retry only appears in the `failed` state). The only escape is to upload a second CV with a bumped version.

The action returns `{ ok: true, candidateCvId }` even when the parser never receives the event — so optimistic UX is misleading.

**Why it matters:** Phase 1 hinges on the CV parsing flow being trustable. A silent failure in the dispatch is the single feature most likely to fail in real-world hosting transitions (Inngest cloud key rotation, network blip, regional outage), and we have zero observability into it.

**Recommended fix:**

```ts
try {
  await inngest.send({ name: 'cv/uploaded', data: { ... } })
} catch (err) {
  Sentry.captureException(err instanceof Error ? new Error(err.name + ': inngest dispatch failed') : new Error('inngest dispatch failed'), {
    tags: { layer: 'action', helper: 'uploadCVAction', subop: 'inngest.send', candidate_cv_id: candidateCvId },
  })
  // Surface as 'failed' so the UI shows the Retry button instead of a permanent spinner.
  await updateCandidateCVParse(supabase, {
    id: candidateCvId,
    status: 'failed',
    parseError: 'Could not queue CV for parsing. Try again.',
  })
}
```

Mirror the same in `retryParseAction`.

---

#### H2: `listApplicationsForJob` does not select `decline_reason`, but `ApplicationsList` renders it — terminal-stage rows always render without the reason

**File:** `src/lib/db/applications.ts:45-46` (SELECT) + `src/app/(app)/jobs/[id]/applications-list.tsx:101-104` (consumer)
**Severity:** HIGH
**Category:** bug / dead code

**Finding:**

`APP_WITH_CANDIDATE_SELECT` is `'id, candidate_id, job_id, stage, stage_changed_at, organization_id, candidates(...)'` — no `decline_reason` column. `PipelineCardData` (`src/lib/db/pipeline-stages.ts:30-41`) doesn't declare `decline_reason` either. The job detail page passes `listApplicationsForJob`'s output to `<ApplicationsList>`, which casts the rows to `(PipelineCardData & { decline_reason?: string | null })[]` and conditionally renders:

```tsx
{isTerminal && row.decline_reason ? (
  <span>({formatDeclineReason(row.decline_reason)})</span>
) : null}
```

Because the column is never selected, `row.decline_reason` is always `undefined`, the conditional is always false, and a rejected/withdrawn application's reason is never displayed on the job page. This breaks the implicit contract on `applications-list.tsx` and silently disables a UI hint the job-detail UI was built to display.

**Why it matters:** Recruiters reviewing a job's history rely on the decline reason chip to triage at a glance. This is a regression hidden behind a type widening.

**Recommended fix:**

1. Add `decline_reason` to `APP_WITH_CANDIDATE_SELECT` in `src/lib/db/applications.ts:45`.
2. Add `decline_reason: Enums<'decline_reason'> | null` to `PipelineCardData` in `src/lib/db/pipeline-stages.ts:30-41` (or a separate `ApplicationDetailRow` shape used only by the table).
3. Populate it in `shapeCard` (`src/lib/db/applications.ts:59-72`) and drop the inline `& { decline_reason?: string | null }` widening in `applications-list.tsx:25-27`.

---

#### H3: `ClientManagementTabs` Activity tab renders every entry as "System" — `actor` is never populated

**File:** `src/app/(app)/clients/[id]/client-management-tabs.tsx:48-68` + `src/lib/db/clients.ts:253-290`
**Severity:** HIGH
**Category:** bug / UX regression

**Finding:**

`getClientTimeline` reads from the `client_activity_timeline` view, which selects `a.actor_user_id` (just the UUID) — no join to the users table for display name/email. `toActivityEntries` then maps each row to an `ActivityEntry` without setting `actor`, so the entry is passed in without an actor object. `ActivityTimeline`'s `actorName(actor: ActivityActor)` returns `'System'` when `actor` is null/undefined. Result: every entry on a client's Activity tab — Notes the recruiter wrote, calls they logged, contacts they added — renders as "System" instead of the actor name.

By contrast, the candidate detail page's `listCandidateActivities` (`src/lib/db/candidates.ts:307-328`) joins the actor: `actor:users!actor_user_id(full_name, email)`. The client side missed this enrichment.

**Why it matters:** The Activity tab is the agency's accountability layer — recruiters need to see who logged the call. Stamping everything as "System" hides the audit trail for the human-meaningful subset of activity.

**Recommended fix:**

Either:

- (A) Update the `client_activity_timeline` view to join `public.users` and expose `actor_full_name`, `actor_email`, then map them in `toActivityEntries`. View change is additive; no migration touches existing columns. **Preferred** — keeps the per-row resolution server-side.
- (B) In `toActivityEntries` (or in the page RSC), collect distinct `actor_user_id` values from the timeline, fetch them once via `from('users').select('id, full_name, email').in('id', actorIds)`, and merge into `ActivityEntry.actor`. This is what `dashboard.ts:getRecentActivity` does (lines 102-113) and is fine but adds a second round trip.

---

### MEDIUM

#### M1: `bump_last_contacted_at` trigger lacks `search_path` hardening — analogue of the R3 fix it didn't receive

**File:** `supabase/migrations/20260517215957_bump_last_contacted_at.sql:20-46`
**Severity:** MEDIUM
**Category:** security

**Finding:**

R3 added `set search_path = public` to `set_organization_id()` (migration `20260517204504`). Plan 1's `bump_candidate_last_contacted_at()` (`20260517215938`) and Plan 0's `assert_same_org`, `contacts_same_org_guard`, etc. all set `search_path = public`. But Plan 3's `bump_last_contacted_at()` (the company/contact version, lines 20-41 of `20260517215957_bump_last_contacted_at.sql`) does NOT set `search_path` and is not `security definer`. Without the lock, a future shadowing object in another schema (added by a tenant or by a malicious migration that the agency-owner mistakenly applies) could intercept calls. This is the exact concern R3 closed for `set_organization_id`.

**Why it matters:** Defence-in-depth. The same logic that justified R3 applies here.

**Recommended fix:** Additive migration:

```sql
create or replace function public.bump_last_contacted_at()
returns trigger
language plpgsql
set search_path = public
as $$
  -- existing body
$$;
```

(Keep `language plpgsql` and the existing body verbatim — only add the `set search_path` clause. The function is `security invoker` by default, which is correct because the UPDATE relies on RLS on `companies`/`contacts`.)

---

#### M2: `record_audit` write inside `getCandidate` happens on every load, including edit page — double-counts audit and inflates ledger

**File:** `src/lib/db/candidates.ts:156-194` + `src/app/(app)/candidates/[id]/edit/page.tsx:22`
**Severity:** MEDIUM
**Category:** behavioural contract (D-16)

**Finding:**

`getCandidate` writes an audit row on every successful load. The edit page (`/candidates/[id]/edit`) calls `getCandidate` and is documented as "effectively a detail-view" in the code, so this is intentional. However:

1. The detail page also calls `getCandidate` AND then the user typically clicks Edit, producing two audit rows back-to-back for the same view session.
2. The audit on the edit page is plausible but the planner's intent (D-16 + CAND-06) was "audit-on-detail-view" not "audit on every server fetch of the row." Two rows = noise that complicates downstream analytics.
3. `acceptCVFieldsAction` calls `getCandidateCV` (which is fine — that's a CV row), but `markCandidateFieldsFromCV` opens a fresh SELECT on the candidate too — not through `getCandidate` — so audit is not double-emitted there. Good.

**Why it matters:** The audit log is supposed to support a future GDPR right-to-access subject report. Inflating it with edit-page loads dilutes the "who has actually viewed this person's data" signal.

**Recommended fix:** Split `getCandidate` into `getCandidateForDetailView` (writes audit) and `getCandidateForEdit` (doesn't), or pass a `{ audit: boolean }` flag. Edit page calls the no-audit variant; detail page calls the audit one. The current implementation is defensible but not Pareto-optimal. Note this as a Phase 2 refactor unless GDPR self-service is on the near-term horizon.

---

#### M3: Direct `.from('users')` and `.from('companies')` queries outside `src/lib/db/*`

**File:** `src/app/(app)/settings/invitations-list.tsx:31-35`, `src/app/(app)/settings/actions.ts:77-82` and `:121-125`, `src/app/(app)/pipeline/page.tsx:37,39`
**Severity:** MEDIUM
**Category:** convention drift

**Finding:**

CONTEXT.md "Integration Points" + CLAUDE.md "all db queries through `src/lib/db/*`" specifies zero inline `.from(...)` calls outside the db helper layer. Four spots break this:

- `invitations-list.tsx:31` — lists users for an org.
- `settings/actions.ts:77` (updateOrganizationAction owner role check) and `:121` (inviteTeammateAction owner role check) — fetches the caller's role.
- `pipeline/page.tsx:37` and `:39` — lists users and companies for the filter dropdown.

The queries are tenant-safe (RLS handles it), so this is convention drift not a security issue. But it's the exact pattern CLAUDE.md exists to prevent — every inline query becomes a place future maintainers might forget to add a column or tag a Sentry capture.

**Why it matters:** Future grep for "all candidate reads" should find every callsite in `src/lib/db/`. Today it doesn't.

**Recommended fix:** Add helpers to `src/lib/db/`:

- `listOrgUsers(supabase)` in `src/lib/db/profiles.ts` (or new `users.ts`) — used by `invitations-list.tsx` and `pipeline/page.tsx`.
- `getCallerRoleAndOrg(supabase, userId)` in `src/lib/db/profiles.ts` — used by both settings actions (returns `{ role, organization_id }`, eats the small over-fetch vs. having the action select exactly two fields).
- `listClientOptions(supabase)` (lightweight `{id, name}[]`) in `src/lib/db/clients.ts` for the filter dropdown.

---

#### M4: Client `website` field is rendered as an `<a href>` without URL-scheme validation

**File:** `src/app/(app)/clients/new/schema.ts:7-22` (validation gap) + `src/app/(app)/clients/[id]/page.tsx:69-78` (consumer)
**Severity:** MEDIUM
**Category:** security (stored XSS / unsafe URL)

**Finding:**

`clientFormSchema.website` is just `z.string().trim().max(2000).optional()`. No URL scheme check. The client detail page renders:

```tsx
<a href={client.website} target="_blank" rel="noopener noreferrer">…</a>
```

A recruiter who pastes `javascript:alert(document.cookie)` (or worse: anything that fetches PII via XHR) into the website field has just planted a clickable JS payload. Same-tenant only, but the agency invites teammates — one teammate poisoning the data, another opening the client page, is a real lateral risk.

By contrast, `updateOrganizationSchema.logo_url` (`src/app/(app)/settings/schema.ts:14-19`) DOES use `.refine((v) => !v || /^https?:\/\//i.test(v), …)` which is the right pattern.

**Why it matters:** It's an avoidable stored-XSS vector. Same-tenant trust is not a justification for skipping cheap defence.

**Recommended fix:** Add the same `http(s)://` regex check to `optionalString` for the `website` field (and ideally to a shared `optionalUrl` helper that's used in both schemas):

```ts
const optionalUrl = z
  .string()
  .trim()
  .max(2000, 'Too long')
  .optional()
  .refine((v) => !v || /^https?:\/\//i.test(v), 'Use a full URL starting with https://')
```

Audit similar free-text fields rendered as anchors in `applications-list.tsx`, `client-management-tabs.tsx`, etc.

---

#### M5: `listJobs` uses `ilike('title', '%${q}%')` with no wildcard escaping

**File:** `src/lib/db/jobs.ts:112-114`
**Severity:** MEDIUM
**Category:** input handling / search correctness

**Finding:**

`q` from URL params is interpolated directly into a LIKE pattern: `query.ilike('title', \`%${q}%\`)`. The `%` and `_` wildcards in user input change semantics — typing `%` matches every job; typing `eng_neer` matches `engineer` AND `engiueer`. Not a SQL-injection (supabase-js parameterises the param), but predictable surprises.

**Why it matters:** Functional correctness in search UX, and a small denial-of-service / surprise vector (typing `%%%%` is a full-table scan against the trigram-less title column).

**Recommended fix:** Escape `%`, `_`, and `\` before interpolation, or move to an RPC like `search_clients` / `search_candidates`:

```ts
const escaped = q.replace(/([\\%_])/g, '\\$1')
query = query.ilike('title', `%${escaped}%`)
```

Note that `q` is already `.trim()`ed but never length-capped here. Pipe through the existing `q.length >= 2` gate that's already on this branch — it's there, just want the escape to land alongside.

---

#### M6: `acceptCVFieldsAction` doesn't verify the CV belongs to a candidate in the caller's org before calling `markCandidateFieldsFromCV`

**File:** `src/app/(app)/candidates/[id]/actions.ts:295-344`
**Severity:** MEDIUM
**Category:** multi-tenancy (defence in depth)

**Finding:**

`getCandidateCV` is user-scoped so RLS prevents reading another org's CV row. But `cv.candidate_id` — if Cause C1 (above) is exploited — could reference another tenant's candidate. `markCandidateFieldsFromCV` is then called via the user-scoped client (good — RLS scopes the SELECT and UPDATE), but the user-scoped client doesn't have read access to the victim's candidate row, so the helper's `maybeSingle()` returns `null` and the helper returns `not_found`. Good — RLS catches this path even if C1 is present. Confirm by walking the call.

So this action is safe in isolation, but the upstream C1 issue means the candidate_cvs row exists and the user could trigger many `acceptCVFieldsAction` calls that simply no-op. Low impact from THIS action, but the existence of cross-tenant `candidate_cvs` rows pollutes the user's UI — they see CV history for a candidate that's not theirs.

**Why it matters:** Mostly tracked by C1. Mention here as a secondary surface that depends on C1's fix.

**Recommended fix:** Once C1 is fixed (the cross-tenant FK guard on `candidate_cvs.candidate_id`), this becomes structurally impossible. No code change needed here directly — but add a comment near the `markCandidateFieldsFromCV` call referencing the FK guard as the upstream invariant.

---

#### M7: `safeNext` does not strip URL-encoded backslash variants

**File:** `src/lib/auth/safe-next.ts:11-18`
**Severity:** MEDIUM
**Category:** security (open redirect — edge case)

**Finding:**

`safeNext` rejects: empty, non-`/`-prefixed, `//…`, `/\\…`, and `://`-containing strings. It does NOT reject:

- `/%5c/evil.com` (URL-encoded backslash)
- `/%2f%2fevil.com` (URL-encoded protocol-relative)
- `/%09/evil.com` (URL-encoded tab) — IE/older WebKit sometimes treats whitespace-leading paths as protocol-less

Modern Chrome/Firefox/Safari don't expand `%5c` into `\` during redirect target parsing — the path stays `/%5c/evil.com` and the user just gets a 404. So this is not exploitable on current browsers, but legacy browser quirks and future URL parsing changes are out of our control. The unit tests in `tests/unit/safe-next.test.ts` don't cover these cases.

**Why it matters:** R2 → R10 of the verification pass tightened the obvious cases; this is the next ring outward.

**Recommended fix:** Normalise input by URL-decoding once and then re-running the checks, OR add explicit rejection for known dangerous encodings:

```ts
if (rawNext.includes('%5c') || rawNext.includes('%5C')) return '/'
if (rawNext.match(/%2[fF]%2[fF]/)) return '/'
```

Add corresponding tests:

```ts
it('returns / for URL-encoded backslash', () => {
  expect(safeNext('/%5cevil.com')).toBe('/')
})
it('returns / for URL-encoded // prefix', () => {
  expect(safeNext('/%2f%2fevil.com')).toBe('/')
})
```

---

#### M8: `(app)/error.tsx` passes the raw error to `Sentry.captureException`, bypassing the PII scrub for `error.message`

**File:** `src/app/(app)/error.tsx:22-25`
**Severity:** MEDIUM
**Category:** security (PII leakage to Sentry)

**Finding:**

The boundary calls `Sentry.captureException(error, { tags: { boundary: 'app-error' } })`. The Sentry `beforeSend` in `sentry.server.config.ts` scrubs `event.extra` and `event.contexts` only — it does NOT touch `error.message` or stack traces. If a future code path throws `new Error(\`candidate ${email} not found\`)` (which the codebase doesn't do today, but is the kind of debugging-leftover that creeps in), the PII would land in Sentry.

The Inngest parser handles this carefully (R4): it never passes the raw error, only `new Error(\`${name}: ${status}\`)`. The app error boundary doesn't apply the same rigour.

**Why it matters:** PII leakage to Sentry is one of the few CLAUDE.md "never do" rules. Defence in depth would have us reduce the surface even where today's code doesn't throw PII-bearing messages.

**Recommended fix:** Wrap with the same name+digest pattern, or strengthen `beforeSend` to scrub `event.exception.values[*].value` (the message). Latter is broader; former is loud and obvious.

```ts
Sentry.captureException(
  new Error(`${error.name}: ${error.digest ?? 'no-digest'}`),
  { tags: { boundary: 'app-error', digest: error.digest ?? 'none' } },
)
```

---

#### M9: `NEXT_PUBLIC_ALLOW_PASSWORD_AUTH` is read directly via `process.env` and not registered in `env.ts`

**File:** `src/app/(auth)/sign-in/sign-in-form.tsx:21`
**Severity:** MEDIUM
**Category:** convention / configuration safety

**Finding:**

Plan 0 R-D03 made `src/lib/env.ts` the single boot-time env validation point. The sign-in form bypasses it:

```ts
const PASSWORD_AUTH_AVAILABLE = process.env.NEXT_PUBLIC_ALLOW_PASSWORD_AUTH === '1'
```

This works (NEXT_PUBLIC_ env vars are statically inlined by Next.js), but:

1. The variable isn't documented in `.env.example` (verify).
2. If misconfigured to `'1'` in production, password sign-in becomes available for any user who appends `?password=1`. The comment "Production sign-in always uses magic link" is misleading — the gate is the env var, not the NODE_ENV.
3. Not in `env.ts`, so no zod validation; a typo (`'true'` vs `'1'`) silently disables it.

**Why it matters:** Auth surface should be configured through a single audited channel.

**Recommended fix:** Register in `env.ts`:

```ts
client: {
  // ...
  NEXT_PUBLIC_ALLOW_PASSWORD_AUTH: z.enum(['0', '1']).default('0'),
},
experimental__runtimeEnv: {
  // ...
  NEXT_PUBLIC_ALLOW_PASSWORD_AUTH: process.env.NEXT_PUBLIC_ALLOW_PASSWORD_AUTH,
},
```

Then in the form: `import { env } from '@/lib/env'; const PASSWORD_AUTH_AVAILABLE = env.NEXT_PUBLIC_ALLOW_PASSWORD_AUTH === '1'`. Also gate on `process.env.NODE_ENV !== 'production'` as a second guard. Add to `.env.example`.

---

### LOW

#### L1: `bumped_candidate_last_contacted_at` trigger uses `greatest()` against `-infinity`-coalesce — defensible but novel; add an integration test

**File:** `supabase/migrations/20260517215938_candidates_last_contacted_at.sql:38-43`
**Severity:** LOW
**Category:** correctness / testing

**Finding:** The "only move forward" semantic is implemented with `greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), new.occurred_at)`. Clever but easy to break with a future maintainer. The Phase 1 plan-level checks don't include a SQL test for this. Consider adding a Vitest test (using `supabase test`) or a `pg_TAP` style assertion. Not a bug — just hard to spot if someone "simplifies" later.

**Fix:** Optional — add SQL integration test in `tests/` or note in `docs/plan.md` so future migrations cite this invariant.

#### L2: `assert_same_org` raises with attacker-controlled table names in the error message — minor info leak

**File:** `supabase/migrations/20260517204500_cross_tenant_fk_guards.sql:31-37`
**Severity:** LOW
**Category:** security (info disclosure)

**Finding:** The exception message includes the parent table name: `'cross-tenant FK guard: % belongs to org %, expected %'`. Postgres errors propagate to the PostgREST client. The actions all map to a generic "Something went wrong" string before returning to the UI, so this doesn't reach end users. Still, the exception message also reveals the victim's org UUID in the `% belongs to org %` segment if a cross-tenant attempt fires. Sentry captures it.

**Fix:** Drop the org UUIDs from the exception message — keep only `'cross-tenant FK guard violated'`. Sentry already has the org tag from `setRequestScope`.

#### L3: `nextCVVersion` race window — two concurrent uploads from the same recruiter

**File:** `src/lib/db/candidate-cvs.ts:111-128`
**Severity:** LOW
**Category:** concurrency

**Finding:** `nextCVVersion` SELECTs the max version and returns `max + 1`. If two upload requests for the same candidate fire within milliseconds, both compute the same next version and the second `createCandidateCV` insert errors on the `(candidate_id, version)` unique constraint. The error path drops the storage object and returns "Couldn't record this CV." Functional behaviour is correct (no orphan data; user retries), but the error message is generic and the user has no breadcrumb for "you just double-clicked." Sentry catches the 23505.

**Fix:** When `createCandidateCV` returns `internal` with PG `code === '23505'`, map to a distinct user message: "Another upload completed just before this one. Please refresh and try again." Easy follow-up. Not urgent — the failure mode is rare (≤2 concurrent uploads from one tab).

#### L4: `Inngest` retries write to `ai_usage` on every attempt — duplicate cost ledger rows for retried CV parses

**File:** `src/lib/inngest/functions/parse-cv.ts:215-221` + `src/lib/ai/claude.ts:51-115`
**Severity:** LOW
**Category:** correctness / cost tracking

**Finding:** Each attempt of `step.run('claude-parse', …)` calls `parseCV` which calls `runWithLogging` which writes one `ai_usage` row per successful Claude call. With `retries: 3`, a 429 → retry → 200 path results in two `ai_usage` rows for the same CV. The first one *had* to call Claude (it consumed tokens), so the cost is real — but downstream "cost per CV" analytics over-counts.

Actually re-reading: 429 is retried inside `runWithLogging` itself (not at the Inngest step level), so the cost is logged only on the eventually-successful attempt. But if the WRITE step (`step.run('write-extracted')`) fails after `claude-parse` succeeded, Inngest retries the function from scratch, and the next attempt re-calls `parseCV` → another Claude call → another `ai_usage` row. Each row is correct (each Claude call really did spend tokens), so this is accurate, not a bug. But "1 CV → 1 cost entry" expectation is wrong.

**Fix:** Document in a comment near `parseCV` that re-tries inside Inngest produce additional `ai_usage` rows by design — the per-tenant `cost_pence` totals are still accurate.

#### L5: `activity-timeline.tsx` `useless aria-label`

**File:** `src/components/app/activity-timeline.tsx:159-163`
**Severity:** LOW
**Category:** accessibility / dead code

**Finding:** The component renders a `<span className="sr-only" aria-label={...}>` with no inner text. `sr-only + aria-label` on an empty span isn't a great pattern — screen readers don't always read aria-label on empty inline elements. The intent (expose initials to assistive tech) is nice but the implementation is unreliable.

**Fix:** Either set text inside the span (`{actorInitials(entry.actor ?? null)}`) so screen readers definitely pick it up, OR drop the span entirely and rely on the bold actor name preceding it.

#### L6: Dashboard `getFollowUpCandidates` over-fetches but doesn't honour the limit at the SQL level

**File:** `src/lib/db/dashboard.ts:370-452`
**Severity:** LOW
**Category:** performance / future scale

**Finding:** The query fetches `limit * 3` (min 30) rows and re-sorts client-side. The comment is honest: "At anchor scale (<= a few hundred candidates with that overdue filter) this is cheap." Fine for Phase 1. The fallback strategy when the anchor scales to 10k candidates is unspecified.

**Fix:** Add a `// TODO Phase 2: convert to RPC with CASE ordering if rows > 1000` comment. No action now.

#### L7: `Sentry.captureException(invitedError ?? new Error('inviteUserByEmail: no user returned'))` may pass a raw Supabase error object

**File:** `src/app/(app)/settings/actions.ts:155-159`
**Severity:** LOW
**Category:** security (PII leakage to Sentry)

**Finding:** The first argument to `captureException` is `inviteError ?? new Error(...)`. If `inviteError` is non-null, it's a raw `AuthError` from Supabase. The Sentry SDK serialises its message and properties. Supabase admin errors typically don't echo PII, but `inviteError.message` could contain the email being invited ("User with email <email> already exists"). The `beforeSend` PII scrub only walks `event.extra` and `event.contexts`, not the exception message.

**Fix:** Mirror the Inngest pattern:

```ts
Sentry.captureException(
  new Error((inviteError?.name ?? 'inviteUserByEmail') + ': failed'),
  { tags: { layer: 'action', helper: 'inviteTeammateAction', status: inviteError?.status ?? 'unknown' } },
)
```

Also: `formError: inviteError?.message ?? 'Invite failed. Please try again.'` echoes the raw message to the UI. If `error.message` is `"User already exists"` that's fine — but if it's anything mentioning the invited email, the inviting recruiter sees it. Probably fine in practice but consider replacing with a hardcoded message.

#### L8: Filename slugging strips most non-ASCII characters — international CVs lose context

**File:** `src/app/(app)/candidates/[id]/actions.ts:96-107`
**Severity:** LOW
**Category:** UX

**Finding:** `slugifyFilename` strips everything outside `[a-z0-9]` to dashes. A CV named "Müller_CV_中文.pdf" becomes "m-ller-cv.pdf" in storage. The Supabase dashboard shows the slug, not the original. For path traversal defence this is overkill: the storage path already encodes the org/candidate UUID prefix.

**Fix:** Optional. Either widen the regex to allow `\p{L}\p{N}` (Unicode letters/numbers) since the storage path is never re-fed into the filesystem, or store the original filename in `candidate_cvs.original_filename` (new column, additive migration). Phase 2 polish.

#### L9: `decline_reason` not surfaced in candidate detail page activity timeline

**File:** `src/components/app/activity-timeline.tsx` + `src/lib/db/candidates.ts:307-328`
**Severity:** LOW
**Category:** UX / coverage gap

**Finding:** The dashboard's `RecentActivityFeed` translates `metadata.decline_reason` to a human label via `formatDeclineReason()`. The candidate detail page's `ActivityTimeline` does not. Today candidate-typed activities don't include stage_change rows (those are entity_type='application'), so the timeline never sees a decline reason — but if a future plan adds candidate-level stage activities, the rendering will fall back to the raw enum.

**Fix:** Either bring the decline_reason translation logic into `ActivityTimeline` (use `entry.kind === 'stage_change'` + metadata check, mirror the dashboard pattern) or document the contract: "this component does not translate decline_reason; use `RecentActivityFeed` if your entries include stage_change rows." Either is fine; consistency would be the higher polish.

#### L10: README is not part of the changed-file scope — Plan 5 promised README updates

**File:** Outside review scope (README updates were planned but file not in changed-files list)
**Severity:** LOW
**Category:** documentation

**Finding:** Plan 5 Task 5.3 lists README updates. Git diff doesn't include `README.md` in the change list. Either Plan 5's README change didn't land or it landed outside this commit window.

**Fix:** Verify and reconcile. If README updates were skipped, log in the Plan 5 summary for a follow-up.

#### L11: `pnpm-workspace.yaml` change is in `git status` but uncommitted on main

**File:** `pnpm-workspace.yaml` (in `M` state per starting git status — not yet committed)
**Severity:** LOW
**Category:** hygiene

**Finding:** The initial git status shows `pnpm-workspace.yaml` modified and `src/types/database.ts` modified, both uncommitted. Neither is part of any reviewed commit. Either:

- These are local-dev artefacts the reviewer's environment dirtied (e.g., `pnpm install` updated the placeholder values per R-D03); leave alone.
- They represent un-committed work; flag for the executor to either commit or revert.

**Fix:** Confirm with the operator. If `pnpm-workspace.yaml` placeholder fix from CONCERNS.md was meant to land here, push it.

## Invariants verified

- `grep -rn "new Anthropic" src/` → only `src/lib/ai/claude.ts:16` ✔
- `grep -rn "record_audit" src/` → only `src/lib/db/candidates.ts:175` (inside `getCandidate`) ✔ — not in `listCandidates`
- `grep -rn "@ts-nocheck" src/ tests/` → none ✔ (database.ts comment paraphrases the rule but does not contain the directive)
- `grep -rn ": any\b\|<any>\|as any" src/ tests/` → none ✔
- `grep -rn "TODO\|FIXME\|XXX\|HACK" src/ tests/` → none ✔
- `grep -rn "console\." src/` → none ✔
- All `src/lib/db/*` modules `import 'server-only'` except `pipeline-stages.ts` (intentional, types-only) ✔
- All RPC SQL functions `set search_path = public` except `bump_last_contacted_at` (Plan 3 — see M1) and `record_audit`/`record_ai_usage` (base schema, already set there) ✔ (one gap)
- `move_application` is `security invoker` ✔
- `client_activity_timeline` view is `security_invoker = true` ✔
- `search_candidates` and `search_clients` RPCs are `security invoker` with `search_path = public` ✔
- `decline_reason` enum values in `src/types/database.ts` match the migration schema (9 values) ✔ R1 honored
- `organizations.logo_url` migration `20260518202000` exists; `OrganizationForm` and `getOrganization` consume it ✔ R2 honored
- `set_organization_id()` re-declared with `set search_path = public` in `20260517204504` ✔ R3 honored
- Inngest catch (`parse-cv.ts:118-128`, `:273-279`) wraps `new Error(name + status)`, never the raw error ✔ R4 honored
- `markCandidateFieldsFromCV` field list matches Phase 1 candidates columns + empty-array predicate for `text[]` columns ✔ R5 honored
- Contact-edit page is `/clients/[id]/contacts/[contactId]/edit/page.tsx` (separate route, not inline Sheet) ✔ R6 honored
- `PipelineShell` uses `useSyncExternalStore + matchMedia`, not dual Tailwind tree ✔ R7 honored
- `inviteTeammateAction` reads role via user-scoped client first, then switches to service-role ✔ R8 honored
- `MAX_CV_BYTES = 10 * 1024 * 1024` enforced in `uploadCVAction` ✔ R9 honored
- E2E golden-path skips CV upload step ✔ R10 honored
- Cross-tenant FK guards exist for contacts/jobs/applications ✔ — **missing for `candidate_cvs.candidate_id`** ✗ (C1)

## Strengths

1. **Service-role usage is centralised and audit-thoughtful.** `createServiceClient` is `server-only`, called from exactly two places (Inngest parser, settings invite admin call), and both use it AFTER a documented privilege check. The Inngest tenant-boundary check at line 155 is a thoughtful belt-and-braces guard — even though it has the C1 gap, the intent and code shape are right.
2. **D-08 implementation is rigorous and well-tested.** The `markCandidateFieldsFromCV` helper centralises the empty-only merge logic with clear scalar vs array predicates, and the Vitest suite covers the regression cases that would silently break it. The "treat empty array as empty" branch is exactly the subtle test that would have been missed without R5's guidance.
3. **PII discipline in the Inngest parser is consistent and explicit.** The R4 pattern (`new Error(\`${name}: ${status}\`)`) is repeated in three Sentry calls inside `parse-cv.ts` with comments explaining why. This is the right convention to repeat — it's friction that pays off the first time Anthropic SDK errors echo prompt fragments.
4. **Search RPCs are correctly authored.** `security invoker`, `set search_path = public`, deterministic tie-breakers, denormalised `total_count` via window — all four design decisions match the planner's spec and avoid the common pitfalls (security definer leak, non-stable pagination order, N+1 count). The GRANT signature mismatch that R-f2136a2 fixed before merge is a good demonstration of the verification gate working.

## Recommendations (prioritized)

1. **Fix C1 (cross-tenant FK guard on `candidate_cvs.candidate_id`)** before merging or pushing to production. Add the additive migration, and ideally also rewrite the Inngest event payload to carry only `candidate_cv_id` and look up the rest from the trusted DB row.
2. **Fix H1 and H2** — they're a one-day cleanup. H1 because the silent dispatch failure mode hides parsing failures; H2 because the decline_reason chip on the job-detail applications list is a genuine UX regression.
3. **Fix H3** — clients Activity tab attributing every entry to "System" is the most user-visible bug after H2. Pair with M3 by introducing the `listOrgUsers`/`listActorsByIds` helper.
4. **Land M3 + M1** as a consistency pass — the inline `.from('users')` and the missing `search_path` on `bump_last_contacted_at()` are both follow-ups to the Plan 0 hardening pattern. Doing them together keeps the convention coherent.
5. **Polish: M4 (client website URL validation), M5 (ilike escaping), M7 (safeNext URL-encoded variants), M8 + L7 (Sentry message scrub on error boundary + invite admin call).** All are one-line / few-line tightenings. Cumulatively they close every remaining "could go wrong" surface I could identify in the changed files.
6. **Defer L1–L11.** They are real but small. Most can wait until Phase 2 cleanup or after the user has thirty days of real usage to surface what actually matters.

---

_Reviewed: 2026-05-18_
_Reviewer: gsd-code-reviewer_
_Depth: deep_
