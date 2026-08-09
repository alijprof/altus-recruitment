# Phase 6: CV Intake Battle-Test & Hardening - Research

**Researched:** 2026-08-09
**Domain:** Document parsing (PDF/DOCX) → LLM structured extraction → Postgres write path; fixture corpora and integration-test harness design
**Confidence:** HIGH for the write-path failure mechanics (empirically reproduced in this session against a real local Supabase stack); MEDIUM for which of the six confirmed mechanisms produced the specific 12 production failures (the decisive artefact — Claude's output for those files — was never persisted; §Decisive Experiment specifies how to obtain it).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Definition of "works" (founder's requirement, operationalised)**
- Tier 1 — MUST PARSE: text-based PDF (single/multi-column, tables, headers/footers, hyperlinks, embedded images), DOCX (templates, tables, text boxes, headers/footers, UK/EU/unicode names, smart quotes, emoji), LinkedIn "Save to PDF" exports, files up to the size cap, filenames with spaces/unicode.
- Tier 2 — MUST FAIL FAST + HONEST (before or at upload where possible, never a generic message): scanned/image-only PDF (existing message), password-protected/encrypted PDF, corrupt/truncated files, zero-byte, wrong-extension (docx renamed .pdf and vice versa), legacy .doc, RTF/ODT/Pages/TXT (unsupported — say so at upload, not 3 minutes later), oversized files.
- Tier 3 — NEVER: generic "Parsing failed" with no cause; silent 'complete' with empty profile; a retry button that cannot succeed.

**Harness requirements**
- Permanent fixture corpus checked into the repo (tests/fixtures/cv-corpus/) — synthetic documents only, ZERO real candidate PII. Generate programmatically where possible (scripts committed) so the corpus is auditable and extendable.
- Layer 1 (fast, CI): extraction unit tests — extractTextFromBuffer against every fixture.
- Layer 2 (integration): full parse-cv pipeline against fixtures with Claude STUBBED (recorded/synthetic extracted_data payloads incl. hostile ones: `\u0000`, lone surrogates, 100k-char fields, deeply weird unicode) exercising the REAL DB write path against local Supabase (project has supabase CLI + Docker config) — this is the layer that would have caught the 12.
- Layer 3 (live spot-check, small): a handful of representative fixtures end-to-end on prod in the FOUNDER'S OWN org (AJ) with real Haiku calls (pennies), cleaned up after. NEVER against the customer org.
- The 12 failed prod rows: after the fix ships, retry them via the existing retry path and verify all 12 complete (their extracted text already proved Claude-parseable) — this is the acceptance test that closes the customer's complaint.

**Fix policy**
- Sanitisation belongs at the write boundary (defence in depth: sanitise extracted text before Claude AND sanitise Claude output before DB write) — never lose meaningful content, strip/replace only illegal-for-Postgres sequences.
- Unsupported formats get UPLOAD-TIME validation (client accept= is already right; add server-side sniffing + immediate honest message) rather than async failure.
- Adding NEW format support (e.g. legacy .doc via a conversion lib) is IN SCOPE ONLY if a Tier-1-worthy need is proven; default is honest Tier-2 rejection. New dependencies require the usual justification gate.

### Claude's Discretion
- Corpus size/composition beyond the named cases; fixture generation tooling choices (within existing deps + devDeps where possible); how to stub Claude in layer 2; exact sanitisation implementation.

### Deferred Ideas (OUT OF SCOPE)
- (None listed in CONTEXT.md.)

### Constraints carried from project rules
- Migrations append-only, FILES ONLY, founder pushes manually. NOTE: two pending unapplied migrations already exist for this pipeline (parse_error_detail, record_audit dedupe) — the phase must remain correct whether or not they are applied, and should list them in its founder handoff if still unapplied.
- pnpm only; no new deps without justification; TypeScript strict; no PII in fixtures, Sentry, or committed files; mandatory /gsd-code-review + pre-smoke pipeline before founder UAT; live-prod data safety rules (read-only preflights, founder sign-off for anything destructive).
</user_constraints>

---

## Summary

I reproduced the production failure signature end-to-end in this session against a **real local Supabase stack** (Postgres 17.6 + PostgREST v14.5 + supabase-js, all migrations applied). **Six distinct payload classes** in Claude's tool-use output cause `write-extracted` to fail with exactly the observed signature: a `{ok:false, code:'internal'}` from `updateCandidateCVParse` / `markCandidateFieldsFromCV`, a plain `Error` thrown inside `step.run`, three Inngest retries against the already-memoised `claude-parse` step (hence exactly one `cv_parse` `ai_usage` row per failure), then `onFailure` writing the generic message. All six are deterministic per file. `[VERIFIED: local Supabase probe, this session]`

The single widest funnel is the **`candidate_cvs.extracted_data` jsonb write**, which carries Claude's *entire* output — every string value and every object key. A single `U+0000` or a single unpaired UTF-16 surrogate **anywhere** in that object kills the write. NUL yields Postgres `22P05 "unsupported Unicode escape sequence" / "\u0000 cannot be converted to text."`; a lone surrogate is rejected one layer earlier by PostgREST as `PGRST102 "Empty or invalid json"`. `[VERIFIED]`

The 06-CONTEXT leading hypothesis is **substantially confirmed, with one correction**. I verified both emission mechanisms it needs: **mammoth emits raw `U+0000` straight through** from a DOCX `<w:t>` (both as a raw byte and as an `&#x0;` character reference), and **unpdf/PDF.js emits raw `U+0000`** when a font's `ToUnicode` CMap maps a glyph to `<0000>` — a real-world artefact of subset/broken font embedding. `normaliseWhitespace()` does not strip it (`cv-extract.ts:30` only collapses `[ \t]+` and `\n{3,}`), and it survives the 60k slice and the JSON round-trip into the Anthropic request body intact. The **correction**: unpdf does *not* emit NUL from the simpler mechanism (a `\000` octal escape inside a `Tj` literal with a standard Type1 font) — that gets normalised to a space — so a fixture built that way will not reproduce the bug. The ToUnicode-CMap route is the one that works. `[VERIFIED]`

The one link in that chain I could not verify without spending real API calls is whether **Claude echoes the NUL back** in its tool output. That is why §Decisive Experiment exists. It also matters because two *other* confirmed classes need no NUL at all and fit the evidence equally well: **`years_experience numeric(4,1)` overflows at any value ≥ 1000** (the tool schema declares `years_experience_total: {type:'number'}` with **no description and no bounds** — `claude.ts:273` — so a Haiku mis-read of a graduation year is an instant `22003`), and **`salary_current_estimate`/`salary_expectation` are `integer` columns written from an unvalidated `as number` cast** (`candidate-cvs.ts:296-297`), so a string, a float, an object or a > 2^31 value is `22P02`/`22003`.

**Primary recommendation:** Fix all six classes at two choke points — a zod-validating coercion boundary in `parseCV()` (claude.ts) and a recursive `sanitiseForPostgres()` applied inside `updateCandidateCVParse` + `markCandidateFieldsFromCV` (candidate-cvs.ts, which also covers the reconciler and `acceptCVFieldsAction`) — and prove it with a layer-2 vitest suite against a real local Supabase, which I have verified runs in 496 ms in this environment. Build fixtures with **zero new dependencies**: Playwright's already-installed Chromium `page.pdf()` for realistic PDFs, the already-in-tree `jszip` for DOCX, and hand-rolled raw bytes for the pathological tiers.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Format/type acceptance (recruiter upload) | Frontend Server (Server Action `uploadCVAction`) | Browser (`accept=`, advisory only) | Server sees the bytes; can sniff magic numbers before touching Storage |
| Format/type acceptance (apply form) | Background job (`parse-cv`) | Frontend Server (`confirmApplyAction`) | Bytes go browser→Storage via signed URL; the server **never sees them at submit time** (`apply/[orgSlug]/actions.ts:177`), so honest typing must happen after download |
| Text extraction | Background job (`cv-extract.ts` in Inngest) | — | unpdf/mammoth are Node-only, in-memory, and can exceed 2 s |
| LLM structured extraction | Background job (`claude.ts` `parseCV`) | — | CLAUDE.md: no synchronous Claude in a request handler |
| **Output shape validation (zod coercion)** | **AI wrapper (`claude.ts`)** | — | The single producer of `ParsedCV`; validating here fixes every consumer at once |
| **Postgres-legality sanitisation** | **DB helper layer (`candidate-cvs.ts`)** | AI wrapper (pre-Claude, defence in depth) | The DB layer is the last choke point shared by parse-cv, the reconciler and `acceptCVFieldsAction` |
| Failure-message honesty | Background job (`parse-cv.ts` + `parse-messages.ts`) | Browser (`cv-review-panel.tsx` predicates) | Message literals are already centralised in `parse-messages.ts`; keep that invariant |
| Fixture generation | Dev tooling (committed scripts, `tests/fixtures/cv-corpus/`) | — | Must be auditable, PII-free, reproducible |

---

## Root-Cause Findings

### Verified failure matrix — real supabase-js → PostgREST v14.5 → Postgres 17.6

Probe method: a real local Supabase stack (`supabase start`, all 80 migrations applied), a service-role `supabase-js` client, one `UPDATE ... .select('id').single()` per payload — i.e. the exact call shape of `updateCandidateCVParse` (`candidate-cvs.ts:185-191`) and `markCandidateFieldsFromCV` (`candidate-cvs.ts:483-486`). `[VERIFIED: local Supabase probe, 2026-08-09]`

| # | Payload | Result | Code | Message |
|---|---------|--------|------|---------|
| 1 | `extracted_data` jsonb, **NUL in a string value** | ❌ | `22P05` | `unsupported Unicode escape sequence` / detail `\u0000 cannot be converted to text.` |
| 2 | `extracted_data` jsonb, **NUL in an object KEY** | ❌ | `22P05` | same |
| 3 | `extracted_data` jsonb, NUL nested in `work_history[0].summary` | ❌ | `22P05` | same |
| 4 | `extracted_data` jsonb, **lone HIGH surrogate** `\uD83D` | ❌ | **`PGRST102`** | `Empty or invalid json` (rejected by PostgREST, never reaches Postgres) |
| 5 | `extracted_data` jsonb, **lone LOW surrogate** `\uDE00` | ❌ | `PGRST102` | `Empty or invalid json` |
| 6 | `text` column (`parse_error`) with NUL | ❌ | `22P05` | `\u0000 cannot be converted to text.` |
| 7 | `text` column with lone surrogate | ❌ | `PGRST102` | `Empty or invalid json` |
| 8 | `candidates.current_company` with NUL | ❌ | `22P05` | same |
| 9 | `text[]` (`skills`) **element** containing NUL | ❌ | `22P05` | same |
| 10 | `salary_current_estimate: "£45,000"` | ❌ | `22P02` | `invalid input syntax for type integer: "£45,000"` |
| 11 | `salary_current_estimate: 45000.5` | ❌ | `22P02` | `invalid input syntax for type integer: "45000.5"` |
| 12 | `salary_current_estimate: 3000000000` | ❌ | `22003` | `value "3000000000" is out of range for type integer` |
| 13 | `salary_expectation: {min,max}` or `[45000]` | ❌ | `22P02` | `invalid input syntax for type integer: "{...}"` |
| 14 | **`years_experience: 2015`** | ❌ | `22003` | `numeric field overflow` / detail `A field with precision 4, scale 1 must round to an absolute value less than 10^3.` |
| 15 | `years_experience: 1000` | ❌ | `22003` | same (**1000 is the cliff**) |
| 16 | `years_experience: "10+"` | ❌ | `22P02` | `invalid input syntax for type numeric: "10+"` |
| 17 | `skills` as a 2-D array `[["a","b"],["c"]]` | ❌ | `22P02` | `malformed JSON array` |
| 18 | `parsing_status: 'done'` (bad enum) | ❌ | `22P02` | `invalid input value for enum cv_parsing_status` |
| 19 | `salary_current_estimate: "45000"` (numeric string) | ✅ | — | coerced silently |
| 20 | `years_experience: 999.9` / `12.75` | ✅ | — | 12.75 rounds to 12.8 silently |
| 21 | `skills` as array of **objects** `[{name:'Python'}]` | ✅ | — | **silently stored as the JSON text `{"name":"Python"}`** — data corruption, not a failure |
| 22 | `skills` as array of numbers / with `null` elements | ✅ | — | silently coerced |
| 23 | **1.1 MB** value in `current_company`, `skills[0]`, or a ~2 MB `extracted_data` | ✅ | — | **disproves the "payload too large for a column" hypothesis** |
| 24 | Emoji, ZWJ, astral plane, RTL, CJK, diacritics, smart quotes, soft hyphen, BOM | ✅ | — | all legal |
| 25 | Control chars `U+0001`–`U+001F` **other than NUL** (incl. `\v`, `\x01`) | ✅ | — | **only NUL is illegal** |

### JavaScript-level failures in the same step (no DB involved)

Run against the **real** `markCandidateFieldsFromCV` via vitest: `[VERIFIED: vitest + local Supabase, this session]`

| Payload | Outcome |
|---------|---------|
| `name` returned as an array/number instead of a string | `TypeError: (args.parsed.name ?? "").trim is not a function` — thrown **uncaught** out of the helper (`candidate-cvs.ts:440`) |
| `work_history` contains a `null` element | `TypeError: Cannot read properties of null (reading 'role')` (`candidate-cvs.ts:315`) |

Both propagate out of `step.run('write-extracted')` → Inngest retries → `onFailure` → generic message. Identical observable signature to a DB rejection.

### Why every one of these produces exactly the observed production evidence

Trace through `parse-cv.ts:326-357`:

1. `updateCandidateCVParse` catches the PostgREST error, `Sentry.captureException`s it, returns `{ok:false, code:'internal'}` (`candidate-cvs.ts:210-215`). The step then `throw new Error('failed to write extracted data')` (`parse-cv.ts:335`) — **the specific SQLSTATE is discarded before it reaches the thrown message**. Same for the merge (`parse-cv.ts:355`).
2. That's a plain `Error` inside `step.run`, so Inngest retries the *step*. `claude-parse` (`parse-cv.ts:315`) is already memoised → **no second Claude call** → exactly one `cv_parse` `ai_usage` row per upload, and **zero** `cv_parse_failed` rows. ✅ matches evidence exactly.
3. Retries exhaust → `onFailure` → `markCvFailed(FAILED_USER_MESSAGE, preserveExistingMessage:true)` (`parse-cv.ts:164-172`). Nothing wrote an honest message earlier in this invocation, so the **generic** copy lands. ✅
4. `parseErrorDetail` would carry `${error.name}: ${status}` = `"Error: undefined"` — useless even once migration `20260804120000` lands, because the SQLSTATE was already thrown away at step 1. **This is a real gap the phase should close.**
5. Deterministic on retry: the same bytes → the same text → Haiku (near-)deterministically returns the same problematic value. ✅ matches "0 of 12 ever got a later successful parse".

### Ranked root-cause candidates, with a disconfirming test for each

| Rank | Candidate | Fit with evidence | Disconfirming test |
|------|-----------|-------------------|--------------------|
| **1** | `U+0000` reaches `extracted_data` jsonb (Claude echoes a NUL that mammoth/unpdf put in the input text) | Explains both formats; NUL emission **verified** in both libraries; widest funnel (whole Claude output) | Re-extract text from the 12 prod files and grep for `\u0000`. **If zero of 12 contain a NUL, this is dead.** |
| **2** | `years_experience` ≥ 1000 (`numeric(4,1)` overflow) | Format-agnostic; the field has **no description and no bounds** in the tool schema (`claude.ts:273`), the weakest-specified field in the whole tool; a graduation year is the obvious mis-read | Replay Haiku on the 12 and check `years_experience_total`. Also: this only fires when `candidates.years_experience` is currently NULL — check whether the 12 candidates had it set. |
| **3** | `salary_*` type/range violation (string, float, object, > 2^31) | Format-agnostic; zero runtime validation (`candidate-cvs.ts:296-297` is a bare `as number` cast) | Replay Haiku on the 12 and inspect `salary_current_estimate` / `salary_expectation` types. |
| **4** | Lone UTF-16 surrogate in Claude's output → `PGRST102` | Format-agnostic; would arise from truncated-emoji tokens | Same replay: scan the parsed object for `/[\uD800-\uDBFF](?![\uDC00-\uDFFF])\|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/`. |
| **5** | `name` / `work_history[]` shape violation → `TypeError` | Format-agnostic; `toParsedCVSubset` does zero runtime validation | Same replay: `typeof parsed.name !== 'string'` or `work_history.some(x => x == null)`. |
| **6** | `max_tokens: 2048` truncation of the tool_use block (`claude.ts:320`) | Fits "long/dense CV, deterministic" — but a truncated tool input most likely arrives as `{}`, which writes **successfully** as `complete` with an empty profile (a **Tier-3** bug, not a failure) | Replay and check `response.stop_reason === 'max_tokens'`. Worth checking regardless: 2048 output tokens is tight for a dense CV with long `work_history[].summary` strings. |

### DISPROVEN / eliminated

- ❌ **"Payload too large for a column."** 1.1 MB text values, 1.1 MB array elements and ~2 MB jsonb all wrote cleanly. `[VERIFIED]`
- ❌ **Duplicate-email unique violation.** `candidates_email_idx` is a **plain** btree `(organization_id, email)`, not unique; `candidates` has **no** CHECK constraints and only FK/PK constraints. `[VERIFIED: local schema introspection]`
- ❌ **Corrupt / truncated / zero-byte / wrong-extension files.** These all throw in `extract-text`, which runs **before** `claude-parse` — so they would produce **zero** `cv_parse` `ai_usage` rows. The 12 each have one. They cannot be corrupt files. `[VERIFIED: parse-cv.ts:279-297 ordering + library probe]`
- ❌ **Scanned/image-only PDFs.** Ruled out by the `MIN_EXTRACTED_CHARS` branch running before Claude (`parse-cv.ts:299`), and by file sizes.
- ❌ **Non-NUL control characters, emoji, RTL, smart quotes, astral-plane glyphs.** All write cleanly. Chasing "weird unicode" generically is a dead end — **only** NUL and lone surrogates matter.
- ⚠️ **Correction to the CONTEXT hypothesis:** it says "mammoth/unpdf emitting control characters". Only **NUL** is illegal for Postgres; `U+0001`–`U+001F` are fine. And unpdf will **not** emit a NUL from a `\000` octal escape in a `Tj` string with a standard font (PDF.js normalises it to a space) — only the ToUnicode-CMap route works. A fixture built the naive way will silently fail to reproduce the bug. `[VERIFIED]`
- ⚠️ **The CONTEXT hypothesis names error class "22P05/22021".** `22P05` is correct; I saw no `22021` (`character_not_in_repertoire`) in any probe. Lone surrogates surface as **`PGRST102`**, a PostgREST-layer code with no SQLSTATE at all — an error-classification helper that only matches SQLSTATEs would miss half the class.

### Decisive Experiment (recommend as Wave 0 of the plan)

A **read-only forensic replay** against production settles ranks 1–6 in one pass, for pennies:

1. Service-role `select id, storage_path, mime_type from candidate_cvs where parsing_status='failed' and parse_error = <generic literal> and created_at >= '2026-08-05'` for the customer org. **No writes.**
2. Download each object from Storage (read-only), run `extractTextFromBuffer` locally, and report per file: byte length, char length, `U+0000` count, lone-surrogate count, `U+FFFD` count. **Zero AI cost.** If any file has a NUL → rank 1 confirmed for that file.
3. For files that come back clean, call `parseCV()` once each (12 × Haiku on ≤ 60 k chars ≈ a few pence) and run the returned object through a "would-Postgres-accept-this" validator that reproduces the matrix above. Print the exact offending field + rule per file. **Write nothing to prod.**
4. Also capture `stop_reason` to settle rank 6.

Output: a per-file root-cause table. This converts every `[ASSUMED]` in the ranking into a verified fact and gives the regression suite its real-world hostile payloads (PII-scrubbed before committing — capture field *shapes*, not values).

---

## Standard Stack

### Core — no new runtime dependencies required

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `unpdf` | ~1.6.2 (installed) | PDF → text | Already the decided stack; pure-JS PDF.js, Vercel-safe `[VERIFIED: package.json]` |
| `mammoth` | ~1.12.0 (installed) | DOCX → text | Already the decided stack `[VERIFIED: package.json]` |
| `zod` | ^4.4.3 (installed) | Runtime validation/coercion of Claude's tool output | Already a direct dependency and the project's validation idiom (`actions.ts` uses it throughout) `[VERIFIED: package.json]` |

### Supporting — fixture generation, all already present

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `@playwright/test` (Chromium) | ~1.60.0 devDep, `chromium-1223` browser downloaded | `page.pdf()` → realistic PDF fixtures | Tier-1 PDFs: multi-column (CSS `column-count`), tables, headers/footers, hyperlinks, embedded images, unicode/emoji `[VERIFIED: generated a 48 663-byte PDF and round-tripped it through unpdf this session]` |
| `jszip` | 3.10.1, present at `node_modules/jszip` (transitive via mammoth) | Build DOCX fixtures | Tier-1/Tier-2 DOCX: tables, unicode, and the hostile NUL/`&#x0;` variants `[VERIFIED: built a valid 2 103-byte DOCX and read it back with mammoth this session]` |
| Node `Buffer` / raw bytes | built-in | Hand-rolled pathological PDFs | Corrupt, truncated, zero-byte, encrypted-header, and the **ToUnicode-CMap NUL** reproduction `[VERIFIED: hand-rolled PDFs parsed and mis-parsed exactly as intended this session]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Playwright `page.pdf()` | `pdf-lib` (new devDep) | pdf-lib gives precise low-level control (and can produce encrypted/odd PDFs), but adds a dependency; Playwright already produces *more realistic* output (real Chromium layout engine, real font embedding/subsetting) with **zero** new deps. **Recommend Playwright.** |
| `jszip` promoted to explicit devDep | Hand-rolled ZIP writer via `node:zlib` (stored entries) | ~60 lines, zero deps, fully auditable — but jszip is already installed and is the library **mammoth itself uses to read DOCX**, guaranteeing round-trip fidelity. **Recommend promoting jszip** (downloads nothing new; makes a phantom dependency explicit, which is the correct hygiene fix). |
| Real local Supabase for layer 2 | High-fidelity fake that reproduces `22P05` | A fake would have to re-implement Postgres's NUL rules, PostgREST's JSON parser, `numeric(4,1)` rounding and int4 range. The real stack starts and runs here. **Recommend the real stack** (with a fast-fail skip when it's down). |
| — | `pdf-parse`, `pdfjs-dist` direct, `docx`, `officegen` | All redundant given the above; each adds supply-chain surface for no capability gain. |

**Installation (the only change recommended):**
```bash
pnpm add -D jszip   # already resolved at 3.10.1 in the lockfile via mammoth; this only makes it explicit
```

---

## Package Legitimacy Audit

**slopcheck could not be installed in this environment** (`pip`/`pip3` unavailable; `python3 -m pip` reports "No module named pip"). Per protocol, packages below are tagged `[ASSUMED]` and the planner should gate any *install* behind a `checkpoint:human-verify` task. Mitigating factor: the recommendation adds **no new package downloads** — `jszip` is already resolved in `pnpm-lock.yaml` and physically present at `node_modules/jszip`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `jszip@3.10.1` | npm | created 2013-09-11, last published 2025-03-14 | 40,177,178 / wk | github.com/Stuk/jszip | unavailable | **Approved** — already installed transitively via `mammoth`; promotion to explicit devDep downloads nothing `[VERIFIED: npm registry metadata + api.npmjs.org, 2026-08-09]` `[ASSUMED: legitimacy, slopcheck unavailable]` |
| `pdf-lib@1.17.1` | npm | created 2017-09-04, last published 2022-05-12 | 10,926,366 / wk | github.com/Hopding/pdf-lib | unavailable | **NOT RECOMMENDED** — capability already covered by Playwright; listed only as a documented alternative. Note: no publish in ~4 years. |

**Packages removed due to slopcheck [SLOP] verdict:** none (tool unavailable).
**Packages flagged as suspicious [SUS]:** none.

---

## Architecture Patterns

### System Architecture Diagram

```
RECRUITER PATH                              APPLY-FORM PATH
  browser <input accept=.pdf,.docx>           browser <input accept=...>
        │ FormData (bytes)                          │ fileMeta only (name/size/type)
        ▼                                            ▼
  uploadCVAction (Server Action)              submitApplyAction
   ├─ mime allow-list  ← file.type            ├─ fileMeta.type allow-list  ← CLIENT-SUPPLIED
   │   (CLIENT-SUPPLIED, spoofable)           │      (spoofable; server never sees bytes)
   ├─ ▲ GAP: no magic-byte sniff              ├─ issues signed upload URL
   ├─ size cap 10 MiB                          ▼
   └─ upload → Storage                    browser PUT bytes ──► Storage
        │                                       │
        └────────────► inngest.send('cv/uploaded') ◄──── confirmApplyAction
                                   │
                                   ▼
                 ┌──────────  parse-cv (Inngest, retries:3)  ──────────┐
                 │ check-ai-budget ─── hard cap ─► honest "paused" msg │
                 │ download-cv    ─── 404 ──────► honest "incomplete"  │
                 │ extract-text (unpdf | mammoth)                      │
                 │    ├─ throws (corrupt/wrong-ext) ─► ▲ GENERIC MSG   │
                 │    ├─ <50 chars ────────────────► honest "scanned"  │
                 │    └─ ▲ NUL survives normaliseWhitespace + 60k slice│
                 │ claude-parse (Haiku, max_tokens 2048) [MEMOISED]    │
                 │    └─ ▲ output written with ZERO runtime validation │
                 │ write-extracted  ◄══ ALL 12 FAILURES LAND HERE ══   │
                 │    ├─ updateCandidateCVParse → extracted_data jsonb │
                 │    │     ▲ NUL → 22P05 │ lone surrogate → PGRST102  │
                 │    └─ markCandidateFieldsFromCV → typed columns     │
                 │          ▲ salary int4 │ years numeric(4,1) │ TypeError│
                 │ embed-candidate (failures swallowed — non-fatal)    │
                 └──── onFailure ──► markCvFailed(GENERIC) ────────────┘
                                   │
                                   ▼
        candidate_cvs.parsing_status='failed', parse_error=GENERIC,
        parse_error_detail="Error: undefined"  (SQLSTATE already discarded)
                                   │
                                   ▼
        cv-review-panel.tsx → offers a retry button that can never succeed
```

Two other write paths share the same defect class and must be fixed by the same choke point:
`reconcile-cv-parses.ts:454-457` (heal-unmerged-profiles) and `acceptCVFieldsAction` (`candidates/[id]/actions.ts:407`), the latter of which would surface a raw `TypeError` to a Next.js error boundary on a non-string `name`.

### Recommended Project Structure

```
tests/
├── fixtures/cv-corpus/
│   ├── generate.ts          # committed generator (Playwright + jszip + raw bytes)
│   ├── manifest.json        # fixture → {tier, expectation, why} — the contract
│   ├── tier1/               # MUST PARSE
│   ├── tier2/               # MUST FAIL FAST + HONEST
│   └── hostile-payloads.ts  # synthetic Claude outputs (NUL, lone surrogate, 2015, "£45,000", ...)
├── unit/lib/ai/cv-extract-corpus.test.ts        # layer 1 — no DB, no network
├── integration/
│   ├── supabase-harness.ts  # local-stack client + seed/teardown + skip-if-down
│   └── cv-write-path.test.ts                    # layer 2 — REAL DB
└── smoke/authed/cv-intake.spec.ts               # layer 3 — prod, AJ org only
```

### Pattern 1: Postgres-legality sanitiser at the DB choke point

**What:** One recursive function applied to every value *and every object key* crossing into a Postgres write.
**When:** At the top of `updateCandidateCVParse` and `markCandidateFieldsFromCV` — the two functions every caller already funnels through.

```ts
// src/lib/db/postgres-safe-text.ts  (NO 'server-only' — pure, testable)
//
// Postgres rejects exactly two things that a CV pipeline can realistically
// produce. Verified 2026-08-09 against Postgres 17.6 + PostgREST v14.5:
//   U+0000            -> 22P05 "unsupported Unicode escape sequence"
//   lone UTF-16 surrogate -> PGRST102 "Empty or invalid json" (PostgREST layer)
// Everything else (U+0001..U+001F, emoji, ZWJ, RTL, astral plane, BOM) is legal
// and MUST be preserved — this is a CV, the content is the product.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function sanitiseText(s: string): string {
  // NUL -> nothing (it is never meaningful text; a broken ToUnicode CMap or a
  // stray XML char-ref put it there). Lone surrogate -> U+FFFD, the Unicode-
  // sanctioned "this was unrepresentable" marker, so the glyph position is
  // preserved and the loss is visible rather than silent.
  return s.replace(/\u0000/g, '').replace(LONE_SURROGATE, '�')
}

export function sanitiseForPostgres<T>(value: T): T {
  if (typeof value === 'string') return sanitiseText(value) as unknown as T
  if (Array.isArray(value)) return value.map(sanitiseForPostgres) as unknown as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[sanitiseText(k)] = sanitiseForPostgres(v)  // KEYS TOO — verified 22P05
    }
    return out as unknown as T
  }
  return value
}
```

Defence in depth per the locked fix policy: also apply `sanitiseText()` to the extracted text in `cv-extract.ts` (fold it into `normaliseWhitespace`, which currently lets NUL through — `cv-extract.ts:30`). That stops the NUL before Claude can echo it *and* keeps the DB boundary honest if Claude produces one independently.

### Pattern 2: zod coercion boundary on Claude's tool output

**What:** Replace `return toolUse.input as ParsedCV` (`claude.ts:337`) with a validating parse. Sanitisation alone does **not** fix classes 2, 3, 5 — those are shape/range violations.
**When:** In `parseCV()`, so `parse-cv.ts`, `reconcile-cv-parses.ts` and `acceptCVFieldsAction` all inherit the fix.

```ts
// Coerce, never reject: a slightly-off field must not fail the whole parse.
// Bounds are derived from the ACTUAL column types (migration 20260513152244):
//   salary_current_estimate / salary_expectation : integer  (int4)
//   years_experience                             : numeric(4,1) -> |v| < 1000
const intInRange = z.coerce
  .number()
  .finite()
  .transform((n) => Math.round(n))
  .refine((n) => n >= 0 && n <= 2_147_483_647)
  .catch(() => undefined as never)
  .optional()

const yearsExperience = z.coerce
  .number()
  .finite()
  .transform((n) => Math.min(Math.max(n, 0), 999.9))
  .catch(() => undefined as never)
  .optional()

const parsedCVSchema = z.object({
  name: z.string().optional(),                       // stops the .trim() TypeError
  email: z.string().optional(),
  // ...
  skills: z.array(z.string()).optional(),            // drops object/array elements
  work_history: z.array(z.object({ /* ... */ }).partial()).optional(),  // drops nulls
  salary_current_estimate: intInRange,
  salary_expectation: intInRange,
  years_experience_total: yearsExperience,
  confidence_per_field: z.record(z.string(), z.string()).default({}),
})
```

Additionally tighten the **tool schema** itself (`claude.ts:267-273`) — `years_experience_total` currently has no description and no bounds, which is the most likely cause of a year-shaped value:
```ts
years_experience_total: {
  type: 'number',
  description: 'Total years of professional experience as a DURATION (e.g. 12.5), never a calendar year. Maximum 60.',
  minimum: 0, maximum: 60,
},
```

### Pattern 3: Preserve the SQLSTATE so `parse_error_detail` is worth having

`DbResult` collapses every DB failure to `code:'internal'` (`candidate-cvs.ts:214`), so by the time `parse-cv.ts:335` throws, the `22P05`/`PGRST102` is gone. Widen the result (or add an optional `detail?: string` carrying `${err.code}` **only** — never `err.message`, which can echo the offending value and would be PII) so `parse_error_detail` records `write-extracted: 22P05 (extracted_data)` instead of `Error: undefined`.

### Pattern 4: Magic-byte sniffing, zero dependencies

```ts
// Signatures are stable and short; a dependency here buys nothing.
// PDF   : 25 50 44 46 2D            "%PDF-"
// ZIP   : 50 4B 03 04               "PK\x03\x04"   (docx/xlsx/pptx/odt/jar/plain zip)
// OLE2  : D0 CF 11 E0 A1 B1 1A E1   legacy .doc / .xls / .ppt
// RTF   : 7B 5C 72 74 66            "{\rtf"
// Distinguishing DOCX from other ZIPs: the archive must contain
// `[Content_Types].xml` AND `word/document.xml` (ODT instead carries a
// `mimetype` entry = application/vnd.oasis.opendocument.text).
```
Recruiter path: `uploadCVAction` already holds the `File`, so `await file.slice(0, 8).arrayBuffer()` is enough for the header check, and jszip (already present) can confirm the DOCX entries.
Apply path: the server **never receives the bytes** at submit time (`apply/[orgSlug]/actions.ts:177`). Options are (a) sniff inside `confirmApplyAction` via a service-role ranged Storage read, or (b) sniff at the top of `extract-text` in `parse-cv.ts` and emit a **type-specific** honest message. (b) is cheaper and covers both paths; (a) additionally gives the applicant instant feedback. Recommend (b) as the floor, (a) as the nicety.

### Anti-Patterns to Avoid

- **Stripping "control characters" wholesale.** `U+0001`–`U+001F` are legal in Postgres `[VERIFIED]`; stripping them destroys content for no benefit and violates the locked "never lose meaningful content" rule.
- **Classifying write errors by SQLSTATE only.** Lone surrogates never reach Postgres — they surface as `PGRST102` with no SQLSTATE `[VERIFIED]`. Any classifier must handle both shapes (extend the existing `isMissingColumnError` idiom in `src/lib/db/postgrest-errors.ts`).
- **Building the NUL PDF fixture with a `\000` octal escape in a `Tj` string.** PDF.js normalises it to a space `[VERIFIED]` — the test would pass while the bug survives. Use a `ToUnicode` CMap with `<41> <0000>`.
- **Testing the write path against the existing fully-mocked builder** (`tests/unit/mark-candidate-fields-from-cv.test.ts:47-70`). That mock accepts every payload in the matrix above — it is precisely why the 12 shipped.
- **`z.coerce.number()` without a `.catch()`** — a throw here converts a bad field into a whole-parse failure, trading one Tier-3 bug for another.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Realistic PDF fixtures | A PDF writer, or a checked-in binary blob of unknown provenance | Playwright Chromium `page.pdf()` from committed HTML | Real layout engine, real font subsetting, real hyperlinks; auditable HTML source; zero new deps; PII-free by construction `[VERIFIED]` |
| DOCX fixtures | A ZIP/OOXML writer | `jszip` (already in tree) | Same library mammoth reads with |
| Postgres-legality checking | A hand-written "is this string safe" predicate | Actually write it to a local Postgres in a test | The rules are non-obvious (keys count; NUL ≠ other control chars; surrogates fail one layer earlier) `[VERIFIED]` |
| Claude output validation | Hand-rolled `typeof` ladders | `zod` (already a direct dep) | Coercion + bounds + `.catch()` in one declaration; the ladders are how `toParsedCVSubset` got its six `as` casts |
| MIME detection | A mime-type library (`file-type`, `mmmagic`) | 8-byte header check + jszip entry check | Two formats, five signatures, all stable; a dependency is pure supply-chain cost |
| Lone-surrogate detection | Manual `charCodeAt` loops | The regex in Pattern 1 (lookahead/lookbehind, ES2018) | Node 24 + the project's ES2022 target support it natively `[VERIFIED: ran this session]` |

**Key insight:** Every failure mode in this phase lives in the gap between what TypeScript's type system *asserts* (`as ParsedCV`, `as number`, `as string[]`) and what actually arrives from a probabilistic model. No amount of static typing closes it; only a runtime boundary and a real database do.

---

## Common Pitfalls

### Pitfall 1: A green mocked test suite over a broken write path
**What goes wrong:** `tests/unit/mark-candidate-fields-from-cv.test.ts` passes on every payload in the failure matrix — its `update()` mock just records the patch.
**Why:** The mock has no type system, no constraints, no PostgREST.
**How to avoid:** Layer 2 must hit a real database. Keep the existing mocked test (it correctly guards the D-08 *policy*), and add the integration suite alongside it — different jobs.
**Warning signs:** A test asserting `expect(patch.salary_current_estimate).toBe('£45,000')` and calling that a pass.

### Pitfall 2: Fixing sanitisation and declaring victory
**What goes wrong:** Sanitisation fixes classes 1 and 4. Classes 2, 3, 5 (`years_experience: 2015`, `salary: "£45,000"`, `name: ['Jane','Doe']`) are completely untouched by it and produce an identical user-visible failure.
**How to avoid:** Both boundaries ship together — sanitiser *and* zod coercion. The layer-2 suite must have a case for each of the six classes.

### Pitfall 3: The retry-the-12 acceptance test giving a false green
**What goes wrong:** Retry runs `retryParseAction`, which resets the row to `pending` and re-dispatches; `parse-cv` calls Haiku **again**, and Haiku is non-deterministic. A row could go green because Haiku happened to return `24` instead of `2015`, with the defect untouched.
**How to avoid:** Gate acceptance on the layer-2 suite (deterministic, stubbed Claude). Treat the 12 retries as the *customer-facing* confirmation, and record which fix class each file exercised, from the forensic replay in §Decisive Experiment.

### Pitfall 4: Fixtures that carry PII or non-determinism
**What goes wrong:** Real CVs land in the repo (public), or Playwright-generated PDFs churn their bytes on every Chromium update (embedded `/CreationDate`, font subset ordering) and produce noisy diffs.
**How to avoid:** All names/emails/phones from a synthetic list (`zoe@example.com`, `+44 7700 900xxx` — Ofcom drama range). Either commit the generated binaries and regenerate only deliberately, or commit only the HTML/XML sources and generate in CI. Recommend committing the binaries (the corpus must be stable and CI must not need a browser) with a `pnpm fixtures:regen` script.

### Pitfall 5: `parse_error_detail` shipping with nothing useful in it
**What goes wrong:** Migration `20260804120000` lands, and the column records `Error: undefined` because the SQLSTATE was discarded three frames earlier.
**How to avoid:** Pattern 3. Verify by asserting on the *stored* `parse_error_detail` in the layer-2 test, not just on the thrown error.

### Pitfall 6: The corrupt-file path still returning the generic message
**What goes wrong:** A truncated PDF throws `InvalidPDFException: Invalid PDF structure.` `[VERIFIED]`, a wrong-extension file throws `Can't find end of central directory` `[VERIFIED]` — both become `NonRetriableError` at `parse-cv.ts:295`, fall to the in-body catch, and get `CV_PARSE_FAILED_MESSAGE` with a retry button that cannot work. That is a Tier-2 **and** Tier-3 violation living in the code today, independent of the 12.
**How to avoid:** Map the library error names to new honest literals in `parse-messages.ts` (keeping the load-bearing-substring convention and the `cv-review-panel.tsx` predicate pattern), and add a `retryable: false` predicate so the panel withholds the button — exactly as `isUnparseableSource` already does.

---

## Code Examples

### Reproduce the PDF NUL (the fixture the phase actually needs)
A `ToUnicode` CMap entry mapping a glyph to `<0000>` makes unpdf emit a literal `U+0000`. `[VERIFIED: this session]`
```
7 0 obj
<< /Length N >>
stream
/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CMapName /Custom def /CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange
6 beginbfchar
<41> <0000>     <-- glyph 'A' maps to U+0000
<42> <0042>
... endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end
endstream endobj
```
Font object references it via `/ToUnicode 7 0 R`. Extracted result:
`"\u0000BCDEF\u0000BCDEF \u0000BCDEF ..."` → `hasNUL: true`.
Control: the same PDF with `\000` inside a `Tj` literal and a plain `/Helvetica` extracts as `"Hello World..."` — **NUL normalised away**, no reproduction.

### Realistic Tier-1 PDF via already-installed Playwright
```ts
import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html)   // CSS column-count:2, <table>, <a>, emoji, CJK, diacritics
const pdf = await page.pdf({
  format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<div style="font-size:8px">CONFIDENTIAL CV</div>',
  footerTemplate: '<div style="font-size:8px">Page <span class="pageNumber"></span></div>',
  margin: { top: '40px', bottom: '40px', left: '30px', right: '30px' },
})
```
Round-tripped through unpdf this session: 48 663 bytes → 380 chars, 0 NULs, 0 lone surrogates, and `Zoë O'Brien‐Şahin 张伟 ... 👩‍💻` preserved intact. `[VERIFIED]`

### DOCX fixtures via jszip — including the two hostile NUL variants
Minimum viable DOCX = three entries: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`. Built this session at 2 103 bytes; mammoth extracted tables, unicode and emoji correctly with **0 messages**. `[VERIFIED]`
Both of these smuggle a real `U+0000` through mammoth into the extracted text `[VERIFIED]`:
```xml
<w:t xml:space="preserve">Jane<!--raw 0x00 byte-->Doe</w:t>
<w:t xml:space="preserve">Jane&#x0;Doe</w:t>
```

### Layer-2 harness shape (proven to run here in 496 ms)
```ts
/** @vitest-environment node */
import { createClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }))
const { markCandidateFieldsFromCV, updateCandidateCVParse, toParsedCVSubset } =
  await import('@/lib/db/candidate-cvs')

const sb = createClient(LOCAL_URL, LOCAL_SERVICE_KEY, { auth: { persistSession: false } })
// seed org -> candidate -> candidate_cvs in beforeAll; delete the org in afterAll (FK cascades)
```
No `src/lib/env.ts` mocking needed: `candidate-cvs.ts` imports only `server-only`, Sentry and types, and both helpers take the client as a parameter. Full-pipeline tests of `parse-cv.ts` **do** pull `env` transitively (via `createServiceClient`) and need a `.env.test` or a `vi.mock('@/lib/env')`.

Observed results, matching the production signature exactly:
```
NUL in extracted_data jsonb      -> {"ok":false,"code":"internal"}
lone surrogate in jsonb          -> {"ok":false,"code":"internal"}
salary "£45,000"                 -> {"ok":false,"code":"internal"}
name: ['Jane','Doe']             -> TypeError: (args.parsed.name ?? "").trim is not a function
work_history: [null, {...}]      -> TypeError: Cannot read properties of null (reading 'role')
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | local Supabase stack | ✓ | Engine 27.3.1 | — |
| Supabase CLI | `supabase start`, migrations | ✓ | 2.98.2 (`node_modules/.bin/supabase`; v2.113.0 available) | — |
| Supabase container images | local stack | ✓ **all cached locally** | postgres 17.6.1.132, postgrest v14.5, gotrue v2.189.0, storage-api v1.60.4, kong 2.8.1, pg_meta v0.96.6, mailpit v1.22.3 | — |
| Local stack actually starts | layer-2 tests | ✓ **verified this session** | API 54321 / DB 54322; all 80 migrations applied (`candidate_cvs.parse_error_detail` present) | — |
| Playwright Chromium | PDF fixture generation, layer 3 | ✓ | `chromium-1223` + headless shell downloaded | — |
| `jszip` | DOCX fixture generation | ✓ | 3.10.1 at `node_modules/jszip` | hand-rolled ZIP via `node:zlib` |
| Vitest | layers 1–2 | ✓ | 4.1.6 (`environment: 'jsdom'` default; use `@vitest-environment node` per file, as existing tests do) | — |
| Node | all | ✓ | v24.18.0 | — |
| pnpm | all | ✓ | 0.35.0 via corepack (**not on bare `$PATH`** — use `corepack pnpm` or `./node_modules/.bin/*`) | — |
| npm registry | dependency verification | ✓ | reachable | — |
| `slopcheck` | package legitimacy gate | ✗ | no `pip`/`pip3`; `python3 -m pip` missing | manual npm metadata + download-count review (done above) |
| `psql` on host | DB introspection | ✗ | — | `docker exec supabase_db_altus-recruitment psql` (used successfully this session) |
| Anthropic API key | forensic replay, layer 3 | not verified | — | founder-run script |

**Notes for the planner:**
- A **different** project's Supabase stack (`altus-quay-forthports`) runs concurrently on ports 544xx. **No collision** with this project's 543xx — verified. Do not assume ports are free by default; the harness should fail fast with an actionable message when `http://127.0.0.1:54321/rest/v1/` is unreachable rather than hanging.
- `supabase start -x vector,logflare,edge-runtime,studio,imgproxy,realtime` starts only what the write-path tests need and completed well inside a 7-minute budget with images already cached.
- I stopped the stack (`supabase stop --no-backup`) and removed all probe artefacts; the working tree is unchanged apart from this file.

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `slopcheck` (manual registry review), host `psql` (`docker exec`).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trust the LLM's declared JSON-schema output shape | Validate/coerce at the boundary with zod (or use provider-side strict structured outputs) | industry-wide since ~2024 | Anthropic's `input_schema` guides but does **not guarantee** the tool input; `claude.ts:337` currently trusts it absolutely `[ASSUMED — training knowledge; not re-verified against current Anthropic docs this session]` |
| Trust `File.type` for server-side format gating | Server-side magic-byte sniffing | long-standing OWASP guidance | `file.type` is browser-derived from the extension; renaming `cv.docx` → `cv.pdf` sails through `ACCEPTED_CV_MIME` (`candidates/[id]/actions.ts:100-105`) `[VERIFIED: code read + library probe of the resulting failure]` |
| Mock the DB in tests | Run the real DB in a container (Testcontainers / `supabase start`) | ~2022 onward | The entire defect class here is invisible to a mock `[VERIFIED]` |

**Deprecated/outdated in this codebase:**
- `toParsedCVSubset`'s six `as` casts (`candidate-cvs.ts:286-307`) — the mechanism by which unvalidated model output reaches typed columns.
- `parseCV`'s `return toolUse.input as ParsedCV` (`claude.ts:337`).
- `normaliseWhitespace` (`cv-extract.ts:26-31`) — correct for whitespace, silent on NUL.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unchanged by this phase |
| V3 Session Management | no | Unchanged |
| V4 Access Control | **yes** | The tenant-boundary check on `storage_path` (`parse-cv.ts:196-202`) is the only thing between a forged `cv/uploaded` event and a cross-tenant read — **any refactor of the parse pipeline must preserve it verbatim**. Layer-3 spot checks run in the founder's org only (locked decision). |
| V5 Input Validation | **yes** | zod at the Claude output boundary; magic-byte sniffing at upload; existing size caps (10 MiB both paths) |
| V6 Cryptography | no | — |
| V7 Error Handling & Logging | **yes** | `parse_error_detail` must carry PII-free technical detail only (SQLSTATE + column name, **never** `err.message`, which can echo the offending value — e.g. `invalid input syntax for type integer: "£45,000"` is borderline, and a NUL-bearing name would be worse). Sentry `beforeSend` scrub already exists (`sentry-scrub.ts`); do not weaken it. |
| V12 Files & Resources | **yes** | Magic-byte sniffing, size caps, `slugifyFilename` path-traversal defence (`actions.ts:106-118`), Storage-path tenant binding |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Content-type spoofing (rename `.docx`→`.pdf`, or a zip bomb labelled `.docx`) | Spoofing / DoS | Magic-byte sniff + entry check; existing 10 MiB cap; jszip reads entry metadata before inflating |
| PII leakage into fixtures committed to a **public** repo | Information Disclosure | Synthetic-only corpus (locked decision); a CI grep for `@gmail.com`/`@outlook.com`/real-looking UK mobile prefixes in `tests/fixtures/**` |
| PII leakage into `parse_error_detail` / Sentry via error messages | Information Disclosure | Store `${code}` + column name only; keep the existing `readStatus`/name-only wrapping idiom (`parse-cv.ts:153`, `observability/inngest.ts`) |
| Prompt injection via CV text (a CV instructing the model) | Tampering | Out of scope for this phase, but note: the extracted text is concatenated straight into the user turn (`claude.ts:327`). Structured output limits the blast radius to field values — which the new zod boundary now constrains. |
| Forged `cv/uploaded` event redirecting the service-role client at another tenant's bytes | Elevation of Privilege | Preserve `parse-cv.ts:196-202` exactly |
| Layer-3 live tests polluting or reading customer data | Information Disclosure | Founder's org (AJ) only; explicit cleanup; never the customer org (locked decision) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude echoes an input `U+0000` back into its tool-use output (the unverified link in root-cause rank 1) | Root-Cause Findings | If Claude strips NULs, rank 1 is dead and the true cause is rank 2/3/5. **Mitigated:** the fix is required regardless (defence in depth), and §Decisive Experiment settles it before planning locks. |
| A2 | The 12 failures share one root cause | Root-Cause Findings | They may span several of the six classes. **Mitigated:** the recommended fix covers all six, so this changes the *narrative*, not the *work*. |
| A3 | Anthropic does not strictly enforce `input_schema` on tool inputs | State of the Art | If it does enforce, ranks 2/3/5 shrink and rank 1 grows. Training-knowledge claim; **not re-verified this session** — worth a Context7/docs check during planning. |
| A4 | A `max_tokens`-truncated tool_use arrives as `input: {}` rather than partial JSON | Root-Cause rank 6 | If it arrives partial, rank 6 becomes a *failure* mode rather than an empty-profile mode. Settled by capturing `stop_reason` in the replay. |
| A5 | Broken `ToUnicode` CMaps mapping glyphs to `<0000>` occur in real-world CV PDFs at a rate consistent with 10/53 | Root-Cause rank 1 | The mechanism is verified; its **prevalence** is not. Settled by step 2 of the replay (zero AI cost). |
| A6 | Prod's PostgREST/Postgres versions behave as the local stack (17.6.1.132 / v14.5) | Failure matrix | Low risk — these are stable, long-standing behaviours; but prod's exact versions were not read this session. |
| A7 | `jszip` and `pdf-lib` are legitimate packages | Package Legitimacy Audit | slopcheck unavailable. Mitigated for jszip by 13 years of history, 40 M weekly downloads, a known GitHub repo, and the fact that it is **already installed** as mammoth's dependency. |

---

## Open Questions (RESOLVED — dispositioned during planning, 2026-08-09)

All five were closed by assigning each to a specific plan. Resolutions:

| # | Question | Resolution | Owner |
|---|----------|------------|-------|
| 1 | Which of the six classes caused each of the 12? | Run the Decisive Experiment as a read-only forensic replay; per-file classification written to `06-FORENSICS.md`. All six are fixed regardless, so the answer changes the narrative, not the work. | plan 06-02 |
| 2 | Should `max_tokens` rise from 2048? | Yes — raised to 4096 (worst case ~0.08p/CV at Haiku's output rate) AND a `CVParseTruncatedError` guard added so a truncated-to-empty parse fails honestly instead of storing an empty profile as complete. | plan 06-06 |
| 3 | Commit the corpus binaries, or generate in CI? | Commit them, plus the HTML/XML sources and a `pnpm fixtures:regen` script. CI never needs a browser; regeneration is deliberate. | plan 06-03 |
| 4 | Password-protected/encrypted PDFs — what does unpdf actually throw? | The generator builds an encrypted fixture and PRINTS the observed exception name, which is recorded in `manifest.json`; the classifier and its tests key off the OBSERVED name, never the predicted `PasswordException`. | plan 06-03 (observed) → 06-07 (mapped) |
| 5 | Are the pending migrations still unapplied in prod? | Enumerated fresh from `supabase/migrations/` at execution time and diffed against the applied ledger — never transcribed. The research-era list here is incomplete (it omits `20260804140100`). This phase adds no migration and is correct either way. | plan 06-10 |

### Original questions, for the record


1. **Which of the six classes actually caused each of the 12?**
   - Known: all six reproduce the exact signature; the write stage is the site.
   - Unclear: the per-file cause — `extracted_data` was never written, so nothing was persisted.
   - Recommendation: run §Decisive Experiment as Wave 0. It is read-only, costs pence, and converts A1/A2/A4/A5 into facts before the plan locks.

2. **Should `max_tokens` rise from 2048?**
   - Known: 2048 output tokens is tight for a dense CV with long `work_history[].summary` strings; truncation likely yields a `complete` row with an empty profile (a Tier-3 violation).
   - Recommendation: capture `stop_reason` in the replay; if any of the 12 hit `max_tokens`, raise to 4096 (cost impact is trivial at Haiku's 400p/MTok output) and add an explicit `stop_reason === 'max_tokens'` guard that fails **honestly** rather than storing an empty profile.

3. **Should the corpus binaries be committed, or generated in CI?**
   - Recommendation: commit them (stable bytes, no browser needed in CI) plus a `pnpm fixtures:regen` script and the HTML/XML sources. Accept the ~1 MB repo cost.

4. **Password-protected/encrypted PDFs.**
   - Not probed this session (no encrypted fixture built). unpdf/PDF.js throws `PasswordException` for these `[ASSUMED]`. Verify during execution and map it to a dedicated honest message — it is an explicitly named Tier-2 case.

5. **Are the two pending migrations still unapplied in prod?**
   - `20260804120000` (`parse_error_detail`) and `20260804140000` (`record_audit` dedupe) are present in the local stack (which applies everything in `supabase/migrations/`) but CONTEXT states they are unapplied in prod. Three later migrations exist behind them (`20260804120100`, `20260804130000` set_created_by trigger, `20260804130100`) whose prod status was **not** determined this session. The phase must work either way and must list all of them in the founder handoff.

---

## Sources

### Primary (HIGH confidence)
- **Direct empirical probe, this session** — local Supabase stack (Postgres 17.6.1.132, PostgREST v14.5, `@supabase/supabase-js` 2.105.4): the 25-row failure matrix, schema/trigger/constraint introspection.
- **Direct empirical probe, this session** — `unpdf@1.6.2` and `mammoth@1.12.0` against hand-built PDFs (raw bytes + ToUnicode CMaps) and jszip-built DOCX: NUL/lone-surrogate emission, corrupt/truncated/zero-byte/wrong-extension error names.
- **Direct empirical probe, this session** — `@playwright/test@1.60` Chromium `page.pdf()` → unpdf round trip.
- **Direct empirical probe, this session** — vitest 4.1.6 running the real `markCandidateFieldsFromCV` / `updateCandidateCVParse` against the local stack (496 ms, 8 tests).
- **Codebase** — `src/lib/ai/cv-extract.ts`, `src/lib/ai/claude.ts:227-338`, `src/lib/inngest/functions/parse-cv.ts`, `src/lib/db/candidate-cvs.ts`, `src/lib/db/postgrest-errors.ts`, `src/lib/cv/parse-messages.ts`, `src/app/(app)/candidates/[id]/actions.ts`, `src/app/(public)/apply/[orgSlug]/actions.ts`, `supabase/migrations/20260513152244_phase1_domain_schema.sql:199-262`, `tests/unit/mark-candidate-fields-from-cv.test.ts`, `vitest.config.ts`, `package.json`, `supabase/config.toml`.
- **npm registry** — jszip / pdf-lib publish dates, repository URLs, dist-tags; `api.npmjs.org` weekly download counts (2026-08-02 → 2026-08-08).

### Secondary (MEDIUM confidence)
- 06-CONTEXT.md production evidence (founder-verified read-only queries; taken as given per instructions).

### Tertiary (LOW confidence — flagged for validation)
- Anthropic tool-use `input_schema` enforcement semantics and `max_tokens`-truncation behaviour (A3, A4) — training knowledge, **not** re-verified against current docs this session.
- Real-world prevalence of `<0000>` ToUnicode mappings in CV PDFs (A5).

---

## Metadata

**Confidence breakdown:**
- Failure mechanics / matrix: **HIGH** — every row empirically reproduced against a real Postgres + PostgREST in this session.
- Which class caused the specific 12: **MEDIUM** — six confirmed mechanisms, decisive artefact not persisted; §Decisive Experiment resolves it.
- Fixture generation approach: **HIGH** — PDFs and DOCX generated and round-tripped this session; zero new deps.
- Harness viability: **HIGH** — local Supabase started, migrations applied, integration test written and green in 496 ms.
- Sanitisation design: **HIGH** — exact boundary verified (keys included; NUL vs. other control chars distinguished; surrogates fail at the PostgREST layer).
- Upload-time sniffing: **MEDIUM-HIGH** — signatures are well-established; the apply-form architectural constraint (server never sees the bytes) verified in code.

**Research date:** 2026-08-09
**Valid until:** 2026-09-08 (30 days — Postgres/PostgREST semantics are stable; re-verify the Anthropic tool-use items sooner if they become load-bearing)
