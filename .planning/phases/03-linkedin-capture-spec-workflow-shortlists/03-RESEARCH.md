# Phase 3: LinkedIn Capture, Spec Workflow & Shortlists — Research

**Researched:** 2026-05-19
**Domain:** Chrome extension (MV3), audio transcription, structured AI extraction, multi-tenant Postgres schema evolution, OAuth scope expansion
**Confidence:** HIGH for code-side recommendations (verified against repo + official docs); MEDIUM for AI cost estimates (pricing volatile — see Phase 1 LEARNINGS R-pricing); HIGH for migration shape.

## Summary

Phase 3 adds five surfaces (LinkedIn ingest, spec→JD, ad+inclusivity, shortlists/floats, dormant outreach, source attribution) on top of already-strong Phase 1/2 foundations. None of them require new infrastructure providers, and only one (LinkedIn ingest) introduces a genuinely new attack surface (cross-origin POST from an extension). The migrations are small and mechanical: one new enum value (`shortlist`), one constraint relaxation (`applications.job_id` → nullable), two new tables (`spec_drafts`, `job_ads`), plus standard trigger pairs (`*_set_org` then `*_verify_same_org_check`) and RLS policies.

**Primary recommendation:**
1. **Extension auth** = read the Supabase session cookie from the user's open Altus tab via `chrome.cookies.get` and forward `Authorization: Bearer <access_token>` to a new `/api/linkedin/ingest` route. No service-role, no PKCE flow inside the extension.
2. **LinkedIn DOM** = primary selectors via `aria-label`, `data-test`, and section landmarks (`<section>` h2 anchors). Fail soft — POST partial captures with `capture_confidence` scoring; recruiter sees what fell back.
3. **Whisper** = 25 MiB raw API limit; recompress server-side to mono 32 kbps Opus in WebM via ffmpeg (gives ~60 min headroom on the 100 MiB upload cap); chunk only when re-encoded file still > 24 MiB.
4. **Sonnet JD** = strict tool-use, every domain-judgement field nullable, recruiter resolves ambiguity in review UI.
5. **Inclusivity rubric** = single Sonnet tool call returning `{score:0-100, dimensions:{gender,age,jargon,accessibility,salary_transparency}, suggestions:[…]}`. Calibrated to the published Gender Decoder masculine/feminine word list as the seed lexicon, then refined by Sonnet's reasoning on accessibility/jargon.
6. **Float NULL job_id** = drop `NOT NULL`, keep FK, keep cross-tenant guard (the trigger short-circuits when `new.job_id IS NULL`).
7. **Outlook Mail.Send** = Phase 2 did NOT request it (`OUTLOOK_SCOPES` is `['offline_access','Mail.Read','User.Read']`). Add it in Phase 3 via incremental consent on a per-recruiter "Connect send permission" button when they first try to send a dormant-client check-in.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| LinkedIn DOM scrape | Browser (extension content script) | — | Only the browser sees the rendered profile |
| LinkedIn ingest auth & write | API (Next.js route handler) | DB (RLS) | Tenant safety = server-side under recruiter's auth |
| Voyage embed on ingest | Inngest background | API enqueues | >2 s, must not block ingest response (CLAUDE.md) |
| Audio upload | Browser → Supabase Storage (direct) | API issues signed URL | Avoid passing 100 MiB through Next.js handler |
| Whisper transcribe | Inngest background | — | Network + ffmpeg + Whisper round-trip > 2 s |
| Sonnet JD draft from transcript | Inngest background | — | Chained after transcribe in same function |
| Spec review form | Frontend server (RSC) + Server Action | DB | Standard Altus mutation pattern |
| Job ad generation | Inngest (slow) **OR** Server Action (~2-4 s) | — | See D3-25 — start as server action with spinner, lift to Inngest if > 5 s |
| Inclusivity score of pasted ad | Server Action | — | Single Sonnet call, no persistence needed |
| Shortlist/float rows | DB (existing `applications` table) | — | Reuse — no new table |
| Dormant client widget query | DB (view or RPC) | RSC dashboard | Aggregation on read |
| Outreach draft email | Server Action (Sonnet) | Outlook API (when sent) | Drafting cheap; sending uses existing Outlook wrapper |
| Source attribution report | DB (RPC) | RSC page | Aggregation server-side, no chart lib |

## Standard Stack

### Core (already in repo — reuse)
| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `@anthropic-ai/sdk` | latest in repo via `claude.ts` wrapper | Sonnet for JD/ad/inclusivity/outreach | D3-24 forces use of the wrapper |
| `voyageai` (REST via `voyage.ts`) | n/a (REST) | Embed LinkedIn-derived candidate text | Same path as CV embed (Phase 1/2) |
| `inngest` | as in `src/lib/inngest/client.ts` | spec/uploaded, audio cleanup cron | All > 2 s AI work goes here |
| `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.105.4 | repo current | Auth + storage + RLS | Extension uses the access token issued by this |
| `microsoft-graph-client` + `@azure/msal-node` | in `src/lib/integrations/outlook.ts` | Send draft email via recruiter's Outlook | Add `Mail.Send` to `OUTLOOK_SCOPES` |

### New (Phase 3 introduces)
| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `openai` (Node SDK) | 4.x (latest stable) [ASSUMED] | Whisper transcription via `src/lib/ai/whisper.ts` | Cleanest typed wrapper; mirrors `claude.ts` pattern |
| `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` | latest [ASSUMED] | Server-side audio recompress before Whisper | Eliminates the 25 MiB Whisper limit for almost all phone recordings |
| `gender-decoder-data` (or vendored JSON of Kat Matfield's word lists) | n/a — vendor JSON | Seed lexicon for inclusivity scoring | Calibrates Sonnet's score against a public baseline |

Verification commands the planner should add as a Wave-0 task:
```bash
npm view openai version            # confirm node SDK current
npm view fluent-ffmpeg version
npm view @ffmpeg-installer/ffmpeg version
```

### Chrome extension (new sub-package, not a Node lib)
- Manifest V3, `permissions: ["cookies","activeTab","scripting","storage"]`, `host_permissions: ["https://*.linkedin.com/*","https://<altus-prod-host>/*","http://localhost:3000/*"]`
- Bundler: **Vite** with `@crxjs/vite-plugin` (most popular MV3 toolchain) [ASSUMED — verify on npm before commit]
- Live in a new top-level dir `chrome-extension/` outside `src/` so it doesn't bloat the Next.js bundle. Pnpm workspace already supports this (`pnpm-workspace.yaml`).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Cookie-from-tab auth | `chrome.identity.launchWebAuthFlow` PKCE | Requires Supabase OAuth provider for the extension; over-engineered for a 2-3 person agency that already has the web app open all day |
| Direct Whisper SDK call | AssemblyAI / Deepgram | New provider — out of scope per constraints |
| New shortlists table | Reuse `applications` | D3-16 already chose reuse — confirmed cleanly possible |
| WYSIWYG ad editor | TipTap / Lexical | Out of scope (D3 deferred). Plain markdown + copy button only |

## Package Legitimacy Audit

slopcheck was not available in this research environment, so all newly proposed packages are tagged `[ASSUMED]` and the planner MUST gate each install behind a `checkpoint:human-verify` task that runs `npm view <pkg>` and confirms publisher + age + downloads before adding to `package.json`.

| Package | Registry | Disposition |
|---|---|---|
| `openai` | npm (Node SDK by OpenAI Inc.) | [ASSUMED] — verify it's the official OpenAI org publisher |
| `fluent-ffmpeg` | npm | [ASSUMED] — author `kribblo`, widely used; verify last publish ≤ 12 mo |
| `@ffmpeg-installer/ffmpeg` | npm | [ASSUMED] — verify the platform binary it pulls is from `@ffmpeg-installer/<platform>` and not a typosquat |
| `@crxjs/vite-plugin` | npm | [ASSUMED] — official `crxjs` org |
| Gender Decoder word lists | n/a — public domain JSON (Kat Matfield, MIT) | Vendor the JSON into `chrome-extension` or `src/lib/ai/inclusivity-lexicon.ts` directly — no npm install needed |

## Architecture Patterns

### System diagram (Phase 3 additions)

```
[LinkedIn tab] -- content script --> [extension service worker]
                                              |
                                              v  fetch (cookies via chrome.cookies.get → Bearer)
                                       [/api/linkedin/ingest]  ← Next.js route handler, recruiter auth
                                              |
                                              v
                                       upsert candidates (RLS)
                                              |
                                              v
                                       inngest.send('linkedin/ingested')
                                              |
                                              v
                                       parse-cv-style pipeline → Voyage embed → done

[Recruiter] -- upload audio --> [Supabase Storage 'spec-audio'] (signed URL)
                                              |
                                              v
                                       inngest.send('spec/uploaded')
                                              |
                                              v
                                       ffmpeg recompress (mono Opus 32kbps)
                                              |
                                              v
                                       Whisper transcribe
                                              |
                                              v
                                       Sonnet JD draft (tool-use)
                                              |
                                              v
                                       upsert spec_drafts (RLS)
                                              |
                                              v
                                       (Recruiter reviews /spec/[id]/review → approve → jobs row)
                                              |
                                              v
                                       Audio retained 30d → cleanup cron deletes

[Job detail page] --> server action: generate ad
                                              |
                                              v
                                       Sonnet (single tool call) → {body, score, suggestions}
                                              |
                                              v
                                       insert job_ads (RLS, optional)

[Dashboard] --> RPC: dormant_clients(60d, 90d) → widget
                  ↓ "Send check-in"
                  Sonnet draft → modal → Outlook (Mail.Send) → activity log kind='email_draft'

[/reports/source-attribution] --> RPC: source_attribution_summary(p_from, p_to)
```

### Recommended new project structure
```
chrome-extension/                  # new pnpm workspace package
├── package.json
├── manifest.json                  # MV3
├── src/
│   ├── content/                   # runs in linkedin.com tab
│   │   └── scrape-profile.ts
│   ├── background/                # service worker
│   │   └── ingest.ts
│   └── popup/
│       └── popup.tsx              # "Send to Altus" button
└── vite.config.ts

src/
├── app/
│   ├── api/linkedin/ingest/route.ts      # NEW
│   ├── api/spec/upload-url/route.ts      # NEW — issues signed Storage URL
│   └── (app)/
│       ├── spec/
│       │   ├── page.tsx                  # NEW — list of pending drafts
│       │   └── [id]/review/page.tsx      # NEW — review UI
│       ├── reports/source-attribution/page.tsx   # NEW
│       └── (existing pages get widgets)
├── lib/
│   ├── ai/
│   │   ├── whisper.ts                    # NEW — mirror claude.ts pattern
│   │   ├── jd-extract.ts                 # NEW — Sonnet tool-use for spec→JD
│   │   ├── ad-generate.ts                # NEW — Sonnet tool-use for ad + inclusivity
│   │   └── inclusivity-lexicon.ts        # NEW — Gender Decoder seed words
│   ├── inngest/functions/
│   │   ├── transcribe-and-structure-spec.ts   # NEW
│   │   └── cleanup-spec-audio.ts              # NEW — daily cron
│   └── db/
│       ├── spec-drafts.ts                # NEW
│       └── job-ads.ts                    # NEW
supabase/migrations/
└── 2026MMDD_HHMMSS_phase3_*.sql          # multiple files (see Migration Impact)
```

### Pattern 1: Extension → API auth (cookie-from-tab → Bearer header)

**What:** Service worker uses `chrome.cookies.get` to read the Supabase access-token cookie from the Altus production origin, then forwards `Authorization: Bearer <token>` on `fetch` to `/api/linkedin/ingest`.

**When to use:** All extension → backend traffic.

**Example skeleton:**
```ts
// chrome-extension/src/background/ingest.ts
async function getAltusAccessToken(): Promise<string | null> {
  // Supabase ssr stores the session in a cookie named like `sb-<project-ref>-auth-token`.
  // We read both halves (some browsers split it into .0 / .1 fragments).
  const projectRef = '<from-env-at-build-time>'
  const cookieName = `sb-${projectRef}-auth-token`
  const cookies = await chrome.cookies.getAll({
    domain: '<altus-prod-host>',
    name: cookieName,
  })
  if (cookies.length === 0) return null
  // Supabase cookie value is base64-encoded JSON containing { access_token, ... }
  const raw = cookies.map(c => c.value).join('')
  const decoded = JSON.parse(atob(raw.replace(/^base64-/, '')))
  return decoded.access_token ?? null
}

chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {
  if (msg.type !== 'linkedin/capture') return
  const token = await getAltusAccessToken()
  if (!token) { sendResponse({ ok: false, error: 'not_signed_in' }); return }
  const res = await fetch('https://<altus-prod-host>/api/linkedin/ingest', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(msg.payload),
  })
  sendResponse({ ok: res.ok, status: res.status })
  return true
})
```

On the server (`/api/linkedin/ingest/route.ts`), use `createServerClient` and pass the Bearer token as the cookie — or use `auth.getUser(token)` to resolve the recruiter, then write under that user's RLS. This is the same pattern Phase 2's Outlook callback uses for token-bound writes.

### Pattern 2: Resilient LinkedIn selectors

**Stability hierarchy** (from highest to lowest — fallback in this order):
1. `aria-label` attributes on landmark sections (e.g. `aria-label="Experience"`)
2. `data-test-*` or `data-view-name="profile-component-entity"` attributes (LinkedIn does ship some; verify per redesign)
3. Section headers anchored by visible h2/h3 text content (`'h2:has(span:contains("Experience"))'` — case-insensitive)
4. Class names — **avoid except as last resort**; they are auto-generated and change weekly

**Strategy:** Each section has a dedicated extractor with three-stage fallback. Each extractor returns `{value, confidence: 'high'|'medium'|'low', strategy_used: 'aria'|'datatest'|'h2'|'class'}`. The ingest endpoint accepts partial captures — missing sections are OK, low-confidence sections trigger a recruiter-facing "review captured data" toast.

```ts
// chrome-extension/src/content/scrape-profile.ts
function findExperienceSection(): Element | null {
  return (
    document.querySelector('section[aria-label*="Experience" i]') ||
    document.querySelector('[data-view-name="profile-card-experience"]') ||
    Array.from(document.querySelectorAll('section h2'))
      .find(h => /experience/i.test(h.textContent ?? ''))?.closest('section') ||
    null
  )
}
```

**Snapshot fixture** in `chrome-extension/tests/fixtures/linkedin-profile-2026-05-19.html` — the canary that detects future LinkedIn redesigns when scrape extractors stop returning expected fields. Run extractors against the fixture in CI.

### Pattern 3: Spec audio pipeline (Inngest function with ffmpeg + Whisper + Sonnet)

```ts
// src/lib/inngest/functions/transcribe-and-structure-spec.ts (skeleton)
export const transcribeAndStructureSpec = inngest.createFunction(
  { id: 'spec-transcribe-and-structure', retries: 2 },
  { event: 'spec/uploaded' },
  async ({ event, step }) => {
    const { storage_path, spec_draft_id, organization_id, user_id } = event.data

    const audioBuffer = await step.run('fetch-audio', async () => downloadFromStorage(storage_path))
    const compressed = await step.run('compress-audio', async () =>
      ffmpegRecompress(audioBuffer, { codec: 'libopus', bitrate: '32k', channels: 1 }))
    const transcript = await step.run('whisper-transcribe', async () =>
      whisperTranscribe(compressed, { language: 'en', prompt: 'UK recruitment spec call. Roles, salaries in GBP £.' }))
    const jdDraft = await step.run('sonnet-structure-jd', async () =>
      extractJdFromTranscript(transcript, { organization_id, user_id }))
    await step.run('persist', async () =>
      updateSpecDraft(spec_draft_id, { transcript: transcript.text, draft: jdDraft, status: 'ready_for_review' }))
  }
)
```

### Anti-patterns to avoid
- **Calling Whisper from a server action.** A 5-min recording recompresses + transcribes in ~30 s. Server actions in Next.js 16 have implicit ~60 s limits and the recruiter sees no progress. **Inngest only.**
- **Service-role on the ingest endpoint.** Defeats RLS for the most attack-surface-y endpoint. Use the authenticated recruiter context.
- **One mega-Sonnet-call for ad + inclusivity + outreach.** Tempting to share context. Don't — different prompts have different cache hit profiles and you can't independently retry. Two separate tool-use calls.
- **Hard-coding LinkedIn classes.** Will break in days. Always use aria/data-test/text-anchored selectors.
- **Storing PII in the extension's chrome.storage.** No — the extension is a thin client. All persistence happens server-side.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Audio chunking by silence | Custom VAD | ffmpeg `-c:a libopus -b:a 32k -ac 1` recompression alone | 99% of 60-min phone recordings drop below 25 MiB after this. Chunking is rarely needed. |
| Inclusivity word lists | Hand-curated lexicon | Vendor Kat Matfield's Gender Decoder JSON (public domain) | Saves you the linguistic legwork; calibrates to a published baseline |
| Cookie parsing in extension | Custom regex over `document.cookie` | `chrome.cookies.get` API | The Supabase cookie is HttpOnly — `document.cookie` cannot see it; `chrome.cookies` can |
| MV3 service worker session persistence | Custom storage adapter | NOT NEEDED for Altus — we don't run a Supabase client inside the extension. The extension only reads a cookie and POSTs. |
| Markdown→HTML for ad output | Custom converter | None — Phase 3 ships plain markdown + clipboard copy (D3 scope). WYSIWYG deferred. |
| Audio format detection / MIME sniffing | Custom | `fluent-ffmpeg`'s `ffprobe` | Already in the toolchain we add |
| Token refresh in extension | n/a | Cookie-from-tab pattern → the Next.js middleware refreshes the recruiter's session whenever they have the tab open. Extension just re-reads on next call. | Zero refresh logic in the extension |

**Key insight:** Don't put any state in the extension. It is purely a "scrape + POST" thin client. Every other concern (auth refresh, dedup, parsing, embedding, cost logging) belongs server-side where Altus already has the patterns.

## Common Pitfalls

### Pitfall 1: Supabase cookie is split across `.0`/`.1` fragments
**What goes wrong:** `chrome.cookies.get({name:'sb-xxx-auth-token'})` returns nothing.
**Why it happens:** Supabase SSR splits oversized auth cookies into `.0` / `.1` parts when the JSON exceeds ~4 KB.
**How to avoid:** Use `chrome.cookies.getAll({domain, name: <prefix>})` and join fragments in order. The example in Pattern 1 above shows the joined-decoded pattern.
**Warning signs:** "Not signed in" toast despite an active session on the website.

### Pitfall 2: Cross-origin POST with credentials gets blocked despite host_permissions
**What goes wrong:** The Altus origin's middleware rejects the request because it doesn't see the expected sb-cookie format.
**Why it happens:** The fetch from the extension comes from origin `chrome-extension://<id>` not `https://altus...`. Supabase SSR middleware looks for a cookie; we sent a Bearer. The route handler must use `supabase.auth.getUser(token)` to resolve the session from the header, not from cookies.
**How to avoid:** Build the route as `const supabase = createServerClient(...)` then `await supabase.auth.getUser(req.headers.get('authorization')!.replace('Bearer ','').trim())`. Don't rely on the cookie path.

### Pitfall 3: LinkedIn obfuscates class names per build
**What goes wrong:** Selectors that worked yesterday fail today.
**Why it happens:** LinkedIn's webpack pipeline mangles classnames on each deploy.
**How to avoid:** Document selector preference order in the extractor (aria → data-test → h2-text → class as last resort), maintain an HTML fixture snapshot in tests, ship the extension with **graceful degradation**: any missing section becomes `null` in the payload; the recruiter is told what didn't capture.
**Warning signs:** Capture confidence drops below 0.7 → emit a Sentry breadcrumb (no PII — just selector-strategy stats).

### Pitfall 4: Whisper hallucinates language on UK regional accents
**What goes wrong:** Strong Glaswegian / Geordie / Leeds accents have been documented to hit ~100% word-error in some studies. Whisper may also "hallucinate" language detection.
**Why it happens:** Whisper's training is heavier on US English.
**How to avoid:** Always pass `language: 'en'` explicitly (forces British-or-American English path), and pass a `prompt` containing UK-specific anchors: "UK recruitment spec call. Roles, salaries in GBP £. Limited company, IR35, perm/contract." This biases tokenization toward UK-spelling outputs.
**Warning signs:** Transcript contains "$" instead of "£", or "labor" instead of "labour" — flag the call to the recruiter as "verify accuracy".

### Pitfall 5: Whisper 25 MiB limit is on the multipart body, not the raw file
**What goes wrong:** Your 24.5 MiB file is rejected.
**Why it happens:** Multipart encoding overhead pushes it over.
**How to avoid:** Set the in-pipeline threshold to 24 MiB. If recompression doesn't get below 24 MiB, chunk at silence using ffmpeg's `silencedetect` filter, recombine transcripts with timestamp stitching.
**Warning signs:** `413 Request Entity Too Large` from OpenAI.

### Pitfall 6: Trigger ordering bug (already paid for in Phase 1 LEARNINGS)
**What goes wrong:** Cross-tenant FK guard fires before `*_set_org` populates `organization_id`, so guard sees NULL and panics.
**Why it happens:** Postgres fires BEFORE triggers in alphabetical order.
**How to avoid:** Name the new guards `<table>_verify_same_org_check` (alphabetically after `<table>_set_org`). Phase 1 fix migration `20260518213836_fix_same_org_trigger_order.sql` is the canonical reference.

### Pitfall 7: Nullable FK + cross-tenant guard
**What goes wrong:** `applications.job_id IS NULL` (float) triggers a NULL-passed-to-`assert_same_org` failure.
**Why it happens:** The current `applications_verify_same_org_check` calls `assert_same_org('public.jobs', new.job_id, new.organization_id)` unconditionally.
**How to avoid:** Modify the guard (new migration) to short-circuit on NULL: `if new.job_id is null then return new; end if;`. Verified-by-RLS path: the row's `organization_id` is set by the existing `applications_set_org` trigger from the recruiter's session — float rows are still tenant-scoped via that, not via the FK guard.

### Pitfall 8: Sonnet returning `null` vs omitting fields
**What goes wrong:** Recruiter UI crashes on `salary_range_min` because it's `undefined` not `null`.
**Why it happens:** Strict mode emits one OR the other depending on schema.
**How to avoid:** Mark optional schema fields explicitly as `nullable: true` and have the UI handle both `null` and `undefined`. For the JD draft schema specifically: `title` REQUIRED, all other fields nullable. Sonnet is told: "Use null for any field the client did not discuss in the call. Do not invent salary, urgency, or seniority. The recruiter will fill missing fields in review."

### Pitfall 9: Incremental Outlook consent reuses old token without new scope
**What goes wrong:** First Mail.Send call fails with `AADSTS65001` ("consent not granted").
**Why it happens:** The existing refresh token only includes `Mail.Read`. Adding `Mail.Send` to `OUTLOOK_SCOPES` doesn't retroactively grant it.
**How to avoid:** When recruiter clicks "Send check-in" for the first time, route them through a fresh consent flow: `prompt=consent` + the expanded scope list. The auth code exchange returns a new refresh token with both scopes. Store both as `cred.scopes`.

### Pitfall 10: Audio file deletion before recruiter approves draft
**What goes wrong:** 30-day cron deletes the file before recruiter ever sees the draft.
**Why it happens:** D3-10 says "30 days after approved or rejected". Naive cron deletes 30 days after upload.
**How to avoid:** Delete-after-30-days uses `spec_drafts.status_changed_at` not `created_at`. Cron query: `where status in ('approved','rejected') and status_changed_at < now() - interval '30 days'`.

## Migration Impact

All migrations append-only. Names below are illustrative; the planner picks final timestamps.

### M1 — `phase3_application_type_shortlist.sql`
- `ALTER TYPE public.application_type ADD VALUE 'shortlist';`
- **Cannot be in a transaction with other DDL referencing this enum** — Postgres limitation. Put this migration alone.

### M2 — `phase3_applications_nullable_job_id.sql`
- `ALTER TABLE public.applications ALTER COLUMN job_id DROP NOT NULL;`
- Drop and recreate the existing `unique (candidate_id, job_id, application_type)` constraint. Postgres treats NULL as distinct so two float rows for the same candidate would all be allowed — that's correct (a candidate can be floated to many notional clients across time).

### M3 — `phase3_applications_same_org_guard_null_safe.sql`
- Update the `applications_check_same_org()` (or whatever the current function is called) to short-circuit on `new.job_id IS NULL`.

### M4 — `phase3_spec_drafts.sql`
```sql
create type public.spec_draft_status as enum ('pending_transcript', 'ready_for_review', 'approved', 'rejected');

create table public.spec_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  audio_storage_path text not null,
  status public.spec_draft_status not null default 'pending_transcript',
  status_changed_at timestamptz not null default now(),
  transcript text,                     -- capped at 50k chars in app code
  draft jsonb,                         -- Sonnet's structured JD output
  job_id uuid references public.jobs(id) on delete set null,  -- populated on approval
  whisper_cost_pence integer,
  sonnet_cost_pence integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(transcript) <= 50000)
);

-- Triggers (note alphabetical ordering)
create trigger spec_drafts_set_org before insert on public.spec_drafts
  for each row execute function public.set_organization_id();
create trigger spec_drafts_verify_same_org_check before insert or update of created_by, job_id on public.spec_drafts
  for each row execute function public.spec_drafts_check_same_org();
create trigger spec_drafts_set_updated_at before update on public.spec_drafts
  for each row execute function public.set_updated_at();
create trigger spec_drafts_set_status_changed_at before update of status on public.spec_drafts
  for each row execute function public.bump_spec_drafts_status_changed_at();

-- RLS: same tenant pattern as other domain tables
alter table public.spec_drafts enable row level security;
-- (4 policies: select / insert / update / delete keyed on organization_id = current_organization_id())
```
Same-org check function (new): asserts `created_by → users` and (if non-null) `job_id → jobs` belong to `new.organization_id` via `assert_same_org()`.

### M5 — `phase3_job_ads.sql`
```sql
create table public.job_ads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  body_markdown text not null,
  inclusivity_score smallint check (inclusivity_score between 0 and 100),
  inclusivity_suggestions jsonb,
  inclusivity_dimensions jsonb,         -- {gender, age, jargon, accessibility, salary_transparency}
  model text not null,
  cost_pence integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_ads_job_id_idx on public.job_ads (job_id);
create index job_ads_organization_id_idx on public.job_ads (organization_id);

-- triggers + RLS pattern identical to spec_drafts
```
Same-org guard asserts `job_id` and `created_by` match `organization_id`.

### M6 — `phase3_dormant_clients_view.sql` (or just the RPC)
```sql
create or replace function public.dormant_clients(
  p_dormant_days int default 60,
  p_long_dormant_days int default 90
) returns table (
  client_id uuid, client_name text, last_contact_at timestamptz,
  days_since int, is_long_dormant boolean, last_placement_summary text
)
language sql stable security invoker
set search_path = public
as $$
  select c.id, c.name, c.last_contacted_at,
         extract(day from (now() - c.last_contacted_at))::int,
         (now() - c.last_contacted_at) > make_interval(days => p_long_dormant_days),
         <subquery for last placement>
  from public.clients c
  where c.organization_id = public.current_organization_id()
    and c.last_contacted_at < now() - make_interval(days => p_dormant_days);
$$;
```
SECURITY INVOKER (not DEFINER) — RLS does the heavy lifting.

### M7 — `phase3_source_attribution_rpc.sql`
```sql
create or replace function public.source_attribution_summary(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  source candidate_source, placements_count int, total_fee_pence bigint,
  avg_time_to_place_days numeric
)
language sql stable security invoker
set search_path = public
as $$
  select c.source,
         count(*)::int,
         sum(coalesce(a.fee_pence, 0))::bigint,
         avg(extract(epoch from (a.placed_at - a.created_at)) / 86400)::numeric
  from public.applications a
  join public.candidates c on c.id = a.candidate_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and a.placed_at::date between p_from and p_to
  group by c.source
  order by placements_count desc;
$$;
```
Assumes `applications.placed_at` and `applications.fee_pence` exist from Phase 1; if not, the planner adds them in a sibling migration. (`grep -n "placed_at\|fee_pence" supabase/migrations/*.sql` to confirm.)

### M8 — `phase3_storage_spec_audio_bucket.sql`
- Create `spec-audio` bucket via Supabase Storage; RLS policies modeled on the existing `cvs` bucket policies (Phase 1, `20260517204501_storage_cvs_bucket.sql`).
- Path convention: `<organization_id>/<user_id>/<spec_draft_id>.<ext>`.

### Existing tables NOT changed
- `candidates` — already has `source = 'linkedin'` and `source_detail text`. No schema change.
- `clients` — already has `last_contacted_at` (from `20260517215938`).
- `activities` — `kind = 'email_draft'` may or may not already exist; if not, add a 1-line `ALTER TYPE` migration.

### Already paid-for (no work needed)
- `application_type` enum already has `'spec'` and `'float'` values (verified in `20260513152244_phase1_domain_schema.sql:54`). Phase 3 only adds `'shortlist'`.
- `candidate_source` enum already has `'linkedin'`. No enum change for LinkedIn capture.

## AI Cost Estimates

All in **pence (GBP)** at 2026-05-19 list prices. Verified pence/MTok constants live in `src/lib/ai/claude.ts`:
- Haiku 4.5: 80/400 input/output
- Sonnet 4.6: 240/1200
- Opus 4.7: 390/1950
- Whisper-1: $0.006/min ≈ 0.48 p/min (£1 ≈ $1.25)

| Call | Model | Typical I/O tokens | Est. cost / call | Annual at anchor scale |
|---|---|---|---|---|
| **LinkedIn ingest parse** (re-use parse-cv logic; LinkedIn JSON is already structured so this is a pass-through, NOT an LLM call) | n/a | 0 / 0 | 0 p | 0 p |
| **LinkedIn embed (Voyage)** | voyage-3 | ~800 tokens of profile text | ~0.04 p | 4 p / 100 captures |
| **Whisper transcribe** (10-min spec call after recompression) | whisper-1 | n/a (per-minute) | ~5 p (10 min × £0.005) | £6 / yr (~120 calls) |
| **Sonnet JD draft** from 10-min transcript | claude-sonnet-4-6 | ~3,000 in / 600 out | (3000/1e6 × 240) + (600/1e6 × 1200) ≈ 0.72 + 0.72 = **1.4 p** | £1.70 / yr |
| **Sonnet ad generation + inclusivity (combined tool call)** | claude-sonnet-4-6 | ~1,500 in / 1,200 out | (1500/1e6 × 240) + (1200/1e6 × 1200) ≈ 0.36 + 1.44 = **1.8 p** | £4.50 / yr (250 ads) |
| **Sonnet inclusivity-only on pasted ad** | claude-sonnet-4-6 | ~1,000 in / 400 out | (1000/1e6 × 240) + (400/1e6 × 1200) ≈ 0.24 + 0.48 = **0.7 p** | £1.40 / yr |
| **Sonnet dormant outreach draft** | claude-sonnet-4-6 | ~800 in / 300 out | (800/1e6 × 240) + (300/1e6 × 1200) ≈ 0.19 + 0.36 = **0.55 p** | £1.40 / yr (250 drafts) |

**Total Phase 3 AI cost at anchor agency scale (~120 spec calls/yr, ~250 ads/yr, ~250 outreach drafts/yr, ~500 LinkedIn captures/yr):** **~£15-20/yr per recruiter.** Negligible — this is well within the per-tenant ai_usage budgets that justify even the lowest SaaS pricing tier.

**Cost drivers to watch:**
1. **Spec transcript length.** Anything > 30 min spikes Sonnet input cost. Cap recruiter's audio upload at 60 min in the UI (Whisper cost stays linear; Sonnet cost is the surprise).
2. **Re-runs of ad generation.** Recruiters love to "try a different vibe". Add a soft cap of 5 generations per job per day, surfaced as a friendly toast.
3. **Whisper retries on transient failures.** Inngest `retries: 2` means up to 3× cost in worst case; acceptable.

`record_ai_usage` `purpose` values to use (extend the existing `ai_usage` table — no schema change needed):
- `spec_transcribe` (Whisper)
- `spec_jd_extract` (Sonnet)
- `ad_generate` (Sonnet)
- `ad_inclusivity_score` (Sonnet — pasted-ad path)
- `dormant_outreach_draft` (Sonnet)
- `linkedin_candidate_embed` (Voyage)

## Sonnet JD schema design (D3-08)

```ts
const jdExtractTool = {
  name: 'extract_spec_call_jd',
  description: 'Extract a structured JD from a recruitment spec-call transcript.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Job title as discussed. REQUIRED. If unclear, use the closest standard title.' },
      seniority_level: { type: ['string','null'], enum: ['junior','mid','senior','lead','principal','director','vp','c_level', null] },
      job_type: { type: ['string','null'], enum: ['perm','contract','temp', null] },
      location: { type: ['string','null'], description: 'City, country, or "remote", or "hybrid: <city>". Null if not discussed.' },
      salary_range_min: { type: ['integer','null'], description: 'In pence. Null if client said "not discussed" or only said "competitive".' },
      salary_range_max: { type: ['integer','null'] },
      currency: { type: ['string','null'], enum: ['GBP','EUR','USD', null], description: 'Default GBP if salary mentioned without currency.' },
      must_haves: { type: 'array', items: { type: 'string' }, description: 'Hard requirements explicitly stated as essential.' },
      nice_to_haves: { type: 'array', items: { type: 'string' } },
      culture_notes: { type: ['string','null'], description: 'Free-text culture or team notes mentioned by the client.' },
      reporting_line: { type: ['string','null'], description: 'e.g. "reports to CTO". Null if not discussed — do NOT infer.' },
      urgency: { type: ['string','null'], enum: ['now','weeks','exploratory', null] },
      hiring_context: { type: ['string','null'], enum: ['new_role','backfill', null] },
      confidence_per_field: { type: 'object', description: 'For each above field, "high" | "medium" | "low" indicating how clearly the client articulated it.' },
      ambiguities: { type: 'array', items: { type: 'string' }, description: 'Things the recruiter should verify with the client — phrased as questions.' }
    },
    required: ['title','must_haves','nice_to_haves','confidence_per_field','ambiguities'],
    additionalProperties: false
  },
  strict: true
}
```

**Critical design decisions:**
- **`title` is the only required free-text field.** Everything else is nullable. Sonnet is explicitly told NEVER to invent a salary or urgency from thin air.
- **`ambiguities[]` is the friction-removal feature.** Recruiter opens the review page and sees: *"Client said 'around £80-100k' — is that base only or total comp? Client mentioned 'hybrid' but not how many days/week."* Each becomes a discussion point for the recruiter's follow-up call.
- **`confidence_per_field` mirrors Phase 1 D-05 pattern** (per-field confidence on CV parsing). UI renders low-confidence fields with a "verify this" badge.
- **No nesting beyond 2 levels.** Per Anthropic's structured outputs guidance, deeper nesting degrades reliability. `confidence_per_field` is a flat object of field→confidence string, not nested.

## Inclusivity rubric design (D3-15)

**Scoring approach:** A single Sonnet tool call returns:
```json
{
  "overall_score": 78,
  "dimensions": {
    "gender": { "score": 85, "flagged_phrases": ["aggressive go-getter"], "rationale": "..." },
    "age": { "score": 70, "flagged_phrases": ["digital native"], "rationale": "..." },
    "jargon": { "score": 60, "flagged_phrases": ["rockstar ninja"], "rationale": "..." },
    "accessibility": { "score": 90, "flagged_phrases": [], "rationale": "No accessibility statement present." },
    "salary_transparency": { "score": 100, "flagged_phrases": [], "rationale": "Range stated." }
  },
  "suggestions": [
    { "original": "aggressive go-getter", "improved": "results-driven and proactive", "reason": "Masculine-coded per Gardner & Kobrynowicz (2004); 'proactive' has neutral coding." },
    { "original": "digital native", "improved": "comfortable working with modern tools and systems", "reason": "'Digital native' signals age bias against older candidates." }
  ]
}
```

**Per-dimension weighting in overall score (recommend):**
- Gender: 25%
- Age: 20%
- Jargon: 20%
- Accessibility: 15%
- Salary transparency: 20%

**Calibration:** The Sonnet prompt is seeded with the Gender Decoder masculine/feminine word lists (Kat Matfield, gender-decoder.katmatfield.com, public domain) as the gender baseline. Sonnet then layers reasoning on top — it can recognize new gendered phrasing the lexicon doesn't catch, and it justifies its score against the lexicon when applicable.

**Why not call Gender Decoder directly?**
- Only covers gender. Age, jargon, accessibility, salary transparency are not in scope.
- It returns a binary "masculine-coded / feminine-coded / neutral", not a 0-100 score.
- We need contextual rewrite suggestions — Sonnet does that, the rubric doesn't.

**Calibration test:** Build 10 canonical UK job ads (5 well-written, 5 problematic). The well-written ones should score 80+; the problematic ones should score < 60. Use this as a regression test for the prompt.

## Outlook Mail.Send scope expansion (P9 above + D3-20)

**Verified:** `OUTLOOK_SCOPES = ['offline_access', 'Mail.Read', 'User.Read']` in `src/lib/integrations/outlook.ts:47`. Mail.Send was **NOT** requested in Phase 2.

**Recommended path: incremental consent at first send**

1. Add `'Mail.Send'` to `OUTLOOK_SCOPES`.
2. When recruiter clicks "Send check-in" the FIRST time after Phase 3 deploys, server detects their stored `cred.scopes` does not include `Mail.Send`, returns an action-required response.
3. UI shows a one-time "Reconnect Outlook to enable sending" button → redirects through the existing `/api/outlook/connect` flow with `prompt=consent` and the expanded scope list.
4. Microsoft returns a fresh refresh token covering both Mail.Read and Mail.Send. `cred.scopes` is updated.

**Don't do:** Auto-redirect every recruiter on Phase 3 deploy. That would interrupt their workflow with an Outlook consent screen. Trigger only on first attempt to send.

**Sending implementation:** `microsoft-graph-client`'s `Client.api('/me/sendMail').post(...)` — already in the SDK we use. Body uses Graph's `Message` shape with `toRecipients`, `subject`, `body.content (html)`, `body.contentType: 'html'`. No new SDK.

**Mail.Send security note:** This is a delegated permission — Microsoft enforces that the recruiter can only send AS themselves, not as anyone else in the tenant. The Application-permission variant (which would let Altus send as any user in the tenant) is **explicitly forbidden** by Phase 2's documented stance (RESEARCH-OUTLOOK P15) and stays forbidden in Phase 3.

## Runtime State Inventory

This is an additive phase (new features, no rename/refactor of existing concepts). Standard inventory:

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | None — additive phase | None |
| Live service config | Outlook OAuth: existing recruiters' `outlook_credentials.scopes` arrays will lack `Mail.Send` after the constant is changed | Re-consent flow at first send (see above) — no migration; the constant change + UI gate is sufficient |
| OS-registered state | None | None |
| Secrets/env vars | New: `OPENAI_API_KEY` (Whisper) | Add to `.env.example`, document in CLAUDE.md project context; verify present in Vercel + local |
| Build artifacts | Chrome extension dist (`chrome-extension/dist/`) — distributed to anchor recruiters as a zip | Add to `.gitignore`; document the build/zip step for anchor handover |

## Validation Architecture

> `workflow.nyquist_validation` defaults to enabled; included.

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest (existing in repo for unit; verified via `package.json`) |
| Config file | Existing `vitest.config.ts` (Phase 1 set up unit tests) |
| Quick run command | `pnpm test -- --run <pattern>` |
| Full suite command | `pnpm test && pnpm lint && pnpm typecheck && pnpm build` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| LINKEDIN-01 | DOM scrape extractors handle missing sections gracefully | unit | `pnpm test -- chrome-extension/tests/scrape-profile.test.ts` | ❌ Wave 0 |
| LINKEDIN-01 | Ingest endpoint rejects unauthenticated POST | unit/integration | `pnpm test -- src/app/api/linkedin/ingest/route.test.ts` | ❌ Wave 0 |
| LINKEDIN-01 | Ingest endpoint deduplicates on existing LinkedIn URL | unit | `pnpm test -- src/lib/db/candidates-linkedin-upsert.test.ts` | ❌ Wave 0 |
| SPEC-01 | ffmpeg recompression drops a 50 MiB m4a below 24 MiB | unit (mocked ffmpeg) | `pnpm test -- src/lib/ai/whisper.test.ts` | ❌ Wave 0 |
| SPEC-01 | Whisper wrapper logs to ai_usage with purpose=spec_transcribe | unit | `pnpm test -- src/lib/ai/whisper.test.ts` | ❌ Wave 0 |
| SPEC-02 | Sonnet JD extract returns null (not undefined, not invented) for undiscussed salary | unit | `pnpm test -- src/lib/ai/jd-extract.test.ts` | ❌ Wave 0 |
| SPEC-02 | Approve action creates jobs row tied to spec_draft.job_id | integration | `pnpm test -- src/lib/db/spec-drafts.test.ts` | ❌ Wave 0 |
| AD-01 | Inclusivity rubric: well-written ad scores ≥ 80 | unit (canned fixture, Sonnet stubbed) | `pnpm test -- src/lib/ai/ad-inclusivity.test.ts` | ❌ Wave 0 |
| AD-01 | Inclusivity rubric: gendered ad ("aggressive rockstar ninja") scores < 60 | unit | same file | ❌ Wave 0 |
| SHORT-01 | Shortlist row in pipeline filter is invisible (filter on application_type='standard') | unit | `pnpm test -- src/lib/db/applications-pipeline-filter.test.ts` | ❌ Wave 0 |
| SHORT-02 | Float row can be inserted with job_id=NULL | unit (DB integration) | `pnpm test -- supabase/tests/applications-float.test.sql` (or pgTAP) | ❌ Wave 0 |
| SHORT-02 | Float row's same-org guard does NOT throw when job_id is NULL | unit | same | ❌ Wave 0 |
| REPEAT-01 | Dormant clients RPC returns clients with last_contacted_at older than threshold | unit | `pnpm test -- src/lib/db/dormant-clients.test.ts` | ❌ Wave 0 |
| REPEAT-01 | Sonnet outreach draft personalizes with client name + last placement | unit (Sonnet stubbed) | `pnpm test -- src/lib/ai/outreach-draft.test.ts` | ❌ Wave 0 |
| REPEAT-01 | Outlook send fails fast with `needs_consent` error if `Mail.Send` missing | unit | `pnpm test -- src/lib/integrations/outlook-mail-send.test.ts` | ❌ Wave 0 |
| REPEAT-02 | Source attribution RPC groups by candidates.source and excludes other orgs | unit (DB integration) | `pnpm test -- supabase/tests/source-attribution.test.sql` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm lint && pnpm typecheck && pnpm test -- --run`
- **Per wave merge:** `pnpm test && pnpm build`
- **Phase gate:** Full suite + manual E2E walkthrough of LinkedIn ingest, spec upload, ad generation, dormant outreach.

### Wave 0 Gaps
- [ ] All test files above (none exist yet)
- [ ] `chrome-extension/` package scaffold + Vitest config for its tests
- [ ] HTML fixture for LinkedIn DOM regression tests
- [ ] Audio fixtures: 30-second WAV (test recompression) + a 60-second silent file (test edge case)
- [ ] Sonnet mocking helper extending the Phase 1 pattern (`src/lib/ai/__mocks__/claude.ts`)

## Security Domain

`security_enforcement` is enabled (default). Phase 3 surfaces:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes | Reuse Supabase Auth; extension forwards Bearer access token |
| V3 Session Management | yes | Reuse Supabase SSR cookies; extension does NOT store its own session |
| V4 Access Control | yes | RLS on `spec_drafts`, `job_ads`; `current_organization_id()` everywhere |
| V5 Input Validation | yes | `zod` schemas (already used in apply-form path Phase 2) on ingest route and spec upload route |
| V6 Cryptography | yes | Existing `encrypt`/`decrypt` in `src/lib/encryption.ts` for Outlook tokens — extend if storing any new secrets (none planned) |
| V8 Data Protection | yes | Audio file retention policy enforced server-side (Inngest cron). No client-side cache of audio. |
| V9 Communications | yes | TLS-only for ingest. Extension manifest `host_permissions` restricted to production + localhost origins. |
| V13 API Security | yes | Rate-limit `/api/linkedin/ingest` (extend Phase 2's `apply_form_rate_limits` table or add a small per-recruiter counter) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Cross-tenant candidate write via crafted ingest payload | T (Tampering) | Use authenticated recruiter client, RLS does the work. Service-role NEVER touches this route. |
| Cross-tenant FK on `spec_drafts.job_id` | T | Same-org guard trigger via `assert_same_org()` |
| Recruiter sends Mail.Send as another user | E (EoP) | Mail.Send is delegated permission — Microsoft enforces sender = consenting user |
| Audio file leak via guessable Storage path | I (Info Disclosure) | Path includes random UUID; Storage RLS limits read to org+user; cron deletes at 30 days |
| Whisper transcript contains PII logged to Sentry | I | Whisper wrapper scrubs transcript text from any Sentry breadcrumb; only log token counts + duration |
| Sonnet hallucinated salary range used in published ad | T (Integrity of business data) | JD schema forbids inventing salary; recruiter reviews + approves; ad generation uses approved JD only |
| Extension MITM via malicious CSP-stripping site | T | `manifest.json` host_permissions limited to LinkedIn + Altus origins; CSP for the extension restricts script sources |
| LinkedIn TOS retaliation (account ban for the recruiter) | Reputational, not STRIDE | D3-01 accepted — single-shot manual capture is below enforcement threshold; rate-limit in extension to 1 capture / 5 seconds to be safe |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Custom JSON-mode prompting | Anthropic's `strict: true` tool-use | Q4 2025 | We already use this in Phase 1 — extend the pattern for new tools |
| Per-prompt JSON parsing with retries | Schema-grammar-constrained decoding | 2025 | Use it; eliminates a class of "model returned malformed JSON" bugs |
| Manifest V2 background pages | Manifest V3 service workers | June 2024 hard cut | We're on MV3 by mandate |
| Google Speech-to-Text / Azure speech | Whisper / gpt-4o-mini-transcribe | 2024 onwards | We use Whisper-1 (cheapest, well-known accent caveats). Gpt-4o-mini-transcribe is half the price (£0.0025/min) and worth a quick A/B as a Phase-4 follow-up. |
| Hand-curated gendered-word lists in app code | Vendored Gender Decoder JSON + Sonnet reasoning layer | n/a | Gives us a public-domain baseline + flexible reasoning |

**Deprecated/outdated:**
- LinkedIn scraping via class-name selectors — fragile, breaks weekly. Use aria/data-test/h2 anchors.
- Storing extension session in `chrome.storage.local` and running a Supabase client inside the service worker — over-engineered when the recruiter already has the Altus tab open.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `openai`, `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `@crxjs/vite-plugin` versions on npm | Standard Stack | Slopsquat — planner MUST run `npm view <pkg>` and verify org/publisher before install |
| A2 | Whisper-1 pricing remains $0.006/min in 2026 | AI Cost Estimates | Underestimate; Phase 1 LEARNINGS pricing-drift lesson applies — verify on `openai.com/api/pricing` at task time |
| A3 | LinkedIn's profile DOM uses some `aria-label` + `data-view-name` attributes today; specific names will need verification against a live profile during scaffold | Architecture — Pattern 2 | Selectors return null; capture confidence drops; need fixture-update task |
| A4 | `gpt-4o-mini-transcribe` at half Whisper-1 cost may be the better default | State of the Art | Cost-only — accuracy unverified for UK accents. Stick with whisper-1 for Phase 3; consider for Phase 4. |
| A5 | The `record_ai_usage` RPC signature accepts a `purpose` arg of arbitrary string (no enum) | AI Cost Estimates / Validation | Verified in `record_ai_usage(p_purpose text, ...)` (`20260513152244_phase1_domain_schema.sql:128`) — **CONFIRMED VERIFIED** |
| A6 | `applications.placed_at` and `applications.fee_pence` exist from Phase 1 | Migration M7 (source attribution RPC) | If missing, planner adds an additive migration; not a blocker |
| A7 | The `set_organization_id()` trigger function is named exactly that and is reusable for new tables | Migrations | Verified used by `applications_set_org` etc.; planner confirms via grep |
| A8 | Inngest `step.run` with > 30 s individual steps is fine on the current Inngest plan | Spec pipeline | If a step times out, split ffmpeg + Whisper into separate `step.run` blocks (already recommended) |
| A9 | `chrome.cookies.get` can read Supabase's HttpOnly auth cookie if the extension has `cookies` permission and `host_permissions` for the Altus origin | Pattern 1 | **HIGH confidence — well-documented in MDN/Chrome dev docs**, but planner must verify on first prototype build |
| A10 | Anchor agency volume estimates (~120 spec calls, 250 ads, 250 outreach, 500 LinkedIn captures per year per recruiter) | AI Cost Estimates | Numbers off by 5× wouldn't materially change the conclusion that Phase 3 AI cost is negligible per tenant |

**If A1-A4 are wrong:** Surface during `/gsd:discuss-phase` for D3-XX confirmation. None are blockers — all have viable fallbacks documented above.

## Open Questions

1. **Q1: Should the extension's "Send to Altus" trigger be the popup button OR an auto-injected button in LinkedIn's UI?**
   - What we know: Popup is safer (LinkedIn DOM changes won't break it) but adds a click.
   - What's unclear: Recruiter UX preference.
   - Recommendation: **Popup for Phase 3** (D3-XX candidate). Consider injected button in Phase 4 once we know LinkedIn DOM behavior. The popup also gives a nice "ingested ✓" confirmation moment.

2. **Q2: What's the cap on simultaneous spec uploads per recruiter?**
   - What we know: Cost is per-call; Inngest can fan out widely.
   - What's unclear: Whether to throttle to prevent a recruiter accidentally uploading 50 files at once.
   - Recommendation: Soft cap of 3 in-flight transcriptions per recruiter at a time; queue the rest. (D3-XX candidate.)

3. **Q3: Does the dormant-client widget surface dormant clients for ALL recruiters in the org, or only ones owned by the current recruiter?**
   - What we know: The data model has `clients.owner_user_id` from Phase 1.
   - What's unclear: Anchor agency has 2-3 recruiters; org-wide visibility makes sense at that size, but enterprise customers may want per-owner.
   - Recommendation: **Org-wide for Phase 3**, with a "mine only" toggle in the widget. (D3-XX candidate.)

4. **Q4: Should `job_ads` be unique per `(job_id, body_markdown)`, or allow duplicates?**
   - What we know: Recruiters regenerate ads frequently; identical regenerations should probably dedupe.
   - What's unclear: Do we keep generation history (for ROI analytics) or only the latest?
   - Recommendation: Keep all generations (no unique constraint) — disk is cheap, analytics value is high. Show "current ad" via a `is_current boolean` flag, set on save. (D3-XX candidate.)

5. **Q5: When the recruiter rejects a spec draft, do we delete it immediately or keep it for 30 days?**
   - What we know: D3-10 says "delete audio 30 days after approved or rejected." Spec draft row itself wasn't specified.
   - Unclear: Whether to keep the rejected draft (for "I changed my mind, restore it" affordance) or hard-delete.
   - Recommendation: Soft-delete the draft (status='rejected', keep row); hard-delete only the audio file. (D3-XX candidate.)

6. **Q6: Inclusivity score on existing ads — does it persist anywhere?**
   - D3-14 says "no persistence unless the user opts in." What does "opt in" look like UX-wise?
   - Recommendation: "Save score to job" button only appears if the ad text is associated with a job. Otherwise it's a one-shot read-only score. (D3-XX candidate.)

7. **Q7: Should outreach drafts use a single "default tone" or offer multiple ("warm catch-up", "new role available", "industry update")?**
   - Recommendation: Single warm catch-up tone for Phase 3; add tone selector in Phase 4 alongside outbound campaigns (which already needs it). (D3-XX candidate.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js / pnpm | Existing | ✓ | system | n/a |
| Docker | Local Supabase dev | ✓ (per CLAUDE.md) | latest | Use cloud Supabase + `--linked` (Phase 1 LEARNINGS note) |
| Chrome (or Edge/Brave) | Extension testing | ✓ (recruiter machines) | latest | Firefox Manifest V3 support is patchy — stay Chrome-only for Phase 3 |
| ffmpeg binary | Server-side audio compress | ✗ on Vercel by default | — | Use `@ffmpeg-installer/ffmpeg` which bundles a Linux x64 static binary suitable for Vercel functions; or run the Inngest function on a runtime that has ffmpeg. **Verify in Wave 0.** |
| Anthropic API key | All Sonnet calls | ✓ (Phase 1) | n/a | None — required |
| Voyage API key | LinkedIn embed | ✓ (Phase 2) | n/a | None — required |
| OpenAI API key | Whisper | ✗ NEW | — | None — required; add to env + Vercel before any spec-call work |
| Inngest event key | Spec pipeline + cleanup cron | ✓ (Phase 1) | n/a | None — required |
| Microsoft Graph app registration | Outlook Mail.Send | ✓ existing, scopes need expansion | n/a | Add Mail.Send to delegated permissions in Azure portal; admin consent only needed if anchor org has consent admin gate (likely no for 2-3 person agency) |

**Missing dependencies with no fallback:**
- OpenAI API key — must be provisioned in Vercel + `.env.local` before Wave 1.

**Missing dependencies with fallback:**
- ffmpeg on Vercel — `@ffmpeg-installer/ffmpeg` is the standard fallback; if it fails, lift the Inngest function to a runtime that ships ffmpeg (e.g. a self-hosted Inngest worker). **Wave-0 verification: run `ffmpeg -version` from a deployed Inngest function once and confirm.**

## Project Constraints (from CLAUDE.md)

These directives apply to all Phase 3 work:

- **AI wrapper-only:** All Claude calls through `src/lib/ai/claude.ts`; all Whisper calls through new `src/lib/ai/whisper.ts`; all Voyage calls through `src/lib/ai/voyage.ts`. No bare SDK use.
- **`record_ai_usage` mandatory:** Every AI call writes a row. Non-negotiable.
- **Inngest for > 2 s AI:** Whisper, Sonnet JD extract, batch operations. Server actions only for the inclusivity-on-pasted-ad path (~3 s, acceptable with spinner).
- **No service-role in route handlers:** Only Inngest functions and the existing invite flow may use service-role. Cross-tenant FK guards via `assert_same_org()`.
- **Append-only migrations:** Never edit committed migration; add a new one to fix.
- **Multi-tenant RLS:** Every new table (`spec_drafts`, `job_ads`) gets RLS policies keyed on `organization_id = current_organization_id()`.
- **No PII to Sentry/PostHog:** Audio transcripts, candidate names, CV text are PII. Strip before logging.
- **Server Components default:** All new pages (`/spec`, `/spec/[id]/review`, `/reports/source-attribution`) are RSC by default; Client Components only for interactivity (file upload widget, ad generate button, dormant outreach modal).
- **Server Actions for mutations:** Approve draft, save job ad, send outreach, regenerate ad → server actions, not route handlers. Route handlers only for `/api/linkedin/ingest` (webhook-like) and `/api/spec/upload-url` (returns signed URL).
- **`pnpm` package manager.**
- **Naming:** PascalCase components, camelCase functions, snake_case DB, lowercase enums.
- **Verification gates per task:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- **Atomic per-task commits.**

## Sources

### Primary (HIGH confidence)
- `/Users/aj_mac/altus-recruitment/CLAUDE.md` — project constraints (mandatory)
- `/Users/aj_mac/altus-recruitment/.planning/phases/01-internal-ats/01-LEARNINGS.md` — trigger ordering, pricing drift, plan-checker value
- `/Users/aj_mac/altus-recruitment/.planning/phases/02-search-match-intake/02-RESEARCH-OUTLOOK.md` — Mail.Send explicitly NOT requested; verified inline
- `/Users/aj_mac/altus-recruitment/supabase/migrations/20260513152244_phase1_domain_schema.sql` — schema baseline (`application_type` enum, `candidate_source` enum, `ai_usage`, `record_ai_usage`)
- `/Users/aj_mac/altus-recruitment/supabase/migrations/20260517204500_cross_tenant_fk_guards.sql` — `assert_same_org()` helper
- `/Users/aj_mac/altus-recruitment/supabase/migrations/20260518213836_fix_same_org_trigger_order.sql` — trigger naming pattern
- `/Users/aj_mac/altus-recruitment/src/lib/ai/claude.ts` — pence/MTok constants, wrapper signature
- `/Users/aj_mac/altus-recruitment/src/lib/integrations/outlook.ts` — current `OUTLOOK_SCOPES` value
- [Anthropic Structured Outputs docs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs) — `strict: true`, nullable fields, 2-level nesting limit
- [Anthropic Claude API Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — schema transformation behavior
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) — Mail.Send delegated permission
- [Microsoft incremental consent](https://learn.microsoft.com/en-us/entra/identity-platform/consent-types-developer) — adding scopes to existing OAuth
- [Chrome Extensions network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) — host_permissions and cross-origin behavior
- [Gender Decoder](https://gender-decoder.katmatfield.com/) — gender-coded word lists (vendor JSON)

### Secondary (MEDIUM confidence — verified against multiple sources)
- [OpenAI Whisper file limit and chunking](https://community.openai.com/t/whisper-api-increase-file-limit-25-mb/566754) — 25 MiB cap, recompression strategies
- [Whisper UK accent performance (JASA study)](https://pubs.aip.org/asa/jel/article/4/2/025206/3267247/Evaluating-OpenAI-s-Whisper-ASR-Performance) — accent degradation evidence
- [Whisper-1 pricing](https://developers.openai.com/api/docs/models/whisper-1) — $0.006/min
- [Supabase auth in Chrome extension (cookie-from-tab approach)](https://gourav.io/blog/supabase-auth-chrome-extension) — pattern for reading auth cookies cross-context
- [Cookie-based login for Chrome extensions with Supabase](https://dev.to/ahmed_sulaiman/cookie-based-login-for-chrome-extensions-with-supabase-am3) — alternative cross-verification of cookie pattern
- [LinkedIn scraper resilience (DOM selector hierarchy)](https://dev.to/alterlab/how-to-scrape-linkedin-data-complete-guide-for-2026-4kf0) — aria/data-test priority over class names

### Tertiary (LOW confidence — flagged for validation at planning time)
- Specific LinkedIn `data-view-name` attribute names — must be verified against a live profile during the extension scaffold task (not from a fixed reference)
- Job-ad inclusivity scoring weights (gender 25%, age 20%, etc.) — recommendation, not from a single authoritative rubric; tunable at calibration time

## Metadata

**Confidence breakdown:**
- Standard stack (npm packages): MEDIUM — names tagged [ASSUMED], require `npm view` verification before install (Phase 1 LEARNINGS slopsquat pattern)
- Architecture / migrations: HIGH — verified against existing Phase 1/2 migration shape and triggers
- Pitfalls: HIGH — drawn from Phase 1 LEARNINGS + verified Anthropic/OpenAI/Microsoft docs
- AI cost estimates: MEDIUM — Anthropic pricing constants verified in `claude.ts` 2026-05-18; Whisper pricing verified from multiple 2025-2026 sources; volumes are illustrative
- Inclusivity rubric design: MEDIUM — Gender Decoder is verified seed; rest is opinionated synthesis (planner can adjust dimensions and weights)
- Extension auth (cookie-from-tab): HIGH — well-documented pattern; verified against Chrome dev docs and multiple Supabase community write-ups

**Research date:** 2026-05-19
**Valid until:** ~2026-06-19 (30 days for the stable surface; ~7 days for LinkedIn DOM specifics which can change weekly)
