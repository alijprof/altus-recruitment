# Forensic replay: the 12 failed production CV rows

## What this proves

Between 5–6 Aug 2026 the customer (Steele Charles) bulk-loaded 73 CVs; 12 failed
(10 PDF, 2 DOCX) with a generic "Parsing failed" message. `ai_usage` shows one
successful `cv_parse` Claude call per failure and zero `cv_parse_failed` rows —
so Claude parsed every file successfully, and the failure happened AFTER the AI
call, in the Postgres write stage (`write-extracted` in
`src/lib/inngest/functions/parse-cv.ts`). `extracted_data` was never persisted
for these 12 rows, so the decisive artefact — what Claude actually returned —
does not exist in the database. It can only be recovered by replaying the
stored bytes.

`06-RESEARCH.md` reproduced six distinct payload classes (NUL, lone surrogate,
`years_experience >= 1000`, salary type/range, name/work_history shape,
`max_tokens` truncation) that all yield this exact signature. This replay
settles **which class fired for which file** — or flags a seventh, unforeseen
class — by re-downloading each file, re-extracting it with the real production
extractor, and (in the paid half) replaying one Haiku call per file through the
real `classifyForPostgres` "would Postgres accept this?" classifier
(`tests/support/pg-legality.ts`).

It writes **nothing** to the customer's rows. See "Data-safety contract" below.

## Running it

```bash
FORENSIC_SKIP_AI=1 pnpm forensics   # step 1: zero-cost — download + re-extract only
pnpm forensics                       # step 2: + one Haiku call per clean-extraction row
```

Always run step 1 first and read its table before spending anything on step 2.

## `.env.forensics.local`

Create this file at the repo root (already covered by the repository's
`.env*` gitignore rule — **never commit it**). Populate from Vercel / your
Supabase project settings:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
FORENSIC_TARGET_ORG_ID=      # the customer org whose 12 failed rows are being read
FORENSIC_BILLING_ORG_ID=cb70bfc3-d916-4831-a21d-0331b2b9efe3   # default: founder's org

# Only required for step 2 (pnpm forensics without FORENSIC_SKIP_AI=1):
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
ANTHROPIC_API_KEY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

**Why the second group is conditional, not unconditional:** `@/lib/ai/claude`
transitively imports `@/lib/env` (`@t3-oss/env-nextjs`), which validates its
entire schema — including `ANTHROPIC_API_KEY`, the Supabase publishable key,
and both Inngest keys — at module load. This file only ever dynamically
imports `@/lib/ai/claude` inside the paid replay branch, so those four keys
are genuinely unnecessary for step 1. This is a deliberate design choice
(not the literal reading of `06-02-PLAN.md`'s single "required keys" list) —
made so the zero-cost half is truly runnable standalone, including in
environments where `ANTHROPIC_API_KEY` is not available locally (e.g. a key
that lives only in Vercel).

If any key required for the mode you're running is missing or empty, the
replay fails immediately inside its `beforeAll` hook, naming the exact
missing keys — it will never hang or half-run.

## Data-safety contract

- The only Supabase verbs this file may ever use are `.select()` and
  `storage.from('cvs').download()`. A mechanical `grep -c` gate in this
  plan's Task 2 verify step fails the task if any `.insert()`, `.update()`,
  `.upsert()`, `.delete()` or `.rpc()` call appears in
  `cv-parse-replay.forensic.ts`.
- Guard rails asserted before any query runs: `FORENSIC_BILLING_ORG_ID` must
  differ from `FORENSIC_TARGET_ORG_ID` (never bill the customer for our own
  diagnostics), and `NEXT_PUBLIC_SUPABASE_URL` must not look like a local
  Supabase stack (this replay is for production).
- The only production **write** the full replay performs is one `ai_usage`
  row per Claude call, against `FORENSIC_BILLING_ORG_ID` (the founder's org
  by default), under `purpose: 'cv_parse_forensic'` — distinct from real
  recruiter parses (`purpose: 'cv_parse'`) so it never pollutes the
  customer's or the founder's genuine usage numbers, plus whatever
  `checkCap` reads as part of its normal pre-flight check.
- `FORENSIC_SKIP_AI=1` performs **zero** writes anywhere — SELECT and Storage
  download only.

## Cost ceiling

12 files × ~15k input tokens at 80p/MTok + ~1.5k output tokens at 400p/MTok
≈ **20–30 pence total** for the full (non-skip) run. Hard ceiling: well under
£1. `FORENSIC_SKIP_AI=1` costs nothing.

## Output

- Prints a markdown table to stdout: `| # | mime | KB | chars | NUL | loneSurr | stop_reason | classes |`.
  `#` is a 1-based row index, not the row UUID.
- Writes a machine-readable copy to `tests/forensics/.out/replay.json`
  (gitignored by nothing in particular — **do not `git add` it**; it is a
  local scratch artefact, not a plan deliverable).

## PII contract

The report may contain counts, lengths, `typeof` strings, JSON paths,
SQLSTATE-equivalent codes, `stop_reason`, and the raw numeric values of
`years_experience_total` / `salary_current_estimate` / `salary_expectation`
(numbers, not PII, and diagnostically decisive). It must never contain
candidate names, emails, phones, employers, locations, or any extracted CV
text — not even truncated. This is enforced by construction in
`cv-parse-replay.forensic.ts`: no function in that file ever copies a string
VALUE out of the extracted text or the Claude response into a log line or
the report; `tests/support/pg-legality.ts`'s findings carry structural
metadata only (rule/path/code/severity), never payload string values.
