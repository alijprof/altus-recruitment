// Shared route inventory for the production smoke suite (tests/smoke/*).
//
// Kept in one place so the no-5xx sweep and the auth-guard checks stay in sync
// with the app's actual route tree. When a route is added under src/app, add it
// here too — that is the contract that keeps the smoke suite honest.

// Authenticated app routes. Anonymous requests to ALL of these must be
// redirected to /sign-in by the middleware (src/proxy.ts). The bogus-UUID
// detail route confirms the guard also covers dynamic segments, not just
// static index pages.
export const PROTECTED_ROUTES = [
  '/',
  '/candidates',
  '/candidates/new',
  '/candidates/00000000-0000-0000-0000-000000000000',
  '/clients',
  '/clients/new',
  '/jobs',
  '/jobs/new',
  '/jobs/00000000-0000-0000-0000-000000000000/pipeline',
  '/pipeline',
  '/floats',
  '/search',
  '/spec',
  '/spec/new',
  '/reports',
  '/reports/source-attribution',
  '/reports/buyer-value',
  '/settings',
  '/settings/team',
  '/settings/integrations',
  '/settings/usage',
  // Email+password auth (2026-06-25): per-user set/change-password page.
  '/settings/security',
  '/help',
]

// Routes reachable without authentication. These must render (2xx) for anyone.
export const PUBLIC_ROUTES = [
  '/sign-in',
  '/sign-up',
  '/auth/auth-code-error',
  // Email+password auth (2026-06-25): unauthenticated reset entry points. With
  // no token, /reset-password still renders a 2xx (the client flips to an
  // "expired" state) — exactly what the no-5xx sweep checks.
  '/forgot-password',
  '/reset-password',
]

// GET-safe API endpoints — hitting them with GET must never 5xx and must have
// no side effects. (Webhook POST endpoints are intentionally excluded: we never
// POST during a smoke run.)
export const SAFE_API_ROUTES = ['/api/inngest']

// Every route we GET during the no-5xx sweep.
export const ALL_GET_ROUTES = [...PUBLIC_ROUTES, ...PROTECTED_ROUTES, ...SAFE_API_ROUTES]
