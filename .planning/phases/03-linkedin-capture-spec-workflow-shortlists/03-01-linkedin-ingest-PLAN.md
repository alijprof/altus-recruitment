# Plan A (03-01): LinkedIn capture — Chrome extension + authenticated ingest endpoint + Voyage embed

**Wave:** 1
**Goal:** Recruiter opens a LinkedIn profile, clicks the Altus extension icon, and within ~10 seconds a new (or updated) candidate appears in the CRM with semantic embedding populated — without any form filling.
**Depends on:** Plan 0 (env + ffmpeg + Sentry tags + test scaffolds)
**Requirements covered:** LINKEDIN-01 (Success criterion #1)
**Decisions implemented:** D3-01 (Chrome MV3 extension), D3-02 (Bearer-from-cookie auth, NOT service-role), D3-03 (fields captured + linkedin_url as `source_detail`), D3-04 (dedup on `source_detail` OR email), D3-05 (Inngest event triggers Voyage embed), D3-24 (AI wrapper + `ai_usage`), D3-26 (no schema migrations needed — uses existing `candidates` table + `source='linkedin'` enum value), D3-28 (popup-only UX, no DOM injection).

---

## Tasks

### Task A.1 — Chrome extension scaffold (`chrome-extension/` pnpm workspace package) + DOM scraper + popup

**Type:** code (auto, tdd="true")

**Files:**
- NEW `chrome-extension/package.json` — pnpm workspace member; `name: '@altus/chrome-extension'`, private, scripts: `dev`, `build`, `test`
- NEW `chrome-extension/tsconfig.json` — extends root tsconfig; `target: ES2022`, `module: ES2022`, `lib: ["ES2022","DOM"]`, no JSX
- NEW `chrome-extension/vite.config.ts` — Vite + `@crxjs/vite-plugin` (verify via `npm view @crxjs/vite-plugin` as a sub-checkpoint — see Detail)
- NEW `chrome-extension/manifest.json` — MV3 (see Detail for exact shape)
- NEW `chrome-extension/src/popup/popup.html` + `chrome-extension/src/popup/popup.ts` — single button "Capture this profile"; status text below; based on RESEARCH §"Recommended new project structure"
- NEW `chrome-extension/src/background/ingest.ts` — service worker; cookie-from-tab → Bearer; based on RESEARCH §Pattern 1 skeleton
- NEW `chrome-extension/src/content/scrape-profile.ts` — exports `scrapeLinkedInProfile(): ScrapedProfile` with three-stage fallback per RESEARCH §Pattern 2
- NEW `chrome-extension/src/shared/scraped-profile-schema.ts` — Zod schema (vendored — extension is not in main src/, so bundle Zod) describing the POST body shape per D3-03
- NEW `chrome-extension/tests/scrape-profile.test.ts` — REPLACE Plan 0 placeholder; assert each extractor (experience, education, skills, about, headline) returns expected shape against the fixture
- NEW `chrome-extension/tests/fixtures/linkedin-profile-2026-05-19.html` — anonymized real LinkedIn profile HTML (recruiter pastes their own profile DOM, all names/emails/companies replaced with placeholders before commit)
- NEW `chrome-extension/README.md` — side-load instructions: build, open `chrome://extensions`, enable dev mode, load `dist/`
- EDIT `pnpm-workspace.yaml` — add `chrome-extension` to `packages:` glob
- EDIT `.gitignore` — `chrome-extension/dist/`

**Detail:**
- **Sub-checkpoint** before installing `@crxjs/vite-plugin`: re-use the Task 0.1 human-verify pattern — `npm view @crxjs/vite-plugin version time.created publisher`. The package is tagged `[ASSUMED]` in RESEARCH; blocking-human approve before adding.
- `manifest.json` per D3-01 + RESEARCH §"Chrome extension" + RESEARCH §"Security Domain" V9 row:
  ```
  {
    "manifest_version": 3,
    "name": "Altus — LinkedIn capture",
    "version": "0.1.0",
    "key": "<base64-encoded-public-key>",
    "permissions": ["cookies", "activeTab", "scripting", "storage"],
    "host_permissions": [
      "https://www.linkedin.com/*",
      "https://altus-recruitment.vercel.app/*",
      "http://localhost:3000/*"
    ],
    "background": { "service_worker": "src/background/ingest.ts", "type": "module" },
    "action": { "default_popup": "src/popup/popup.html" },
    "content_scripts": [{ "matches": ["https://www.linkedin.com/in/*"], "js": ["src/content/scrape-profile.ts"] }]
  }
  ```
  Per HARD RULE 7 — host_permissions are LinkedIn-only + Altus origins, NEVER `<all_urls>`.
  **CRITICAL-1 fix (plan-check 2026-05-19)**: the `"key"` field pins the extension ID so `chrome-extension://<id>` is deterministic across side-loads + reloads. Generate via `openssl genrsa 2048 | openssl rsa -pubout -outform DER | base64`. Commit the public key to the manifest; the deterministic ID then feeds env `LINKEDIN_EXTENSION_ID` for the CORS allowlist in `/api/linkedin/ingest`.
- `scrape-profile.ts` extractors follow RESEARCH §Pattern 2 stability hierarchy (aria-label → data-view-name → h2-text → class). Each extractor returns `{ value, confidence: 'high'|'medium'|'low', strategy_used: 'aria'|'datatest'|'h2'|'class' }`. The final POST body is `{ name, headline, current_role, current_company, location, about, work_experience[], education[], skills[], linkedin_url, capture_confidence: number (0-1) }`. Per D3-03 NEVER capture profile photo URL.
- `background/ingest.ts` per RESEARCH §Pattern 1: `chrome.cookies.getAll({ domain: <altus-host>, name: 'sb-<projectref>-auth-token' })` — split-cookie aware per RESEARCH §Pitfall 1; concatenate `.0` + `.1` fragments before base64-decode. Rate-limit to **1 capture per 5 seconds per tab** via in-memory `Map<tabId, lastFiredAt>` per RESEARCH §"Security Domain" LinkedIn TOS row.
- `X-Altus-Extension-Version` header on every POST (PATTERNS §8 cross-cutting) reads `chrome.runtime.getManifest().version`.
- TDD: replace `chrome-extension/tests/scrape-profile.test.ts` `.todo` with real assertions against the fixture. Each extractor MUST return `confidence` ≥ `'medium'` for at least the headline + current_role + skills on a well-formed profile, AND return `null` (not throw) for a fixture with the experience section deliberately removed.

**Acceptance:**
- `pnpm --filter @altus/chrome-extension build` produces `chrome-extension/dist/` with `manifest.json`, `popup.html`, bundled JS.
- `pnpm --filter @altus/chrome-extension test` passes; assertion that all five fields scrape with ≥ medium confidence on the fixture.
- `grep -c '"<all_urls>"' chrome-extension/manifest.json` returns 0 (HARD RULE 7).
- Side-load the unpacked extension in Chrome; navigate to a public LinkedIn profile; click extension icon → popup shows "Capture this profile" button. Button is wired but the network call will 404 until Task A.2.

---

### Task A.2 — `/api/linkedin/ingest` authenticated POST + dedupe-on-(linkedin_url|email) helpers

**Type:** code (auto, tdd="true")

**Files:**
- NEW `src/app/api/linkedin/ingest/route.ts` — POST handler, authenticated context; based on auth pattern from `uploadCVAction` (`src/app/(app)/candidates/[id]/actions.ts` lines 137–146) + outlook webhook boilerplate (`src/app/api/outlook/webhook/route.ts`)
- NEW `src/app/api/linkedin/ingest/route.test.ts` — REPLACE Plan 0 placeholder; 401 on no token, 200 on valid, 400 on malformed body
- NEW `src/lib/db/candidates-linkedin.ts` — helpers `getCandidateByLinkedInUrl`, `getCandidateByEmail`, `upsertCandidateFromLinkedIn` per PATTERNS §7
- NEW `src/lib/db/candidates-linkedin.test.ts` — REPLACE `candidates-linkedin-upsert.test.ts` Plan 0 placeholder; dedup-on-linkedin_url returns existing row id, dedup-on-email when linkedin_url misses, fresh-create otherwise
- NEW `src/lib/validation/linkedin-ingest-schema.ts` — Zod schema (server-side mirror of extension Zod) per RESEARCH §"Security Domain" V5 row, with per-field length caps (location ≤ 200, about ≤ 5000, headline ≤ 300, work_experience.length ≤ 30, education.length ≤ 15, skills.length ≤ 100, linkedin_url ≤ 500 + URL format)

**Detail:**
- Route handler per D3-02 uses **authenticated** Supabase client (`const supabase = await createClient()` from `@/lib/supabase/server`), NOT service-role. The `Authorization: Bearer <access_token>` header is resolved via `supabase.auth.getUser(token)` per RESEARCH §Pitfall 2 — middleware will not see the cookie because the request originates from `chrome-extension://<id>`.
- Handler skeleton:
  ```
  export async function OPTIONS() { /* CORS preflight 204 with Allow-Origin */ }
  export async function POST(req: NextRequest) {
    1. Validate X-Altus-Extension-Version header is ≥ minimum supported (env-configured); else 426 Upgrade Required with download URL
    2. const token = req.headers.get('authorization')?.replace('Bearer ','') — 401 if missing
    3. const supabase = await createClient()
    4. const { data: { user } } = await supabase.auth.getUser(token) — 401 if no user
    5. const body = await req.json(); const parsed = LinkedInIngestSchema.safeParse(body); 400 if !parsed.success
    6. const profile = await getProfile(supabase, user.id) — resolve organization_id
    7. Postgres advisory lock: `await supabase.rpc('pg_try_advisory_xact_lock', { key1: hashtext(organization_id::text), key2: hashtext(linkedin_url) })` — `xact_lock` auto-releases on transaction end (no leak on early return). If lock returns `false`: 429 + `Retry-After: 2`. HIGH-3 fix (plan-check 2026-05-19).
    8. const existing = await getCandidateByLinkedInUrl(supabase, linkedin_url) ?? await getCandidateByEmail(supabase, email)
    9. const result = existing
         ? await updateCandidateFromLinkedIn(supabase, existing.id, profile)  // updates fill-empty-only style, matches Phase 1 D-08 "accept all only populates empty"
         : await insertCandidateFromLinkedIn(supabase, { ...profile, source: 'linkedin', source_detail: linkedin_url, organization_id: profile.organization_id /* trigger fills, but pass for clarity */ })
    10. await inngest.send({ name: 'linkedin/captured', data: { organization_id, candidate_id: result.id, user_id: user.id } })
        // try/catch + Sentry-capture-name-only per uploadCVAction lines 206–236
    11. return NextResponse.json({ ok: true, candidate_id: result.id, updated: !!existing }, {
          headers: corsHeadersFor(req.headers.get('origin'))
        })
  }
  ```
- **CRITICAL-1 fix (plan-check 2026-05-19)**: the original CORS spec named `https://www.linkedin.com` as Allow-Origin, but the request actually originates from `chrome-extension://<id>` (the background service worker, not the LinkedIn page). LinkedIn-as-origin would block the response. Correct spec:
  - Pin the extension ID by setting `key` in `manifest.json` (Plan A Task A.1) so `chrome-extension://<known-id>` is stable across reloads.
  - Helper `corsHeadersFor(origin: string | null)` in `src/app/api/linkedin/_cors.ts` checks `origin` against an allowlist regex: `/^chrome-extension:\/\/[a-p]{32}$/` (32-char base-16-like Chrome extension ID pattern) AND optionally the pinned ID from env `LINKEDIN_EXTENSION_ID`. Returns `Access-Control-Allow-Origin: <origin>` (echo) only on match; otherwise omits the header (browser drops the response).
  - `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: authorization, content-type, x-altus-extension-version, origin`.
  - OPTIONS handler returns 204 with the same headers.
  - Defence-in-depth: even if browser CORS were bypassed, auth (`getUser(token)`) is the real gate — CORS is just to make the legitimate extension's fetch round-trip.
- Per PATTERNS §10 / HARD RULE: do **NOT** add `/api/linkedin/ingest` to `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts` — it requires auth.
- Sentry tags on every captureException: `{ phase: 'p3', layer: 'route-handler', route: '/api/linkedin/ingest' }`. Per PATTERNS §1 — capture `new Error(\`${err.name}: ${status}\`)`, never the raw error.
- **Tenant boundary note (HARD RULE 4 doesn't strictly apply because we're NOT using service-role here)** — but we still assert defensively before any cross-record reference: any candidate row returned by `getCandidateByLinkedInUrl` MUST have `organization_id === profile.organization_id` (RLS guarantees this, but assert as a defence-in-depth check before falling into the UPDATE branch). If mismatch, throw — never silently update a foreign org's candidate.
- TDD: route.test.ts mocks `supabase.auth.getUser(token)`, `getCandidateByLinkedInUrl`, `inngest.send`. Assertions: (a) 401 if no Authorization header, (b) 400 if body missing `name`, (c) 200 + `inngest.send` called once on happy path, (d) 200 with `updated: true` if dedupe hit.

**Acceptance:**
- `pnpm test -- --run src/app/api/linkedin/ingest/route.test.ts src/lib/db/candidates-linkedin.test.ts` passes.
- `curl -X POST http://localhost:3000/api/linkedin/ingest` (no auth) returns 401.
- `curl -X POST -H "Authorization: Bearer <valid>" -H "Content-Type: application/json" -d '{...valid payload...}'` returns 200 with `candidate_id`.
- A row appears in `candidates` with `source='linkedin'` and `source_detail=<linkedin_url>`.
- Inngest dashboard shows a `linkedin/captured` event queued.

---

### Task A.3 — Inngest function `embed-candidate-from-linkedin` (Voyage embed reusing Phase 2 wrapper)

**Type:** code (auto, tdd="true")

**Files:**
- NEW `src/lib/inngest/functions/embed-candidate-from-linkedin.ts` — extracted-and-adapted version of `parse-cv.ts` Step 5 "embed-candidate" block (lines 273–330); pattern per PATTERNS §2
- NEW `src/lib/inngest/functions/embed-candidate-from-linkedin.test.ts` — Vitest unit, mocks `embed()` from voyage wrapper + service-role client; asserts the tenant-boundary check fires
- EDIT `src/app/api/inngest/route.ts` — register `embedCandidateFromLinkedIn` (alphabetical insertion)
- EDIT `src/lib/ai/embed-text.ts` — add guard for empty CV text branch (PATTERNS §2 — "verify the helper handles empty input; if it doesn't, extend it with a guard rather than building a new helper"). Specifically: `candidateEmbeddingText(candidate, '')` should still return the structured-fields block, just without the CV-text tail.

**Detail:**
- Function body:
  ```
  export const embedCandidateFromLinkedIn = inngest.createFunction(
    { id: 'embed-candidate-from-linkedin', retries: 2,
      concurrency: { limit: 5, key: 'event.data.organization_id' } },  // matches parse-cv per D3-05 reference to "parseCV logic adaptation"
    { event: 'linkedin/captured' },
    async ({ event, step }) => {
      const { organization_id, candidate_id, user_id } = event.data
      const candidate = await step.run('fetch-candidate', async () => {
        const sb = createServiceClient()
        const { data, error } = await sb.from('candidates').select('*').eq('id', candidate_id).single()
        if (error || !data) throw new NonRetriableError('candidate-not-found')
        // HARD RULE 4: tenant-boundary check before any write
        if (data.organization_id !== organization_id) throw new NonRetriableError('cross-tenant-event')
        return data
      })
      const text = await step.run('build-embed-text', async () => candidateEmbeddingText(candidate, ''))
      const embedded = await step.run('voyage-embed', async () => embed({
        organizationId: organization_id, userId: user_id,
        purpose: 'linkedin_candidate_embed',  // per RESEARCH §AI Cost Estimates purpose list
        inputType: 'document', inputs: [text]
      }))
      await step.run('persist-embedding', async () => bumpCandidateEmbedding(/* service-role */ createServiceClient(), candidate_id, organization_id, embedded.embeddings[0]))
    }
  )
  ```
- Per HARD RULE 4 (service-role + organization_id): every service-role write in `persist-embedding` MUST pass `organization_id` explicitly to the UPDATE's WHERE clause AS WELL AS the SET clause. The Phase 1 + 2 LEARNINGS bug class is referenced in a header comment.
- `purpose: 'linkedin_candidate_embed'` — NEW value extending the `ai_usage.purpose` text field. Per RESEARCH A5, the field is `text` not enum, so no schema change.
- Sentry capture pattern per PATTERNS §1 — `new Error(\`${err.name}: ${status}\`)`, tags `{ phase: 'p3', layer: 'inngest', function: 'embed-candidate-from-linkedin' }`.
- TDD: mock `createServiceClient` to return a stub with `from().select().single()` returning a candidate with `organization_id: 'org-A'`; assert that an event with `organization_id: 'org-B'` throws `NonRetriableError` BEFORE any embed call.

**Acceptance:**
- `pnpm test -- --run src/lib/inngest/functions/embed-candidate-from-linkedin.test.ts` passes; cross-tenant guard test passes.
- `grep -rn "new VoyageAIClient" src/` still returns exactly 1 line (singleton invariant per PATTERNS §10).
- End-to-end manual smoke: capture a LinkedIn profile via the extension → check `candidates.embedded_at` is populated within ~30s; check `ai_usage` has a `purpose='linkedin_candidate_embed'` row.

---

## AI cost
Per RESEARCH §AI Cost Estimates:
- Voyage embed per LinkedIn capture: ~0.04p
- 500 captures/year/recruiter: ~20p/year

## Risks
- **LinkedIn DOM redesign breaks selectors.** Mitigation: three-stage fallback (RESEARCH §Pattern 2); fixture-snapshot in tests catches divergence; capture-confidence telemetry surfaces drops in Sentry breadcrumbs.
- **Supabase cookie format changes.** Mitigation: cookie-fragment-join logic per RESEARCH §Pitfall 1; integration sanity-checked in popup status text ("Not signed in" if cookie miss).
- **LinkedIn account ban for the recruiter.** D3-01 accepted; mitigated by extension-side rate limit (1 capture / 5s) + popup-only UX (D3-28).

## Playwright E2E touchpoint
The end-to-end flow (LinkedIn tab → click extension → row visible in `/candidates`) cannot be Playwright-driven inside Chrome easily — the extension lives in `chrome-extension://<id>` and Playwright launches a separate browser context. **Stub E2E path:** `tests/e2e/linkedin-ingest-api.spec.ts` (new) POSTs a canned payload directly to `/api/linkedin/ingest` with a freshly signed-in cookie and asserts the candidate appears at `/candidates` within 15s. This validates the server half of LINKEDIN-01 in CI; the extension half is manually verified per Acceptance criteria above.

## Cross-plan dependencies
- **Provides to Plan B:** none direct.
- **Provides to Plan C:** none direct.
- **Provides to Plan E:** `candidates.source='linkedin'` rows feed the source attribution report (Plan F) — no contract beyond the existing `source` enum value.
- **Consumes from Plan 0:** Sentry tag conventions, package legitimacy gates, Vitest scaffold for `route.test.ts` and `candidates-linkedin-upsert.test.ts`.
