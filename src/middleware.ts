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
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|icon$|apple-icon$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
