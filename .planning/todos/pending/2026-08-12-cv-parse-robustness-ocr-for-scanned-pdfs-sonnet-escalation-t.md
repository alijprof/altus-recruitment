---
created: 2026-08-12T11:00:01.597Z
title: CV parse robustness: OCR for scanned PDFs, Sonnet escalation, targeted re-ask
area: general
files:
  - src/lib/inngest/functions/parse-cv.ts
  - src/lib/cv/parse-messages.ts
---

## Problem

Founder asked (2026-08-12) how to make CV parsing more robust. Pipeline is
healthy post-Phases 6-7 (fixture corpus + harness, honest failures, 3 retries,
15-min reconciler, confidence flags + editing; 0 failures in 48h), but three
genuine robustness levers remain, in value order:

1. **Scanned/image-only PDF CVs fail honestly but unrecoverably** — the
   extract-text step gets no text from image-only PDFs (scanned paper, photo
   of a CV), so the whole class is rejected. This is the one real coverage gap.
2. **No model escalation** — a Haiku parse failure or very-low-confidence
   result goes straight to honest-fail / human review; no attempt on a
   stronger model first.
3. **Low-confidence fields require human fill-in** — no targeted second AI
   pass on just the unsure fields.

## Solution

Prioritized:
1. OCR/vision pass: when extract-text yields no/negligible text, render pages
   to images and parse via Claude vision through the existing
   `src/lib/ai/claude.ts` wrapper (cost-logged to ai_usage as usual). Recovers
   the whole scanned-CV class.
2. Escalation retry: one bounded retry on Sonnet when Haiku fails or overall
   confidence is very low, before the honest-fail path.
3. Targeted re-ask: narrow second pass prompting only for the low-confidence
   fields, merging under the recruiter's edits (never overwrite manual fixes).

Deliberately NOT in Phase 8 (Branded CV) scope. Candidate for a small
dedicated phase or quick tasks after Phase 8.
