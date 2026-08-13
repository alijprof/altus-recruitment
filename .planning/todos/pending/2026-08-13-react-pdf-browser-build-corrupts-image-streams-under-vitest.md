---
created: 2026-08-13T17:55:00.000Z
title: react-pdf browser build corrupts embedded image streams under vitest
area: testing
files:
  - vitest.config.ts
  - src/lib/pdf/branded-cv-document.tsx
  - tests/smoke/authed/branded-cv.smoke.ts
---

## Problem

Discovered 2026-08-13 while rendering the founder's branded-CV sample with the
real Steele Charles logo: PDFs rendered under **vitest** embed image XObjects
(logo RGB + alpha SMask) with corrupt FlateDecode/DCTDecode streams (invalid
zlib header `78 fd`, 0xFD replacement-byte fingerprint). Text/font/content
streams are unaffected. A 1×1 PNG is too trivial to trigger it, which is why
every existing test (extraction pins via lenient pdf.js) passes.

Root cause (verified empirically): vitest's jsdom environment resolves
`@react-pdf/renderer` via its **browser** build, whose image writer mangles
binary; the same render under plain **Node resolution produces valid streams**
(probe: identical source PNG → both streams valid). Production (Next server
runtime, Node conditions) is therefore expected-safe, but this is unproven on
the deployed bundler output.

## Solution

1. Pin vitest to react-pdf's node build (resolve.conditions / alias in
   vitest.config.ts) so unit tests exercise the same code path as production.
2. Add a stream-validity assertion to the branded-cv unit test (zlib-decompress
   every FlateDecode image XObject) so a regression fails loudly — pdf.js
   text-extraction pins cannot see this class.
3. During the Phase 8 prod smoke (post-migration): after the Generate step,
   validate the downloaded branded PDF's image streams (or at minimum eyeball
   the logo in the downloaded file during founder UAT) to prove the deployed
   runtime embeds images correctly with a real logo.
