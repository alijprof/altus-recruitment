/**
 * @vitest-environment node
 *
 * Render-foundation regression test for Phase 8 (Branded CV). This is the
 * canary for the whole feature: if the vendored fonts stop resolving, or
 * @react-pdf/renderer changes its rendering contract, this test fails
 * before any template or Server Action code does.
 *
 * The default jsdom environment (vitest.config.ts) lacks the Node
 * stream/Buffer surface @react-pdf/renderer needs server-side, hence the
 * per-file `@vitest-environment node` override above.
 *
 * Uses `React.createElement` rather than JSX syntax so this file can stay a
 * plain `.test.ts` (matching the plan's file path) without a JSX transform.
 */
import type { DocumentProps } from '@react-pdf/renderer'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { extractText, getDocumentProxy } from 'unpdf'
import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BRANDED_CV_FONT_FAMILY, ensureBrandedCvFonts } from '@/lib/pdf/register-fonts'

const styles = StyleSheet.create({
  page: { fontFamily: BRANDED_CV_FONT_FAMILY, padding: 24 },
  text: { fontSize: 12 },
})

function buildDocument(): React.ReactElement<DocumentProps> {
  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(
        View,
        null,
        React.createElement(Text, { style: styles.text }, 'Renée Müller'),
        React.createElement(Text, { style: styles.text }, '£1,250 per day'),
      ),
    ),
  )
}

describe('branded CV render foundation', () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>

  beforeEach(() => {
    // Spy without a mock implementation — if the render ever calls fetch,
    // the real fetch still runs (so we don't mask a network dependency as
    // a silent no-op), but we can assert the call count afterwards.
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders a real PDF with £/diacritic glyphs intact, fast, with zero network I/O', async () => {
    const startedAt = Date.now()

    // Phase 8 review WR-01: font registration is lazy (register-fonts.ts),
    // triggered in production by `renderBrandedCv` — this test drives
    // `renderToBuffer` directly, bypassing that call, so it must register
    // fonts itself. `ensureBrandedCvFonts` is idempotent.
    ensureBrandedCvFonts()
    const pdfBuffer = await renderToBuffer(buildDocument())

    const elapsedMs = Date.now() - startedAt

    // Behaviour 1: resolves to a real PDF buffer, not an error object or an
    // empty/garbage payload.
    expect(pdfBuffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    // Behaviour 4: the zero-AI, deterministic generation path is fast —
    // well inside the unit-test timeout, and inside BCV-07's sub-second
    // performance claim with margin for slower CI hosts.
    expect(elapsedMs).toBeLessThan(5000)

    // Behaviour 3: no outbound network call happened during the render —
    // fonts are filesystem-loaded (register-fonts.ts), never fetched
    // (research Pitfall 4). Deliberately scoped to http(s) URLs rather than
    // "fetch called at all": @react-pdf/layout's `yoga-layout` flexbox
    // dependency bootstraps its WASM binary via a one-time, process-memoized
    // `fetch('data:application/octet-stream;base64,...')` call (verified —
    // `instancePromise ??= loadYoga()` in @react-pdf/layout). A `data:` URI
    // never leaves the process (no DNS, no socket) — it is an unrelated
    // implementation detail of the layout engine's own WASM loading, not the
    // network-download race this behaviour exists to catch. A real
    // regression (e.g. `Font.register({ src: 'https://...' })` creeping
    // back in) would show up here as an http(s) URL.
    const networkFetchCalls = fetchSpy.mock.calls.filter(([input]) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : String(input)
      return /^https?:\/\//i.test(url)
    })
    expect(networkFetchCalls).toEqual([])

    // Behaviour 2: text round-trips through unpdf's real PDF.js-backed
    // extraction, proving actual glyph coverage rather than tofu boxes
    // (research Pitfall 3). unpdf 1.6.x rejects a raw Node `Buffer` even
    // though it subclasses `Uint8Array` (explicit `Buffer.isBuffer` check) —
    // construct a plain `Uint8Array` view over the same bytes, mirroring
    // the production pattern in src/lib/ai/cv-extract.ts.
    const bytes = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength)
    const pdfDocument = await getDocumentProxy(bytes)
    const { text } = await extractText(pdfDocument, { mergePages: true })
    const mergedText = Array.isArray(text) ? text.join('\n') : text
    // PDF text extraction inserts arbitrary spacing between text runs
    // (kerning-adjusted glyph runs, column breaks) — collapse whitespace
    // before substring matching so the assertion isn't flaky on layout
    // details that have nothing to do with glyph coverage.
    const normalisedText = mergedText.replace(/\s+/g, ' ').trim()

    expect(normalisedText).toContain('Renée Müller')
    expect(normalisedText).toContain('£1,250 per day')
  })
})
