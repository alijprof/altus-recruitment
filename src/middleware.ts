import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    // Match everything except static assets, image optimisation, and the
    // well-known public files (PWA manifest, Next.js metadata icon routes,
    // robots, sitemap). The latter group was added in quick task 260528-0rd
    // after pre-UAT HTTP smoke (Agent B) caught the original matcher
    // intercepting /manifest.webmanifest and breaking PWA install on iOS /
    // Android. `icon$` / `apple-icon$` use end-anchors so we don't
    // accidentally exclude future app routes that start with "icon".
    //
    // Phase 5 review (Wave 0): the new public paths added to PUBLIC_PATHS
    // (/api/stripe/webhook, /welcome, /pricing, /features, /docs, /status)
    // all flow through updateSession() correctly under this matcher — none
    // are static assets or excluded by pattern. No matcher change needed.
    // If /docs later serves static MDX assets from a CDN path, revisit then.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|icon$|apple-icon$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
