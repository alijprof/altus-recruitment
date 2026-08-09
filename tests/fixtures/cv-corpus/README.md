# CV intake fixture corpus

Permanent, committed fixture corpus for Phase 6 (CV Intake Battle-Test &
Hardening). It exists so a format regression in the CV extraction pipeline
(`src/lib/ai/cv-extract.ts`) can never ship silently again — every class of
document the production extractor is expected to handle, reject, or be
proven hostile against has a fixture here, plus a `manifest.json` that
records what each fixture proves.

## The three tiers

- **`tier1/`** — documents the extractor **MUST PARSE**. Realistic PDFs
  (single/multi-column, tables, headers/footers, hyperlinks, embedded
  images, unicode, LinkedIn "Save to PDF" exports, long documents) and DOCX
  files (templates, tables, headers, text boxes, unicode). A green result
  here proves the extractor still handles the shapes real CVs actually
  arrive in.
- **`tier2/`** — documents the extractor **MUST FAIL FAST AND HONESTLY**:
  scanned/image-only PDFs, encrypted PDFs, corrupt/truncated/zero-byte
  files, wrong-extension files (DOCX bytes labelled `.pdf` and vice versa),
  legacy `.doc`, `.rtf`, `.odt`, `.txt`. None of these should ever produce a
  silent "complete" with an empty profile, or the generic "Parsing failed"
  message with no cause.
- **`hostile/`** — documents that parse **successfully** but are
  deliberately built to make the extractor emit a literal `U+0000`
  (Postgres-illegal in `text`/`jsonb` columns) or other Postgres-illegal
  byte sequences. These reproduce the verified root-cause mechanisms behind
  the 12 production CV-parse failures from 5–6 Aug 2026 (see
  `.planning/phases/06-.../06-RESEARCH.md`). A green ("parses fine, 0 NUL")
  result on one of these fixtures **before** the sanitisation fix (plan
  06-06) lands means the fixture itself is wrong — not that the underlying
  bug is fixed.

`manifest.json` is the machine-readable contract: one entry per fixture,
with `tier`, `mime`, `expect` (`parse` | `reject`), and either `minChars`
/`mustContain`/`expectNulCount` (Tier-1, hostile) or `expectErrorName`
/`expectMinCharsBelow` (Tier-2). Layer-1 (extraction unit tests) and
Layer-2 (full write-path integration tests) — both added in later Wave-2
plans — assert against this manifest, never against hand-picked
expectations duplicated in test files.

## The synthetic-identity rule

**Every name, employer, email and phone number in this corpus is
synthetic.** Nothing here was ever copied from a real CV, a real person, or
production data — this repository is public, and anything committed here is
world-readable forever.

The generator enforces this with a single source of truth:
`SYNTHETIC_PEOPLE` / `SYNTHETIC_EMPLOYERS` in `generate.mjs`. Rules:

- **People**: drawn only from the fixed list in `SYNTHETIC_PEOPLE` (Zoë
  O'Brien-Şahin, 张伟, Aoife Ní Bhraonáin, Jan Kowalski — chosen for
  diacritic/CJK/unicode coverage, not because they resemble anyone real).
- **Emails**: always `@example.com` (IANA-reserved for documentation/
  examples, never routable).
- **Phones**: always the Ofcom drama range `+44 7700 900xxx` (reserved by
  Ofcom for fiction/testing — never dialable).
- **Employers**: invented (`Northwind Offshore Ltd`, `Cerulean Rail Group`,
  `Solstice Grid Systems`, `Meridian Subsea Ltd`).

If you add a fixture, reuse an existing synthetic person/employer or add a
new one to the same constant block — never hand-type a new name/email/phone
inline, and never paste in real CV content "just for realism."

Plan 06-04 adds a CI grep across `tests/fixtures/**` that fails the build on
real-looking domains (`@gmail.com`, `@outlook.com`, etc.) or UK mobile
prefixes outside the Ofcom range, as a backstop against this rule being
violated by accident.

## Why the binaries are committed (not generated in CI)

CI must not need a real browser to run the extraction test suites, and the
corpus must be byte-stable so `git diff` on it is always meaningful. The
generator therefore runs locally/deliberately and its **output binaries are
committed**, alongside the HTML sources that produced the PDFs (in
`sources/`, reviewable in a normal text diff) and the generator script
itself (`generate.mjs`, also reviewable).

`pnpm fixtures:regen` is idempotent — running it twice back-to-back leaves
`git status` clean (the generator pins Chromium's `/CreationDate`/`/ModDate`
and jszip's per-entry mtimes, including auto-created folder entries, to a
fixed date; without that, both would embed the real wall-clock time on
every run and churn the whole corpus on every regeneration).

**Chromium version upgrades will still change the exact PDF bytes**
(different font subsetting, layout engine internals) — that's expected and
accepted (see the phase's threat register, T-06-11). Layer-1/2 test
assertions key on **extracted content** via the manifest, never on raw byte
hashes, so a Chromium upgrade does not itself break the test suite. Run
`pnpm fixtures:regen` deliberately when you actually need to touch a
fixture — not as a side effect of an unrelated change, and always review
the resulting diff before committing it.

## How to add a fixture

1. Pick the right tier (`tier1` if the extractor must succeed on it, `tier2`
   if it must fail fast and honestly, `hostile` if it succeeds but carries a
   Postgres-illegal byte sequence).
2. Add a builder function in `generate.mjs`, in the matching `TIER 1` /
   `TIER 2` / `HOSTILE` section, drawing any names/employers/contacts from
   `SYNTHETIC_PEOPLE`/`SYNTHETIC_EMPLOYERS` (add a new synthetic entry there
   first if you need one). For a PDF, write the HTML to `sources/` via
   `writeSourceHtml()` before rendering it, so the content stays reviewable.
3. Call `pushManifest({...})` for the new fixture — either by adding an
   entry to the `TIER1_MANIFEST_DEFS` table (verified against the real
   extracted text by `verifyTier1Manifest()`) if it's Tier-1, or inline
   next to the fixture's own builder code in `buildTier2()`/`buildHostile()`
   otherwise. Every entry needs a `why` explaining what the fixture proves
   — a fixture nobody can explain is a fixture nobody will maintain. For
   Tier-2/hostile fixtures, let `observeExtraction()` (which runs the
   `mirrorExtractTextFromBuffer()` self-check) tell you the real error
   name/NUL count and put THAT in the manifest; never hand-write a
   predicted value.
4. Run `pnpm fixtures:regen`, confirm the new fixture is non-empty and
   under the 1 MiB cap (the generator throws if not), and confirm
   `git status` is clean on a second consecutive run (idempotency).
5. Commit `generate.mjs`, any new `sources/*.html`, the fixture binary, and
   the updated `manifest.json` together.

## Self-checks

Several fixtures are only useful if what they claim to prove is actually
true, so the generator proves it rather than assuming it:

- `hostile-pdf-tounicode-nul.pdf` and both `hostile-docx-*-nul.docx`
  fixtures: the generator runs a local mirror of
  `src/lib/ai/cv-extract.ts`'s `extractTextFromBuffer()` +
  `normaliseWhitespace()` over the freshly-built bytes and throws if the
  extracted text does **not** contain a literal `U+0000`.
- `t2-pdf-scanned-no-text.pdf`: the generator asserts the mirror extracts
  fewer than 50 characters (the `MIN_EXTRACTED_CHARS` threshold in
  `src/lib/inngest/functions/parse-cv.ts`) and throws if it extracts more.
- Every Tier-2 fixture's `expectErrorName` in the manifest is the error
  **actually observed** by running the mirror over the fixture during
  generation — never a hand-typed guess (e.g. the encrypted-PDF fixture's
  `PasswordException` and the wrong-extension fixtures' errors were
  confirmed this way, not assumed from documentation).

This file is plain Node ESM (no TypeScript runner), so it cannot `import`
the real `.ts` extractor — the mirror is kept in sync by hand. If
`cv-extract.ts`'s normalisation logic changes, update the mirror in
`generate.mjs` to match, or these self-checks will silently diverge from
what production actually does.
