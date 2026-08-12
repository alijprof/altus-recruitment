import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Font } from '@react-pdf/renderer'

// Deliberately NOT `import 'server-only'` here — tests/unit/lib/pdf/render-
// foundation.test.ts imports this module directly under `@vitest-environment
// node`, and `server-only` throws in that context. The module has no browser
// entry point of its own (it is only ever imported from Server Actions/route
// handlers that are themselves server-only), so the guard would be redundant
// anyway.

// WHY FILESYSTEM, NOT A URL: `Font.register({ src: 'https://...' })` kicks
// off an un-awaitable async download inside react-pdf — there is no API to
// wait for it to finish before `renderToBuffer` starts consuming the font.
// On a Vercel cold start this becomes a race (and sometimes an outbound
// network dependency the render didn't need to have at all): the render can
// begin, and fail or silently fall back, before the download resolves
// (research Pitfall 4). Reading the TTF synchronously from the bundled
// filesystem at module scope removes the race entirely — the bytes are
// available before any render call can happen.

export const BRANDED_CV_FONT_FAMILY = 'LiberationSans'

// Guard against double registration if this module is evaluated more than
// once in the same process (e.g. hot reload, or being imported from two
// different entry points that don't share a module cache in some bundler
// configurations).
let registered = false

if (!registered) {
  const regularPath = join(process.cwd(), 'src/lib/pdf/fonts/LiberationSans-Regular.ttf')
  const boldPath = join(process.cwd(), 'src/lib/pdf/fonts/LiberationSans-Bold.ttf')

  // Read (and discard) the bytes here purely to fail FAST and LOUD at
  // module load if the vendored TTFs are missing from the deployed bundle
  // (see the outputFileTracingIncludes comment in next.config.ts). This
  // throws a clear ENOENT at cold start instead of deferring to an obscure
  // fontkit error the first time a PDF is actually generated.
  //
  // The installed @react-pdf/renderer 4.6.0 (@react-pdf/font 4.0.9) does
  // NOT support passing the Buffer itself as `Font.register`'s `src` —
  // verified empirically: it throws `dataUrl.substring is not a function`
  // (its internal data-URL sniff assumes `src` is a string). Its own
  // TypeScript types agree (`src: string`). So `Font.register` below is
  // given the file PATH, which @react-pdf/font resolves via
  // `fontkit.open(path)` → `fs.promises.readFile(path)` — still a pure
  // filesystem read, still zero network, still no async-download race
  // (Pitfall 4); only the buffer-vs-path detail differs from the
  // originally-assumed API shape.
  readFileSync(regularPath)
  readFileSync(boldPath)

  Font.register({
    family: BRANDED_CV_FONT_FAMILY,
    fonts: [
      { src: regularPath, fontWeight: 'normal' },
      { src: boldPath, fontWeight: 'bold' },
    ],
  })

  // react-pdf's default hyphenation callback aggressively breaks words at
  // syllable boundaries (e.g. "Recruit-ment") to fit narrow columns — this
  // mangles job titles and company names on a CV, which read as typos.
  // Disabling it means a word either fits on the line or wraps whole.
  Font.registerHyphenationCallback((word) => [word])

  registered = true
}
