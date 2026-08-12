/**
 * @vitest-environment node
 *
 * Plan 08-06 Task 2 — single-surface logo regression pin.
 *
 * 08-RESEARCH.md Pitfall 1: organizations.logo_url used to be edited from
 * TWO live forms — /settings (Phase 1) and /settings/branding (Phase 5) —
 * so an owner could paste a URL on the general Settings page and silently
 * clobber a logo uploaded via Branding. This plan removed the field from
 * /settings entirely; /settings/branding (via uploadOrgLogoAction /
 * removeOrgLogoAction, 08-05) is now the ONLY writer.
 *
 * Source inspection via node:fs, rather than importing the modules, mirrors
 * tests/unit/lib/inngest/cron-hardening.test.ts: importing the settings
 * actions pulls in server-only, next/cache, Supabase clients and Sentry,
 * none of which are needed to assert "this string does not appear in this
 * file's code". Comment-stripping matters: this test's OWN explanatory
 * comments (and the source files' own historical comments about logo_url)
 * must not be able to satisfy or break the gate — only lines whose trimmed
 * form is ENTIRELY a `//` or `*` comment are dropped, so a real code line
 * that merely has a trailing comment is unaffected either way.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !(trimmed.startsWith('//') || trimmed.startsWith('*'))
    })
    .join('\n')
}

function readStrippedCode(relativePath: string): string {
  const raw = readFileSync(resolve(process.cwd(), relativePath), 'utf8')
  return stripCommentLines(raw)
}

const SETTINGS_FILES = [
  'src/app/(app)/settings/schema.ts',
  'src/app/(app)/settings/actions.ts',
  'src/app/(app)/settings/organization-form.tsx',
]

describe('logo single-surface regression pin (Phase 08 Plan 06, Pitfall 1)', () => {
  describe.each(SETTINGS_FILES)('%s', (relativePath) => {
    it('never mentions logo_url in real code', () => {
      const code = readStrippedCode(relativePath)
      expect(
        code,
        `${relativePath}: logo_url must not appear anywhere in this file's code — ` +
          '/settings/branding is the single canonical surface for the org logo ' +
          '(08-RESEARCH.md Pitfall 1). If this fails, someone re-added a second ' +
          'writer for organizations.logo_url.',
      ).not.toMatch(/logo_url/)
    })
  })

  it('settings/branding/schema.ts (colours-only) never mentions logo_url either', () => {
    const code = readStrippedCode('src/app/(app)/settings/branding/schema.ts')
    expect(
      code,
      'settings/branding/schema.ts: logo_url must not appear — the colours form/schema ' +
        'must never be able to write the logo; uploadOrgLogoAction/removeOrgLogoAction ' +
        '(FormData + file bytes) are the only writers.',
    ).not.toMatch(/logo_url/)
  })

  it('settings/branding/actions.ts still exports the real logo writers', () => {
    const code = readStrippedCode('src/app/(app)/settings/branding/actions.ts')
    expect(
      code,
      'settings/branding/actions.ts must export uploadOrgLogoAction — removing it would ' +
        'leave the app with NO way to set a logo at all.',
    ).toMatch(/export\s+async\s+function\s+uploadOrgLogoAction\b/)
    expect(
      code,
      'settings/branding/actions.ts must export removeOrgLogoAction — removing it would ' +
        'leave the app with NO way to clear a logo.',
    ).toMatch(/export\s+async\s+function\s+removeOrgLogoAction\b/)
  })
})
