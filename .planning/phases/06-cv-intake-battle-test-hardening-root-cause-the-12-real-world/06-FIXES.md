---
phase: 06-cv-intake-battle-test-hardening-root-cause-the-12-real-world
fixed_at: 2026-08-09
source_review: 06-REVIEW.md
review_verdict: FIX-FIRST (4 blockers)
branch: worktree-agent-a8a4015a410d8d3ab
base_commit: ecb9b75
scope: all critical + all high + named mediums (ME-01, ME-02, ME-03)
findings_in_scope: 7
fixed: 6
documented_decision: 1
deferred: 0
status: all_in_scope_addressed
---

# Phase 6 — Review Fix Report

Fixes for `06-REVIEW.md` (2026-08-09, deep review of `d01bdc1..ecb9b75`).
Scope as instructed: **all critical + all high + the three named mediums**.
Every fix is its own commit, applied on top of `ecb9b75`.

## Summary

| Finding | Class | Outcome | Commit |
|---|---|---|---|
| CR-01 | BLOCKER | Fixed | `24217fd` |
| CR-02 | BLOCKER | Fixed | `4992642` |
| HI-01 | BLOCKER | Fixed | `3bf3163` |
| HI-02 | BLOCKER | Fixed | `99304f7` |
| ME-01 | WARNING | Documented decision (deletion kept — frozen contract wins) | `21759a2` |
| ME-02 | WARNING | Fixed | `138643f` |
| ME-03 | WARNING | Fixed (+ layer-2 proof; one sub-path deferred with reason) | `b5e7fa8`, `f330f93`, `c4f3c6d` |

Not in scope, untouched, still open for the founder: ME-04, ME-05, ME-06,
LO-01 … LO-06, IN-01 … IN-03.

---

## HI-02 — vitest scanned `.claude/worktrees` — `99304f7`

**Was:** `pnpm test` red in the working tree. `.claude/worktrees/<agent>/` is
a full duplicate of the repo; vitest's default include glob discovered every
spec twice and the duplicated Playwright specs hard-failed the run.

**Change:**
- `vitest.config.ts` — added `'.claude/**'` to `exclude`.
- `vitest.integration.config.ts`, `vitest.forensics.config.ts` — added
  explicit `exclude` arrays (belt and braces; their `include` globs are
  already root-relative).
- `.gitignore` — added `.claude/`. The reviewer's second point: an untracked
  full duplicate of the repo sitting one `git add -A` away from a **public**
  repo. Nothing under `.claude/` is tracked, so this changes nothing else.

**No worktree content deleted** — live agent worktrees exist.

**Verified:** `npx vitest run` → 65 passed | 4 skipped, **755 passed | 28
todo**, reproducing the reviewer's figure exactly.

---

## CR-01 — apply form discarded the server's honest message — `24217fd`

**Was:** `confirmApplyAction` returns an actionable `formError` ("save it as
a real PDF or .docx and upload again"); the client threw it away and toasted
hardcoded copy claiming the CV *uploaded fine* and to email the agency — the
opposite of the truth for a rejected file, and the one action that cannot fix
it.

**Change:** `apply-form.tsx` now renders `confirmResult.formError` verbatim.
The generic copy survives only as a fallback for an **empty** message, never
as a replacement for one the server supplied. No message text is duplicated
client-side — it all comes from the server response.

**Test:** new `tests/unit/app/apply/apply-form-confirm-message.test.tsx`
walks the real component to the DOM/toast boundary (the existing action-level
test asserts only the server return value, which is why nothing caught this).
It also asserts the *absence* of the old falsehood — no "uploaded but we
couldn't", no contact email — for the wrong-format case.

**Red-then-green proven:** with `apply-form.tsx` reverted, 2 of 3 new tests
fail; with the fix, 3 pass.

---

## CR-02 — sniffer was stricter than the parser it gates — `4992642`

**Was:** `sniffFileType` required `%PDF-` at offset 0. pdf.js does not:
`checkHeader()` calls `find(stream, "%PDF-")` with a default 1024-byte limit
and then `moveStart()`s the stream to the header. Re-verified in the bundled
source during this fix: `function Uc(t,e,n=1024,s=!1)` called as `Uc(e, X1)`
with `X1 = new Uint8Array([37,80,68,70,45])`. A BOM- or gateway-prefixed PDF
parses perfectly and is in the customer's back-book today; the recruiter path
blocked it outright and the apply path marked it `failed` with a message
inside `isUnretryableParseFailure` — a permanent dead end.

**Change (as locked):** `findMagicWithin()` mirrors pdf.js's window exactly —
the signature must both start and fit within the first 1024 bytes, which is
what pdf.js's `peekBytes(n)` + `r = a.length - i` bound gives.

**One deliberate ordering choice, documented in the module:** offset-0
signatures are resolved **first**, and only then does the PDF search widen.
A file starting `PK\x03\x04` genuinely *is* a zip even if `%PDF-` appears
inside its first KiB (a stored entry name, an embedded PDF). Searching the
window first would reclassify such a DOCX as a PDF and have
`assertUploadableCV` reject it as mislabelled — trading CR-02's false
rejection for a new one. As written, the widened search can only turn a
former `'unknown'` into `'pdf'`; **no previously-classified file changes
classification.**

**Fixtures (corpus/manifest/generator — not frozen, extension allowed):**
- `tier1/t1-pdf-bom-prefixed.pdf` — 3-byte UTF-8 BOM.
- `tier1/t1-pdf-junk-prefixed.pdf` — 45-byte mail-gateway preamble.

Both derived from the already-deterministic single-column PDF with **fixed**
prefixes, so determinism and regen idempotence hold. Verified:
- `pnpm fixtures:regen` left **every pre-existing fixture byte-identical**
  (`git status` showed only the two new files + manifest).
- Two consecutive regens produced **byte-identical** md5s across all fixtures
  and the manifest.
- Both extract **1612 chars**, identical to the unprefixed original.

**Layer-1 assertions without touching a frozen file:**
`cv-extract-corpus.test.ts` is manifest-driven by design, so both fixtures
picked up "extracts real text with the expected content and zero illegal
bytes" automatically — confirmed in its verbose output. The frozen file gained
nothing and lost nothing.

**Signature tests:** `file-signature.test.ts` (not frozen) pins both real
fixtures accepted, the window boundaries (start offset 1019 found, 1020 not),
and the zip-ordering guarantee.

**Not done — out of the locked scope:** the reviewer's *additional*
suggestion to make `'unknown'` INCONCLUSIVE (allow-through) on the apply path
is a behaviour change that was not part of the locked decision, so it is left
for the founder. The concrete failure CR-02 describes is closed regardless:
prefixed PDFs now sniff as `'pdf'` and pass on both paths.

---

## HI-01 — integration gate was silently green with the stack down — `3bf3163`

**Was:** `pnpm test:integration` exited **0 with 22 skipped** when the stack
was unreachable. Every "22/22" claim in the 06-05..06-08 summaries was
unverifiable from the exit code alone.

**Change:** new `tests/integration/require-stack.setup.ts`, wired as
`globalSetup` in `vitest.integration.config.ts` — it runs before any file is
collected and throws:

> `local Supabase stack is not running — start it with `pnpm exec supabase start``

...plus the full exclusion-flag command and an explanation that this is the
only layer exercising the real write path.

**It lives in the runner, not in the suite,** because
`tests/integration/cv-write-path.test.ts` is frozen. The existing
`describe.skipIf` is untouched.

`CI_SKIP_INTEGRATION=1` restores the skip for an environment that genuinely
cannot run Docker — loud, with a warning that the real write path was **not**
exercised. Silence is never the default.

**Verified:** stack down → **exit 1** with the message; `CI_SKIP_INTEGRATION=1`
→ exit 0, 22 skipped, warning printed; stack up → 25/25 green.

---

## ME-01 — NUL deleted, not replaced — decision recorded — `21759a2`

**Checked the frozen contracts first, as instructed. They pin deletion:**
`tests/integration/cv-write-path.test.ts` asserts the values read back from a
real Postgres — `'JaneDoe'` (C1a), the key `badkey` (C1b), `'Texthere'`
(C1c).

**Therefore deletion is KEPT** and the rationale is documented in
`postgres-safe-text.ts`'s header, per the locked instruction. The header now
states the asymmetry, the failure it can cause (`Jane<NUL>Doe` → `JaneDoe`
merges words in a name), why it stands, and the exact conditions for
revisiting it — change the substitution **and** the three C1 assertions in
one deliberate commit, with the red-suite freeze explicitly lifted first.

Documentation only. **No behaviour change. No frozen file edited.**

---

## ME-02 — slice could split a surrogate pair — `138643f`

**Was:** both truncations ran downstream of the sanitiser (cv-extract
sanitises inside `normaliseWhitespace`; `parse-cv.ts` then sliced to 60,000
and `embed-text.ts` to 30,000). `String.prototype.slice` cuts on UTF-16 code
units, so a boundary inside a surrogate pair left a **lone surrogate** on a
string that was legal a moment earlier → PGRST102.

**Change:** new `truncateLegal(s, maxChars)` in `postgres-safe-text.ts` —
truncate, then re-sanitise (the locked "slice before sanitisation" ordering).
`parse-cv.ts:296` and `embed-text.ts:64` now call it. Same-reference fast path
preserved.

**Tests** (in `postgres-safe-text.test.ts`, not frozen): pins the premise —
a bare `.slice()` genuinely does yield a lone high surrogate — and the fix,
including at the real 60,000-char boundary, using an **independent**
lone-surrogate probe rather than the implementation's own regex.

---

## ME-03 — unguarded sibling write paths — `b5e7fa8`, `f330f93`, `c4f3c6d`

**Was:** the two guards existed at exactly three CV-pipeline call sites. The
LinkedIn ingest and the public apply form write the **same** candidates
columns from an extension-supplied JSON body and an untrusted browser form;
`z.string()` accepts both illegal sequences, so either one made the write fail
deterministically with no root cause captured — the same shape as the 12.

**Change (surgical, at the write boundary):**
- `candidates-linkedin.ts` — `sanitiseForPostgres` on both the UPDATE patch
  and the INSERT payload.
- `candidates.ts` `createCandidate` — same on its insert payload.
- New `src/lib/db/failure-detail.ts` lifts `failureDetail` out of
  `candidate-cvs.ts` (identical implementation, one copy not two) so all
  three paths report a PII-free root cause. `DbResult.detail` was already
  optional, so no call site needed changing.

**Tests:**
- Unit — `tests/unit/lib/db/write-boundary-sanitisation.test.ts` captures the
  payload actually handed to supabase-js and asserts recursively (values
  **and** keys) that neither illegal sequence survives, while content is
  otherwise preserved. Red-then-green proven: with both db files reverted,
  all 3 fail.
- Layer 2 — new `tests/integration/candidate-write-siblings.test.ts` (its own
  file; the frozen one untouched) proves the write actually **lands** in a
  real Postgres and re-reads the stored value: NUL removed, lone surrogate →
  U+FFFD, and legitimate unicode (CJK, RTL, diacritics) byte-identical.

**Deferred, with reason — `upsertCandidateFromLinkedIn` at layer 2:**
it cannot be exercised by this harness. Its INSERT deliberately omits
`organization_id` and relies on the `candidates_set_org` trigger reading
`auth.uid()`; the harness holds a **service-role** client, which has none, so
the trigger raises `P0001` for any caller, sanitised or not. Confirmed
empirically against the live local stack:

```
P0001 (candidates.insert: full_name, headline, about, email, location,
       current_role_title, current_company, skills, work_experience,
       education, source, source_detail, consent_basis, consent_at,
       consent_text_version)
```

(That one-line diagnosis is the ME-03 `detail` widening paying for itself —
before it, this returned a bare `code: 'internal'`.) Covering it at layer 2
would mean teaching the harness to mint a real authenticated session, a much
larger change than the fix it would verify. The path's sanitisation **is**
fully pinned at the unit level, and the layer-2 half holds transitively via
`createCandidate` writing the same columns. Reasoning is recorded in-file so
the next editor doesn't rediscover it.

---

## Gate results

Run after all fixes, from this worktree.

| Gate | Result |
|---|---|
| `pnpm typecheck` (`tsc --noEmit`) | **clean**, 0 errors |
| `pnpm lint` | **0 errors**, 24 warnings — all pre-existing `_`-prefixed unused params; none in any file changed here |
| `pnpm test` (unit) | **67 passed \| 4 skipped (71 files)**, **780 passed \| 28 todo (808)**, 0 failed — up from 755 passed at review time |
| `pnpm test:integration`, stack **up** | **2 files passed, 25/25 passed** (22 frozen + 3 new) |
| `pnpm test:integration`, stack **down** | **exit 1** with the required message (was: exit 0, 22 skipped) |
| `pnpm test:integration`, `CI_SKIP_INTEGRATION=1` | exit 0, 22 skipped, loud warning |
| `pnpm fixtures:regen` | pre-existing fixtures byte-identical; two consecutive runs byte-identical (idempotent) |

**Frozen red-suite files — byte-identical to their creation commits
(blob-hash compared, not just diffed):**

| File | Creation commit | Blob hash | Now |
|---|---|---|---|
| `tests/integration/cv-write-path.test.ts` | `30c6782` | `20dd465b…` | identical |
| `tests/unit/lib/ai/cv-extract-corpus.test.ts` | `510f5b1` | `d9dc2624…` | identical |
| `tests/unit/lib/ai/cv-parse-truncation.test.ts` | `feb9d28` | `3cfbba4a…` | identical |

**Constraint compliance:** no migrations; no production access (local
Docker stack only, started and stopped within this run); pnpm/corepack only;
TypeScript strict throughout. All 19 changed text files byte-scanned — **no
raw control bytes, no stray U+FFFD**; every special character in new tests is
built with `String.fromCharCode` / `String.fromCodePoint`.

**Left alone as instructed:** `tests/smoke/authed/cv-intake.smoke.ts` and
`tests/smoke/README.md` (concurrently authored elsewhere) — neither was read
nor written.

---

_Fixed: 2026-08-09_
_Base: `ecb9b75` (the reviewed head)_
