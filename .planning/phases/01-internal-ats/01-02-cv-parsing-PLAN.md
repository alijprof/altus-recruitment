# Plan 2: CV Upload & AI Parsing

**Phase:** 1 — Internal ATS
**Plan:** 2 of 5 (cv-parsing)
**Depends on:** Plan 0 (Inngest client + route, `src/lib/ai/claude.ts` wrapper, `cvs` Storage bucket with RLS, service-role client, env validation, Sentry) **and** Plan 1 (`/candidates/[id]` detail page reserved the right column for CV UI; `src/lib/db/candidates.ts` exists so we can extend it with empty-field merging)
**Requirements covered:** CV-01, CV-02, CV-03, CV-04, CV-05
**Success criterion satisfied:** #2 — "Recruiter can upload a CV, wait for AI parsing to complete in the background, and review/accept extracted structured data (name, role, skills, salary, seniority) from a review panel"
**Mode:** mvp — vertical slice (UI upload → Storage write → Inngest event → Haiku parse → DB write → review panel, all wired)

## Goal

After this plan, a recruiter on `/candidates/[id]` can upload a CV (PDF or DOCX), see "Parsing…" feedback, and within ~30 seconds get a "Review extracted data" panel showing each field with a `high|medium|low` confidence badge. They can "Accept all" (which fills any candidate fields still empty — never overwrites manually-entered values per D-08) or edit fields inline. On parse failure, an amber alert with a "Try again" button requeues the Inngest job (D-06).

## Required reading for executor

- `.planning/phases/01-internal-ats/01-CONTEXT.md` decisions D-05, D-06, D-07, D-08
- `.planning/phases/01-internal-ats/01-RESEARCH.md` — sections **15 (PDF + DOCX extraction via `unpdf` and `mammoth`), 16 (Claude tool-use schema for CV — already in `claude.ts` from Plan 0), 17 (Inngest `parseCVOnUpload` function — full 4-step shape), 18 (Storage upload from a Server Action), 10 (the `parseCV()` already in `src/lib/ai/claude.ts` — DO NOT re-implement)**
- `.planning/phases/01-internal-ats/01-PATTERNS.md` — all "Task 4 — CV upload + parse" rows
- `.planning/phases/01-internal-ats/01-UI-SPEC.md` — section 3 (CV Review Panel) + the Confidence Badge spec + Error States row "CV parse failed"
- `CLAUDE.md` — "Never call Claude in a synchronous request handler when it could take >2s", "All Claude calls go through `src/lib/ai/claude.ts`", "Never log CV text, candidate names, or any PII to Sentry"
- `docs/phase-1-tasks.md` Task 4 (original spec)
- `src/lib/ai/claude.ts` (Plan 0 — the `parseCV()` function to call from the Inngest function)
- `src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts` (Plan 0 — register the new function here)
- `src/lib/supabase/service.ts` (Plan 0 — service-role client used inside the Inngest function)
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` — `candidate_cvs` table shape (`organization_id`, `candidate_id`, `storage_path`, `parsing_status`, `extracted_data jsonb`, `parse_error`)

## Tasks

### Task 2.1: CV upload Server Action + db helper + Inngest event trigger

**Files:**
- create `src/lib/db/candidate-cvs.ts`
- create `src/app/(app)/candidates/[id]/cv-upload.tsx` (Client Component — file input + drag/drop)
- modify `src/app/(app)/candidates/[id]/actions.ts` (extend with `uploadCVAction` + `retryParseAction` server actions)

**Pattern to copy:** RESEARCH §18 (Server Action that uploads to Supabase Storage, inserts `candidate_cvs` row with `parsing_status='pending'`, sends `cv/uploaded` Inngest event). PATTERNS.md "Task 4" rows `src/lib/db/candidate-cvs.ts`, `cv-upload.tsx`.

**Implementation:**
1. `pnpm add unpdf@1.6 mammoth@1.12` (these are pure-JS, no native bindings — Vercel-safe per RESEARCH §15).
2. Create `src/lib/db/candidate-cvs.ts` exporting:
   - `listCandidateCVs(supabase, candidateId)` — ordered by `created_at DESC`.
   - `createCandidateCV(supabase, { candidateId, storagePath, originalFilename, mimeType })` — inserts with `parsing_status: 'pending'`, returns the new id. The `set_organization_id` trigger populates `organization_id` (do not pass it from client code per CONTEXT.md code_context).
   - `updateCandidateCVParse(supabase, { id, status, extractedData?, parseError? })` — updates `parsing_status`, `extracted_data`, `parse_error`. Used by the Inngest function via service-role client.
   - `markCandidateFieldsFromCV(supabase, { candidateId, parsed })` — per D-08, only populates empty candidate fields. Per VERIFICATION R5, the actual candidate columns AVAILABLE to populate (verified against `supabase/migrations/20260513152244_phase1_domain_schema.sql` lines 199–231):
     - **Scalars:** `email`, `phone`, `location`, `current_role_title`, `current_company`, `seniority_level`, `salary_current_estimate`, `salary_expectation`, `currency`, `years_experience`.
     - **Arrays:** `skills`, `sector_tags` — these ARE on `candidates`. Treat empty `{}` as "empty" (not as "set"): use `Array.isArray(currentRow[k]) && currentRow[k].length === 0` rather than a null check.
     - **NOT on candidates** (CV-row JSONB only): `work_history`, `education`. Leave those in `extracted_data` on the `candidate_cvs` row.
     Build the patch by iterating the scalar list with `v == null` filter, and the array list with the `length === 0` filter, mapping each from `parsed[k]`.
3. Extend `src/app/(app)/candidates/[id]/actions.ts`:
   - `uploadCVAction(formData: FormData)`: extract `file`, `candidateId`. Validate mime type is `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. **Per VERIFICATION R9, reject files > 10 MiB (`10 * 1024 * 1024`)** at the action level — `unpdf` runs in-memory inside Inngest and a 50 MiB PDF could exceed default Inngest runner memory. The 50 MiB Storage bucket limit is the outer safety net; this action-level cap is the practical one. Generate `storagePath = \`${org_id}/${candidate_id}/${crypto.randomUUID()}-${slug(file.name)}\`` (slug helper inline — replace non-alphanumeric with `-`, lowercase, max 80 chars). Use the SSR Supabase client to `storage.from('cvs').upload(path, file, { contentType, upsert: false })` — RLS ensures the upload is allowed only if `path` starts with the caller's org id (Plan 0 storage RLS). Insert the `candidate_cvs` row via `createCandidateCV`. Send `inngest.send({ name: 'cv/uploaded', data: { organization_id, candidate_id, candidate_cv_id, storage_path } })`. Return `{ ok: true, candidateCvId }`. `revalidatePath(\`/candidates/${candidateId}\`)`.
   - `retryParseAction({ candidateCvId, candidateId, storagePath, organizationId })`: looks up the CV row, sets `parsing_status='pending'` and clears `parse_error`, re-sends the `cv/uploaded` event. `revalidatePath(\`/candidates/${candidateId}\`)`.
4. **CvUpload Client Component** (`cv-upload.tsx`):
   - `'use client'`. shadcn `<Input type="file" accept=".pdf,.docx" />` + a "Upload" button. Optional drag-and-drop overlay (skip in Plan 2 if it adds complexity — file input is sufficient for MVP).
   - On submit, builds `FormData`, calls `uploadCVAction(formData)` via `useTransition`. On success, toasts "CV uploaded — parsing…" and refreshes. On error, toasts the error message.
5. Wire the upload component into `src/app/(app)/candidates/[id]/page.tsx` — in the right-1/3 column placeholder that Plan 1 reserved. Above the `<CvReviewPanel />` from Task 2.3.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- On a candidate detail page, upload a real PDF. The toast fires. Refresh the page — a `candidate_cvs` row exists with `parsing_status = 'pending'` (verify via Supabase Studio). The Storage bucket shows the file at `<org_id>/<candidate_id>/<uuid>-<filename>.pdf`.
- Cross-tenant RLS smoke: attempt the upload server action by manually crafting a storage path with a different org id (e.g., via DevTools call) — Storage RLS rejects the insert.

### Task 2.2: Inngest `parseCVOnUpload` function + register on the webhook

**Files:**
- create `src/lib/inngest/functions/parse-cv.ts`
- modify `src/app/api/inngest/route.ts` (add `parseCVOnUpload` to the `functions` array)
- create `src/lib/ai/cv-extract.ts` (text extraction helper — PDF via `unpdf`, DOCX via `mammoth`)

**Pattern to copy:** RESEARCH §17 (full 4-step Inngest function), RESEARCH §15 (`unpdf` + `mammoth` snippets). RESEARCH §10 (`parseCV()` from `src/lib/ai/claude.ts` — call it; do not re-implement). The tenant-boundary check on `storage_path.startsWith(\`${organization_id}/${candidate_id}/\`)` is mandatory (RESEARCH §4 + §17 — Inngest runs as service_role and bypasses RLS).

**Implementation:**
1. Create `src/lib/ai/cv-extract.ts`:
   - `extractTextFromBuffer(buffer: ArrayBuffer | Uint8Array, mimeType: string): Promise<string>` — branch on mimeType. PDF uses `await getDocumentProxy(new Uint8Array(buffer))` + `extractText(pdf, { mergePages: true })` from `unpdf`. DOCX uses `await mammoth.extractRawText({ buffer })`. Throw a typed error on unsupported mime type. Trim and normalise whitespace before returning.
2. Create `src/lib/inngest/functions/parse-cv.ts` — implement the 4-step function from RESEARCH §17 in full:
   - `id: 'parse-cv-on-upload'`, `concurrency: { limit: 5, key: 'event.data.organization_id' }`, `retries: 3`, listens on `'cv/uploaded'`.
   - Step 1 `download-cv`: validate `storage_path.startsWith(\`${organization_id}/${candidate_id}/\`)`; if not, `throw new NonRetriableError('storage_path outside tenant boundary')`. Then `createServiceClient().storage.from('cvs').download(storage_path)` → buffer.
   - Step 2 `extract-text`: `await extractTextFromBuffer(buffer, mimeType)`. Cap output at 60_000 chars (truncation guard — typical CV is <10k; cap avoids runaway tokens).
   - Step 3 `claude-parse`: `await parseCV({ cvText, organizationId, userId: null })` from `@/lib/ai/claude` — this call automatically logs to `ai_usage` (CV-04, CLAUDE.md mandate).
   - Step 4 `write-extracted`: `updateCandidateCVParse(serviceClient, { id: candidate_cv_id, status: 'complete', extractedData: parsed })` AND `markCandidateFieldsFromCV(serviceClient, { candidateId, parsed })` (D-08 — only empty fields). On any thrown error after step 1 succeeds, the catch logs to Sentry **per VERIFICATION R4**: pass `Sentry.captureException(new Error(error.name + ': ' + (error.status ?? 'unknown')), { tags: { layer: 'inngest', function: 'parse-cv-on-upload', candidate_cv_id } })`. **Do NOT pass the original `error` object** — some Claude/Anthropic SDK errors embed prompt fragments in `error.message` and would bypass the global `beforeSend` PII scrub from Plan 0 (which only redacts known PII keys, not freeform error text). Then write `parsing_status='failed'` with `parse_error: 'Parsing failed. You can retry now or continue and parse later.'` (UI-SPEC §Error States exact string).
3. Wrap the catch outside the steps in a `try/catch` at the function body level: a `NonRetriableError` (bad path, corrupt file) must persist `parsing_status='failed'` and write a helpful `parse_error`. Generic retried errors don't write failure — Inngest auto-retries.
4. Register the function: `src/app/api/inngest/route.ts` imports `parseCVOnUpload` and passes it in the `functions: [parseCVOnUpload]` array.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- Start `pnpm dev:all` (Next + Inngest). Upload a small CV PDF (use a real one if you have one, or `https://www.bls.gov/careeroutlook/2017/article/pdf/college-grads-cv.pdf` — public).
- Within 30 s, `candidate_cvs.parsing_status` transitions `pending → complete`. `extracted_data` JSONB has a `name`, `confidence_per_field` map, and other fields.
- `select * from ai_usage where purpose = 'cv_parse' order by created_at desc limit 1;` returns a row with non-zero `input_tokens`, `output_tokens`, `cost_pence` (CV-04 confirmed).
- Cost row's `cost_pence` is ≤ 5 (target £0.005–£0.01 per CV per `docs/plan.md`).
- Cross-tenant boundary smoke: manually send an `inngest.send({ name: 'cv/uploaded', data: { organization_id: <org-A>, candidate_id: <cand-A>, storage_path: '<org-B>/<cand-B>/anything' } })` from the Inngest dev UI — expect the function to fail with a `NonRetriableError` and no Claude call to fire.

### Task 2.3: CV review panel UI + "Accept all" empty-field merge + retry on failure

**Files:**
- create `src/app/(app)/candidates/[id]/cv-review-panel.tsx` (Client Component — shadcn `<Sheet>` on desktop, bottom sheet on mobile)
- create `src/components/app/confidence-badge.tsx` (shared — high/medium/low semantic colors)
- modify `src/app/(app)/candidates/[id]/page.tsx` (render the review panel and CV history list in the right column)
- modify `src/app/(app)/candidates/[id]/actions.ts` (extend with `acceptCVFieldsAction`)
- modify `src/lib/db/candidate-cvs.ts` (`getCandidateCV(supabase, cvId)` for the panel data)

**Pattern to copy:** UI-SPEC §3 (CV Review Panel — full spec including the "Review extracted data" trigger only visible when `parsing_status='complete'`, the `Progress` bar while pending, the amber `Alert` + "Try again" button when `'failed'`). RESEARCH §17 (D-08 empty-field merge — handled by the helper, but the action calls into it).

**Implementation:**
1. **ConfidenceBadge** — props `{ confidence: 'high' | 'medium' | 'low'; field: string }`. Renders a `<Badge>` per UI-SPEC §3: `text-xs font-normal px-2 py-0.5 rounded-full` with green/amber/red color mapping. Label format: `"{Field} · {confidence}"` (e.g., `"Skills · medium"`).
2. **CvReviewPanel** — `'use client'`. Props `{ candidateCv: Tables<'candidate_cvs'>; candidateId: string }`. Behaviour:
   - `parsing_status === 'pending'`: render a disabled trigger button with `<Progress value={undefined}>` (indeterminate) and label "Parsing…".
   - `parsing_status === 'complete'`: render "Review extracted data" trigger; clicking opens a `<Sheet side="right">` (desktop) or a bottom sheet on mobile (use the `<Sheet>` `side` prop responsive variants — `side="right" className="lg:max-w-md"` for desktop default and rely on shadcn's responsive bottom-sheet behaviour if available; otherwise render a `<Drawer>` from shadcn `drawer` for mobile via `useMediaQuery` — keep this lightweight, prefer `Sheet` everywhere if Drawer would expand scope).
   - Inside the sheet: iterate over `candidateCv.extracted_data` and render a row per field — field label (`text-sm`), value (`text-sm`), confidence badge right-aligned. "Accept all" button at the bottom calls `acceptCVFieldsAction({ candidateCvId, candidateId })`. "Edit field" inline edit is acceptable to defer to Plan 5 polish IF the action is non-trivial — Plan 2 must ship at minimum "Accept all" working.
   - `parsing_status === 'failed'`: render an amber `<Alert>` with heading "CV parsing failed." and body "You can retry now or continue and parse later." (UI-SPEC §Error States exact string) plus a "Try again" `<Button>` that calls `retryParseAction({ candidateCvId, candidateId, storagePath, organizationId })`.
3. **acceptCVFieldsAction** in `[id]/actions.ts`:
   - Reads the latest CV row + the candidate row. Calls `markCandidateFieldsFromCV(supabase, { candidateId, parsed: extractedData })` — the helper already enforces "empty fields only" (D-08).
   - Also writes an `activities` row with `kind = 'note'`, `body = 'CV extracted by AI'` per UI-SPEC §Activity Type Labels ("CV parsed").
   - `revalidatePath(\`/candidates/${candidateId}\`)`. Returns `{ ok: true }`.
4. **Detail page wiring**: in `/candidates/[id]/page.tsx` right column:
   - Render `<CvUpload candidateId={id} />` at the top.
   - Below, list `candidate_cvs` rows (most recent first). For the topmost row, render `<CvReviewPanel />`. Older rows render as a simple list with filename + status badge.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- End-to-end happy path: upload a CV, wait ~30s, "Review extracted data" button appears, click it, sheet opens with fields + confidence badges, click "Accept all". Refresh the candidate detail page — previously-empty fields (e.g. `current_role_title`) are now populated; previously-set fields are unchanged (D-08 confirmed by manually-setting `current_company` BEFORE upload and verifying the parsed company didn't overwrite it).
- Activity timeline shows a new "CV extracted by AI" entry (UI-SPEC label).
- Failure path: upload a deliberately corrupt PDF (e.g., a text file renamed to `.pdf`). After Inngest's retries exhaust, `parsing_status = 'failed'`, the amber alert renders, clicking "Try again" requeues — verify a second `ai_usage` row appears only if it gets to Claude; otherwise no new row (NonRetriableError fires earlier).
- Audit row from Plan 1 is still being written on every detail-page view — confirm with a final `select` from `audit_log`.

## Plan-level verification

Run before declaring the plan done:

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Success criterion #2 demonstrated end-to-end on a real CV.
- [ ] `select count(*) from ai_usage where purpose = 'cv_parse'` returns at least 1 row per CV uploaded (CV-04).
- [ ] `select cost_pence from ai_usage where purpose = 'cv_parse' order by created_at desc limit 1;` is non-zero and reasonable (≤ 5 pence per CV).
- [ ] D-08 verified: a candidate with a manually-entered `current_company = 'Old Co'` keeps `'Old Co'` after Accept-all, even if the parsed `current_company` is `'New Co'`. Empty fields ARE populated.
- [ ] Sentry receives a `parse-cv-on-upload` error on a deliberately corrupt CV — payload does NOT contain `cvText`, candidate email, or any value from `extracted_data` (PII-scrub `beforeSend` from Plan 0 confirmed).
- [ ] No raw `new Anthropic()` instantiation outside `src/lib/ai/claude.ts` (`grep -rn "new Anthropic" src/ --include='*.ts*'` returns only `src/lib/ai/claude.ts`).
- [ ] Inngest dev UI shows the function registered + at least one successful + one failed run.

## Out of scope for this plan (deferred or other plans)

- Embeddings — Phase 2 (deferred). The CV parse stops at structured fields; no Voyage call.
- CV email-inbox intake (`apply@…`) — Phase 2.
- Re-parse on demand — Phase 2. Plan 2 supports retry only on failure, per D-06.
- PDF.js preview rendering inside the review panel — out of scope; show a "Download CV" button instead via a signed URL helper (lightweight; defer to Plan 5 if time-pressed).
- "Edit field" inline editing in the review panel — Plan 5 polish if not landed here. "Accept all" is the minimum.
- Anthropic pricing-page verification (RESEARCH open question #2) — Plan 5.
