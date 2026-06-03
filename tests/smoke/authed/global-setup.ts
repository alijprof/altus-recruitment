import { existsSync, statSync } from 'node:fs'

// Fail fast with an actionable message if no authenticated session has been
// captured yet — otherwise Playwright errors cryptically when it can't load the
// storageState file.
const STATE = 'tests/smoke/.auth/prod.json'

export default function globalSetup() {
  if (!existsSync(STATE) || statSync(STATE).size < 10) {
    throw new Error(
      [
        `No authenticated session found at ${STATE}.`,
        'Capture one first via the magic-link relay (single continuous context):',
        '  SMOKE_AUTH_EMAIL=you@example.com node tests/smoke/authed/relay-signin.mjs',
        'then paste the sign-in link from your inbox when prompted.',
        'See tests/smoke/README.md → "Layer A2".',
      ].join('\n'),
    )
  }
}
