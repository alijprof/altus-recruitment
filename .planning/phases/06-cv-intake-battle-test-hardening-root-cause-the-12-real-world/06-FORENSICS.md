# 06-FORENSICS — replay of the 12 failed CV rows (Steele Charles, 5-6 Aug)

**Zero-cost half run:** 2026-08-09 (read-only; no AI calls; generatedAt 2026-08-09T19:18:00.554Z)
**AI half:** not yet run (ANTHROPIC_API_KEY exists only in Vercel — founder-optional, see below)

## Extracted-text scan (FORENSIC_SKIP_AI=1)

| # | cv id | mime | chars | NUL | lone surr | U+FFFD | sliced | extract error |
|---|-------|------|-------|-----|-----------|--------|--------|---------------|
| 1 | de5d0390 | pdf | 3120 | 0 | 0 | 0 | False | — |
| 2 | 418ceb4e | pdf | 3120 | 0 | 0 | 0 | False | — |
| 3 | 47ab8c29 | docx | 6281 | 0 | 0 | 0 | False | — |
| 4 | d4e68fd3 | pdf | 3850 | 0 | 0 | 0 | False | — |
| 5 | 934e26be | pdf | 3850 | 0 | 0 | 0 | False | — |
| 6 | 0e7a622e | pdf | 11509 | 0 | 0 | 0 | False | — |
| 7 | 21af6768 | pdf | 2480 | 0 | 0 | 0 | False | — |
| 8 | d16c8e67 | pdf | 2927 | 0 | 0 | 0 | False | — |
| 9 | b5cf2d95 | pdf | 2927 | 0 | 0 | 0 | False | — |
| 10 | 465998dd | docx | 3312 | 0 | 0 | 0 | False | — |
| 11 | 423ccf48 | pdf | 11353 | 0 | 0 | 0 | False | — |
| 12 | c782bce1 | pdf | 2809 | 0 | 0 | 0 | False | — |

## Findings

1. **All 12 extract cleanly.** Zero NUL bytes, zero lone surrogates, zero U+FFFD,
   no extraction errors, normal lengths (2,480–11,509 chars). The extractor-emitted-
   illegal-bytes classes (RESEARCH C1/C2) are NOT the cause for these 12 rows.
   (Those classes remain real — reproduced against local Postgres — and keep their
   red tests + sanitiser fix as defence in depth.)
2. **Identical char-lengths in pairs (3120×2, 3850×2, 2927×2)** = same file re-uploaded
   after failing — the 12 rows are ~9 distinct documents, each failing deterministically.
3. **Elimination logic:** extraction clean + exactly one successful cv_parse Claude call
   per upload + deterministic per-file failure ⇒ the illegal content is in CLAUDE'S
   PARSED OUTPUT hitting DB type bounds or unguarded casts: years_experience
   numeric(4,1) overflow (a '\u2265 1000' value, e.g. a year misread as years-of-
   experience), salary integer casts, non-string name / null work_history entries
   (TypeError before write), or truncation at max_tokens=2048 producing a partial
   object through the unvalidated `as ParsedCV` cast (stop_reason capture will tell).
4. **Consequence for the phase:** Wave 4's coercion boundary (zod bounds + coerceParsedCV)
   is now the primary fix for the customer's 12; the Postgres sanitiser remains
   defence-in-depth for the extractor classes. No plan changes needed — both were
   already in scope with red tests.

## AI half (optional, founder-run, ~20-30p billed to founder org)

Would name the exact class per row by re-running Claude on each extracted text and
validating the output against the pg-legality classifier + capturing stop_reason.
Instructions: tests/forensics/README.md. **Not blocking:** Waves 3-6 fix every
candidate class regardless, and Wave 8's retry-the-12 acceptance run proves closure
empirically. Run it only if you want per-row attribution before the fixes land.

## Outcome (2026-08-10, post-fix retry)

All 12 rows retried through the fixed pipeline via their original cv/uploaded
events: **12/12 complete, 10/10 distinct candidates with populated profiles.**
Root-cause attribution: write-stage (Claude-output-vs-DB-bounds) per the
layer-2 regression suite; extraction was never the problem for these rows.
