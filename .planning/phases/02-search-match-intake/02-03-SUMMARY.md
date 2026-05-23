---
phase: 02-search-match-intake
plan: "03"
subsystem: api
tags: [apply-form, gdpr, turnstile, supabase-storage, inngest, zod, playwright, typescript]

# Dependency graph
requires:
  - phase: 02-search-match-intake/02-00
    provides: "(public) route group, middleware /apply allowance, apply_form_rate_limits table, record_audit_anonymous, turnstile.ts, blocklist.ts, organizations.apply_form_enabled"
  - phase: 01-internal-ats
    provides: "candidates table, candidate_cvs table, cv/uploaded Inngest event, parse-cv function, Storage bucket"
provides:
  - "/apply/[orgSlug] — public candidate apply form with 5 anti-abuse layers"
  - "submitApplyAction + confirmApplyAction — two-stage signed-upload-URL flow"
  - "apply-form-rate-limit.ts — per-IP-per-org sliding window check"
  - "Organizations.apply_form_enabled toggle (owner-only) + /settings discoverability"
  - "CONSENT_TEXT_V2 + CURRENT_CONSENT_VERSION = 'v2'"
  - "Anonymous audit records (actor_user_id = null) for GDPR apply-form submissions"
  - "Playwright E2E: apply form happy path + edge cases"
affects: [03-linkedin-capture-spec-workflow-shortlists]

# Tech tracking
tech-stack:
  added:
    - "@marsidev/react-turnstile — Cloudflare Turnstile widget"
  patterns:
    - "Two-stage signed-upload-URL: submitApplyAction returns signedUrl; client PUTs file directly to Storage; confirmApplyAction verifies + fires cv/uploaded"
    - "Service-role org boundary: org.id derived ONLY from slug lookup — never from client input"
    - "storagePath tenant assertion before createSignedUploadUrl (M-2 BLOCKER from VERIFICATION)"
    - "ip_hash (SHA-256) stored instead of raw IP — GDPR"
    - "Fail-open rate limit: DB failure allows submission (Sentry warn) — real candidate over bot defence"

key-files:
  created:
    - "src/app/(public)/apply/[orgSlug]/page.tsx"
    - "src/app/(public)/apply/[orgSlug]/apply-form.tsx"
    - "src/app/(public)/apply/[orgSlug]/schema.ts"
    - "src/app/(public)/apply/[orgSlug]/actions.ts"
    - "src/app/(public)/apply/[orgSlug]/success/page.tsx"
    - "src/lib/integrations/apply-form-rate-limit.ts"
    - "src/app/(app)/settings/apply-form-toggle.tsx"
    - "src/app/(app)/settings/apply-form-actions.ts"
    - "tests/e2e/apply-form.spec.ts"
    - "tests/unit/app/apply/schema.test.ts"
    - "tests/unit/app/apply/turnstile.test.ts"
    - "tests/unit/app/apply/rate-limit.test.ts"
    - "tests/unit/app/apply/confirm-action-inngest-fallback.test.ts"
  modified:
    - "src/lib/legal/consent.ts — CONSENT_TEXT_V2 + CURRENT_CONSENT_VERSION = 'v2'"
    - "src/lib/db/organizations.ts — getOrganizationBySlug helper"
    - "src/lib/db/candidates.ts — getCandidateByEmailForOrg + createCandidateCV/createActivity explicit organizationId"
    - "src/app/(app)/settings/page.tsx — apply form section + slug display"

key-decisions:
  - "D2-11: Two-stage signed-upload-URL flow avoids streaming large files through server action; bypasses Next.js 4.5 MiB limit; never gives browser service-role privileges"
  - "D2-12: Five abuse layers — Turnstile, rate limit, honeypot, email-domain blocklist, consent required"
  - "D2-13: apply-form creates candidate with source='apply_form', consent_basis='consent', market_status='actively_looking'"
  - "Rate limit fails OPEN: transient DB failure allows submission (documented trade-off)"
  - "organization_id passed explicitly in service-role inserts (trigger cannot resolve auth.uid() under service-role)"

patterns-established:
  - "Service-role apply-form action: 3-source trust boundary (slug lookup, storage path prefix, explicit org.id)"
  - "record_audit_anonymous for GDPR-required audit row on anonymous actions"
  - "ip_hash = SHA-256 of raw IP — never store raw IP"
  - "confirmApplyAction fires cv/uploaded; on Inngest failure candidate row persists and recruiter uses retry button"

requirements-completed:
  - APPLY-01
  - APPLY-02

# Metrics
duration: "unknown — backfilled"
completed: "2026-05-19"
---

# Phase 2 Plan 3: Public Apply Form Summary

_Backfilled on 2026-05-23 from VERIFICATION/LEARNINGS/REVIEW + git log; some execution-time detail (exact durations, granular deviation list) is approximate._

**Public apply form at /apply/[orgSlug] with 5 anti-abuse layers, two-stage signed-upload-URL CV flow, GDPR consent, anonymous audit, and automatic cv/uploaded chain into existing parse+embed pipeline — ROADMAP success criterion #3 fully delivered**

## Performance

- **Duration:** unknown — backfilled
- **Started:** unknown
- **Completed:** 2026-05-19
- **Tasks:** 3
- **Files modified:** ~18

## Accomplishments
- /apply/[orgSlug] renders for any org with apply_form_enabled=true; returns 404 for unknown slug (anti-enumeration) and disabled orgs
- Two-stage submit: server action validates + returns signed Storage URL; browser PUTs CV directly; confirm action verifies object exists and fires cv/uploaded to Phase 1 parse chain
- Five abuse layers verified: Turnstile, rate limit (fail-open), honeypot, email blocklist, required GDPR consent
- Owners can toggle apply_form_enabled and copy the public link from /settings
- Playwright E2E happy path + missing-consent + honeypot + bad-email-domain cases

## Task Commits

1. **Task 3.1: public apply route + schema + form UI** — `ab3cc35` (feat)
2. **Task 3.2: submitApplyAction + confirmApplyAction trust boundary** — `80a0b1b` (feat)
3. **Task 3.3: settings discoverability + apply-form toggle + M-8 Inngest fallback test** — `ed019ac` (feat)

## Files Created/Modified
- `src/app/(public)/apply/[orgSlug]/actions.ts` — submitApplyAction + confirmApplyAction (security-sensitive; service-role; explicit org.id boundary)
- `src/app/(public)/apply/[orgSlug]/apply-form.tsx` — RHF + Turnstile widget + honeypot + two-stage submit
- `src/app/(public)/apply/[orgSlug]/schema.ts` — zod schema including consent_confirmed: z.literal(true)
- `src/lib/integrations/apply-form-rate-limit.ts` — sliding window upsert, fail-open design
- `src/lib/legal/consent.ts` — CONSENT_TEXT_V2 added, CURRENT_CONSENT_VERSION = 'v2'
- `src/lib/db/candidates.ts` — getCandidateByEmailForOrg; explicit organizationId params for service-role inserts
- `tests/e2e/apply-form.spec.ts` — Playwright E2E suite
- `tests/unit/app/apply/confirm-action-inngest-fallback.test.ts` — verifies candidate persists even if Inngest send fails

## Decisions Made
- storagePath uses `${org.id}/applicants/${candidateId}-${uuid}.${ext}` — differs from recruiter-uploaded `${org.id}/${candidateId}/` convention; parse-cv updated to accept both layouts (commit 04fc69b from LEARNINGS)
- createCandidate/createCandidateCV/createActivity all pass explicit organization_id for service-role path; trigger no-ops when column already set (LEARNINGS §1 — apply-form P0 bug)
- Rate limit fails OPEN: prefers accepting a bot submission over blocking a real candidate on DB hiccup

## Deviations from Plan
Backfilled summary — full deviation detail not recoverable. Known bugs fixed during/after:

**1. [Rule 1 - Bug] Service-role insert P0 — apply-form candidates created but CV and activity inserts failed**
- **Found during:** Production smoke-test (post-execution; user reported "Something went wrong")
- **Issue:** createCandidateCV and createActivity relied on trigger to set organization_id; trigger calls current_organization_id() which returns NULL under service-role — raises "organization_id is required"
- **Fix:** Extended createCandidateCV and createActivity helpers to accept optional organizationId param; apply-form passes org.id explicitly (commit a12883b from LEARNINGS)
- **Files modified:** src/lib/db/candidate-cvs.ts, src/lib/db/activities.ts, apply/actions.ts

**2. [Rule 1 - Bug] parse-cv storage path assertion failure**
- **Found during:** After apply-form fix above
- **Issue:** Phase 1 parse-cv enforced storage_path must start with `${org_id}/${candidate_id}/`; apply-form used `${org_id}/applicants/...`; every apply-form CV failed parsing and retried forever
- **Fix:** parse-cv updated to accept both path layouts (commit 04fc69b)
- **Files modified:** src/lib/inngest/functions/parse-cv.ts

---

**Total deviations:** 2 critical bugs found in production smoke-test and fixed

## Issues Encountered
- Apply-form P0: candidate row created but CV parsing never started; root cause was service-role org trigger + storage path convention mismatch (both fixed)
- Inngest env vars were set to Preview+Development scope in Vercel, not Production — apply-form candidates existed but cv/uploaded never fired (LEARNINGS §5); fixed by re-adding with Production scope

## User Setup Required
- TURNSTILE_SECRET_KEY + NEXT_PUBLIC_TURNSTILE_SITE_KEY (Cloudflare Turnstile)
- INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY must have Production scope in Vercel (not just Preview)

## Next Phase Readiness
- /apply/[orgSlug] is live; candidates from apply form flow into the same parse+embed pipeline as recruiter-uploaded CVs
- CONSENT_TEXT_V2 established; historical V1 candidates unaffected

---
*Phase: 02-search-match-intake*
*Completed: 2026-05-19*
