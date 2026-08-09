---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
reviewed: 2026-08-09T22:50:00Z
depth: deep
branch: phase-6/cv-intake-battle-test
diff_base: d01bdc1
diff_head: ecb9b75
files_reviewed: 38
files_reviewed_list:
  - src/app/(app)/candidates/[id]/actions.ts
  - src/app/(app)/candidates/[id]/cv-review-panel.tsx
  - src/app/(public)/apply/[orgSlug]/actions.ts
  - src/lib/ai/claude.ts
  - src/lib/ai/cv-extract.ts
  - src/lib/ai/parsed-cv-schema.ts
  - src/lib/cv/extraction-errors.ts
  - src/lib/cv/file-signature.ts
  - src/lib/cv/parse-messages.ts
  - src/lib/db/candidate-cvs.ts
  - src/lib/db/types.ts
  - src/lib/inngest/functions/parse-cv.ts
  - src/lib/text/postgres-safe-text.ts
  - tests/fixtures/cv-corpus/generate.mjs
  - tests/fixtures/cv-corpus/hostile-payloads.ts
  - tests/fixtures/cv-corpus/manifest.json
  - tests/forensics/cv-parse-replay.forensic.ts
  - tests/integration/cv-write-path.test.ts
  - tests/integration/supabase-harness.ts
  - tests/support/pg-legality.ts
  - tests/unit/app/apply/confirm-action-file-sniff.test.ts
  - tests/unit/app/candidates/cv-review-panel.test.tsx
  - tests/unit/fixtures-pii-guard.test.ts
  - tests/unit/lib/ai/cv-extract-corpus.test.ts
  - tests/unit/lib/ai/cv-parse-truncation.test.ts
  - tests/unit/lib/ai/parsed-cv-schema.test.ts
  - tests/unit/lib/cv/extraction-errors.test.ts
  - tests/unit/lib/cv/file-signature.test.ts
  - tests/unit/lib/cv/parse-messages.test.ts
  - tests/unit/lib/pg-legality.test.ts
  - tests/unit/lib/text/postgres-safe-text.test.ts
  - vitest.config.ts
  - vitest.integration.config.ts
  - vitest.forensics.config.ts
  - package.json
  - .gitignore
  - .prettierignore
  - (plus binary corpus fixtures, byte-scanned only)
findings:
  critical: 2
  high: 2
  medium: 6
  low: 6
  info: 3
  total: 19
  blocker: 4
  warning: 12
status: issues_found
verdict: FIX-FIRST
---

# Phase 6: CV Intake Battle-Test & Hardening — Code Review

**Reviewed:** 2026-08-09
**Depth:** deep (cross-file: import graph, call chains, write-path tracing, byte scans, live test/typecheck/lint execution)
**Diff:** `d01bdc1..ecb9b75` — 70 files, +7,560 / −136
**Verdict:** **FIX-FIRST** — 4 blockers

## Summary

The core hardening work is genuinely good. The coercion boundary
(`parsed-cv-schema.ts`) and the Postgres-legality sanitiser
(`postgres-safe-text.ts`) are careful, well-reasoned, minimal-blast-radius
modules, and their tests actually pin behaviour rather than restating the
implementation. I verified the two things most likely to be wrong in a fix
wave of this shape and **both came back clean**: the sanitiser does not
mangle legitimate unicode (CJK / RTL / accents / ZWJ emoji / BOM / soft
hyphen / NBSP / astral plane are pinned preserved, end-to-end through the
real extractor via the fixture corpus), and the three "red→green" test files
are **byte-identical to their original RED commits** — no assertion was
weakened to manufacture green.

The defects cluster somewhere else: at the **new byte-sniffing rejection
layer** and at the **verification harness itself**.

Two blockers are the phase's own bug class, relocated. `CR-01`: the apply
form's client component was never wired to the new rejection — the server
computes an honest wrong-format message and the untouched client throws it
away and shows "Your CV uploaded but we couldn't confirm it," which is
affirmatively false. `CR-02`: the sniffer demands `%PDF-` at byte 0 while
the pipeline's own parser (pdf.js, via unpdf) searches the first 1024 bytes
— so a class of PDF that parsed successfully yesterday is hard-rejected
today, and on the public path it is rejected into a permanently
un-retryable dead end.

Two more blockers are verification integrity. `pnpm test:integration` — the
layer-2 suite explicitly described as "the layer that would have caught the
12" — exits **0 with 22 skipped** when the local stack is down; I reproduced
this. And `pnpm test` is **currently red** in the working tree because a
stale `.claude/worktrees/` directory is neither gitignored nor excluded from
vitest. A hardening phase whose own gates can pass while proving nothing is
the same failure mode the phase exists to eliminate, one layer up.

Everything else is medium-and-below: sanitiser/truncation ordering, two
sibling write paths still unguarded, and message-class mismatches.

---

## Critical

### CR-01 (BLOCKER): Apply-form client discards the new rejection message — applicant is told the opposite of the truth

**Files:**
`src/app/(public)/apply/[orgSlug]/actions.ts:658-665` (new, this branch)
`src/app/(public)/apply/[orgSlug]/apply-form.tsx:198-203` (**untouched** by this branch — `git diff d01bdc1..ecb9b75` on this file is empty)

**Issue:**
Wave 06-08 Task 3 added a confirm-time byte sniff that, on a positive
contradiction, marks the CV row `failed` and returns:

```ts
return { ok: false, formError: CV_WRONG_FORMAT_MESSAGE }
```

The client that consumes `confirmApplyAction` was never updated. It ignores
`formError` entirely and renders a hardcoded toast:

```tsx
if (!confirmResult.ok) {
  toast.error(
    `Your CV uploaded but we couldn’t confirm it. Email ${contactEmail} and we’ll sort it.`,
  )
```

(Contrast line 168 in the same file, which *does* surface
`submitResult.formError` for stage 1.)

**Failure scenario:** An applicant uploads a `.docx` renamed `.pdf` (or any
file the sniff rejects). Server-side: candidate row written, consent row
written, storage object written, `candidate_cvs` row flipped to
`parsing_status='failed'` with an honest reason, `cv/uploaded` never fired.
Client-side: the applicant is told their CV **uploaded fine** and that the
agency will "sort it" — the exact opposite of the actionable instruction the
server computed ("Save it as a real PDF or .docx and upload again"). They
email the agency instead of re-saving. The recruiter sees a candidate with a
dead CV row and no application signal. This is precisely the Tier-3 outcome
06-CONTEXT.md forbids ("generic message with no cause"), now shipped on the
*public* surface, and the 06-08 SUMMARY's claim that both surfaces "now
honestly reject Tier-2 format mismatches" is not true for the apply path.

The action-level test (`tests/unit/app/apply/confirm-action-file-sniff.test.ts`)
asserts only the server return value, so nothing catches this.

**Fix:**

```tsx
// src/app/(public)/apply/[orgSlug]/apply-form.tsx:198
if (!confirmResult.ok) {
  toast.error(
    confirmResult.formError ??
      `Your CV uploaded but we couldn’t confirm it. Email ${contactEmail} and we’ll sort it.`,
  )
  resetTurnstile()
  return
}
```

Then add a rendering-level test (mirroring `cv-review-panel.test.tsx`'s
pattern) asserting that `CV_WRONG_FORMAT_MESSAGE` reaches the DOM/toast. Also
consider leaving the file input populated so the applicant can immediately
re-pick — as written, a rejected application requires a full re-submit.

---

### CR-02 (BLOCKER): `sniffFileType` requires `%PDF-` at offset 0; the pipeline's own PDF parser tolerates 1024 bytes of prefix — good files are now rejected

**Files:**
`src/lib/cv/file-signature.ts:38-58` (`startsWithMagic` / `sniffFileType`)
`src/lib/cv/file-signature.ts:150-151` (recruiter path: `unknown` → `unsupported-format`)
`src/app/(public)/apply/[orgSlug]/actions.ts:222-223` (apply path: `unknown` → positive mismatch → reject)
`src/app/(app)/candidates/[id]/actions.ts:157-161` (recruiter call site)

**Issue:** `startsWithMagic` compares magic bytes **only at index 0**. The
extractor this gates for is `unpdf` → pdf.js, whose `checkHeader` calls
`find(stream, "%PDF-", 1024)` — verified directly in the bundled source
(`node_modules/unpdf/dist/pdfjs.mjs`: `function Uc(t,e,n=1024,...)`, called
as `Uc(e, X1)` from `checkHeader()`). pdf.js deliberately scans the first
**1024 bytes** for the header because leading junk occurs in the wild (UTF-8
BOM from a naive re-save, mail-gateway preamble, concatenated output, some
fax/scanner exports).

**Failure scenario:** A PDF with a 3-byte BOM (or any leading whitespace/
junk) before `%PDF-`:

- **Before this branch:** uploaded fine, extracted fine, parsed fine. It is
  in the customer's back-book today.
- **Recruiter path now:** `sniffFileType` → `'unknown'` → `assertUploadableCV`
  → `{ ok:false, reason:'unsupported-format' }` → the recruiter is told *"We
  support only PDF and Word (.docx) CVs right now"* about a file that **is** a
  PDF. Upload blocked outright.
- **Apply path now (worse):** `isApplyPathFormatMismatch` returns `true` for
  `'unknown'` (line 222-223), so the row is marked `failed` with
  `CV_WRONG_FORMAT_MESSAGE`. That message matches `isWrongFormat`, which is
  inside `isUnretryableParseFailure` — so the retry button is withheld in the
  panel **and** `retryParseAction` refuses server-side. A valid CV becomes a
  permanent dead end, with an orphan storage object, and (via CR-01) the
  applicant is told it uploaded fine.

This also contradicts the module's own stated principle at
`src/app/(public)/apply/[orgSlug]/actions.ts:120-124` — "ambiguous reads are
always resolved in the applicant's favour" — and the 06-08 SUMMARY's
"T-06-34 (false rejection of a legitimate CV) … now test-provably resolved as
allow-through," which is only true for the ZIP/DOCX ambiguity, not for
`'unknown'`. There is no corpus fixture for a prefixed PDF, so nothing
catches it.

**Fix:**

```ts
// src/lib/cv/file-signature.ts — mirror pdf.js's own tolerance
const PDF_HEADER_SEARCH_WINDOW = 1024

function findMagic(bytes: Uint8Array, magic: readonly number[], window: number): boolean {
  const limit = Math.min(bytes.length, window) - magic.length
  outer: for (let i = 0; i <= limit; i++) {
    for (let j = 0; j < magic.length; j++) {
      if (bytes[i + j] !== magic[j]) continue outer
    }
    return true
  }
  return false
}

export function sniffFileType(bytes: Uint8Array): SniffedType {
  // PDF first, and within the same window pdf.js itself accepts.
  if (findMagic(bytes, PDF_MAGIC, PDF_HEADER_SEARCH_WINDOW)) return 'pdf'
  if (startsWithMagic(bytes, ZIP_MAGIC)) return 'zip'
  ...
}
```

**Additionally**, on the apply path change `'unknown'` from a rejection to
INCONCLUSIVE (allow through, breadcrumb only) so it obeys the file's own
stated rule — the async classifier already produces an honest, type-specific
message for a genuinely bad file:

```ts
// src/app/(public)/apply/[orgSlug]/actions.ts:222
// ole2 / rtf are positive contradictions. 'unknown' is INCONCLUSIVE on a
// bounded head read — never reject on it (T-06-34).
if (sniffed === 'unknown') return false
return true
```

Add corpus fixtures: `t1-pdf-bom-prefixed.pdf` and
`t1-pdf-junk-prefixed.pdf`, asserted `expect: 'parse'` in `manifest.json` and
accepted by `assertUploadableCV`.

---

## High

### HI-01 (BLOCKER): the layer-2 suite that "would have caught the 12" exits 0 while running nothing

**File:** `tests/integration/cv-write-path.test.ts:86-96, 114`

**Issue:** The suite gates on `describe.skipIf(!up)` with a `console.warn`.
The file's own comment says *"A silent skip is worse than no test at all"* —
and then implements exactly that: a warning on stdout and a **zero exit
code**.

**Reproduced:**

```
$ npx vitest run --config vitest.integration.config.ts
 Test Files  1 skipped (1)
      Tests  22 skipped (22)
```

Exit code 0. `pnpm test:integration` is "green" having exercised zero
assertions against a real Postgres. Every claim in the 06-05..06-08 summaries
of the form "`pnpm test:integration` 22/22" is unverifiable after the fact
from the exit code alone, and any future CI wiring or founder re-run on a
machine without Docker will report success while proving nothing. This is
the phase's own defect class (a silent pass masking an unexercised path)
relocated into the verification layer.

**Fix:** make skipping opt-in and loud.

```ts
const up = await isStackUp()
const allowSkip = process.env.ALLOW_SKIP_INTEGRATION === '1'

if (!up && !allowSkip) {
  throw new Error(
    'cv-write-path.test.ts: local Supabase stack unreachable. This suite is the ' +
      'only layer that exercises the REAL write path — refusing to pass vacuously. ' +
      'Start the stack, or set ALLOW_SKIP_INTEGRATION=1 to acknowledge the gap.',
  )
}
```

---

### HI-02 (BLOCKER): `pnpm test` is red in the repo as it stands — stale worktree is neither gitignored nor excluded

**Files:** `vitest.config.ts:15-25`, `.gitignore`

**Issue:** `.claude/worktrees/agent-a14b444676e95fad9/` (left behind by this
phase's worktree merges) is untracked, **not in `.gitignore`**, and **not in
vitest's exclude list**. Vitest's default include glob picks up the
duplicated tree.

**Reproduced:**

```
$ npx vitest run
 Test Files  3 failed | 130 passed | 9 skipped (142)
      Tests  1510 passed | 22 skipped | 56 todo (1588)
FAIL .claude/worktrees/agent-a14b444676e95fad9/tests/e2e/auth-guard.spec.ts
     Error: Playwright Test did not expect test() to be called here.
```

With the worktree excluded, the summaries' figure reproduces exactly:

```
$ npx vitest run --exclude '.claude/**' --exclude 'tests/e2e/**' --exclude 'tests/integration/**'
 Test Files  65 passed | 4 skipped (69)
      Tests  755 passed | 28 todo (783)
```

Two consequences: (a) the CLAUDE.md mandatory gate "`pnpm test` passes"
currently **fails** and the founder will see red before UAT; (b) an untracked
full duplicate of the repo sits one `git add -A` away from being committed to
a **public** repo.

**Fix:**

```gitignore
# .gitignore
.claude/
```

```ts
// vitest.config.ts — belt and braces
exclude: [
  '**/node_modules/**',
  '.claude/**',
  'tests/e2e/**',
  'tests/integration/**',
  ...
],
```

Then delete the stale worktree (`git worktree prune` + `rm -rf .claude/worktrees/*`).

---

## Medium

### ME-01 (WARNING): NUL is deleted, not replaced — silently merges words in candidate names

**Files:** `src/lib/text/postgres-safe-text.ts:64`, `src/lib/ai/cv-extract.ts:37`

**Issue:** The module's own stated principle (lines 20-23) is that a lone
surrogate becomes U+FFFD *"rather than vanishing so the loss stays visible."*
NUL gets the opposite treatment — `out.split(NUL).join('')` deletes it
silently.

**Failure scenario:** The documented real-world source of NUL is a PDF
`ToUnicode` CMap mapping a glyph to U+0000 (06-RESEARCH §Code Examples,
reproduced in `hostile/hostile-pdf-tounicode-nul.pdf`). If that glyph is the
**space** in a name, `Jane\0Doe` → `JaneDoe`, which Claude then extracts as
the name and `markCandidateFieldsFromCV` writes to `candidates.full_name`. If
it is a letter, a letter silently disappears. Nothing anywhere records that
content was altered. The current test **pins** the deleting behaviour
(`postgres-safe-text.test.ts:53`), so this is a deliberate decision to
revisit, not an accident.

**Fix:** in the extraction path specifically, substitute a space rather than
deleting — `normaliseWhitespace` already collapses runs immediately
afterwards (`cv-extract.ts:41`), so this costs nothing:

```ts
// src/lib/text/postgres-safe-text.ts
export function sanitiseText(s: string, nulReplacement = ''): string { ... }

// src/lib/ai/cv-extract.ts:37 — a NUL here is a substituted glyph, not padding
const legal = sanitiseText(text, ' ')
```

At minimum, add a Sentry breadcrumb (count only, never content) when
`sanitiseText` alters a string, so silent content loss is at least
observable.

### ME-02 (WARNING): sanitise-then-truncate — a UTF-16 slice can re-introduce a lone surrogate downstream of the sanitiser

**Files:** `src/lib/inngest/functions/parse-cv.ts:296`, `src/lib/ai/embed-text.ts:64`

**Issue:** `sanitiseText` runs inside `normaliseWhitespace`, i.e. **before**
`extracted.slice(0, MAX_CV_TEXT_CHARS)` (60,000) and before
`cvText.slice(0, MAX_CV_CHARS_FOR_EMBED)` (30,000). `String.prototype.slice`
cuts on UTF-16 code units, so a boundary landing mid-surrogate-pair produces
a trailing lone surrogate on a string that was legal a moment earlier.

**Failure scenario:** A ≥60k-char CV with an emoji/astral glyph straddling
index 60,000 yields a lone surrogate in the JSON body sent to Anthropic (and,
at 30,000, to Voyage). Narrow, but it is the exact class this phase exists to
close, and the ordering makes the guarantee false rather than merely
improbable.

**Fix:** re-sanitise after truncation, or truncate on code-point boundaries.

```ts
// parse-cv.ts:296
return sanitiseText(extracted.slice(0, MAX_CV_TEXT_CHARS))
```

### ME-03 (WARNING): sibling write paths for the same illegal-value classes remain unguarded

**Files:** `src/lib/db/candidates-linkedin.ts:158-182` (update), `:210-232` (insert); `src/lib/db/candidates.ts:371` (`createCandidate`)

**Issue:** I traced every production call site of the two new guards — they
exist at exactly three places (`cv-extract.ts:37`,
`candidate-cvs.ts:230`, `candidate-cvs.ts:554`). The LinkedIn ingest writes
`full_name`, `headline`, `about`, `skills`, `work_experience`, `education`
into the **same** `candidates` columns from an extension-supplied JSON body,
with neither `coerceParsedCV` nor `sanitiseForPostgres`, and its `DbResult`
failures carry no `detail`. `createCandidate` — fed by the public apply form
— is likewise unguarded. `zod`'s `z.string()` in
`linkedin-ingest-schema.ts` accepts ` ` and lone surrogates without
complaint.

To be fair to the phase: `acceptCVFieldsAction` and the reconciler's
`heal-unmerged-profiles` — the two paths explicitly in scope — **are**
correctly covered, because both funnel through `markCandidateFieldsFromCV`
which now coerces first (`candidate-cvs.ts:455-462`). The gap is the
siblings, not the ones named.

**Failure scenario:** a NUL or lone surrogate anywhere in a POSTed LinkedIn
capture body → 22P05 / PGRST102 → `{ ok:false, code:'internal' }` → the
extension shows a generic failure, deterministically, forever, with no root
cause captured. Same shape as the 12.

**Fix:** apply the boundary at those writes too.

```ts
// src/lib/db/candidates-linkedin.ts
import { sanitiseForPostgres } from '@/lib/text/postgres-safe-text'
...
.update(sanitiseForPostgres(patch))
...
.insert(sanitiseForPostgres(insertPayload))
```

and widen their failure returns with `failureDetail(...)` (already exported-
shaped in `candidate-cvs.ts:27`; lift it to a shared `db/` helper).

### ME-04 (WARNING): `uploadCVAction` fully buffers up to 10 MiB before any auth or entitlement check

**File:** `src/app/(app)/candidates/[id]/actions.ts:157-161`

**Issue:** `const head = new Uint8Array(await file.arrayBuffer())` executes
**before** `requireEntitledOrg()` (line 163) and before
`supabase.auth.getUser()` (line 169). Next.js Server Actions are not
authenticated by the framework — every action must authorise itself — so an
unauthenticated caller who knows the action ID can drive a full 10 MiB
in-memory materialisation per request. This also contradicts the block
comment 60 lines above it: *"Validation order matters: cheapest first."* The
sniff is now the most expensive validation and it runs first.

The variable name `head` is also misleading — it is the entire file.

**Fix:** move the sniff after the auth + entitlement gates (it still runs
before any Storage write or DB row, which is all the correctness argument
requires), and rename `head` → `bytes`.

```ts
const gate = await requireEntitledOrg()
if (!gate.ok) return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return { ok: false, error: 'Not signed in.' }

// Byte-level sniff — still before any Storage write or candidate_cvs row.
const bytes = new Uint8Array(await file.arrayBuffer())
const signatureCheck = assertUploadableCV(bytes, file.type)
if (!signatureCheck.ok) return { ok: false, error: signatureCheck.message }
```

### ME-05 (WARNING): a zero-length head read is treated as a positive contradiction on the apply path

**File:** `src/app/(public)/apply/[orgSlug]/actions.ts:645-665`

**Issue:** `readObjectHeadBytes` returns `new Uint8Array(await res.arrayBuffer())`.
A zero-length `Uint8Array` is truthy, so `if (headBytes)` passes,
`sniffFileType` returns `'unknown'`, and the row is rejected as a *format
mismatch*. Two problems: an empty/short read (Storage hiccup, a 206 that
returned nothing) is **inconclusive**, not a contradiction; and if the object
genuinely is zero bytes, `CV_WRONG_FORMAT_MESSAGE` ("contents don't match its
extension") describes the wrong failure — `CV_UPLOAD_INCOMPLETE_MESSAGE` is
the honest one, and it carries different, correct UI guidance.

**Fix:**

```ts
if (headBytes && headBytes.length > 0) {
  ... existing sniff ...
} else {
  Sentry.addBreadcrumb({ category: 'apply-form',
    message: 'confirm: byte-sniff read empty/failed — skipping, falling through', level: 'info' })
}
```

### ME-06 (WARNING): `seniority_level` is dropped on any case/whitespace variant instead of normalised

**File:** `src/lib/ai/parsed-cv-schema.ts:200-203`

**Issue:** `coerceSeniority` does an exact-match membership test against the
seven lowercase enum values. `'Senior'`, `'senior '`, `'SENIOR'` are all
dropped silently. The module's rationale for dropping (line 54-56) is sound
for a genuinely off-enum value like `'C-suite'`, but a case variant is a
*recoverable* value, and dropping it loses a field the UI filters on with no
signal to anyone. This is the "coercion defaulting a valid field to nothing"
class.

**Fix:**

```ts
function coerceSeniority(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalised = value.trim().toLowerCase()
  return (SENIORITY_LEVELS as readonly string[]).includes(normalised) ? normalised : undefined
}
```

Extend `parsed-cv-schema.test.ts:223-227` with `'Senior'` → `'senior'`.

---

## Low

### LO-01 (WARNING): comment claims unrecognised extraction errors stay retryable; the code makes them NonRetriable
**File:** `src/lib/inngest/functions/parse-cv.ts:305-306` vs `:325`.
The comment says an unclassified error *"falls through to today's behaviour
exactly: generic, retryable — an unknown fault may well be transient"*, but
line 325 unconditionally throws `NonRetriableError`, so Inngest never retries.
(The recruiter-facing retry button *is* still offered, because the generic
message is excluded from `isUnretryableParseFailure` — so behaviour is
defensible; the comment is wrong and will mislead the next editor.)
**Fix:** correct the comment, or genuinely re-throw the original error for
the unclassified case so the 3 Inngest retries apply.

### LO-02 (WARNING): a raw U+0001 control byte is committed in a test source file
**File:** `tests/unit/lib/pg-legality.test.ts:93` — `classifyForPostgres({ name: 'a\x01b' })`
with the control character written literally. Both `postgres-safe-text.ts:36-39`
and `postgres-safe-text.test.ts:18-26` establish (and justify at length) the
opposite convention: build every special character from `String.fromCharCode`
so a formatter or copy-paste cannot silently disarm the assertion. Verified
by byte-scanning all 38 changed text files — this is the only such
occurrence; no NUL, no invalid UTF-8, no stray U+FFFD anywhere else.
**Fix:** `const SOH = String.fromCharCode(0x01)` and interpolate.

### LO-03 (WARNING): `prettier --check` fails on 6 changed files, two of them production sources
`src/app/(app)/candidates/[id]/actions.ts`, `src/lib/cv/file-signature.ts`,
`tests/fixtures/cv-corpus/hostile-payloads.ts`,
`tests/integration/supabase-harness.ts`,
`tests/unit/lib/ai/cv-parse-truncation.test.ts`,
`tests/unit/lib/cv/parse-messages.test.ts`.
`pnpm lint` passes (0 errors) because ESLint delegates formatting to
Prettier and nothing runs Prettier in the gate.
**Fix:** `npx prettier --write` on those six, and add
`"format:check": "prettier --check ."` to the verification checklist.

### LO-04 (WARNING): `sanitiseForPostgres` can silently collide two keys, and has no cycle guard
**File:** `src/lib/text/postgres-safe-text.ts:90-102`.
`out[sanitiseText(key)] = ...` maps `bad\0key` and `badkey` onto the same
output key — last write wins, silently. Two different lone-surrogate keys
both collapse to the same U+FFFD-bearing key. Separately, a self-referencing
object recurses until the stack overflows. Neither is reachable from Claude's
JSON output today (acyclic, and colliding keys require an adversarial model),
but both are cheap to close.
**Fix:** on collision, keep the first value and add a Sentry breadcrumb;
carry a `WeakSet` seen-set for cycle detection.

### LO-05 (WARNING): a production organization UUID is hard-coded as a default in a public repo
**File:** `tests/forensics/cv-parse-replay.forensic.ts:106-107` —
`process.env.FORENSIC_BILLING_ORG_ID ?? 'cb70bfc3-…'`. Not a credential and
not exploitable without keys, but it is production-identifying data
committed to a public repository, and a default that silently bills a real
org if the env var is unset.
**Fix:** drop the default; add `FORENSIC_BILLING_ORG_ID` to the required-keys
list so an unset value fails loudly.

### LO-06 (WARNING): hardcoded failure literal bypasses the single-source-of-truth message module
**File:** `src/app/(app)/candidates/[id]/actions.ts:266, 373` —
`parseError: 'Could not queue CV for parsing. Try again.'` is written
directly instead of `CV_STUCK_MESSAGE`. This is the exact literal-drift that
`src/lib/cv/parse-messages.ts` was created (SF-1) to eliminate; the file now
imports two predicates from that module while still writing a raw literal
two lines away. Pre-existing, but inside a function this branch edited.
**Fix:** `parseError: CV_STUCK_MESSAGE`.

---

## Info

### IN-01: salary values can reach the forensic replay's on-disk output
`tests/support/pg-legality.ts:26` (`value?: number`) → `replay.json`
(`cv-parse-replay.forensic.ts:443-450`). The directory is gitignored and the
committed 06-FORENSICS.md carries counts only, so this is contained — worth
knowing the file is not PII-free if it is ever pasted somewhere.

### IN-02: the PII tripwire is blind to compressed PDF text streams
`tests/unit/fixtures-pii-guard.test.ts:91` reads as latin1, so deflate-
compressed Chromium PDF content streams are invisible to it. The file
documents that false negatives are acceptable. Coverage is transitive in
practice (every tier-1 PDF is rendered from a committed HTML source that
*is* scanned), which is fine — just not what the test name implies.

### IN-03: `parse_error_detail` remains a migration FILE only
`supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql`
exists but, per 06-CONTEXT.md, was not applied to production. Until the
founder pushes it, `updateCandidateCVParse`'s defensive fallback
(`candidate-cvs.ts:235-253`) strips the column on every write and the phase's
headline observability win (SQLSTATE + column capture) stores nothing in
prod. The fallback itself is correct and I verified it re-runs the update
with the exact remaining columns and reports `sentColumns` accordingly. Flag
this at the top of the founder handoff.

---

## Checks that came back CLEAN

Recorded so the negative results are auditable, not assumed.

**The phase's own bug class (sanitisation corrupting good data)**
- Unicode preservation is pinned, not asserted: CJK (`张伟`), RTL (`مرحبا`),
  diacritics (`Zoë O'Brien-Şahin`, `Aoife Ní Bhraonáin`), ZWJ emoji, astral
  plane, BOM, soft hyphen, NBSP, U+0001/U+001F, and a clean 1.1 MB string all
  round-trip byte-for-byte (`postgres-safe-text.test.ts:80-108`) — and the
  same glyphs are pinned through the **real** extractor against real
  PDF/DOCX fixtures via `manifest.json`'s `mustContain`
  (`cv-extract-corpus.test.ts:123-140`). The sanitiser touches exactly two
  sequences.
- `coerceParsedCV` drops rather than clamps: `2015` → absent, `1000` → absent,
  `999.9` → kept, `999.96` → absent (scale-then-precision reasoning is
  correct for `numeric(4,1)`). No fabricated value is ever written.
- A single bad field never fails a whole parse — verified by construction
  (every transform is total; no `z.coerce.*`) and by test
  (`parsed-cv-schema.test.ts:48-65`), plus a no-throw sweep over the entire
  hostile-payload table.
- 100k-char `work_history[].summary` survives intact.

**Ordering: sanitise vs coerce vs write**
- Traced every production call site of both guards: `cv-extract.ts:37`
  (pre-Claude), `candidate-cvs.ts:230` (`updateCandidateCVParse`, sanitises
  the whole patch incl. keys), `candidate-cvs.ts:554`
  (`markCandidateFieldsFromCV`, after coercion). Coerce-then-sanitise-then-
  write holds at both DB boundaries.
- `markCandidateFieldsFromCV` coerces **before the first field read**
  (`:455-462`), which is what makes `acceptCVFieldsAction` (raw stored
  `extracted_data`) and the reconciler's `heal-unmerged-profiles`
  (`reconcile-cv-parses.ts:454-459`) safe. Both were named in scope; both are
  covered. `currency` is correctly carried across the boundary by the caller
  rather than by the model.
- `extracted_data` has exactly one writer in the whole codebase
  (`parse-cv.ts:384`), and it writes the coerced object.
- `mapWorkHistory` / `mapEducation` read only keys that `WORK_HISTORY_KEYS` /
  `EDUCATION_KEYS` preserve — the coercion does not strip anything a
  downstream mapper needs.

**Retry-refusal logic**
- No transient class is classified unretryable: `isUnretryableParseFailure`
  contains exactly the six deterministic file-property classes; budget-capped,
  stuck, generic and max_tokens-truncation are all excluded, each with a
  correct rationale.
- No unretryable class still offers retry: verified per-class in
  `cv-review-panel.test.tsx:127-153` by accessible role, and the server-side
  half (`retryParseAction`) gates on the **same** shared predicate before the
  status reset, so a direct action call can neither retry nor clear the
  honest message.
- The `preserveExistingMessage` semantics from the 4 Aug fix are intact:
  preserve-both-or-neither (`parse-cv.ts:113-129`), `onFailure` passes
  `true`, in-body branches default to `false`, and `retryParseAction`'s reset
  to `pending`/NULL still prevents a stale message resurrecting.
- Budget-cap flow unchanged: pre-flight returns without throwing;
  mid-parse `CapExceededError` returns without throwing; neither burns
  Inngest retries.
- Empty-profile guard (`isProfileEffectivelyEmpty`) untouched and still
  short-circuits the embed.

**file-signature sniffing (beyond CR-02)**
- Every magic check is bounds-checked before indexing; zero-byte and 2/3-byte
  buffers return `'unknown'` without throwing (pinned).
- ZIP entry-order concern is handled correctly for the **full-read**
  recruiter path: `isDocxArchive` scans head **and tail** 64 KiB, and the ZIP
  central directory at the tail lists every entry name regardless of local-
  header order. Verified against all three real tier-1 DOCX fixtures plus the
  two hostile DOCX fixtures.
- The bounded-read false-negative is correctly documented and correctly
  handled: ZIP declared DOCX with no DOCX entries in the window is allowed
  through, with an observability breadcrumb (test at
  `confirm-action-file-sniff.test.ts:277`).
- No zip inflation anywhere — `jszip` stays a devDependency, `grep -rn jszip src/`
  returns only explanatory comments.
- Recruiter-path rejection leaves **no** state: it returns before
  `nextCVVersion`, before `storage.upload`, before `createCandidateCV`. No
  orphan object, no row.
- A storage read failure at confirm never blocks an application (falls
  through with a breadcrumb; pinned by test).

**parse_error_detail PII safety**
- `failureDetail` (`candidate-cvs.ts:27-34`) reads **only** `error.code` and
  concatenates hard-coded sub-op labels plus column names. `err.message` is
  never touched anywhere in the chain.
- The one place a caught error's `.message` is surfaced verbatim
  (`parse-cv.ts:541-542`) is gated on `instanceof WriteExtractedFailedError`,
  whose message is itself built only from `DbResult.detail`/`code`. Every
  other error keeps `${name}: ${status}`.
- All other detail strings are hard-coded literals or `${err.name}
  (${mimeType})` — `classifyExtractionError` classifies by name/substring and
  never echoes a message into `detail`.
- The pre-migration defensive fallback is preserved and now reports the
  columns of the statement that actually failed.

**Tenancy, boundaries, secrets**
- No new query lacks tenant scoping. `confirmApplyAction` still re-derives the
  org from the slug and re-verifies `(org, candidate)` on the CV row; the
  new sniff sits after that check and reads only `cvRow.storage_path`.
  `parse-cv.ts`'s storage-path tenant boundary check is untouched.
- No client component imports `parsed-cv-schema`, `postgres-safe-text`,
  `file-signature` or `extraction-errors`; none of those modules imports
  `server-only`, and none pulls in a browser Supabase client. `parse-messages`
  remains the only module the `'use client'` panel imports.
- Sentry config / `beforeSend` scrub: `git diff` shows zero changes.
- **Byte-scanned all 38 changed text files**: no NUL, no invalid UTF-8, no
  stray U+FFFD; the single control byte found is LO-02.
- No secrets in the diff (only `'sk-ant-test-fake'` in a mock);
  `.env.forensics.local` is covered by `.gitignore`'s `.env*`.
- The `purpose` override added to `parseCVDetailed` does **not** open an AI-cap
  bypass: `checkCap` runs the entitlement gate and the £ spend-ceiling gate
  for *every* purpose (`cap-enforcement.ts:111-125`); only the per-unit ratio
  check is skipped for an unmapped bucket. The £3,000/mo backstop still
  applies to `cv_parse_forensic`.
- Forensic replay is **write-free** against the database: no `.insert` /
  `.update` / `.upsert` / `.delete` / `.rpc` anywhere in the file; the only
  writes are to the gitignored `tests/forensics/.out/`. Its guard rails
  (billing-org ≠ target-org, required-env assertions) are real assertions.
- Integration harness hard guard is real: refuses any non-localhost/127.0.0.1
  resolved URL before constructing the service-role client.

**Tests**
- **Red→green conversion is legitimate.** All three named files are
  byte-identical to their original RED commits — `git diff <creation>:<path>
  ecb9b75:<path>` is empty for `tests/integration/cv-write-path.test.ts`
  (30c6782), `tests/unit/lib/ai/cv-extract-corpus.test.ts` (510f5b1) and
  `tests/unit/lib/ai/cv-parse-truncation.test.ts` (feb9d28). No assertion was
  edited after the fix landed.
- The green tests are not tautologies: they assert **stored** values re-read
  from the DB (layer 2), real extractor output against real binary fixtures
  (layer 1), and scripted SDK responses driving real branch selection
  (truncation). `cv-extract-corpus.test.ts` deliberately does not import the
  production sanitiser, so it cannot assert the fix against itself. The
  corpus suite also asserts `coveredFiles.size === manifest.length`, so a
  fixture cannot go unexercised.
- Fixture-generator determinism claims hold up on inspection: PDF
  `/CreationDate`+`/ModDate` are rewritten in place at fixed width (offsets
  preserved), every `zip.file()` passes a fixed date, `stabiliseZipFolderDates`
  catches jszip's auto-created folder entries, and all "random" bytes come
  from a seeded mulberry32 — never `Math.random()`/`crypto.randomBytes`.
- `tsc --noEmit` clean; `eslint src tests` 0 errors / 22 warnings (all
  pre-existing `_`-prefixed unused params).
- Unit suite: **755 passed** once the stale worktree is excluded (HI-02).

---

## Recommended fix order

1. **CR-01** — one-line client fix + a rendering test. Highest
   customer-visible impact, lowest effort.
2. **CR-02** — 1024-byte header search + `'unknown'` → inconclusive on the
   apply path + two new corpus fixtures.
3. **HI-02** — `.gitignore` + vitest exclude, so the gate is trustworthy
   before anything else is re-verified.
4. **HI-01** — fail-closed integration skip; then re-run
   `pnpm test:integration` against a live local stack and record the real
   22/22.
5. ME-01 … ME-06, then LO-01 … LO-06.
6. Re-run the full gate (`pnpm lint`, `tsc --noEmit`, `pnpm test`,
   `pnpm test:integration`) and only then the browser pre-smoke.

---

_Reviewed: 2026-08-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
