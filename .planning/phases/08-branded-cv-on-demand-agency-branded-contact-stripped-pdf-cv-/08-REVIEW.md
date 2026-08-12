---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
reviewed: 2026-08-12T14:05:00Z
depth: deep
diff_base: a3cf005662799560825efdb6a2ef7851e8f5c5e6
files_reviewed: 43
files_reviewed_list:
  - next.config.ts
  - package.json
  - playwright.smoke-auth.config.ts
  - src/app/(app)/candidates/[id]/actions.ts
  - src/app/(app)/candidates/[id]/branded-cv-generate-button.tsx
  - src/app/(app)/candidates/[id]/branded-cv-panel.tsx
  - src/app/(app)/candidates/[id]/branded-cv/route.ts
  - src/app/(app)/candidates/[id]/page.tsx
  - src/app/(app)/settings/actions.ts
  - src/app/(app)/settings/branding/actions.ts
  - src/app/(app)/settings/branding/branding-form.tsx
  - src/app/(app)/settings/branding/logo-upload-field.tsx
  - src/app/(app)/settings/branding/page.tsx
  - src/app/(app)/settings/branding/schema.ts
  - src/app/(app)/settings/organization-form.tsx
  - src/app/(app)/settings/page.tsx
  - src/app/(app)/settings/schema.ts
  - src/app/(public)/apply/[orgSlug]/page.tsx
  - src/lib/admin/org-erasure.ts
  - src/lib/branding/org-logo.ts
  - src/lib/db/candidate-branded-cvs.ts
  - src/lib/db/organizations.ts
  - src/lib/db/postgrest-errors.ts
  - src/lib/pdf/branded-cv-data.ts
  - src/lib/pdf/branded-cv-document.tsx
  - src/lib/pdf/register-fonts.ts
  - src/lib/upload/image-signature.ts
  - supabase/migrations/20260812120000_candidate_branded_cvs.sql
  - supabase/migrations/20260812120100_org_logos_bucket.sql
  - tests/smoke/authed/branded-cv.smoke.ts
  - tests/unit/app/candidates/branded-cv-route.test.ts
  - tests/unit/app/candidates/delete-candidate-branded-sweep.test.ts
  - tests/unit/app/candidates/generate-branded-cv-action.test.ts
  - tests/unit/app/settings/logo-single-surface.test.ts
  - tests/unit/app/settings/org-logo-actions.test.ts
  - tests/unit/lib/admin/org-erasure-coverage.test.ts
  - tests/unit/lib/branding/org-logo.test.ts
  - tests/unit/lib/db/candidate-branded-cvs.test.ts
  - tests/unit/lib/pdf/branded-cv-data.test.ts
  - tests/unit/lib/pdf/branded-cv-document.test.ts
  - tests/unit/lib/pdf/render-foundation.test.ts
  - tests/unit/lib/upload/image-signature.test.ts
  - tests/unit/supabase/phase8-migrations.test.ts
findings:
  critical: 3
  warning: 7
  info: 6
  total: 16
status: issues_found
verdict: FIX-FIRST
---

# Phase 8 (Branded CV): Code Review Report

**Reviewed:** 2026-08-12
**Depth:** deep (cross-file: import graph, call chains, DB/RLS boundary, deploy ordering)
**Diff:** `a3cf005..HEAD` (49 commits, 9 plans)
**Files reviewed:** 43 source/test/migration files
**Status:** issues_found — **FIX-FIRST**

## Summary

The Phase 8 feature code is, on its own terms, of high quality. I verified — against
the code, not the SUMMARYs — that:

- the contact-strip is a genuine type-level guarantee (`BrandedCvData` has no
  email/phone/salary field) *and* is pinned at runtime by an unpdf raw-byte
  absence check (`branded-cv-document.test.ts:144`);
- `generateBrandedCvAction` really is ungated by billing and really does never
  call `requireEntitledOrg` — pinned twice, once per-test and once in an
  `afterEach` that runs on every path in the file
  (`generate-branded-cv-action.test.ts:255,274`), with the founder rationale
  comment present (`actions.ts:535-547`);
- the logo upload/remove actions **remain** entitlement- and owner-gated
  (`settings/branding/actions.ts:151,170,227,244`), with tests for both;
- the View control is a real `<a href>` with `rel="noopener noreferrer nofollow"`
  and no client promise anywhere in the click path (`branded-cv-panel.tsx:78-86`)
  — the Phase-7 incident class is genuinely avoided, and the smoke pins
  "no `button` named View exists" (`branded-cv.smoke.ts:409`);
- the export audit row is filed **before** the 302 and its ordering (not just
  occurrence) is pinned (`branded-cv-route.test.ts:208`);
- every failure in the delivery route collapses to the same bare 404 — no
  cross-tenant existence oracle;
- zero AI/network in the generation path, statically pinned, with the yoga-WASM
  `data:` URL correctly exempted and only `http(s)` fetches rejected
  (`render-foundation.test.ts:89`);
- both migrations are additive and idempotent, RLS is enabled with the full
  policy quad keyed on `current_organization_id()`, and the `org-logos` bucket
  is private with a PNG/JPEG allowlist;
- GDPR sweeps cover branded PDFs on candidate delete (`actions.ts:794,885`) and
  `org-logos` on org erasure (`org-erasure.ts:22`), with the missing-bucket
  tolerance narrowly scoped to 404+"bucket" and a test proving a genuine list
  failure still throws (`org-erasure-coverage.test.ts:123`).

I ran the gates myself: `tsc --noEmit` exit 0; the 13 Phase-8 unit files pass
(190 tests, including real PDF renders + text extraction).

**But three defects must be fixed before this reaches a human, and one of them
may be an active production incident right now.** The phase adds
`organizations.logo_storage_path` to three SELECT lists with no missing-column
tolerance while its own migration is documented as *not yet pushed* — that
combination 404s the public apply form for every tenant. The new
`candidate_branded_cvs.candidate_id` has no cross-tenant FK guard trigger, which
this repo previously classified CRITICAL for the identical shape on
`candidate_cvs`. And the logo upload advertises a 2 MB cap that Next's
1 MB Server Action body limit rejects — the founder's own Phase-1 research
flagged this exact trap and it was never configured.

---

## Blockers (critical tier — must fix before UAT/ship)

### CR-01 — `organizations.logo_storage_path` has NO pre-migration tolerance: a code-ahead-of-migration deploy 404s the public apply form for every tenant

**Severity:** BLOCKER
**Files:**
- `src/lib/db/organizations.ts:45` (`getOrganization` SELECT)
- `src/lib/db/organizations.ts:102` (`updateOrganization` returning SELECT)
- `src/lib/db/organizations.ts:153` (`getOrganizationBySlug` SELECT)

**Issue:**
Migration `20260812120100_org_logos_bucket.sql` adds
`organizations.logo_storage_path`. `08-01-SUMMARY.md:37,88,151` states the
migration is **checkpoint-pending on the founder's manual `db push`**, and
`08-VERIFICATION.md` (written today) repeats that the push has not happened.
Meanwhile the code that selects the column is merged to `main` and deployed
(`7b72c18 chore: retrigger Vercel deploy…`, then `88c3269`).

PostgREST rejects a SELECT naming an unknown column with SQLSTATE `42703` —
the **whole query fails**, it does not return the other columns. Every one of
these paths therefore fails closed on a pre-migration database:

| Path | Line | Behaviour when the column is missing |
|---|---|---|
| Public apply page | `src/app/(public)/apply/[orgSlug]/page.tsx:59-62` | `!orgResult.ok` → `notFound()` → **every tenant's apply form 404s** |
| Apply submission | `src/app/(public)/apply/[orgSlug]/actions.ts:317-320` | "Submissions are not currently accepted." — **applications silently stop arriving** |
| Apply confirm | `src/app/(public)/apply/[orgSlug]/actions.ts:583-586` | "CV record not found." |
| Stripe checkout | `src/app/api/stripe/checkout/route.ts:91-93` | 400 "Could not load your organisation" — **no new subscriptions** |
| Stripe portal | `src/app/api/stripe/portal/route.ts:52-54` | 400 — **no billing management** |
| Settings / Branding / TopNav | `settings/page.tsx:33`, `branding/page.tsx:38`, `(app)/layout.tsx:32` | degrade to blank/"" (these are fine) |

This is precisely the failure mode the phase went to great lengths to prevent
for `candidate_branded_cvs` (`isMissingTableError`, the tri-state
`BrandedCvState`, the self-hiding panel) — and the same discipline exists in
this repo *for columns* (`isMissingColumnError`, `src/lib/db/postgrest-errors.ts:31`,
written for exactly this reason). It simply was not applied here. The
08-01 SUMMARY's claim that "every later plan is written to degrade gracefully in
the meantime" is **false for this column**.

**Concrete failure scenario:** Steele Charles's careers/apply link has been
returning a 404 to real candidates since the Phase-8 deploy, and no one will
learn about it from Sentry — `getOrganizationBySlug` captures the error, but the
page renders a perfectly ordinary 404. Lost inbound applications are
unrecoverable.

**Fix (do both):**

1. **Immediately** — verify live state and, if unmigrated, push:
   ```sql
   -- read-only check
   select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'organizations'
     and column_name = 'logo_storage_path';
   ```
   ```bash
   pnpm exec supabase db push --linked   # founder's script
   ```
   Then load a real `/apply/<slug>` and confirm 200.

2. **Durably** — make the read tolerant so the next code-ahead-of-migration
   deploy degrades instead of 404ing a public form:
   ```ts
   // src/lib/db/organizations.ts
   const WITH_LOGO_PATH = 'id, name, slug, apply_form_enabled, logo_url, logo_storage_path, brand_primary, brand_secondary'
   const WITHOUT_LOGO_PATH = 'id, name, slug, apply_form_enabled, logo_url, brand_primary, brand_secondary'

   let { data, error } = await supabase.from('organizations').select(WITH_LOGO_PATH).eq('slug', slug).maybeSingle()
   if (error && isMissingColumnError(error, 'logo_storage_path')) {
     ;({ data, error } = await supabase.from('organizations').select(WITHOUT_LOGO_PATH).eq('slug', slug).maybeSingle())
     // logo_storage_path is simply absent -> resolveOrgLogoUrl falls through to logo_url/wordmark
   }
   ```
   Apply the same two-step to `getOrganization`. (`updateOrganization` only
   writes `logo_storage_path` from the logo actions, which are already
   feature-scoped, so it can stay strict.)

---

### CR-02 — No cross-tenant FK guard on `candidate_branded_cvs.candidate_id`: an attacker in org A can permanently break branded-CV generation for a named candidate in org B

**Severity:** BLOCKER
**Files:**
- `supabase/migrations/20260812120000_candidate_branded_cvs.sql:45,52,74-75,87-88`
- exploited via `src/app/(public)/apply/[orgSlug]/actions.ts:549-550`
- surfaces as a permanent failure at `src/lib/db/candidate-branded-cvs.ts:277-314`

**Issue:**
The table has a plain FK to `candidates(id)` plus `unique (candidate_id)`, and
`organization_id` is filled by the `set_organization_id` BEFORE INSERT trigger.
The INSERT RLS policy only checks `organization_id = current_organization_id()`
— **nothing checks that the referenced candidate belongs to the caller's org.**
Postgres FKs do not enforce tenancy, and they bypass RLS.

This repo has already been bitten by this exact shape and fixed it as a
CRITICAL: `20260518211005_candidate_cvs_cross_tenant_fk_guard.sql` installs
`assert_same_org('public.candidates', new.candidate_id, new.organization_id)` on
`candidate_cvs`; `ai_summaries`, `applications`, `jobs`, `contacts`,
`spec_drafts` and `job_ads` all carry the same guard. `candidate_branded_cvs`
does not.

**Concrete, fully-reachable exploit (no UUID guessing required):**

1. Attacker submits the victim org's **public** apply form. `submitApplyAction`
   returns `{ candidateId, candidateCvId }` to the unauthenticated client
   (`apply/[orgSlug]/actions.ts:549-550`). With a known candidate's email the
   dedupe path (`:349 candidateId = existing.data.id`) hands back the **existing**
   victim candidate's real UUID.
2. Attacker, signed in to their own tenant, POSTs straight at PostgREST with
   their own JWT:
   ```
   POST /rest/v1/candidate_branded_cvs
   { "candidate_id": "<victim-candidate-uuid>", "storage_path": "x" }
   ```
   Trigger stamps `organization_id` = attacker's org, the WITH CHECK passes, the
   FK passes, the row commits, and `unique (candidate_id)` is now consumed.
3. Victim org clicks **Generate**: their RLS-scoped read sees no row →
   `upsertBrandedCv` INSERTs → `23505` → recovery path `updateExisting` →
   `UPDATE … eq(candidate_id)` matches 0 rows under the victim's RLS →
   `.single()` returns `PGRST116` → `{ ok:false, code:'internal' }` → the
   recruiter sees **"Couldn't save the branded CV. Please try again."** forever.
   The just-rendered PDF is deleted every attempt. There is no UI or support
   path to clear the poisoned row (it is invisible to the victim's RLS).

No data is read cross-tenant (Storage RLS still blocks signing another org's
path), so this is integrity/denial-of-service, not disclosure — but it is
permanent, silent to the victim, and trivially scriptable against every
candidate an attacker can enumerate through the apply form.

**Fix:** new, append-only migration mirroring the `candidate_cvs` precedent:

```sql
-- supabase/migrations/2026xxxxxxxxxx_candidate_branded_cvs_cross_tenant_fk_guard.sql
create or replace function public.candidate_branded_cvs_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org(
    'public.candidates'::regclass, new.candidate_id, new.organization_id);
  return new;
end;
$$;

drop trigger if exists candidate_branded_cvs_same_org_check
  on public.candidate_branded_cvs;
create trigger candidate_branded_cvs_same_org_check
  before insert or update of candidate_id, organization_id
  on public.candidate_branded_cvs
  for each row execute function public.candidate_branded_cvs_same_org_guard();
```

Add a pin to `tests/unit/supabase/phase8-migrations.test.ts` asserting the guard
exists (source inspection, same style as the existing pins), so a future table
cannot ship without it. Push this **with** the two pending Phase-8 migrations so
the window never opens.

---

### CR-03 — Logo upload advertises a 2 MB cap; Next rejects at 1 MB (default `serverActions.bodySizeLimit`), so a real agency logo can fail with an opaque error

**Severity:** BLOCKER
**Files:**
- `next.config.ts:4-59` (no `serverActions.bodySizeLimit` anywhere)
- `src/lib/upload/image-signature.ts:36` (`MAX_LOGO_BYTES = 2 MiB`)
- `src/app/(app)/settings/branding/logo-upload-field.tsx:75,197` (client cap + "up to 2 MB" copy)
- `supabase/migrations/20260812120100_org_logos_bucket.sql:33` (bucket limit 2097152)

**Issue:**
Next's Server Action body limit defaults to **1 MB** — verified in the installed
runtime: `node_modules/next/dist/server/app-render/action-handler.js:566-575`
(`bodySizeLimitBytes … : 1024 * 1024`, then `ApiError(413, 'Body exceeded …')`).
`uploadOrgLogoAction` is a Server Action receiving the file in `FormData`, so a
1.0–2.0 MB PNG **never reaches the action at all**: Next 413s the request, the
`await uploadOrgLogoAction(formData)` promise rejects, and the client falls into
the generic `catch` (`logo-upload-field.tsx:102-106`) showing
`err.message` — a framework error string, not the honest "too large" copy the
project wrote. Every layer of the app (client check, `assertUploadableLogo`,
Storage bucket) says 2 MB is allowed; the platform says 1 MB.

The project's own Phase-1 research called this out and it was never actioned:
`.planning/phases/01-internal-ats/01-RESEARCH.md:1854` — *"Server Action body
size limit is 1 MiB by default… Configure in next.config.ts."*

**Concrete failure scenario:** at UAT the founder uploads the real Steele
Charles logo (a landscape lockup PNG — 1–2 MB is entirely ordinary at print
resolution) and the headline setup step of the phase fails with an
unintelligible error. Note the same defect already applies to `uploadCVAction`,
which advertises 10 MiB (`candidates/[id]/actions.ts:104,147`) — any customer CV
over 1 MB is failing today for the same reason.

**Fix:**
```ts
// next.config.ts
const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '12mb' }, // >= MAX_CV_BYTES (10 MiB) and MAX_LOGO_BYTES (2 MiB)
  },
  // …
}
```
Then keep the two application caps as the real authority (they already run
before any Storage write). Add a regression pin asserting
`bodySizeLimit` >= `MAX_CV_BYTES` so the two can't drift.

---

## Warnings

### WR-01 — Font read + `Font.register` at module scope puts the whole candidate detail page behind a file-packaging assumption

**File:** `src/lib/pdf/register-fonts.ts:31-53`, reached from
`branded-cv-document.tsx:23` → `candidates/[id]/actions.ts:25` → the
`/candidates/[id]` server bundle.

**Issue:** `readFileSync(join(process.cwd(), …))` runs at import time and is
*designed* to throw. Because the module is in the candidate page's import graph
(the Server Action lives in `actions.ts`, which the page imports transitively
via its client components), an ENOENT does not degrade the branded-CV feature —
it throws while loading the route module, i.e. **the candidate detail page, the
CV review panel, activity logging and candidate delete all 500 together**, for
users who never touch branded CVs.

I verified the mitigation currently holds: Next matches
`outputFileTracingIncludes` keys with `picomatch(key, { contains: true })`
(`node_modules/next/dist/build/collect-build-traces.js:463-471`), and
`/candidates/[id]` does match the route — so the fonts *are* traced today. The
objection is blast radius, not present breakage: the guard is one config key
away from silently excluding the fonts (a route rename, a moved action, a Next
upgrade changing the matcher).

**Fix:** make registration lazy and local to the render, so a packaging
regression costs the feature, not the page:
```ts
let fontsReady = false
export function ensureBrandedCvFonts() {
  if (fontsReady) return
  Font.register({ /* … */ })
  Font.registerHyphenationCallback((w) => [w])
  fontsReady = true
}
// branded-cv-document.tsx
export function renderBrandedCv(data, branding) {
  ensureBrandedCvFonts()               // throws inside the try/catch at actions.ts:607
  return renderToBuffer(<BrandedCvDocument … />)
}
```
`generateBrandedCvAction` already wraps `renderBrandedCv` in try/catch with a
PII-free Sentry capture and a friendly message — this puts the failure there.

### WR-02 — The smoke mutates the founder's LIVE org branding with no cleanup guarantee

**File:** `tests/smoke/authed/branded-cv.smoke.ts:412-455` (afterAll at `:181-245`
sweeps candidates only)

**Issue:** the branding test uploads a 1×1 bottle-green PNG as the org's real
logo and relies on the *same test body* reaching the Remove step to undo it. If
anything between `:448` and `:452` fails or times out (a slow Storage write, a
flaky toast assertion, CI cancellation, `retries: 2` abandoning mid-test), the
founder's production org is left with a **1-pixel logo rendering on the public
apply page and on every branded CV generated thereafter**. Every other write in
this spec is protected by the fail-closed `afterAll` sweep; this one is not.
The `test.skip(!hasNoLogo)` guard only prevents clobbering an *existing* logo —
it does nothing about residue this test creates.

**Fix:** move the undo into `afterAll` (idempotent), so it runs on failure paths
too:
```ts
let smokeLogoUploaded = false
// …after a confirmed 'Logo uploaded' toast: smokeLogoUploaded = true
test.afterAll(async () => {
  if (smokeLogoUploaded && page) {
    await page.goto('/settings/branding')
    const remove = page.getByRole('button', { name: 'Remove', exact: true })
    if (await remove.isVisible().catch(() => false)) {
      await remove.click()
      await page.getByText('No logo yet').waitFor({ timeout: 15_000 })
    }
  }
  // …existing candidate sweep
})
```

### WR-03 — "Remove" irreversibly destroys a legacy `logo_url` with no confirmation and no way to re-enter it

**Files:** `src/app/(app)/settings/branding/actions.ts:252-255` (remove nulls
both columns), `:192-195` (upload also nulls `logo_url`),
`logo-upload-field.tsx:156-166` (single-click Remove, no dialog),
`settings/schema.ts` + `branding/schema.ts` (both `logo_url` editors deleted in 08-06)

**Issue:** an org whose logo is a legacy pasted URL renders `currentLogoUrl` →
`hasAnyLogo` → the **Remove** button. One click sets `logo_url = null`. After
08-06 there is no surface anywhere in the app that can set `logo_url` again, so
the org's apply-page branding is permanently lost and only a manual SQL update
can restore it. Compare `CandidateDeleteButton`, which requires a confirm step
for a destructive act.

**Fix:** either (a) have `removeOrgLogoAction` clear only `logo_storage_path`
and let the precedence rule fall back to the legacy URL, or (b) add an
AlertDialog confirm whose copy names what is being removed ("This will also
clear the logo URL you pasted previously — it can't be restored from here"). (a)
is smaller and matches the documented precedence rule.

### WR-04 — The salary guarantee is narrower than the code claims: `about`/`headline` free text reaches the client-facing PDF verbatim

**Files:** `src/lib/pdf/branded-cv-data.ts:16-22,76-77`,
`tests/unit/lib/pdf/branded-cv-document.test.ts:55,176`

**Issue:** the module header states salary fields are *"commercially sensitive
negotiating information that must never reach a client-facing document"*, and
the column allowlist honours that. But `about` is passed through unmodified and
the test fixture deliberately pins that **`"£850 per day"` in `about` survives
into the PDF** (`:176`). The recruiter-facing warning
(`BRANDED_CV_FREE_TEXT_WARNING`) names only *"a phone number or email"* — so the
one mitigation the design relies on doesn't mention the risk the header claims
is absolute. A CV parsed by Haiku routinely puts rate/salary history into the
summary; that document then goes to the client.

**Fix:** extend the warning copy (one string, no logic change):
```ts
export const BRANDED_CV_FREE_TEXT_WARNING =
  'Contact fields and salary columns are removed automatically. Check the headline and summary yourself before sending — a phone number, email, day rate or salary typed into prose is not removed.'
```
and soften the header comment from "must never reach" to "is excluded from the
structured fields; free text is the recruiter's responsibility".

### WR-05 — Genuine DB failures in the delivery route are indistinguishable from "no branded copy" for the user

**File:** `src/app/(app)/candidates/[id]/branded-cv/route.ts:94-97`

**Issue:** `if (!brandedResult.ok) notFound()` folds `code: 'internal'` (a real
Postgres/PostgREST fault, already Sentry-captured at
`candidate-branded-cvs.ts:106`) into the same bare 404 as "no row" and
"cross-tenant". Uniform 404s are correct for the *existence* cases; an internal
fault is not an existence signal, and returning 404 for it tells the recruiter
their document is gone when the database merely hiccupped.

**Fix:**
```ts
if (!brandedResult.ok) {
  if (brandedResult.code === 'internal') {
    return new NextResponse(SIGN_FAILED_COPY, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  notFound()   // not_found: row missing, cross-tenant, or table not migrated
}
```
This leaks nothing (the 502 is identical for any candidate id) and matches the
route's own treatment of a failed sign.

### WR-06 — Activity write result unchecked, and generation files no `audit_log` row

**File:** `src/app/(app)/candidates/[id]/actions.ts:697-703`

**Issue:** `await createActivity(...)` discards its `DbResult`; a failed insert
still returns `{ ok: true }` to the user, so the "Branded CV generated" trail
can be missing with no user-visible signal (Sentry-only). Separately, the action
reads the full candidate row (`:572-576`) but deliberately files no `audit_log`
row, on the reasoning that the detail page already filed a `view`. That holds
for the UI path, but the action is a directly-invocable POST endpoint — a script
can generate branded PDFs of every candidate with the only trace being an
`activities` row of `kind: 'system'`, which is not what CLAUDE.md's "every access
to candidate data is logged" means.

**Fix:** check the result and downgrade the toast (`{ ok: true, warning: … }`) or
at minimum capture explicitly; and consider `recordExportAudit(supabase,
'candidate', candidateId, { action: 'branded_cv_generated' })` here — the
delivery route already proves the audit write is cheap and never-throwing.

### WR-07 — `08-VERIFICATION.md`'s prettier claim doesn't cover the phase; 7 new source files fail `prettier --check`

**Files:** `branded-cv-panel.tsx`, `candidates/[id]/page.tsx`, `branding-form.tsx`,
`logo-upload-field.tsx`, `org-erasure.ts`, `candidate-branded-cvs.ts`,
`branded-cv-document.tsx` (+7 test files)

**Issue:** the verification records `prettier --check` as green, but it was only
run over the two files 08-09 touched. Running it across the phase diff reports
14 failures. (Repo-wide baseline is already 252 files, so this is drift, not a
new class of problem — but the *claim* is an overclaim, and `pnpm format:check`
is a documented gate.)

**Fix:** `pnpm exec prettier --write` over the phase diff, and correct the
verification note to say which files were checked.

---

## Info

### IN-01 — `register-fonts.ts` double-registration guard is dead code
`src/lib/pdf/register-fonts.ts:29-31,68`: `let registered = false; if (!registered) { … registered = true }` at module scope can never observe `true` on entry — a module body runs once per instantiation, and a second instantiation gets a fresh `false`. The comment claims it guards hot-reload/dual-registry cases; it cannot. Remove it, or move the flag into the lazy initialiser proposed in WR-01 (where it becomes real).

### IN-02 — `generateBrandedCvAction` reads `select('*')` on candidates
`src/app/(app)/candidates/[id]/actions.ts:572-576` pulls every column including the `halfvec(1024)` embedding and the PII columns the mapper then discards. Consistent with `getCandidate` (`src/lib/db/candidates.ts:278`), so not a regression — but an explicit ~12-column list here would make the contact-strip visible at the query layer too.

### IN-03 — Branded CV can be generated for a candidate with no data
`branded-cv-panel.tsx:46-67` renders **Generate** regardless of parse state, so a name-only candidate yields a near-empty client-facing PDF that is then stored and offered as "Branded copy". Consider gating the control (or adding a hint) on `data.work.length || data.about` — cheap, and it prevents a bad artifact reaching a client.

### IN-04 — Missing-table breadcrumb fires on every candidate page render pre-migration
`src/lib/db/candidate-branded-cvs.ts:145-152` adds a Sentry breadcrumb per render while the table is absent. Correct behaviour (breadcrumb, not exception) but noisy for the whole pre-migration window; a module-level "logged once" flag would be quieter.

### IN-05 — `isMissingBucketError` is message-shaped, as documented
`src/lib/admin/org-erasure.ts:85-92` matches 404 + `/bucket/i`. I could not construct a realistic non-missing-bucket error that satisfies both (list on a valid bucket with an unknown prefix returns `[]`, not 404), and the test proves a 500 still throws. Flagged only so the looseness stays on the record if storage-js ever changes its 404 copy.

### IN-06 — No execution evidence exists for this phase yet
`08-VERIFICATION.md` is explicitly PARTIAL: Task 3 (`pnpm smoke:auth` against production) and Task 4 (founder UAT) have not run, and the migrations are unpushed — so nothing in Phase 8 has ever executed against a real database or real Storage. Notably, no test exercises the real `supabase.storage.upload(path, Buffer)` call with a `Buffer` body; that path is mocked everywhere. The authed smoke is the only thing that would catch it, and it must be run after the migrations land.

---

## Verdict: **FIX-FIRST**

Fix in this order:

1. **CR-01 now** — check whether production's `organizations` table has
   `logo_storage_path`. If it does not, the public apply form is currently
   returning 404 to real candidates and Stripe checkout/portal are 400ing;
   push the migrations immediately, then add the tolerant read.
2. **CR-02 with the same push** — add the `assert_same_org` trigger to
   `candidate_branded_cvs` before the table is reachable in production, so the
   cross-tenant poisoning window never opens.
3. **CR-03 before UAT** — one config line; otherwise the founder's first act at
   UAT (uploading the real logo) may fail with a framework error.
4. WR-01…WR-07 before sign-off (WR-02 before the smoke is ever run against
   production).

Re-run `pnpm exec vitest run` + `tsc --noEmit`, then Task 3 (`pnpm smoke:auth
--workers=1`) against the deployed build, and only then present UAT.

---

## Fixes applied (2026-08-12)

Base for this pass: `871b8b6` (CR-01's missing-column-tolerance hotfix,
already landed — see that commit and its follow-up `6861dfc`/`871b8b6` for
CR-01; no further CR-01 work was needed, including no regression test, since
this review's CR-01 fix section did not ask for one).

| Finding | Commit | Description |
|---|---|---|
| CR-01 | `6861dfc`, `871b8b6` (pre-existing, this pass's base) | Missing-column tolerance for `logo_storage_path` on all three `organizations.ts` query sites — retries without the column and substitutes `null` on `42703`. No open sub-points for this pass to close. |
| CR-02 | `fbf90d2` | New append-only migration `20260812150000_branded_cvs_same_org_guard.sql` installs `candidate_branded_cvs_same_org_guard()` mirroring the `candidate_cvs` precedent (`20260518211005`) exactly — closes the cross-tenant poisoning path via `assert_same_org`. Extended `phase8-migrations.test.ts` with source-inspection pins. NOT applied to any database — joins the founder's pending migration push. |
| CR-03 | `c3f4ad0` | `experimental.serverActions.bodySizeLimit = '12mb'` in `next.config.ts`, covering `MAX_CV_BYTES` (10 MiB) and `MAX_LOGO_BYTES` (2 MiB) with headroom. New `tests/unit/next-config.test.ts` pins `bodySizeLimit >= MAX_CV_BYTES` and `>= MAX_LOGO_BYTES` by source inspection. |
| WR-01 | `1a70637` | `register-fonts.ts` registration is now lazy (`ensureBrandedCvFonts()`, called from `renderBrandedCv` immediately before `renderToBuffer`) instead of a module-scope side effect — a font-packaging regression now fails only the branded-CV feature (inside `generateBrandedCvAction`'s existing try/catch), not the whole `/candidates/[id]` route module. Folds in IN-01 for free (the dead double-registration guard becomes a real once-per-process guard). |
| WR-02 | `46d4319` | `branded-cv.smoke.ts`'s `afterAll` now removes any logo the run uploaded on every path that reaches the hook (not only the happy path) via a `smokeLogoUploaded` flag set the moment the upload toast is confirmed — idempotent, and a cleanup failure is captured then re-thrown so the run still fails loudly. |
| WR-03 | `e1289a0` | Added an `AlertDialog` confirmation to `LogoUploadField`'s Remove button, worded specifically for the legacy-URL case. **Deviation from the review's literal suggested fix (a)**: implementing "clear only `logo_storage_path`" as written would make Remove a *silent no-op* for an org whose only logo is a legacy pasted URL (the toast says "removed" but the same logo keeps rendering, since `resolveOrgLogoUrl` falls back to the untouched `logo_url`) — itself a CLAUDE.md-prohibited silent failure, and arguably worse than the original defect. Implemented option (b) instead (an explicit confirmation dialog), which the review offers as an equally valid alternative. `removeOrgLogoAction`'s server behaviour is unchanged. |
| WR-04 | `bd299fb` | Widened `BRANDED_CV_FREE_TEXT_WARNING` to name phone, email, day rate AND salary (previously only phone/email) — copy-only, per the review's suggested text. Softened the module header comment so it no longer contradicts what the free-text path actually guarantees. |
| WR-05 | `2be61dc` | `branded-cv/route.ts` now returns 502 (not 404) when `getBrandedCvForCandidate` reports `code: 'internal'` — a genuine DB fault is no longer folded into the same response as "no branded copy". Existence failures (`not_found`) still collapse to 404 as before. |
| WR-06 | `39badb6` | `generateBrandedCvAction`'s `createActivity` result is now checked (a failure is Sentry-captured with caller-specific tags, not silently discarded), and a `recordExportAudit` row is now filed for the generation event itself. **Minor deviation**: used metadata key `subject: 'branded_cv_generated'` rather than the review's literal `action: 'branded_cv_generated'`, to avoid colliding with `audit_log.action`'s actual fixed value (`'export'`) for this RPC — same disambiguating intent, clearer field name. |
| WR-07 | `fd86d46` | Ran `prettier --write` across the full phase 8 diff (14 files, whitespace/Tailwind-class-order only, confirmed via `git diff` per file). Appended an addendum to `08-VERIFICATION.md` correcting the scope ambiguity in the original prettier claim. |
| IN-01 | (folded into `1a70637`, WR-01) | The module-scope `let registered = false; if (!registered)` guard — genuinely dead code, as the review notes — became a real once-per-process guard by construction once registration moved into the lazy `ensureBrandedCvFonts()` initialiser. No separate commit needed. |
| IN-02 | *acknowledged, not applied* | `generateBrandedCvAction`'s `select('*')` on `candidates` is consistent with `getCandidate` and the review itself calls it "not a regression". Narrowing to an explicit column list touches a query the branded-CV mapper (`toBrandedCvData`) depends on for correctness — a missed field would silently degrade generated PDFs. That risk sits above this pass's zero-risk bar for INFO items; left as a candidate for a future, deliberately-scoped follow-up. |
| IN-03 | *acknowledged, not applied* | Gating the Generate control on `data.work.length \|\| data.about` is a product/UX decision (what counts as "enough data to generate"), not a mechanical fix — Rule 4 territory (architectural/product change), out of scope for an automated fix-first pass. Left for the founder. |
| IN-04 | *acknowledged, not applied* | A module-level "logged once" flag to quiet the missing-table Sentry breadcrumb would introduce exactly the module-level mutable state this codebase's CLAUDE.md explicitly prohibits ("Global state: No module-level singletons"). The breadcrumb itself is already cheap (attached to whatever event follows, not an event on its own) — the noise-reduction benefit doesn't clear that architectural bar. Left as-is. |
| IN-05 | *no action needed* | Review flags this only "so the looseness stays on the record" — no fix suggested, none applied. |
| IN-06 | *no action needed* | Process/evidence gap (production smoke run + founder UAT + the founder's manual migration push), not a code defect — outside an automated fix-first pass's reach. |

### Gate re-run after all fixes (2026-08-12)

```
$ pnpm typecheck   → exit 0, clean
$ pnpm lint        → exit 0, 0 errors, 38 pre-existing warnings (none in files this pass touched)
$ pnpm exec vitest run → exit 0, 93 files passed | 4 skipped (97); 1157 tests passed | 1 skipped | 28 todo
```

---

_Reviewed: 2026-08-12_
_Reviewer: Claude (gsd-code-reviewer, Fable 5)_
_Depth: deep_
