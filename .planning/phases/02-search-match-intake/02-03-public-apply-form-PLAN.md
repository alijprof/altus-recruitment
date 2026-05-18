# Plan 3: Public Apply Form

**Phase:** 2 — Search, Match & Intake
**Plan:** 3 of 4 (public-apply-form)
**Depends on:** Plan 0 (`(public)/layout.tsx`, middleware `/apply` allowance, `organizations.apply_form_enabled` column + slug format constraint, `apply_form_rate_limits` table, `record_audit_anonymous` function, `src/lib/integrations/turnstile.ts`, `src/lib/legal/apply-form-blocklist.ts`, Phase 2 env vars including `TURNSTILE_*`) AND **independent of Plans 1 and 2** at the data layer (the apply form's CV parse fires `cv/uploaded` which already chains into the embed pipeline from Plan 1; matches will populate once a job is in scope — no Plan 3 work needed)
**Requirements covered:** APPLY-01, APPLY-02
**Success criterion satisfied:** ROADMAP #3 — "A candidate can navigate to the public apply form, upload their CV, give GDPR consent, and appear as a new candidate record with CV parsing triggered automatically"
**Mode:** mvp — vertical slice (visit `/apply/<org-slug>` anonymously → fill form → Turnstile → upload CV → success page → recruiter sees a new candidate with `source='apply_form'` and CV parsing in progress in the Phase 1 candidate detail view)

## Goal

After this plan, a prospective candidate visits `https://altus.co.uk/apply/<org-slug>` (or local dev `http://localhost:3000/apply/<org-slug>`) where they see a minimal, branded form: full name, email, phone, location, current role title (optional), availability, salary expectation, source detail, CV file upload, Cloudflare Turnstile widget, GDPR consent checkbox, hidden honeypot. Submission is gated by five anti-abuse layers (Turnstile, rate limit per IP+slug, honeypot, email-domain blocklist, required consent). A successful submission: validates server-side, creates a candidate row with `source='apply_form'`, mints a signed Supabase Storage upload URL, has the browser PUT the CV directly to Storage, confirms upload, fires the existing `cv/uploaded` Inngest event (which Phase 1 already wires to parse-cv, and Phase 2 Plan 1 chains to embed), writes a `record_audit_anonymous` row, and renders a "Thanks — application received" success page. A recruiter in the org then sees the candidate immediately on `/candidates` with parsing in progress.

## Phase Goal (MVP user story)

**As a** prospective candidate (anonymous user with a CV), **I want to** apply to a recruitment agency from their public apply page in under two minutes — **so that** they have my CV, contact details, and consent on file and can reach out to me for relevant roles.

## Required reading for executor

- `.planning/phases/02-search-match-intake/02-CONTEXT.md` — decisions **D2-10 (path-based URL), D2-11 (signed upload URL), D2-12 (layered abuse defence), D2-13 (apply-form creates), D2-14 (anonymous audit)**
- `.planning/phases/02-search-match-intake/02-RESEARCH.md` — **§C.12 (routing + slug + `apply_form_enabled`), §C.13 (anti-spam layers — full list), §C.14 (signed upload URL flow — 7-step pattern), §C.15 (GDPR consent text — exact copy), §C.16 (what the apply form creates — table of inserts + audit), §C.17 (org slug provisioning), Security Domain table "Apply form abuse", "OAuth callback CSRF" (informs the rate-limit + state semantics), "Server-side request forgery via signed upload URL"**
- `.planning/phases/02-search-match-intake/02-PATTERNS.md` — every row under "App routes — public" (apply-form page, schema, actions, success page) and the "Signed upload URL pattern" cheat-sheet
- `.planning/phases/01-internal-ats/01-LEARNINGS.md` — **"Code review catches what executors' self-checks cannot" + "Cross-tenant FK guards must extend to ALL tenant-scoped tables"** — the apply form is the FIRST unauthenticated DB writer in the codebase; review-grade caution applies
- `CLAUDE.md` — never log CV text / candidate name / email to Sentry; service-role usage discipline; audit-on-create is required for GDPR
- `src/app/(app)/candidates/new/schema.ts` — canonical zod schema shape including the `consent_confirmed: z.literal(true)` and email-refine pattern; mirror these conventions in the apply schema
- `src/app/(app)/candidates/new/candidate-form.tsx` — canonical RHF + zod + shadcn `<Form>` + `useTransition` + `toast.error` Client Component
- `src/app/(app)/candidates/new/actions.ts` — canonical server-action shape with `safeParse` + `DbResult` return + `redirect()` pattern
- `src/app/(app)/candidates/[id]/actions.ts` — `uploadCVAction` (authenticated path; we MUST NOT reuse it but study its structure: mime/size validation, Storage path convention `<org_id>/<candidate_id>/<uuid>-<slug>.<ext>`, Inngest event payload shape)
- `src/lib/db/candidates.ts` — `createCandidate` shape; we extend the helper layer with a service-role-safe variant
- `src/lib/db/candidate-cvs.ts` — `createCandidateCV` + `nextCVVersion` (we re-use; the apply path is a new caller)
- `src/lib/legal/consent.ts` — bump `CURRENT_CONSENT_VERSION` to `'v2'` in this plan; keep `CONSENT_TEXT_V1` for legacy candidates
- `supabase/migrations/20260517204501_storage_cvs_bucket.sql` — Storage bucket + RLS policies; the apply path uses the SAME bucket with the SAME RLS (path-prefix gated by `org_id`)
- `src/lib/supabase/service.ts` — `createServiceClient` used here only inside the apply server actions

## Tasks

### Task 3.1: Apply route, schema, and form UI (`(public)/apply/[orgSlug]`)

**Files:**
- create `src/app/(public)/apply/[orgSlug]/page.tsx` (async RSC — org lookup + form render)
- create `src/app/(public)/apply/[orgSlug]/apply-form.tsx` (Client Component — RHF + zod + Turnstile widget + honeypot + two-stage submit)
- create `src/app/(public)/apply/[orgSlug]/schema.ts` (zod schema; bumps `CONSENT_TEXT_V2`)
- create `src/app/(public)/apply/[orgSlug]/success/page.tsx` (static thank-you page)
- modify `src/lib/legal/consent.ts` (add `CONSENT_TEXT_V2`; bump `CURRENT_CONSENT_VERSION = 'v2'`; keep `CONSENT_TEXT_V1`)
- create `src/lib/db/organizations.ts` extension (`getOrganizationBySlug(supabase, slug): DbResult<Pick<Tables<'organizations'>, 'id' | 'name' | 'slug' | 'apply_form_enabled'> | null>` — service-role caller-passable)
- create `tests/e2e/apply-form.spec.ts` (Playwright happy-path + consent-missing failure case)
- create `tests/unit/app/apply/schema.test.ts`

**Pattern to copy:** `src/app/(app)/candidates/new/{page,candidate-form,schema,actions}.ts(x)` is the canonical RHF/zod/shadcn `<Form>` shape — mirror its structure entirely. RESEARCH §C.15 lines 161–178 for the consent copy. RESEARCH §C.12 for the org-lookup + `notFound()` pattern.

**Implementation:**

1. **`src/lib/legal/consent.ts` bump.** Add `CONSENT_TEXT_V2` per RESEARCH §C.15 — the long-form apply-specific text with `{org_name}` and `{contact_email}` placeholders (rendered server-side at form-render time). Keep `CONSENT_TEXT_V1`. Change `CURRENT_CONSENT_VERSION = 'v2' as const`. Update the JSDoc note that the recruiter-facing /candidates/new form now stamps `consent_text_version='v2'` for new manual entries (no migration on historical rows; they retain `'v1'` — GDPR Art. 7 demonstrable consent).

2. **`src/app/(public)/apply/[orgSlug]/schema.ts`** — zod schema mirroring `candidates/new/schema.ts`:
   - `full_name`: `z.string().trim().min(2, 'Please enter your full name.').max(255)`
   - `email`: same email refine pattern as `candidates/new/schema.ts:33-42` but REQUIRED (no `.optional()`).
   - `phone`: optional string max 50 chars; trimmed.
   - `location`: optional string max 255 chars.
   - `current_role_title`: optional string max 255 chars.
   - `availability`: `z.enum(['immediate', 'two_weeks', 'one_month', 'other'])`.
   - `salary_expectation`: `z.string().regex(/^\d{0,8}$/).optional()` (string-to-int coerced server-side; client input is more forgiving).
   - `source_detail`: optional string max 255 chars (free-text "How did you hear about us?").
   - `consent_confirmed`: `z.literal(true, { error: 'Please confirm consent to submit your application.' })`.
   - `marketing_consent`: `z.boolean().optional().default(false)` (the optional "consider me for future similar roles" checkbox per RESEARCH §C.15).
   - `hp`: `z.string().max(0, '')` (honeypot — must be empty string; submit fails silently from the action if non-empty).
   - `turnstile_token`: `z.string().min(1, 'Please complete the verification challenge.')`.
   - Export `applyFormSchema` and `ApplyFormInput`.

3. **`src/app/(public)/apply/[orgSlug]/page.tsx`** — async RSC:
   - `await params`. `const slug = params.orgSlug`.
   - Use the service-role client (`createServiceClient`) ONLY for the org lookup — RLS on `organizations` allows authenticated members to read their own org, but the apply path has no auth. Service-role bypasses RLS; we're just doing a single-row lookup by slug. The `organizations_slug_format` CHECK constraint plus the lookup-by-slug gate the input shape. **Cite this explicitly in a comment** so reviewers see the rationale.
   - Call `getOrganizationBySlug(serviceClient, slug)`. If `!ok || data is null || data.apply_form_enabled === false`, `notFound()` (renders the standard 404 — same response for disabled-form vs missing-org per RESEARCH §C.12 anti-enumeration).
   - Render header: `<h1>Apply to {org.name}</h1>` + a single paragraph "Tell us a bit about yourself and we'll be in touch.". Below: `<ApplyForm orgId={org.id} orgName={org.name} orgSlug={slug} consentText={CONSENT_TEXT_V2.replace('{org_name}', org.name).replace('{contact_email}', 'careers@altus.co.uk')} />`.
   - No TopNav, no auth — the `(public)/layout.tsx` from Plan 0 provides the minimal frame.

4. **`apply-form.tsx`** — `'use client'`. Mirror `candidate-form.tsx` structure exactly:
   - `useForm({ resolver: zodResolver(applyFormSchema), defaultValues: { ... } })`
   - `useTransition` for pending state
   - shadcn `<Form>` + `<FormField>` + `<FormItem>` + `<FormLabel>` + `<FormControl>` + `<FormMessage>` per the canonical Phase 1 pattern
   - All inputs: `<Input>` for text, `<Select>` for availability, `<Textarea>` for source_detail
   - **File input**: `<Input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />` — client-side size check `file.size > 10 * 1024 * 1024` → `form.setError('root', { message: 'File must be smaller than 10 MB' })`. Stored in React state alongside the form (not in RHF — RHF doesn't handle File objects gracefully); validated again in the action.
   - **Honeypot**: hidden field `<input type="text" name="hp" tabIndex={-1} autoComplete="off" className="sr-only absolute -left-[9999px]" aria-hidden="true" />` per RESEARCH §C.13.
   - **Turnstile widget**: `<Turnstile siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} onSuccess={(token) => form.setValue('turnstile_token', token)} />` using `@marsidev/react-turnstile`. If `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset (dev), render a fallback `<button type="button" onClick={() => form.setValue('turnstile_token', 'dev-bypass')}>Skip captcha (dev)</button>` AND have `verifyTurnstileToken` in the server-side helper accept `'dev-bypass'` only when `NODE_ENV !== 'production'`. Document this dev affordance clearly in `apply-form.tsx` and `turnstile.ts`.
   - **Consent block**: render `consentText` prop verbatim in a `<div className="text-xs text-muted-foreground border rounded-md p-3">` followed by `<Checkbox>` + `<Label>` "I have read and agree to the above". REQUIRED (`consent_confirmed`).
   - **Marketing consent block** (optional): second checkbox "I would also like to be considered for future similar roles".
   - **Two-stage submit:**
     - Stage 1 — `onSubmit` calls `submitApplyAction(formInput, fileMeta)` where `fileMeta = { name, size, type }` (NOT the file itself — we don't stream through the action). On success → action returns `{ ok: true, signedUrl, candidateCvId, candidateId, organizationId }`.
     - Stage 2 — client `fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': fileMeta.type }, body: file })`. Toast on Storage upload failure.
     - Stage 3 — client calls `confirmApplyAction({ candidateId, candidateCvId, organizationId })`. On success, `window.location.href = '/apply/<slug>/success'` (or `router.push`). On error toast and surface a "Resume support" link to `mailto:careers@altus.co.uk`.
   - Field error mapping: `form.setError` from action's `fieldErrors`. Submit-level errors → `toast.error`.
   - Reset Turnstile widget on action failure (single-use tokens — `turnstile.reset()` from the package's imperative API).

5. **`success/page.tsx`** — static RSC. `<h1>Application received</h1>` + paragraph "Thanks for applying. We'll review your CV and reach out about relevant opportunities. You can close this window or visit <Link href='/'>our website</Link>." Sonner toast (via a small Client wrapper that calls `toast.success` on mount) "Application received".

6. **`getOrganizationBySlug`** in `src/lib/db/organizations.ts`. SELECT `id, name, slug, apply_form_enabled` FROM `organizations` WHERE `slug = $1`. `maybeSingle()`. Returns `DbResult<...|null>`. Used by service-role caller in `page.tsx` and by the action. Sentry tag `{ layer: 'db', helper: 'getOrganizationBySlug' }`. (No PII concern; slug is non-secret.)

7. **`tests/e2e/apply-form.spec.ts`**:
   - **Happy path**: visit `/apply/<seed-org-slug>`, fill all required fields, accept consent, attach a small valid PDF (use a fixture in `tests/fixtures/sample-cv.pdf` — copy from Phase 1 if it exists; else generate via `pdfkit` in a setup step). Bypass Turnstile via the dev affordance. Click submit. Assert URL becomes `/apply/<slug>/success`. Assert the success toast text. Use a Supabase admin query in `afterEach` to confirm the candidate + candidate_cv + activity rows exist.
   - **Missing consent**: same flow but leave the consent checkbox unchecked. Assert the form's submit is rejected and a field error appears with the consent message. Assert NO row inserted (verify via admin query).
   - **Honeypot**: programmatically set the hidden `hp` field to "spam" via Playwright's `page.evaluate`. Submit. Assert the success URL is NOT reached and NO candidate row inserted (the action drops silently — display a generic "Your submission was flagged" toast).
   - **Bad email domain**: enter `applicant@mailinator.com`. Assert the action returns a field error.
   - These E2E tests REQUIRE `pnpm test:e2e:reset` to provide a seeded org with a known slug; document in the spec's setup.

8. **`tests/unit/app/apply/schema.test.ts`** — at least: schema accepts a complete valid input, rejects missing consent, rejects bad email, rejects oversized hp value, rejects empty turnstile_token.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Manually visit `/apply/<seed-org-slug>` in `pnpm dev`. The (public) layout renders ("Powered by Altus" footer present). The form displays org name in the header. All required-field validations fire client-side.
- Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` unset → dev bypass button appears; clicking it sets the token; form is submittable.
- Visit `/apply/<unknown-slug>` → standard Next 404 page (not "no such org" string — anti-enumeration confirmed).
- Run `pnpm test:e2e tests/e2e/apply-form.spec.ts` — all three cases pass.

**Done:**
- Form is reachable, renders correctly, validates client-side, has consent/honeypot/Turnstile wired but **does not yet submit successfully** (Task 3.2 implements the actions)

### Task 3.2: `submitApplyAction` + `confirmApplyAction` server actions (the trust boundary)

**Files:**
- create `src/app/(public)/apply/[orgSlug]/actions.ts`
- modify `src/lib/db/candidates.ts` (add `getCandidateByEmailForOrg(serviceClient, { organizationId, email })` for duplicate detection; existing `createCandidate` works for the new row — but we need a service-role-tolerant variant; check whether the existing helper assumes RLS or accepts a service-role client. The helper takes a `SupabaseClient<Database>` — works for both.)
- modify `src/lib/db/candidate-cvs.ts` (the existing `nextCVVersion` works for the apply path — no change beyond confirming it's callable from service-role)
- create `src/lib/integrations/apply-form-rate-limit.ts` (per-IP-per-org sliding window check)
- create `tests/unit/app/apply/turnstile.test.ts` (mock-fetch test of `verifyTurnstileToken`)
- create `tests/unit/app/apply/rate-limit.test.ts`

**Pattern to copy:** PATTERNS.md "Signed upload URL pattern" cheat-sheet — 7-step server-action flow VERBATIM. RESEARCH §C.14 (file upload) + §C.16 (what the apply form creates) + §C.13 (rate-limit logic). `src/app/(app)/candidates/[id]/actions.ts:110-230` `uploadCVAction` as a structural reference (same Inngest event shape — but Storage upload goes via signed URL, NOT via streaming through the action).

**Implementation:**

1. **`actions.ts`** — `'use server'`. Two exports.

2. **`submitApplyAction(input, fileMeta, captchaToken, slug)`:**
   - Headers: `import { headers } from 'next/headers'`. Read `x-forwarded-for` (Vercel) / fallback to `x-real-ip`. Compute `ipHash = crypto.createHash('sha256').update(rawIp).digest('hex')` per RESEARCH §C.13 (NEVER store raw IPs — GDPR).
   - **Turnstile FIRST.** `const turnstile = await verifyTurnstileToken(captchaToken, rawIp)`. If `!turnstile.success`, return `{ ok: false, formError: 'Verification failed. Please retry the challenge.' }` (the client form resets the widget on this signal).
   - **Honeypot.** `if (input.hp && input.hp.length > 0)` → silently return `{ ok: false, formError: 'Your submission was flagged.' }` and `Sentry.addBreadcrumb({ category: 'apply-form', message: 'honeypot-tripped' })` (NO PII; just a counter).
   - **Zod re-validate.** `applyFormSchema.safeParse(input)`. On failure, `return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }`. (Client validated already; this is belt-and-braces.)
   - **Email-domain blocklist.** `if (isBlockedEmailDomain(parsed.data.email))` → `{ ok: false, fieldErrors: { email: ['Please use a personal or work email address.'] } }`.
   - **File-meta validation.** `fileMeta.type` must be PDF or DOCX mime; `fileMeta.size` must be `<= 10 * 1024 * 1024 && > 0`; `fileMeta.name` must be ≤ 255 chars and non-empty. On failure → `{ ok: false, fieldErrors: { cv: ['Invalid CV file.'] } }`.
   - **Service-role client.** `const supabase = createServiceClient()`. **Tenant boundary block.** All subsequent writes use this client; the boundary is `org.id` derived ONLY from the slug lookup — NEVER trust any client-passed `organizationId`. Comment this loudly in the code:
     ```ts
     // CRITICAL: org.id is the ONLY trusted tenant identifier in this action.
     // Service-role bypasses RLS. Any client-supplied org field is ignored.
     ```
   - **Org lookup.** `const orgResult = await getOrganizationBySlug(supabase, slug)`. Bail with `notFound()`-equivalent shape (the action returns; the client redirects to /404).
   - **Rate limit.** `await checkApplyFormRateLimit(supabase, { ipHash, organizationId: org.id })` — implementation in step 5 below. On limit exceeded, return `{ ok: false, formError: 'Too many submissions from this network. Please try again in a few hours.' }`.
   - **Duplicate detection.** `existing = await getCandidateByEmailForOrg(supabase, { organizationId: org.id, email: parsed.data.email })`. If `.ok && .data`:
     - Add a new CV row (incremented version) for the existing candidate.
     - Optionally bump `market_status` to `'actively_looking'` if currently `'cold'`.
     - Activity row `kind: 'system'`, `body: 'Re-applied via public form'`, `entity_id: existing.id`.
     - candidateId = existing.id.
     Else (new candidate):
     - Insert candidates row with `full_name`, `email`, `phone`, `location`, `current_role_title`, `source: 'apply_form'`, `source_detail: parsed.data.source_detail ?? slug`, `market_status: 'actively_looking'`, `consent_basis: 'consent'`, `consent_at: new Date().toISOString()`, `consent_text_version: CURRENT_CONSENT_VERSION` (now 'v2'). The candidates_set_org trigger fills `organization_id` from session… but the session is service-role, which has no `current_organization_id()`. **EXPLICIT FIX:** pass `organization_id: org.id` in the insert payload. The trigger only fills when the column is null; if we pass it, the trigger no-ops. The set_organization_id trigger is the canonical pattern (per `20260513152244_phase1_domain_schema.sql:86-99`); confirm in code review.
     - activity row: `kind: 'system'`, `body: 'Candidate applied via public form'`, `entity_id: new candidate.id`, metadata `{ apply_form: true, slug, marketing_consent: parsed.data.marketing_consent ?? false }`.
     - candidateId = new.id.
   - **Signed upload URL.** Compute `ext = fileMeta.name.split('.').pop().toLowerCase()`. `storagePath = \`${org.id}/applicants/${candidateId}-${crypto.randomUUID()}.${ext}\``. (Note the `applicants/` segment per PATTERNS.md cheat-sheet — differentiates from the recruiter-uploaded `{org_id}/{candidate_id}/...` shape, lets us add retention policies later.)
     - **EXPLICIT TENANT ASSERTION (per VERIFICATION M-2 — BLOCKER, mirrors Phase 1's C1 lesson):** before minting the signed URL, assert:
       ```ts
       if (!storagePath.startsWith(`${org.id}/applicants/`)) {
         Sentry.captureException(
           new Error('apply: storage path tenant assertion failed'),
           { tags: { layer: 'server-action', action: 'submitApplyAction', org_slug: slug } },
         )
         return { ok: false, formError: 'Something went wrong. Please try again.' }
       }
       ```
       Both `storagePath` and `org.id` are server-constructed, so this is belt-and-braces — but Phase 1's C1 CRITICAL came from exactly the same "looks-safe-but-not-asserted" defence layering. The cost is one line; the value is the gate being machine-checkable in code review.
     - Then `const { data, error } = await supabase.storage.from('cvs').createSignedUploadUrl(storagePath)`. The signed URL is single-use, scoped to the path, expires per Supabase's default (~2 hours — plenty for the client to upload). Also add an inline comment near the `candidate_cvs` insert (next bullet) — `// FK guard: candidate_cvs_verify_same_org_check enforces same-org on candidate_id (Phase 1 commit 0966875)`.
   - **`candidate_cvs` row.** Compute `version = await nextCVVersion(supabase, candidateId)`. `createCandidateCV(supabase, { candidateId, storagePath, mimeType: fileMeta.type, fileSizeBytes: fileMeta.size, version, uploadedBy: null })`. (uploaded_by is `null` — anonymous.)
   - **Anonymous audit.** `await supabase.rpc('record_audit_anonymous', { p_organization_id: org.id, p_action: 'create', p_entity_type: 'candidate', p_entity_id: candidateId, p_metadata: { source: 'apply_form', ip_hash: ipHash } })`. The metadata MUST include `ip_hash` for fraud forensics; never raw IP.
   - **Inngest event.** Do NOT fire `cv/uploaded` here — the storage object doesn't exist yet (client uploads next). Defer to `confirmApplyAction`.
   - **Return** `{ ok: true, signedUrl: data.signedUrl, candidateCvId: <newly created>, candidateId, organizationId: org.id }`.
   - **Error handling.** Wrap in try/catch at the action body level. On any unexpected throw: `Sentry.captureException(new Error(\`apply-submit: \${err.name ?? 'unknown'}\`), { tags: { layer: 'server-action', action: 'submitApplyAction', org_slug: slug } })` — NEVER pass `err` directly (Phase 1 R4 pattern); NEVER include email or name. Return `{ ok: false, formError: 'Something went wrong. Please try again.' }`.

3. **`confirmApplyAction({ candidateId, candidateCvId, organizationId })`:**
   - `'use server'`. `const supabase = createServiceClient()`.
   - **Re-verify tenant boundary.** SELECT `organization_id, storage_path, mime_type` FROM `candidate_cvs` WHERE `id = candidateCvId AND organization_id = organizationId AND candidate_id = candidateId`. If no row, return `{ ok: false }` and Sentry breadcrumb. This blocks a malicious client from confirming a CV they don't own.
   - **Verify storage object exists.** `await supabase.storage.from('cvs').list(path: storage_path.split('/').slice(0, -1).join('/'), { search: <basename> })`. If the object isn't there (client never PUT it), return `{ ok: false, formError: 'CV upload did not complete. Please try again.' }`.
   - **Fire Inngest event.** `await inngest.send({ name: 'cv/uploaded', data: { organization_id: organizationId, candidate_id: candidateId, candidate_cv_id: candidateCvId, storage_path: cvRow.storage_path, mime_type: cvRow.mime_type, user_id: null } })`. Wrap in try/catch + Sentry (Phase 1 pattern). On Inngest failure DO NOT roll back — the audit + DB rows are still useful; the recruiter can manually retry parsing from the candidate detail page (Phase 1 retry button).
   - Return `{ ok: true, redirectTo: \`/apply/\${slug}/success\` }`.

4. **Tenant-boundary discipline.** Inline comment cluster at the top of `actions.ts`:
   ```ts
   /**
    * SECURITY-SENSITIVE FILE — read before editing.
    *
    * This is the FIRST unauthenticated DB-writer in the codebase. Service-role
    * is used because there's no auth.uid(). The tenant boundary lives in three
    * places only:
    *   1. The slug → organizations lookup. `slug` is the only client-supplied
    *      tenancy signal we trust.
    *   2. The Storage path prefix `<org.id>/applicants/...`. The bucket RLS
    *      enforces the path layout for authenticated callers; service-role
    *      bypasses but the path is server-constructed.
    *   3. The candidate_cvs row's organization_id, set from `org.id` derived
    *      from the slug lookup. NEVER read this from the client.
    *
    * Any new field that takes a tenant ID from the client is a vulnerability.
    * See 01-LEARNINGS.md → "Code review catches what executors' self-checks
    * cannot" for the C1 cross-tenant injection class.
    */
   ```

5. **`src/lib/integrations/apply-form-rate-limit.ts`** — `import 'server-only'`. Single exported async function:
   - `checkApplyFormRateLimit(supabase, { ipHash, organizationId, windowMinutes = 5, maxPerWindow = 3 })`:
     - Compute `windowStart = new Date(Math.floor(Date.now() / (windowMinutes * 60 * 1000)) * (windowMinutes * 60 * 1000)).toISOString()` (bucket alignment so the sliding window is deterministic and the PK works).
     - `upsert into apply_form_rate_limits (ip_hash, organization_id, window_start, count) values (...) on conflict (ip_hash, organization_id, window_start) do update set count = apply_form_rate_limits.count + 1 returning count`.
     - If `count > maxPerWindow`, return `{ allowed: false }`; else `{ allowed: true }`.
     - Wrap in try/catch; on DB failure, **fail-OPEN** (`{ allowed: true }`) but Sentry-warn — we'd rather accept a bot's submission than block a legit candidate due to a transient DB hiccup. Document this choice clearly.

6. **Unit tests:**
   - `tests/unit/app/apply/turnstile.test.ts`: stub `fetch`; assert success path returns `{ success: true }`; assert failure path; assert missing-secret returns `{ success: false, errorCodes: ['missing-config'] }`.
   - `tests/unit/app/apply/rate-limit.test.ts`: stub Supabase client; assert first 3 calls return `allowed: true`, 4th in window returns `false`; new window resets.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- **Full happy path.** `pnpm dev`. Visit `/apply/<seed-org-slug>`, fill form, upload a small PDF. Watch:
  1. Network: POST to `/apply/<slug>` action returns a signed URL within ~1 s.
  2. Network: PUT to `<signed-url>` completes (200).
  3. Network: POST to `confirm` action returns `{ ok: true, redirectTo }`; browser navigates to success page.
  4. SQL: `select * from candidates where source='apply_form' order by created_at desc limit 1` returns the new candidate with `consent_basis='consent'`, `consent_at` ≈ now(), `consent_text_version='v2'`, `market_status='actively_looking'`, `source_detail` populated.
  5. SQL: `select * from candidate_cvs where candidate_id = '<new>' order by created_at desc limit 1` returns version 1 with `parsing_status` transitioning pending → complete within ~30 s (Phase 1 Inngest function chain fires).
  6. SQL: `select * from audit_log where entity_id = '<new>' order by at desc limit 1` returns a row with `actor_user_id IS NULL`, `action='create'`, `metadata->>'source' = 'apply_form'`, `metadata->>'ip_hash'` populated.
  7. SQL: `select * from ai_usage where purpose='cv_parse' and created_at > now() - interval '1 minute'` returns a row (CV-04 confirmed).
  8. Phase 2 chain: within another ~30 s, `select candidate_embedding is not null from candidates where id = '<new>'` returns `true` (Plan 1 reactive embed fires off the same `cv/uploaded` event).
- **Duplicate path.** Apply twice with the same email. The second submission creates a new `candidate_cvs` version row attached to the FIRST candidate's id — no duplicate `candidates` row.
- **Cross-tenant smoke.** Modify the Storage path in the action to `<other-org-id>/applicants/...` (deliberately, in a branch). The storage RLS doesn't block service-role, but the bucket policy + the FK guard on `candidate_cvs` (Phase 1's `candidate_cvs_verify_same_org_check`) WILL: the candidate row is in org A, the CV row would be in org A (it's set explicitly), but the storage path lies in org B. This is a UI-construction bug, not a runtime issue. **Defence:** validate `storagePath.startsWith(\`${org.id}/\`)` before persisting. Add this check explicitly. After the check, revert the test mutation.
- **Rate limit.** Submit 4 forms in 5 minutes (with different valid CVs). 4th submission → action returns `formError: 'Too many submissions...'`. SQL: `select count from apply_form_rate_limits where ip_hash = '<hash>'` shows `count = 4`.
- **Bad Turnstile token.** Force the client to send `turnstile_token: 'invalid'`; expect form-level error and NO DB inserts.
- **Honeypot.** Set `hp = 'spam'` via DevTools; submit. Action drops silently. No DB inserts; Sentry breadcrumb visible in Sentry dev panel (or `console.log` if Sentry is dev-mocked).

**Done:**
- ROADMAP success #3 is demonstrable end-to-end on a real PDF
- All five anti-abuse layers fire correctly
- Audit row with anonymous actor lands; FK guard / RLS holds; CV parsing chains through into Phase 1's pipeline and Plan 1's embedding

### Task 3.3: Apply-form discoverability + cleanup tasks

**Files:**
- modify `src/app/(app)/settings/page.tsx` (surface the org slug + a "Copy public apply link" button per RESEARCH §C.17)
- modify `src/app/(app)/settings/organization-form.tsx` (display slug read-only)
- modify `src/lib/db/organizations.ts` (extend `getOrganization` to include `slug` + `apply_form_enabled` in the returned shape)
- create `src/app/(app)/settings/apply-form-toggle.tsx` (Client Component — switch to toggle `apply_form_enabled` on/off via a small server action)
- create `src/app/(app)/settings/apply-form-actions.ts` (`toggleApplyFormEnabledAction(enabled: boolean)`)
- create `tests/e2e/apply-form-toggle.spec.ts` (E2E — toggle off → public apply route 404s; toggle on → renders again)

**Pattern to copy:** `src/app/(app)/settings/page.tsx` for the page structure; `src/app/(app)/settings/actions.ts` for the action shape; `src/app/(app)/settings/organization-form.tsx` for the form pattern.

**Implementation:**

1. **Settings page surface.** Render a "Public apply form" section with:
   - The current slug as code: `<code className="font-mono">/apply/{slug}</code>`.
   - A "Copy link" button (Client Component) that puts `${window.location.origin}/apply/${slug}` on the clipboard + sonner toast "Copied".
   - The `apply_form_enabled` toggle (Switch from shadcn).
   - A short explainer: "Share this link on your careers page or social media. Candidates who apply via this link appear in your candidates list with `Source: Apply form`."

2. **`toggleApplyFormEnabledAction`** — auth: confirm caller's role (RLS already enforces same-org; restrict to `role='owner'` per Phase 1 D-04 invite-role pattern — read `auth.getUser()`, then RLS-scoped read of `users.role`, reject if non-owner per `01-LEARNINGS.md` R8 ordering). Then update `organizations.apply_form_enabled` via the authenticated client (RLS allows owner updates). `revalidatePath('/settings')`. Return `{ ok: true | false }`.

3. **Migration sanity.** The `organizations.apply_form_enabled` column was added by Plan 0 with `default true`. New orgs created via `handle_new_user` will get `true` automatically — no trigger change needed.

4. **E2E:** sign in as the owner; toggle off; sign out; visit `/apply/<slug>` → 404. Toggle on; visit again → form renders. Use Playwright's auth state from `tests/e2e/global-setup.ts` (Phase 1 pattern) for the owner sign-in.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Owner sees the slug + link + toggle on `/settings`. A non-owner sees the slug + link but the toggle is disabled or hidden (defer the role-check UX polish; for v1 just ensure the action enforces; UI can show the toggle disabled with a tooltip).
- Toggle off → `/apply/<slug>` returns 404 immediately (`revalidatePath` ensures the RSC re-reads).

**Done:**
- Recruiters can find and share their public apply URL
- Owners can disable inbound applications during hiring freezes

## Plan-level verification

- [ ] `pnpm lint && pnpm typecheck && pnpm test --run && pnpm test:e2e && pnpm build` all pass
- [ ] Demo: anonymous browser visits `/apply/<seed-slug>`, fills form, uploads a real PDF, sees the success page. Recruiter signs in, opens `/candidates`, the new candidate is at the top with `source='apply_form'` and CV `parsing_status` resolving to `complete` within ~60 s. (ROADMAP success #3 verbatim.)
- [ ] All five abuse layers verified individually: missing consent (UI-level), bad Turnstile token, honeypot tripped, blocklisted email domain, rate limit exceeded
- [ ] `select count(*) from audit_log where action='create' and entity_type='candidate' and actor_user_id IS NULL` increments by exactly 1 per successful apply
- [ ] `select metadata->>'ip_hash' from audit_log order by at desc limit 1` is a 64-char hex string (sha256). **Never** a raw IP.
- [ ] `grep -rE "request\\.ip\\b|x-forwarded-for" src/app/\(public\)` is gated by the sha256 hash — no raw IP persisted anywhere
- [ ] Service-role usage discipline: `grep -rn "createServiceClient" src/ --include='*.ts*'` returns: Inngest function files, settings invite action, and this plan's `src/app/(public)/apply/[orgSlug]/actions.ts`. Nothing else.
- [ ] `CURRENT_CONSENT_VERSION === 'v2'`. `CONSENT_TEXT_V1` still exported.
- [ ] Apply-form submission DOES NOT log CV contents, applicant email, or applicant name to Sentry — confirm via dev Sentry inspector by deliberately throwing in the action and inspecting the captured event.
- [ ] The apply path's signed-upload-URL flow respects the 10 MiB cap: an 11 MiB PDF is rejected client-side; an attempt to PUT 11 MiB to the signed URL is rejected by Supabase Storage's bucket cap.
- [ ] Phase 1 candidate detail still works (no regression); the new candidate's CV review panel functions normally
- [ ] Plan 1's embed Inngest function fires off the same `cv/uploaded` event the apply flow emits — no separate Inngest wiring required (vertical integration confirmed)
- [ ] **(VERIFICATION M-4 — db-helper PII discipline grep):** `grep -A2 "Sentry.captureException" src/lib/db/candidates.ts src/lib/db/organizations.ts | grep -iE "email|full_name|name:"` returns nothing. (Confirms no db-helper path passes email/name-bearing arguments through to Sentry.)
- [ ] **(VERIFICATION M-8 — failed-Inngest-send fallback):** mock `inngest.send` to throw inside `confirmApplyAction`; submit a successful apply; verify (a) the candidate row + `candidate_cvs` row still persist, (b) Sentry captures the failure with `tags.layer='server-action', tags.action='confirmApplyAction'` and no PII, (c) the candidate appears in the recruiter's `/candidates` list (`parsing_status='pending'`), (d) clicking Phase 1's "Retry parsing" button on the candidate detail re-fires `cv/uploaded` and the parse completes.

## Out of scope for this plan (deferred or other plans)

- Job-specific apply links `/apply/<slug>/jobs/<job-slug>` — Phase 3 (the form would prefill `source_detail` with the job and pre-link the candidate to that job's pipeline). Phase 2's apply form is org-level only.
- Per-org branding (logo, accent colour) on the apply page — Phase 5 SaaS shell. Phase 2 ships "Powered by Altus" footer only.
- Apply-form `email_bodies` storage / candidate self-service portal — Phase 4 / out-of-scope per REQUIREMENTS.md "Out of Scope".
- Virus scan on uploaded files — out of scope; relying on Storage bucket mime allow-list + 10 MiB cap.
- IP geolocation / country-blocklist — out of scope; raw IPs never stored, so this would need a separate path.
- Resending the candidate a "thanks, here's a copy of what you submitted" email — Phase 4 (Resend integration).
- Owner-toggle UX polish (loading state, disabled-tooltip for non-owners) — minor polish; Task 3.3 ships functional minimum
