# Phase 8: Branded CV — Research

**Researched:** 2026-08-12
**Domain:** Server-side PDF generation on Vercel Node serverless (Next.js Server Actions), Supabase Storage document modelling, GDPR-erasure-safe schema extension
**Confidence:** HIGH (PDF library choice, repo integration points, erasure/export coverage) / MEDIUM (template visual design, exact contact-stripping scope — needs founder confirmation per below)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Output format: PDF first.** No DOCX in this phase; Word export is a
   possible follow-on if clients demand it.
2. **Contact details: stripped** on the branded copy (email, phone, address —
   name stays). Standard agency practice; protects the fee. Original CV
   untouched.
3. **Scope: full feature in one phase** — template + logo upload + generate
   action → stored branded PDF with View/Download. Not the thin-slice
   (branded page + print-to-PDF) variant the triage floated.
4. **Template: design a clean standard layout** — no existing Steele Charles
   template to replicate. One layout for all tenants, branded per-tenant via
   settings (founder's words: "putting the colour scheme and logo in the
   settings and then having that populate a standard CV template").

### Triage design correction — LOCKED (2026-08-11 triage)

- **Generate ON-DEMAND, never auto-on-parse.** Phase 7 made parsed data
  editable; an auto-generated copy would go stale the moment a field is
  corrected. Generation reads the candidate's CURRENT data at click time.

### Claude's Discretion

- Template visual design (professional recruitment-standard layout; which
  parsed fields render and their order), within BCV-02.
- Storage modelling for the branded artifact (new table vs. flagged
  candidate_cvs row vs. documents table) — planner decides after research;
  must preserve tenant RLS + audit patterns and BCV-06 idempotent regeneration.
- PDF generation mechanism — needs research (resolved below).

### Deferred Ideas (OUT OF SCOPE)

- DOCX/Word export; Outlook attachment send (follow-on candidates).
- Per-tenant custom template layouts.
- Anonymisation beyond contact-stripping (e.g. name redaction / blind CVs).
- Submission/float workflow changes (what gets SENT is untouched; this phase
  only produces and stores the artifact).

### Open technical fork — CONFIRM WITH FOUNDER before execute

- **PDF generation approach.** Resolved below with a concrete recommendation
  (`@react-pdf/renderer`). CLAUDE.md requires founder sign-off on any new
  dependency — present the two-sentence recommendation (see Summary) before
  execution begins.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BCV-01 | On-demand generation only — button on candidate page builds PDF from CURRENT data at click time, never auto-on-parse | Server Action pattern (§Architecture Patterns, Pattern 1); zero-AI synchronous generation confirmed safe under Vercel/CLAUDE.md's "≤2s → don't use Inngest" rule (§Environment Availability, §Pitfall 7) |
| BCV-02 | One standard template, tenant-branded (brand_primary/brand_secondary/logo on a clean professional layout: identity header, headline/about, skills, work history, education) | Exact field inventory from `candidates` + `candidate_cvs.extracted_data` (§Repo Integration — Parsed Data Fields); `@react-pdf/renderer`'s flexbox layout + auto-pagination fits variable-length CVs (§Standard Stack) |
| BCV-03 | Contact details stripped: email, phone, address never render; name stays; original CV untouched | §Contact-Stripping Correctness — field-level scope + free-text caveat, flagged as needing founder confirmation on "address" (§Assumptions Log A1) |
| BCV-04 | Real logo upload in Settings→Branding (replacing URL-only field); graceful no-logo header | §Repo Integration — Branding Settings & Logo Upload; **critical finding**: `logo_url` is edited from TWO existing forms today (§Pitfall 1) |
| BCV-05 | Branded PDF stored as a candidate document, clearly marked, View/Download via Phase-7 route-handler surface + export audit row | §Repo Integration — Delivery/Audit Pattern; §Storage Modelling Options (recommendation: new table, reusing the `cvs` bucket) |
| BCV-06 | Regeneration safe and idempotent — supersedes prior branded copy cleanly, no orphaned files, no duplicate rows | §Storage Modelling Options — partial-unique-index / single-row-per-candidate design; §Pitfall 6 (orphaned storage objects) |
| BCV-07 | Acceptance/closure gates; zero AI spend in generation path | Confirmed: no Claude/Voyage call anywhere in the recommended pipeline — deterministic template fill only (§Standard Stack, §Architecture Patterns) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Ask before new dependencies** — `@react-pdf/renderer` is a new runtime
  dependency and MUST get explicit founder sign-off before `pnpm add`. This
  research exists specifically to make that a one-glance decision.
- **Ask before schema/migration changes** — whichever storage model the
  planner picks (this research recommends a new table), it requires a new
  migration file. Migrations in this project are **founder-pushed manually**
  (`pnpm exec supabase db push --linked`) — the plan must not assume CI/auto-apply.
- **Server Actions for mutations, route handlers only for webhooks/public
  APIs** — with one documented exception already in this codebase (file
  delivery via a navigable GET, `cv-file/[cvId]/route.ts`). The "Generate
  branded CV" action is a mutation → Server Action. Its "View/Download"
  delivery is a navigable GET → route handler, following the exact
  established exception.
- **RLS is the tenancy authority; never bypass with service role in
  client-reachable code.** All new tables/buckets must follow the existing
  `current_organization_id()` + `set_organization_id()` trigger convention.
- **Never call Claude/Voyage/Whisper synchronously if it could exceed ~2s —
  move to Inngest.** BCV-07 mandates zero AI spend, so this rule is
  structurally inapplicable to generation itself — but it also means there is
  **no reason** to route generation through Inngest; a direct Server Action
  is both simpler and faster (see §Architecture Patterns, Pattern 1).
- **Never log PII to Sentry/PostHog** — candidate name, email, phone must
  never appear in Sentry breadcrumbs/tags for this feature, mirroring the
  existing CV-file route's PII-free capture discipline.
- **`pnpm typecheck` / `pnpm lint` / tests green + manual verify** before
  declaring done, per the standard verification checklist.
- **Match existing patterns rather than introducing new ones** — this
  research is written to point at the specific existing file for every
  pattern the plan will need to mirror (audit, RLS, storage path convention,
  magic-byte upload sniffing, Server-Action error shape).

## Summary

Generate the branded PDF with **`@react-pdf/renderer`** (MIT, actively
maintained — v4.6.0 published 3 days before this research, React 19 in its
declared peerDependencies) rendered synchronously inside a Server Action;
reject headless Chromium (`puppeteer-core` + `@sparticuz/chromium`, ~70 MB
unpacked binary layer, multi-hundred-ms-to-seconds cold start) and `pdf-lib`
(upstream unmaintained since 2022, no layout engine — every wrap/paginate
decision for variable-length work history would be hand-rolled) as poor
fits for a one-click, zero-AI, purely-deterministic template fill.

Model the branded artifact as a **new table** (`candidate_branded_cvs`, one
row per candidate, reusing the existing `cvs` Storage bucket and RLS
pattern) rather than a flagged `candidate_cvs` row: the existing table's
`(candidate_id, version)` uniqueness, `parsing_status` enum, and
`mime_type ∈ {pdf, docx}` semantics all encode "this is a literal uploaded
revision of the source CV" — overloading it with a derived, single-instance,
never-parsed artifact would require a migration to the version constraint
and silent special-casing throughout `cv-files-panel.tsx`, `nextCVVersion`,
and the Phase-6 frozen CV-intake smoke suite. A new table costs one migration
and two small additions to the existing erasure/export sweeps (both are
one-line list additions, not new logic) and leaves every tested Phase 6/7
code path completely untouched.

Two concrete repo findings must reach the planner: (1) `organizations.logo_url`
is currently edited from **two different existing forms** (`/settings` general
org page and `/settings/branding`) — BCV-04's real upload must address both,
not just the branding page; (2) `@react-pdf/renderer`'s `Image` component has
**no native SVG support** — the new logo-upload validator should accept
PNG/JPEG only, mirroring the byte-sniffing pattern already used for CV
uploads.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| "Generate branded CV" trigger (button click) | Browser / Client | — | A plain button invoking a Server Action; no client state machine needed (mirrors `score-all-button.tsx` minus the polling — generation is synchronous and fast) |
| PDF template fill from candidate data | API / Backend (Server Action) | — | Deterministic read of `candidates` + `candidate_cvs.extracted_data`, zero AI, zero external network call — belongs entirely server-side, same tier as `uploadCVAction` |
| PDF byte generation (`@react-pdf/renderer`) | API / Backend (Server Action, Node runtime) | — | Pure-JS, in-process rendering; no browser, no native binary, no filesystem beyond a bundled font asset |
| Branded PDF storage | Database / Storage (Supabase Storage `cvs` bucket) | — | Same bucket, same org-prefixed RLS policy as original CVs |
| Branded PDF row bookkeeping | Database / Storage (Postgres, new table) | — | New table, not `candidate_cvs`, to avoid corrupting version/parse semantics (see Summary) |
| Delivery (View/Download) | API / Backend (Route Handler, navigable GET) | Browser / Client (plain `<a>`) | Mirrors the existing `cv-file/[cvId]/route.ts` exception to "route handlers = webhooks/public APIs only" — a signed URL redirect must be a real document navigation |
| Org branding (colours + logo) storage | Database / Storage (`organizations` table + Storage) | — | Existing `brand_primary`/`brand_secondary`/`logo_url` columns; BCV-04 adds a Storage-backed logo path |
| Export audit trail | Database / Storage (`audit_log` via `record_audit` RPC) | API / Backend (Route Handler calls it) | Reuses `recordExportAudit`, entity_type `'candidate'`, filed before the redirect — same invariant as the original CV route |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-pdf/renderer` | `^4.6.0` [VERIFIED: npm registry — version/publish-date/peerDeps confirmed via `npm view`, cross-checked against official docs at react-pdf.org] | Declarative React → PDF document generation, server-side (`renderToBuffer`) | Actively maintained (latest patch published 3 days before this research), MIT-licensed, React-19-compatible peerDependency range, flexbox-like layout engine with automatic pagination — the only one of the four candidates that solves "flowing, variable-length document" without hand-rolled positioning math |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| A single bundled Unicode TTF (e.g. Inter or Noto Sans, static weight — not a variable font) | n/a — vendored asset, not an npm package | Text rendering with full Latin-Extended glyph coverage (names with diacritics, £) | Always register this explicitly with `Font.register` at module scope; never rely on the PDF built-in "Helvetica" fallback (see Pitfall 3) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@react-pdf/renderer` | `puppeteer-core` + `@sparticuz/chromium` (headless Chromium print) | Renders arbitrary HTML/CSS (more design freedom, could reuse a web-rendered preview) but the Chromium binary layer alone is ~70 MB unpacked [VERIFIED: npm registry, `dist.unpackedSize` on `@sparticuz/chromium@149.0.0`], adds multi-hundred-ms-to-several-second cold-start extraction cost, and needs `serverExternalPackages` wiring (the project already has this pattern for `@ffmpeg-installer/ffmpeg` — so it's *possible*, just heavier than necessary for a one-page-to-two-page deterministic document). Reasonable fallback only if the founder later wants pixel-perfect HTML/CSS design fidelity. |
| `@react-pdf/renderer` | `pdf-lib` (or its maintained fork `@cantoo/pdf-lib`, `2.8.1`) | Upstream `pdf-lib` unmaintained since 2022-05 [VERIFIED: npm registry, `time.modified`]; low-level drawing API only (`drawText`, `drawImage` at explicit x/y) — no layout engine, so wrapping a long skills list or paginating a 6-job work history would be entirely hand-rolled. Fine for form-filling a *fixed* template (e.g. stamping a signature onto an existing PDF); wrong tool for a flowing document. |
| `@react-pdf/renderer` | `@pdfme/generator` (`6.1.12`, actively maintained, 187k weekly downloads) | Fast (tens-to-hundreds of ms) and Node/serverless-friendly, but its model is a fixed-position JSON *schema* authored in a WYSIWYG designer — built for form-fill documents, not reflowing prose/lists. Would need significant extra logic to handle unpredictable CV length across pages. |
| `@react-pdf/renderer` | Typst via `@myriaddreamin/typst-ts-node-compiler` (WASM) | A credible, quality 2025/2026 alternative (proper typesetting engine, in-process, no native browser) but requires learning Typst's own markup DSL, ships native N-API bindings (platform-specific binary risk on Vercel), and has a tiny ecosystem/download count next to react-pdf. Pure switching cost with no corresponding benefit for this team's React/TS-only codebase. |

**Installation:**
```bash
pnpm add @react-pdf/renderer
```
No install needed for the font — vendor a TTF file directly into the repo (e.g. `src/lib/pdf/fonts/Inter-Regular.ttf`, `Inter-Bold.ttf`) and load via `fs.readFileSync(path.join(process.cwd(), ...))`, never a network fetch (see Pitfall 4).

**Version verification:** `npm view @react-pdf/renderer version` → `4.6.0`, published 2026-08-08 (4 days before this research). `npm view @react-pdf/renderer peerDependencies` → `{ react: '^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0' }`, compatible with this project's React 19.2.4. License MIT. Repository `github.com/diegomura/react-pdf`.

## Package Legitimacy Audit

> slopcheck was **not available** in this research environment (`pip`/`pip3`
> not installed on the research host). Per protocol, the recommended package
> is tagged `[ASSUMED]` — not `[VERIFIED]` — despite manual npm-registry and
> official-docs cross-checks (see below), and the planner must gate the
> `pnpm add` behind a `checkpoint:human-verify` task.

| Package | Registry | Age | Downloads (wk) | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------------|--------------|-----------|-------------|
| `@react-pdf/renderer` | npm | First published 2017; latest patch 2026-08-08 (4 days old) | 4,995,261 | github.com/diegomura/react-pdf (linked in npm metadata, matches official docs at react-pdf.org) | not run (tool unavailable) | `[ASSUMED]` — manually cross-verified via `npm view` (version, peerDeps, license, repo, `postinstall` script = none) and official docs (react-pdf.org/fonts, react-pdf.org/components); planner must add `checkpoint:human-verify` before `pnpm add` |

**Packages removed due to slopcheck `[SLOP]` verdict:** none (slopcheck did not run).
**Packages flagged as suspicious `[SUS]`:** none identified manually — `npm view @react-pdf/renderer scripts.postinstall` returned empty (no postinstall script).

*All packages above are tagged `[ASSUMED]` per the graceful-degradation
protocol; the planner must gate the install behind a `checkpoint:human-verify`
task even though manual verification found nothing concerning.*

## Repo Integration — Parsed Data Fields (BCV-02)

Everything the template needs already exists, typed, in `src/types/database.ts`
(`Tables<'candidates'>`). No new candidate columns are needed for BCV-02.

| Template section | Source column(s) | Type | Notes |
|---|---|---|---|
| Identity header | `full_name` (candidates) | `string` (NOT NULL) | Always present |
| Headline | `headline` | `string \| null` | May be empty — template must degrade gracefully |
| About / summary | `about` | `string \| null` | Free text — see §Contact-Stripping Correctness for the free-text caveat |
| Current role context | `current_role_title`, `current_company`, `seniority_level` | `string \| null` each | |
| Skills | `skills` | `string[]` (NOT NULL, default `'{}'`) | Empty array is the "no skills" state, not null |
| Sector tags | `sector_tags` | `string[]` (NOT NULL, default `'{}'`) | Optional to render — Claude's discretion per BCV-02 |
| Work history | `work_experience` | `Json` (jsonb array) — shape written by `mapWorkHistory` in `src/lib/db/candidate-cvs.ts`: `{ title, company, dates }[]` | Populated either from CV parse or LinkedIn capture (migration `20260522094604`) |
| Education | `education` | `Json` (jsonb array) — shape from `mapEducation`: `{ school, degree, dates }[]` | Same dual-source population path |
| Years of experience | `years_experience` | `number \| null` | Optional display field |
| Salary fields | `salary_current_estimate`, `salary_expectation`, `currency` | present but **NEVER render these on a client-facing branded document** — not part of BCV-02's listed sections and salary expectation is commercially sensitive negotiating information, not a CV field | Not a locked decision — flag as an explicit exclusion in the plan, not an oversight |
| Contact (to be stripped per BCV-03) | `email`, `phone`, `location` | `string \| null` each | See dedicated section below |

**`work_experience` / `education` typing caveat:** these two columns are
typed as `Json` in the generated `Database` type (i.e. `unknown` in practice
via Supabase's jsonb mapping), **not** as the structured `{title, company,
dates}[]` / `{school, degree, dates}[]` shape they actually contain at
runtime. The template-fill code must defensively coerce/validate this JSON
the same way `markCandidateFieldsFromCV` does on the write side — do not
assume the shape without a runtime check, since a row written by a future/older
code path could carry a different shape.

## Repo Integration — Storage Modelling Options (BCV-05, BCV-06)

Three options were weighed, evaluated against BCV-06's idempotent-regeneration
requirement and the project's existing erasure/export sweeps
(`deleteCandidateAction` in `src/app/(app)/candidates/[id]/actions.ts`,
`ORG_EXPORT_TABLES`/`ORG_STORAGE_BUCKETS` in `src/lib/admin/org-erasure.ts`).

| Option | Fit for BCV-06 (idempotent, no orphans/dupes) | Erasure/export coverage | Verdict |
|---|---|---|---|
| **New table** `candidate_branded_cvs` (recommended) | Clean: `unique (candidate_id)` makes regeneration a delete-old-row-and-object + insert-new (or update-in-place) with no ambiguity about "which row is current" | Needs: (a) add table name to `ORG_EXPORT_TABLES`; (b) add a storage-path-capture query to `deleteCandidateAction` (mirroring the existing `cvPathRows`/`voiceAudioRows` pattern) so the branded PDF's object is removed on candidate delete; (c) FK `candidate_id ... on delete cascade` handles the row itself automatically, matching the existing `candidate_cvs`/`ai_summaries` cascade convention | **Recommended.** One migration + two small, mechanical additions to already-tested sweep code. Zero risk to the Phase 6 frozen CV-intake suite or Phase 7 lifecycle logic, since `candidate_cvs` is untouched. |
| Flagged `candidate_cvs` row (add a `kind` enum column, `'original' \| 'branded'`) | Awkward: the `(candidate_id, version)` unique constraint would need a partial unique index scoped to `kind = 'original'`, and a *second* partial unique index (`unique (candidate_id) where kind = 'branded'`) for BCV-06's single-current-copy requirement — two constraint changes instead of one clean table | Free for export (`candidate_cvs` already in `ORG_EXPORT_TABLES`) and free for candidate-level erasure (`deleteCandidateAction` already queries `candidate_cvs.storage_path` before cascade — a branded row is swept automatically) — **but** requires auditing/patching `cv-files-panel.tsx` (branded row must NOT show as "Latest" or get a `v{n}` label in the existing CV-history list), `nextCVVersion()` (must exclude `kind='branded'` rows from version-number computation), and `parsing_status`/`mime_type` semantics (branded rows never go through the parse pipeline — what does `parsing_status` mean for them?) | **Not recommended.** The erasure/export win is real but is outweighed by the number of existing, tested call sites that would need new `kind`-aware branching to avoid silently corrupting the CV-history UI or the version-numbering invariant the Phase 6/7 test suites assert on. |
| Storage-only object (no DB row at all, e.g. deterministic path `{org_id}/{candidate_id}/branded-cv.pdf`, existence checked via `storage.list`) | Fails BCV-06 outright without extra bookkeeping: "regenerate cleanly, no duplicate rows" is trivially true (there's no row), but there is also no `created_at`/`generated_by` audit trail, and every "does a branded copy exist" check becomes a Storage `list` round-trip instead of an indexed query | Storage-level erasure is free (`cvs` bucket already swept by org-id prefix); but GDPR *export* has no row to include — a customer's export would silently omit "we generated a branded copy of your data on this date" | **Not recommended.** Cheapest to build, but loses the audit/generated-by metadata BCV-05 implies ("clearly marked ... with an export audit row **on every access**" already requires a row-identified entity for `recordExportAudit`'s metadata anyway). |

**Recommended schema sketch** (for the planner to refine, not a locked
decision — flag for founder sign-off since it's a new migration):

```sql
create table public.candidate_branded_cvs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  storage_path text not null,
  generated_by uuid references public.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id) -- BCV-06: exactly one current branded copy per candidate
);

create index candidate_branded_cvs_organization_id_idx on public.candidate_branded_cvs (organization_id);

alter table public.candidate_branded_cvs enable row level security;
-- Same tenant select/insert/update/delete policy quad as candidate_cvs
-- (migration 20260513152244:477-486), keyed on current_organization_id().

create trigger candidate_branded_cvs_set_org before insert on public.candidate_branded_cvs
  for each row execute function public.set_organization_id();
create trigger candidate_branded_cvs_set_updated_at before update on public.candidate_branded_cvs
  for each row execute function public.set_updated_at();
```

Regeneration (BCV-06) becomes: generate new bytes → upload to a **new**
Storage path → `update ... set storage_path = $new, generated_at = now()
where candidate_id = $id` (upsert semantics via the unique constraint) →
best-effort `remove()` the **old** Storage object. This ordering (write new,
then delete old) means a mid-regeneration crash leaves the *old* copy still
servable rather than leaving nothing — the same "storage-first, DB-second"
ordering discipline already used in `deleteAllOrgStorage`.

Storage path convention (reuse the existing `cvs` bucket — no new bucket, no
new bucket RLS policy needed, since the existing policy is `(storage.foldername(name))[1]
= current_organization_id()::text`, which imposes no constraint on the
path below the first segment):

```
{organization_id}/{candidate_id}/branded-cv-{uuid}.pdf
```

## Repo Integration — Delivery/Audit Pattern (BCV-05)

Reuse the exact shape of `src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts`
for a sibling route, e.g. `src/app/(app)/candidates/[id]/branded-cv/route.ts`:

1. UUID-shape-gate the candidate id (no `cvId` param needed if the new table
   is keyed 1:1 on `candidate_id` — the route can look up by `candidate_id`
   directly, simplifying the URL to `/candidates/[id]/branded-cv`).
2. `getUser()` auth check (defence in depth; route handlers don't run
   layouts).
3. RLS-scoped read of the `candidate_branded_cvs` row — cross-tenant or
   missing both collapse to a bare 404 (same tenancy-hiding discipline as
   the original).
4. `supabase.storage.from('cvs').createSignedUrl(storage_path, 60)` — same
   60s TTL constant, same bucket.
5. `recordExportAudit(supabase, 'candidate', candidateId, { candidate_branded_cv_id: row.id })`
   **before** the redirect, never after — same ordering invariant, same
   `entity_type: 'candidate'` (so it appears in the same access-history
   query the original CV audit rows use — `record_audit`'s `p_entity_type`
   is a free string, not FK-constrained, confirmed in `src/lib/db/audit.ts`).
6. `NextResponse.redirect(signed.signedUrl, 302)` with `cache-control: no-store`.

The UI "View" control mirrors `cv-file-link.tsx` — a plain `<a target="_blank"
rel="noopener noreferrer nofollow">` pointing at the new route, **not** a
client component with an async action. This is not optional stylistic
preference: the codebase has a documented production incident
(2026-08-11, referenced at the top of `cv-file/[cvId]/route.ts`) where the
popup+async-Server-Action pattern silently hung. Do not reintroduce that
shape for the branded-CV View control.

"View/Download" in BCV-05's wording maps to this **single** existing
control — there is no separate Download button anywhere in this codebase
today (confirmed: only one `createSignedUrl`/`download` call site exists,
in the CV-file route). A PDF opened via this pattern renders inline in the
browser's native PDF viewer, from which the user saves — this already
satisfies "Download" without a second control.

## Repo Integration — Branding Settings & Logo Upload (BCV-04)

`src/app/(app)/settings/branding/` today: `brand_primary`/`brand_secondary`
(hex, DB-CHECK-constrained `^#[0-9a-fA-F]{6}$`) + `logo_url` (a free-text
`https://` URL field, validated client- and server-side by a shared regex,
rendered via `next/image` with `unoptimized` — i.e. no remote-pattern
allowlisting exists yet, deliberately, per the inline comment).

**Critical finding — duplicate field, not previously flagged in CONTEXT.md:**
`organizations.logo_url` is edited from **two separate, still-live forms**:

1. `src/app/(app)/settings/organization-form.tsx` (`/settings`, Phase 1) —
   edits `name` + `logo_url` via `updateOrganizationAction`
   (`src/app/(app)/settings/actions.ts`). Its own source comment says
   `// upload UI is Phase 2` — an old plan reference that this phase now
   actually delivers, just three years and several phases later than the
   comment implies.
2. `src/app/(app)/settings/branding/branding-form.tsx` (`/settings/branding`,
   Phase 5) — edits `brand_primary`/`brand_secondary`/`logo_url` via
   `updateBrandingAction`.

Both write the **same column**. If BCV-04 only replaces the field on the
branding page, an owner can still paste an arbitrary external URL into the
`/settings` general page and silently clobber the uploaded logo — defeating
the point of "real upload flow." The plan must explicitly decide: (a) update
both forms to the new upload widget, or (b) remove the `logo_url` field from
`/settings` and make `/settings/branding` the single canonical location
(recommended — it already owns the *other* half of branding, colours).

**Upload flow recommendation (mirrors the existing CV-upload precedent in
`uploadCVAction`, `src/app/(app)/candidates/[id]/actions.ts`):**

- New Supabase Storage bucket or reuse `cvs`? **Recommend a new bucket**,
  e.g. `org-logos` — logos are org-scoped (not candidate-scoped), one per
  org, small (KBs not MBs), and mixing them into the `cvs` bucket's
  `{org}/{candidate}/...` two-level path convention would need a special
  top-level `{org}/logo.png` exception. A dedicated bucket keeps the path
  convention uniform: `{organization_id}/logo-{uuid}.{ext}`.
  - **This is a new bucket** → needs its own `insert into storage.buckets`
    migration (mirror `20260517204501_storage_cvs_bucket.sql`'s four-policy
    RLS shape) AND an addition to `ORG_STORAGE_BUCKETS` in
    `src/lib/admin/org-erasure.ts` (currently `['cvs', 'spec-audio',
    'voice-note-audio']`) so org-level erasure/export sweeps the logo too.
- **Format validation: PNG/JPEG only, reject SVG.** `@react-pdf/renderer`'s
  `Image` component supports Buffer/URL sources in JPG/PNG only — it has no
  native SVG rasterisation (confirmed against react-pdf.org's component
  docs). Accepting an SVG logo today (the URL-only field's placeholder text
  literally suggests "PNG or SVG recommended") would produce a template that
  silently fails to render the logo the moment BCV-02 tries to embed it.
  Mirror the existing dependency-free magic-byte sniff pattern in
  `src/lib/cv/file-signature.ts` (`PNG_MAGIC = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]`,
  `JPEG_MAGIC = [0xff,0xd8,0xff]`) rather than trusting the client-supplied
  MIME type, exactly as `assertUploadableCV` does for CVs.
- Size cap: small, a few hundred KB is plenty for a logo; the existing CV
  cap constant pattern (`MAX_CV_BYTES` in `actions.ts`) is the precedent to
  mirror at a much smaller number (e.g. 2 MiB).
- `next/image` for the on-screen branding-settings preview: once the logo is
  a Supabase Storage object rather than an arbitrary external URL, the
  preview can use a signed/public URL from the SAME bucket-and-org
  convention as everything else — no new `remotePatterns` entry needed if
  the preview goes through a signed URL (server-fetched) rather than a raw
  public Storage URL.

## Repo Integration — GDPR Erasure Coverage (cross-cutting for BCV-05/06)

Two existing sweeps must be extended, both additive (list entries, not new
logic):

1. **Candidate-level** (`deleteCandidateAction`,
   `src/app/(app)/candidates/[id]/actions.ts`): today captures
   `candidate_cvs.storage_path` and `voice_notes.audio_storage_path` BEFORE
   calling the `delete_candidate` RPC (which cascades the DB rows), then
   best-effort removes the captured paths from Storage. Add a third capture
   query for `candidate_branded_cvs.storage_path` (or the equivalent path if
   a different storage model is chosen) and a third `removeFromBucket('cvs', brandedPaths)`
   call. The RPC itself needs **no change** if the new table's FK is
   `on delete cascade` — Postgres cascades the row automatically, matching
   the existing `candidate_cvs`/`ai_summaries` convention noted in the RPC's
   own comment.
2. **Org-level** (`src/lib/admin/org-erasure.ts`): add
   `'candidate_branded_cvs'` to `ORG_EXPORT_TABLES` (for GDPR data export
   completeness) and — only if a **new** logo bucket is introduced —
   `'org-logos'` to `ORG_STORAGE_BUCKETS`. If the logo is instead stored
   under the `cvs` bucket, this second addition is unnecessary (already
   covered).

## Contact-Stripping Correctness (BCV-03)

**Structured fields — unambiguous, strip these:**
- `candidates.email`
- `candidates.phone`

**Ambiguous field — needs founder confirmation, do not silently decide:**
CONTEXT.md's locked wording is "email, phone, address — name stays," but the
`candidates` schema has **no literal `address` column** — the closest field
is `location` (`string | null`), which in this codebase's actual usage is
city/region-level ("Manchester, UK"), not a full postal address; there is no
separate street-address field anywhere in the schema. Two readings are both
defensible:

- **Reading A (strip `location` too):** honours the literal word "address"
  in the locked decision as broadly as possible — err on the side of the
  founder's stated intent to protect the fee.
- **Reading B (keep `location`):** city/region is standard, expected content
  on a professionally-branded CV (commute/relocation/hybrid context for the
  client) and is not itself a contact route — nobody reaches a candidate by
  mailing "Manchester." Most UK recruitment-agency branded CVs retain
  city-level location while stripping literal contact channels.

This research does not resolve this ambiguity — it is flagged as
**Assumption A1** below and must be confirmed with the founder before
BCV-03 is implemented, alongside the PDF-library sign-off.

**Free-text embedding (the "about"/"headline" subtlety):** `about` and
`headline` are recruiter-editable free text (Phase 7 made all parsed fields
editable). A candidate's self-authored CV text or a recruiter's manual entry
could in principle contain an email or phone number typed directly into
prose (e.g. "reach me directly at ..."). **Pragmatic recommendation: do not
attempt automated regex-scrubbing of free text.** Reasons:
- False positives (a UK phone-format-looking string that's actually a
  reference number, a postcode-shaped substring) would mangle legitimate CV
  content the recruiter wrote deliberately.
- False negatives give false confidence — a scrubber that catches 90% of
  phone-number patterns is worse than no scrubber, because it invites
  trusting an unverified guarantee.
- This mirrors the project's existing "recruiter judgment, not automation"
  posture for anything subjective (CLAUDE.md: "AI scores and suggests;
  recruiter decides").
- Treat this as a known, documented limitation in the template's design
  notes (visible to the planner and, transitively, in a UI hint near the
  Generate button: "contact fields are stripped automatically; check the
  headline/about text before sending").

## Architecture Patterns

### System Architecture Diagram

```
Candidate detail page (RSC)
        │
        │  [Generate branded CV] button (Client Component, onClick)
        ▼
generateBrandedCvAction (Server Action, 'use server')
        │
        ├─ requireEntitledOrg() gate (mirrors uploadCVAction/updateBrandingAction)
        ├─ auth.getUser() + getProfile() → organizationId
        ├─ getCandidate(candidateId)          ── current (edited) parsed data
        ├─ getOrganization(organizationId)    ── brand_primary/brand_secondary/logo path
        ├─ (optional) sign/read the org logo object from Storage → Buffer
        │
        ▼
renderToBuffer(<BrandedCvDocument candidate org logoBuffer />)   [@react-pdf/renderer, in-process, no network]
        │
        ▼
supabase.storage.from('cvs').upload(newPath, pdfBuffer, { contentType: 'application/pdf' })
        │
        ▼
upsert candidate_branded_cvs row (storage_path, generated_at, generated_by)
        │
        ├─ best-effort remove() the PRIOR storage object (if regenerating)
        │
        ▼
revalidatePath(`/candidates/${id}`) → toast "Branded CV generated"


---- Delivery path (separate click, separate request) ----

<a href="/candidates/[id]/branded-cv" target="_blank">  (plain anchor, no JS)
        │
        ▼
GET /candidates/[id]/branded-cv  (Route Handler, Node runtime)
        ├─ auth check
        ├─ RLS-scoped read of candidate_branded_cvs row
        ├─ createSignedUrl(storage_path, 60s)
        ├─ recordExportAudit('candidate', candidateId, {...})   ← BEFORE redirect
        ▼
302 redirect → signed Supabase Storage URL → browser's native PDF viewer
```

### Recommended Project Structure

```
src/
├── app/(app)/candidates/[id]/
│   ├── branded-cv/
│   │   └── route.ts                    # delivery — mirrors cv-file/[cvId]/route.ts
│   ├── branded-cv-panel.tsx            # small server component: status + Generate button + View link
│   ├── branded-cv-generate-button.tsx  # 'use client' — onClick → Server Action, toast, revalidate
│   └── actions.ts                      # add generateBrandedCvAction alongside uploadCVAction et al.
├── lib/
│   ├── pdf/
│   │   ├── branded-cv-document.tsx     # the @react-pdf/renderer <Document> component (template)
│   │   ├── fonts/
│   │   │   ├── Inter-Regular.ttf       # vendored, committed — NOT fetched at render time
│   │   │   └── Inter-Bold.ttf
│   │   └── register-fonts.ts           # Font.register(...) called once at module scope
│   └── db/
│       └── candidate-branded-cvs.ts    # mirrors candidate-cvs.ts's DbResult-shaped helpers
└── lib/upload/
    └── image-signature.ts              # PNG/JPEG magic-byte sniff, mirrors cv/file-signature.ts
supabase/migrations/
├── <timestamp>_candidate_branded_cvs.sql   # new table + RLS + triggers
└── <timestamp>_storage_org_logos_bucket.sql  # new bucket + RLS (if new-bucket option chosen)
```

### Pattern 1: Synchronous, zero-AI Server Action for generation

**What:** The entire generate operation (data read → PDF render → Storage
upload → row upsert) runs inline inside one `'use server'` function, exactly
like `updateBrandingAction`, `uploadCVAction`'s non-AI portion, and unlike
`scoreAllMatchesAction` (which only *starts* an Inngest job because Sonnet
match scoring is genuinely slow and asynchronous).
**When to use:** Any deterministic, non-AI, sub-second server operation in
this codebase — CLAUDE.md's "move to Inngest" rule is specifically about AI
call latency, and BCV-07 mandates zero AI spend, so it does not apply here.
**Example:**
```typescript
// Source: pattern mirrors src/app/(app)/settings/branding/actions.ts
'use server'

export async function generateBrandedCvAction(candidateId: string): Promise<ActionResult> {
  const gate = await requireEntitledOrg()
  if (!gate.ok) return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  const candidateResult = await getCandidate(supabase, candidateId) // RLS-scoped
  if (!candidateResult.ok) return { ok: false, formError: 'Candidate not found.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, formError: 'Profile not found.' }
  const orgResult = await getOrganization(supabase, profileResult.data.organization_id)
  if (!orgResult.ok) return { ok: false, formError: 'Organisation not found.' }

  const pdfBuffer = await renderToBuffer(
    <BrandedCvDocument candidate={candidateResult.data} org={orgResult.data} />,
  )
  // ... upload + upsert row, see §Storage Modelling Options for the
  // write-new-then-delete-old ordering.
}
```

### Pattern 2: Module-scope font registration, filesystem-loaded

**What:** Register fonts once, from a bundled file path, not a URL.
**When to use:** Always, for this feature — see Pitfall 3 and Pitfall 4.
**Example:**
```typescript
// Source: react-pdf.org/fonts + community guidance on Next.js/Vercel bundling
import { Font } from '@react-pdf/renderer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

Font.register({
  family: 'Inter',
  fonts: [
    { src: readFileSync(join(process.cwd(), 'src/lib/pdf/fonts/Inter-Regular.ttf')) },
    { src: readFileSync(join(process.cwd(), 'src/lib/pdf/fonts/Inter-Bold.ttf')), fontWeight: 'bold' },
  ],
})
```
Note: the font files must be included in the Server Action's/route's
Next.js output file tracing — if they end up excluded from the deployed
function bundle, this throws at cold start on Vercel, not locally. Verify
with a preview deploy, not just `pnpm build` locally (this project's build
gate is explicitly the Vercel build per `.claude/.../memory/vercel-project-ids.md`
— local `pnpm build` fails on env validation already, per existing project memory).

### Anti-Patterns to Avoid

- **Fetching a Google Fonts URL at render time:** documented, real
  serverless failure mode — cold-start network timeouts and a race between
  `Font.register()`'s async download and `renderToBuffer()` starting before
  the font finishes loading, with no built-in await. Always vendor the font
  file into the repo instead.
- **Client-side async action for the View/Download control:** this exact
  shape caused a real production incident in this codebase 2026-08-11 (see
  `cv-file/[cvId]/route.ts` header comment). Use a plain anchor to a route
  handler, full stop.
- **Overloading `candidate_cvs` with a `kind` flag:** technically possible,
  but see §Storage Modelling Options — the blast radius across
  `cv-files-panel.tsx`, `nextCVVersion()`, and the frozen Phase-6 smoke suite
  is not worth the erasure-sweep convenience it buys.
- **Auto-scrubbing free-text fields for embedded contact info via regex:**
  see §Contact-Stripping Correctness — false positives/negatives make this
  worse than no scrubbing at all.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF page layout / text wrapping / pagination for variable-length CVs | Manual x/y positioning with `pdf-lib`, computing line breaks and page overflow by hand | `@react-pdf/renderer`'s `<View>`/`<Text>` flexbox layout with `<Page>` auto-pagination | A candidate with 0 jobs and a candidate with 8 jobs must both produce a correctly-paginated document from the *same* template component tree — this is exactly the class of problem a layout engine exists to solve |
| Headless-browser process management (launch, page pool, zombie-process cleanup) | Manual `puppeteer-core` lifecycle management in a serverless function | N/A — not needed at all, since `@react-pdf/renderer` never spawns a browser | Avoided entirely by the recommended library choice, not by careful engineering |
| Image format sniffing for the logo upload | Trusting `file.type` (client-supplied, spoofable) | Reuse the magic-byte sniff pattern already proven in `src/lib/cv/file-signature.ts` for PNG (`\x89PNG\r\n\x1a\n`) / JPEG (`\xFF\xD8\xFF`) | The exact same spoofing risk CVI-08/T-06-29 already closed for CV uploads applies identically to logo uploads |

**Key insight:** Every "don't hand-roll" in this phase is really "don't
re-litigate a problem this codebase already solved once, for CVs" — the
logo-upload validation, the storage-first-delete-second erasure ordering,
the navigable-GET delivery pattern, and the RLS/trigger table convention are
all copy-the-shape problems, not new-design problems.

## Common Pitfalls

### Pitfall 1: The duplicate `logo_url` edit surface (see §Branding Settings)
**What goes wrong:** BCV-04 ships a real upload flow on `/settings/branding`,
but `/settings` (the general org page) still has a free-text `logo_url`
field wired to the same column — an owner can paste a URL there and silently
overwrite the uploaded logo.
**Why it happens:** The `/settings` field predates `/settings/branding` by
several phases (Phase 1 vs Phase 5) and was never consolidated.
**How to avoid:** Plan must explicitly touch both forms — either migrate
both to the upload widget or remove the field from `/settings` and point
users to Branding.
**Warning signs:** A code review that only searches for `logo_url` inside
`settings/branding/` will miss this entirely — search the whole `src/app/(app)/settings/`
tree.

### Pitfall 2: SVG logos silently fail to render in the PDF
**What goes wrong:** The current URL-only field's placeholder text says "PNG
or SVG recommended." `@react-pdf/renderer`'s `Image` component has no native
SVG rasterisation — an SVG logo simply won't appear (or will error) when the
template tries to embed it.
**Why it happens:** SVG works fine in the browser (`next/image` renders it
happily) but the PDF-generation library operates in a completely different
rendering context with a narrower format contract (JPG/PNG/Buffer only).
**How to avoid:** Restrict the new upload validator to PNG/JPEG only, and
update the field's help text.
**Warning signs:** A logo that shows correctly on the public apply page but
is missing/blank on the generated branded PDF.

### Pitfall 3: Diacritics/extended-Latin candidate names render as blank boxes or missing glyphs
**What goes wrong:** The PDF's built-in "Helvetica" (or any base-14 standard
font) only supports a narrow encoding; several real GitHub issues on
`@react-pdf/renderer` document specific glyphs (©, middle-dot, č/ć/đ) failing
to render depending on font choice.
**Why it happens:** PDF standard fonts default to WinAnsi/StandardEncoding,
not full Unicode; a registered custom font must itself contain the needed
glyphs.
**How to avoid:** Always explicitly `Font.register` a broad-coverage TTF
(Inter and Noto Sans both have solid Latin-Extended coverage) rather than
relying on the library default, and spot-check rendering with a name
containing at least one diacritic (é, ü) and the £ symbol during
implementation, not just in the happy-path ASCII test fixture.
**Warning signs:** A generated PDF for "Renée Müller" or a UK salary/day-rate
context using £ shows a box, blank space, or wrong glyph where the character
should be.

### Pitfall 4: Font loaded via network fetch times out or races render on cold start
**What goes wrong:** `Font.register({ src: 'https://...' })` initiates an
async download; `renderToBuffer()` can be called before that download
resolves, and Vercel cold starts add latency that makes the race more likely
to lose, or the outbound fetch may be blocked/slow entirely.
**Why it happens:** No built-in "await font ready" API; documented,
recurring community pitfall specific to serverless deployment.
**How to avoid:** Vendor the TTF file into the repo and load via
`fs.readFileSync(path.join(process.cwd(), ...))`, never a URL — see Pattern
2 above. Confirm the font file survives Next.js output file tracing into the
deployed function bundle (verify on a Vercel preview, not just local build).
**Warning signs:** Local dev works fine (warm filesystem, no timeout
pressure); production intermittently throws or silently falls back to a
default font.

### Pitfall 5: Salary fields accidentally leak onto a client-facing document
**What goes wrong:** `candidates.salary_current_estimate` /
`salary_expectation` are real, present columns that are easy to
absent-mindedly include "while we're in there" building the template, since
they sit right next to the fields that DO belong (seniority, years
experience).
**Why it happens:** Not explicitly called out as excluded in BCV-02's
requirement text (only lists identity/headline/skills/work-history/
education) — an implementer scanning the `candidates` row shape could
plausibly assume "more data = more useful CV."
**How to avoid:** Treat the BCV-02 field list as an allowlist, not a
starting point to add to. Salary expectation specifically is commercially
sensitive negotiating information that should never appear on a document
handed to the client.
**Warning signs:** A generated PDF shows a salary figure anywhere.

### Pitfall 6: Orphaned Storage objects on regeneration or a failed generate
**What goes wrong:** BCV-06 requires "no orphaned files" on regeneration; a
naive delete-then-write ordering leaves the candidate with NO branded CV
(worse than stale) if the write step fails after the delete succeeds, while
a naive write-without-cleanup ordering leaves the OLD Storage object
permanently orphaned (a real cost + a latent GDPR-erasure gap, mirroring the
exact class of bug `deleteAllOrgStorage`'s header comment already documents
as a known risk pattern in this codebase).
**Why it happens:** Two operations (Storage write, DB row update) cannot be
transactional together.
**How to avoid:** Write-new-then-delete-old ordering (upload the new PDF to
a fresh path, update the row to point at it, THEN best-effort remove the old
object) — mirrors the "storage-first" discipline already established
elsewhere in this codebase, adapted so the *new* copy is never at risk, only
the stale one.
**Warning signs:** A candidate with multiple branded-CV Storage objects
under their prefix but only one DB row pointing at one of them.

### Pitfall 7: Assuming generation needs Inngest because "it's a background job"
**What goes wrong:** Every other multi-step candidate-page action in this
codebase that isn't instant (CV parse, match scoring, voice-note transcribe)
goes through Inngest, which could lead an implementer to reflexively route
branded-CV generation through Inngest too — adding async polling UI
(`ScoreAllButton`-style) for an operation that's actually sub-second.
**Why it happens:** Pattern-matching on "codebase convention" without
checking WHY those other actions are async (they call Claude/Voyage/Whisper,
which can take seconds; this phase has zero AI calls by requirement).
**How to avoid:** Generate synchronously in the Server Action; return the
result directly; no polling, no Inngest event, no "started" toast — a "done"
toast, because it actually is done by the time the action returns.
**Warning signs:** A branded-CV feature with a spinner that polls for up to
90 seconds for what should be a sub-2-second operation.

## Code Examples

### Rendering to a Buffer (Node, server-side)
```typescript
// Source: react-pdf.org (server-side usage pattern)
import { renderToBuffer } from '@react-pdf/renderer'

const pdfBuffer: Buffer = await renderToBuffer(<BrandedCvDocument {...props} />)
```

### Image embedding from a Storage-fetched Buffer (no filesystem, no URL fetch at render time)
```typescript
// Source: react-pdf.org/images (Buffer source form) + this project's existing
// Storage read pattern (createSignedUrl / storage.download elsewhere in the codebase)
const { data: logoBlob } = await supabase.storage.from('org-logos').download(logoPath)
const logoBuffer = logoBlob ? Buffer.from(await logoBlob.arrayBuffer()) : null

// In the template component:
{logoBuffer ? <Image src={logoBuffer} style={styles.logo} /> : <Text style={styles.wordmark}>{org.name}</Text>}
```

### PNG/JPEG magic-byte sniff (mirrors `src/lib/cv/file-signature.ts`)
```typescript
// Source: pattern mirrored from src/lib/cv/file-signature.ts (this repo)
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

function sniffImageType(bytes: Uint8Array): 'png' | 'jpeg' | 'unknown' {
  if (startsWithMagic(bytes, PNG_MAGIC)) return 'png'
  if (startsWithMagic(bytes, JPEG_MAGIC)) return 'jpeg'
  return 'unknown'
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side PDF via headless Chromium screenshot/print (`page.pdf()`) | Declarative React-component PDF generation (`@react-pdf/renderer`) for template-fill documents | Long-standing split — Chromium print remains the right tool for "print an existing HTML page exactly as rendered," not for "generate a new document from structured data" | This phase is squarely the latter case |
| `pdf-lib` for programmatic PDF construction | Maintained forks (`@cantoo/pdf-lib`, `@pdfme/pdf-lib`) now used *underneath* higher-level tools (e.g. `@pdfme/generator` depends on `@pdfme/pdf-lib`) rather than used directly for layout | Upstream `pdf-lib` stalled ~2022 | Confirms low-level libraries are now consumed as an implementation detail of higher-level generators, not chosen directly for document authoring |
| Vercel serverless functions capped near 50 MB / 10s (Hobby-era assumptions) | Fluid Compute defaults: 300s duration (Hobby & Pro), up to 800s max on Pro; 250 MB uncompressed bundle (5 GB via "Large Functions" beta) [CITED: vercel.com/docs/functions/limitations, `last_updated: 2026-07-01`] | Ongoing Vercel platform evolution | Removes "will Puppeteer even fit" as a hard blocker — it's a heaviness/cold-start tradeoff now, not a wall — but doesn't change the recommendation, since react-pdf is strictly lighter and faster for this document type regardless |

**Deprecated/outdated:**
- Treating `pdf-lib` (unscoped, original package) as an actively-maintained
  choice — it is not; use a maintained fork if `pdf-lib`'s low-level API is
  ever genuinely needed for a different problem (e.g. stamping a signature
  onto an existing PDF), not for this phase's flowing-document generation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Address" in CONTEXT.md's locked BCV-03 decision refers only to the `candidates.location` field (city/region), and this research recommends KEEPING `location` on the branded copy (Reading B) rather than stripping it, pending founder confirmation | §Contact-Stripping Correctness | If the founder actually meant "strip location too," a shipped template would leak more identifying context than intended — low severity (city-level, not a literal contact route) but still a locked-decision mismatch that must be confirmed, not assumed silently |
| A2 | `@react-pdf/renderer` is the correct recommendation despite slopcheck being unavailable to run in this research session | §Standard Stack, §Package Legitimacy Audit | Low — manually cross-verified via `npm view` (version, peerDeps, license, postinstall=none, repo linkage) and official docs (react-pdf.org); still gated behind `checkpoint:human-verify` per protocol |
| A3 | A **new table** (`candidate_branded_cvs`) is the right storage model rather than a flagged `candidate_cvs` row | §Storage Modelling Options | Medium — this is explicitly "Claude's Discretion" per CONTEXT.md, so the planner may choose differently; if a flagged-row approach is chosen instead, `cv-files-panel.tsx`, `nextCVVersion()`, and `parsing_status` semantics all need audited, not just the new-table migration |
| A4 | The logo should live in a **new** `org-logos` Storage bucket rather than the existing `cvs` bucket | §Branding Settings & Logo Upload | Low-medium — if reused under `cvs` instead, the path convention needs a one-off top-level exception (`{org}/logo.png` vs the `{org}/{candidate}/...` two-level convention everywhere else), and `ORG_STORAGE_BUCKETS` would NOT need a new entry (already covers `cvs`) |
| A5 | Salary fields (`salary_current_estimate`, `salary_expectation`) should be excluded from the template entirely | §Repo Integration — Parsed Data Fields, Pitfall 5 | Low — this is a reasonable default (BCV-02's field list doesn't mention salary), but was not an explicit locked decision either; confirm during template design review |

## Open Questions (RESOLVED)

> Both questions below were settled by founder sign-off on 2026-08-12 and are
> retained for the reasoning trail only. Neither is open.

1. **[RESOLVED — UNGATED]** Should the "Generate branded CV" action be gated
   behind `requireEntitledOrg()`?
   - What we know: every other candidate-page mutation (`uploadCVAction`,
     `retryParseAction`) and the branding-settings mutation
     (`updateBrandingAction`) are gated, even the ones with zero AI spend —
     the gate's stated purpose in this codebase is "block CRM mutations for
     non-entitled orgs," not narrowly "block AI spend."
   - What's unclear: whether the founder considers a purely-local,
     zero-cost, zero-AI generation action a "CRM mutation" in the same
     sense, or whether it should be available even to un-entitled orgs (like
     the CV-file View route deliberately is NOT gated, reasoning "withholding
     a customer's own file behind a billing state is a data-hostage
     posture").
   - Recommendation at research time: gate it (consistent with every other
     *mutation*, as opposed to the *read* path which is deliberately ungated).
   - **RESOLUTION (founder, 2026-08-12): OVERRIDDEN — do NOT gate it.** The
     action stays ungated by billing state, matching the no-data-hostage stance
     documented on `cv-file/[cvId]/route.ts`: a customer's own candidate data
     is not withheld behind a billing state, and this action spends nothing
     external that a gate would protect. Auth + RLS remain the only gates.
     Implemented in plan 08-07.

2. **[RESOLVED — SINGLE CURRENT COPY]** Does the branded PDF need its own
   "version" concept at all, or is "regenerate replaces" (BCV-06) sufficient
   forever?
   - What we know: BCV-06 explicitly wants regeneration to supersede
     cleanly with no duplicate rows — a single-current-copy model.
   - What's unclear: whether a future phase might want to keep a history of
     branded copies (e.g. "the version sent to Client X on this date"),
     which would need the schema recommended here (`unique (candidate_id)`)
     revisited.
   - Recommendation: build for BCV-06's stated single-current-copy
     requirement now; the new-table design doesn't foreclose adding
     versioning later (it would just relax the unique constraint), unlike
     the flagged-`candidate_cvs`-row option which would have already spent
     its versioning column on the wrong semantics.
   - **RESOLUTION (2026-08-12): single current copy, as recommended.** Plan
     08-01's migration enforces it with `unique (candidate_id)`; plan 08-07
     implements regeneration as write-new-then-delete-old against that
     constraint. Adding history later remains a constraint relaxation, not a
     redesign.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime (Vercel Serverless, Node runtime — not Edge) | `@react-pdf/renderer`'s `renderToBuffer`, `fs`-based font loading | ✓ (existing route handlers already default to Node runtime; only `icon.tsx`/`apple-icon.tsx` use Edge) | Vercel default Node runtime | n/a — this feature must NOT be marked `export const runtime = 'edge'` |
| Vercel function bundle size headroom | Bundling `@react-pdf/renderer` (~294 KB unpacked core + ~13 small sub-deps) + two vendored TTF files (a few hundred KB each) | ✓ | Current limit 250 MB uncompressed [CITED: vercel.com/docs/functions/limitations] | n/a — negligible fraction of the limit, unlike the rejected Chromium alternative |
| Vercel function max duration | Synchronous PDF generation inside a Server Action | ✓ | 300s default on both Hobby and Pro under Fluid Compute [CITED: vercel.com/docs/functions/limitations] | n/a — generation is expected to complete in well under 1s; this headroom is not a constraint either way |
| Supabase Storage (`cvs` bucket, existing) | Storing the generated PDF | ✓ (already provisioned, migration `20260517204501`) | — | n/a |
| Supabase Storage (new `org-logos` bucket, if that option is chosen) | Storing the uploaded logo | ✗ — needs a new migration | — | No fallback needed; this is a planned, founder-approved schema addition, not a missing external dependency |
| pip/pip3 (for slopcheck) | Package Legitimacy Audit tooling | ✗ — not installed on this research host | — | Graceful degradation already applied: package tagged `[ASSUMED]`, planner adds `checkpoint:human-verify` |

**Missing dependencies with no fallback:** none — the one "missing" item
(the `org-logos` bucket) is a planned schema addition requiring founder
sign-off on the migration, not an environment gap.

**Missing dependencies with fallback:** slopcheck unavailability, handled
via the standard graceful-degradation protocol (see Package Legitimacy Audit).

## Security Domain

> `security_enforcement` is absent from `.planning/config.json` → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (indirect) | Existing `auth.getUser()` + middleware guard, unchanged by this phase — new route/action both re-check per the established defence-in-depth pattern |
| V3 Session Management | no | Not touched by this phase |
| V4 Access Control | yes | RLS via `current_organization_id()` on the new table + Storage bucket policy quad, identical shape to `candidate_cvs`/`cvs` bucket; cross-tenant candidate id resolves to the same bare 404 the CV-file route already uses (no existence oracle) |
| V5 Input Validation | yes | Logo upload: magic-byte sniff (not client MIME trust), size cap, format allowlist (PNG/JPEG, explicitly reject SVG) — mirrors CVI-08's existing CV-upload hardening |
| V6 Cryptography | no | No new crypto surface — signed URLs reuse the existing Supabase Storage signing mechanism with the existing 60s TTL constant |
| V7 Error Handling & Logging | yes | PII-free Sentry capture on any Storage/render failure (mirror `cv-file/[cvId]/route.ts`'s `Sentry.captureException(new Error(err.name), { tags: {...} })` pattern — never log candidate name/email/phone/storage_path) |
| V13 API/Web Service | n/a | No new public/webhook endpoint — the new route handler sits inside the existing `(app)` authenticated route group |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant candidate-id enumeration via the new branded-CV route | Information Disclosure | RLS-scoped read + bare 404 for both "not found" and "wrong tenant" — exact mirror of the existing CV-file route's tenancy-hiding discipline |
| Spoofed `Content-Type`/extension on logo upload (SVG mislabelled as PNG, or an executable disguised as an image) | Tampering | Magic-byte sniff before any Storage write, mirroring `assertUploadableCV`/`sniffFileType` in `src/lib/cv/file-signature.ts` |
| Contact-stripping bypass via a stale/cached branded PDF after a candidate's email/phone changes | Information Disclosure (of a subtler kind — actually the INVERSE: a stale branded copy could still be technically correct since it never HAD contact fields, but could go stale on OTHER content) | BCV-01's on-demand-only rule already addresses staleness generally; no additional stripping-specific mitigation needed since contact fields are excluded from the template's data-read entirely, not filtered post-hoc from an already-fetched blob |
| Orphaned/leaked signed URL from a cached 302 `Location` header | Information Disclosure | `cache-control: no-store` on the redirect response, identical to the existing CV-file route |
| Logo-upload DoS via oversized file | Denial of Service | Size cap enforced before any Storage write, mirroring `MAX_CV_BYTES` |

## Sources

### Primary (HIGH confidence)
- `npm view @react-pdf/renderer version / time.modified / peerDependencies / dependencies / scripts.postinstall / repository.url / license` — this research session
- `npm view pdf-lib / @cantoo/pdf-lib / @pdfme/generator / puppeteer-core / @sparticuz/chromium version / time.modified / dist.unpackedSize` — this research session
- https://api.npmjs.org/downloads/point/last-week/{package} — weekly download counts, this research session
- https://react-pdf.org/fonts — official docs, `Font.register` API, TTF/WOFF-only constraint, variable-font limitation
- https://react-pdf.org/components — official docs, `Image` component source types (URL/Buffer/data-buffer, JPG/PNG only)
- https://vercel.com/docs/functions/limitations (`last_updated: 2026-07-01`) — memory/duration/bundle-size limits
- Direct repo reads: `src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts`, `src/app/(app)/candidates/[id]/actions.ts`, `src/lib/db/candidate-cvs.ts`, `src/lib/db/audit.ts`, `src/lib/admin/org-erasure.ts`, `src/lib/cv/file-signature.ts`, `src/app/(app)/settings/branding/*`, `src/app/(app)/settings/organization-form.tsx`, `src/app/(app)/settings/schema.ts`, `src/app/(app)/settings/actions.ts`, `src/app/(public)/apply/[orgSlug]/page.tsx`, `src/types/database.ts`, `supabase/migrations/20260513152244_phase1_domain_schema.sql`, `supabase/migrations/20260517204501_storage_cvs_bucket.sql`, `supabase/migrations/20260603120100_delete_candidate_rpc.sql`, `supabase/migrations/20260518202000_organizations_logo_url.sql`, `supabase/migrations/20260604120000_phase5_saas_billing.sql`, `next.config.ts`, `package.json`

### Secondary (MEDIUM confidence)
- WebSearch: `@sparticuz/chromium` cold-start/bundle-size commentary (cross-checked against directly-measured `dist.unpackedSize` via `npm view`, which confirmed the ~70 MB figure)
- WebSearch: `pdf-lib` maintenance-status summary (cross-checked against directly-measured `time.modified` via `npm view`, which confirmed the 2022 staleness)
- GitHub issue titles/summaries (diegomura/react-pdf #2277, #780, #1771, #856, #2717) — confirms a real, recurring class of Unicode/glyph rendering issues exists; exact root causes not independently re-verified beyond the issue summaries

### Tertiary (LOW confidence)
- WebSearch summarisation conflating the npm package `react-pdf` (a PDF *viewer*, by wojtekmaj) with `@react-pdf/renderer` (a PDF *generator*, by diegomura) in one query's results — explicitly disambiguated in this document; do not trust "react-pdf" mentions without the `@react-pdf/renderer` scope in any future research pass
- A WebSearch claim that "Vercel increased the 250MB function bundle limit to 5GB on June 30, 2026" — the 5GB figure is real but gated behind the "Large Functions" beta + Fluid Compute + `VERCEL_SUPPORT_LARGE_FUNCTIONS` opt-in, not a blanket limit increase; corrected against the official docs fetch above (§State of the Art)

## Metadata

**Confidence breakdown:**
- Standard stack (PDF library choice): HIGH — cross-verified via `npm view` (registry ground truth) and official docs (react-pdf.org), independent of any single WebSearch summary; slopcheck unavailability is the only reason it's not tagged `[VERIFIED]`
- Architecture / storage modelling: HIGH for the repo-integration facts (erasure sweep code, RLS pattern, route-handler precedent — all read directly from source); MEDIUM for the new-table-vs-flagged-row recommendation, since it's explicitly delegated to planner discretion in CONTEXT.md
- Contact-stripping scope: MEDIUM — the structured-field stripping (email/phone) is HIGH confidence; the "address"/`location` question is an open ambiguity flagged for founder confirmation, not resolved here
- Pitfalls: HIGH for the two repo-specific findings (duplicate logo_url form, salary-field leak risk) since both are directly observed in source; MEDIUM for the font/Unicode pitfalls, which rest on GitHub issue summaries rather than a from-scratch reproduction

**Research date:** 2026-08-12
**Valid until:** ~30 days for the repo-integration findings (stable until the codebase changes); ~14 days for the specific `@react-pdf/renderer` version pin (fast-releasing package, publishes patches every few days) — re-run `npm view @react-pdf/renderer version` before planning if this research is more than two weeks old
