/**
 * @vitest-environment node
 *
 * Regression pin for Phase 8 review CR-03 (BLOCKER): Next's Server Action
 * body limit defaults to 1 MB, which silently rejects a real logo upload
 * (MAX_LOGO_BYTES = 2 MiB) or CV upload (MAX_CV_BYTES = 10 MiB) before
 * either application-level size check ever runs, surfacing an opaque
 * framework error instead of the app's own "too large" copy.
 *
 * This is source inspection (node:fs), not a Next config import, because
 * next.config.ts's default export is wrapped in withSentryConfig — importing
 * it directly would require a live Sentry auth-token path and a Next build
 * context this unit suite does not have. The invariant under test — the
 * configured serverActions.bodySizeLimit covers the larger of the two
 * declared application caps — is a structural property of the source text,
 * matching the source-inspection pattern already used for the Phase 8
 * migrations (tests/unit/supabase/phase8-migrations.test.ts).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const NEXT_CONFIG_PATH = resolve(process.cwd(), 'next.config.ts')
const CV_ACTIONS_PATH = resolve(process.cwd(), 'src/app/(app)/candidates/[id]/actions.ts')
const IMAGE_SIGNATURE_PATH = resolve(process.cwd(), 'src/lib/upload/image-signature.ts')

// The `bytes` package Next uses to parse `bodySizeLimit` treats these
// suffixes as 1024-based (kb/mb/gb), matching Next's own default of
// `1024 * 1024` for the un-configured 1 MB limit
// (node_modules/next/dist/server/app-render/action-handler.js).
function parseBodySizeLimitToBytes(limit: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb)$/i.exec(limit.trim())
  if (!match) {
    throw new Error(`Unrecognised bodySizeLimit format: "${limit}"`)
  }
  const [, amount, unit] = match
  const multiplier = { kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[unit!.toLowerCase()]!
  return Number(amount) * multiplier
}

// Evaluates a pinned "N * M * ..." numeric-literal multiplication expression
// (e.g. "10 * 1024 * 1024") without eval/Function — the source files only
// ever express these caps as a chain of numeric-literal multiplications.
function parseNumericLiteralProduct(expression: string): number {
  return expression
    .split('*')
    .map((part) => part.trim())
    .reduce((product, part) => {
      if (!/^\d+$/.test(part)) {
        throw new Error(`Expected a plain numeric literal, got "${part}" in "${expression}"`)
      }
      return product * Number(part)
    }, 1)
}

describe('next.config.ts serverActions.bodySizeLimit (Phase 08 review CR-03)', () => {
  const configSource = readFileSync(NEXT_CONFIG_PATH, 'utf8')

  it('configures experimental.serverActions.bodySizeLimit', () => {
    expect(
      configSource,
      'Next defaults Server Action bodies to 1 MB — without an explicit override, a ' +
        '1.0-2.0 MB logo or any CV over 1 MB never reaches the action at all',
    ).toMatch(/serverActions:\s*{\s*bodySizeLimit:\s*'[^']+'/)
  })

  it('sets bodySizeLimit large enough to cover MAX_CV_BYTES and MAX_LOGO_BYTES, so the caps cannot silently drift apart', () => {
    const configMatch = /bodySizeLimit:\s*'([^']+)'/.exec(configSource)
    expect(configMatch, 'expected a quoted bodySizeLimit value in next.config.ts').not.toBeNull()
    const bodySizeLimitBytes = parseBodySizeLimitToBytes(configMatch![1]!)

    const cvActionsSource = readFileSync(CV_ACTIONS_PATH, 'utf8')
    const cvMatch = /const MAX_CV_BYTES = (\d+(?:\s*\*\s*\d+)*)/.exec(cvActionsSource)
    expect(cvMatch, 'expected MAX_CV_BYTES in candidates/[id]/actions.ts').not.toBeNull()
    const maxCvBytes = parseNumericLiteralProduct(cvMatch![1]!)

    const imageSignatureSource = readFileSync(IMAGE_SIGNATURE_PATH, 'utf8')
    const logoMatch = /export const MAX_LOGO_BYTES = (\d+(?:\s*\*\s*\d+)*)/.exec(
      imageSignatureSource,
    )
    expect(logoMatch, 'expected MAX_LOGO_BYTES in src/lib/upload/image-signature.ts').not.toBeNull()
    const maxLogoBytes = parseNumericLiteralProduct(logoMatch![1]!)

    expect(
      bodySizeLimitBytes,
      `bodySizeLimit (${bodySizeLimitBytes} bytes) must be >= MAX_CV_BYTES (${maxCvBytes} bytes) — ` +
        'otherwise the advertised 10 MiB CV cap is a lie the platform rejects before the app ever sees it',
    ).toBeGreaterThanOrEqual(maxCvBytes)
    expect(
      bodySizeLimitBytes,
      `bodySizeLimit (${bodySizeLimitBytes} bytes) must be >= MAX_LOGO_BYTES (${maxLogoBytes} bytes)`,
    ).toBeGreaterThanOrEqual(maxLogoBytes)
  })
})
