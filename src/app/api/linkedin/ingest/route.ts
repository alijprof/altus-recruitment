import * as Sentry from '@sentry/nextjs'

import { corsHeadersFor, versionGte } from '@/app/api/linkedin/_cors'
import { upsertCandidateFromLinkedIn } from '@/lib/db/candidates-linkedin'
import { getProfile } from '@/lib/db/profiles'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { isOrgEntitled } from '@/lib/stripe/require-entitlement'
import { createBearerClient, createClient } from '@/lib/supabase/server'
import { LinkedInIngestSchema } from '@/lib/validation/linkedin-ingest-schema'

// ---------------------------------------------------------------------------
// Plan 03-01 Task A.2 — POST /api/linkedin/ingest.
//
// Authenticated route (D3-02): runs in the recruiter's session context (NOT
// service-role). The extension passes the Supabase access_token as
// `Authorization: Bearer <token>` — we resolve the user via
// `supabase.auth.getUser(token)` because the middleware cookie path doesn't
// apply (request originates from chrome-extension://, no Supabase cookies).
//
// Flow:
//   1. Extension version gate (X-Altus-Extension-Version ≥ minimum)
//   2. Bearer extraction + getUser(token) → 401 on miss
//   3. Zod validation → 400 on bad shape
//   4. Profile lookup → organization_id
//   5. Postgres advisory xact lock keyed on (org_id, linkedin_url_hash) so
//      two concurrent captures of the same profile collapse to one row
//   6. upsertCandidateFromLinkedIn (dedup-on-source_detail-then-email)
//   7. inngest.send('linkedin/captured') for downstream embed
//   8. JSON response with CORS allow-origin echoed for the extension origin
//
// Sentry tags follow Phase 3 convention: `{ phase: 'p3', layer:
// 'route-handler', route: '/api/linkedin/ingest' }` per PATTERNS §10 and
// docs/phase-3-sentry-tags.md.
// ---------------------------------------------------------------------------

const ROUTE_TAGS = {
  phase: 'p3',
  layer: 'route-handler',
  route: '/api/linkedin/ingest',
} as const

function getPinnedExtensionId(): string | undefined {
  const id =
    typeof (env as unknown as { LINKEDIN_EXTENSION_ID?: string })
      .LINKEDIN_EXTENSION_ID === 'string'
      ? (env as unknown as { LINKEDIN_EXTENSION_ID?: string }).LINKEDIN_EXTENSION_ID
      : undefined
  return id && id.length > 0 ? id : undefined
}

function getMinExtensionVersion(): string {
  const v =
    typeof (env as unknown as { LINKEDIN_EXTENSION_MIN_VERSION?: string })
      .LINKEDIN_EXTENSION_MIN_VERSION === 'string'
      ? (env as unknown as { LINKEDIN_EXTENSION_MIN_VERSION?: string })
          .LINKEDIN_EXTENSION_MIN_VERSION
      : undefined
  return v && v.length > 0 ? v : '0.1.0'
}

function jsonResponse(body: unknown, init: { status: number; cors: Headers }): Response {
  const headers = new Headers(init.cors)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { status: init.status, headers })
}

function statusOnly(status: number, cors: Headers, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers(cors)
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v)
  }
  return new Response(null, { status, headers })
}

export async function OPTIONS(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const cors = corsHeadersFor(origin, getPinnedExtensionId())
  return statusOnly(204, cors)
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const cors = corsHeadersFor(origin, getPinnedExtensionId())

  // 1. Extension version gate
  const version = req.headers.get('x-altus-extension-version') ?? ''
  const minVersion = getMinExtensionVersion()
  if (!version || !versionGte(version, minVersion)) {
    return jsonResponse(
      {
        ok: false,
        error: 'extension_upgrade_required',
        min_version: minVersion,
      },
      { status: 426, cors },
    )
  }

  // 2. Bearer extraction
  const authz = req.headers.get('authorization') ?? ''
  const token = authz.startsWith('Bearer ') ? authz.slice('Bearer '.length).trim() : ''
  if (!token) {
    return jsonResponse({ ok: false, error: 'unauthenticated' }, { status: 401, cors })
  }

  // The route runs in the authenticated app context. createClient() builds a
  // cookie-aware client; we then use getUser(token) to validate the explicit
  // bearer (the middleware cookie path doesn't apply for chrome-extension://
  // origins).
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return jsonResponse({ ok: false, error: 'unauthenticated' }, { status: 401, cors })
  }
  const user = userData.user

  // Build a token-scoped client for the DATA queries so they run AS the
  // bearer-authenticated user under RLS. The cookie-bound `supabase` client
  // validates the token but does NOT attach it to PostgREST's Authorization
  // header — getProfile / upsertCandidateFromLinkedIn would otherwise run with
  // no session (auth.uid() NULL → anon role → RLS blocks → 500). Passing the
  // bearer in the global Authorization header makes PostgREST run as that user.
  // RLS stays the tenant boundary (org is read from the user's own profile row,
  // and upsertCandidateFromLinkedIn additionally asserts the dedup row's org) —
  // this is more tenant-safe than service-role and matches the route's design.
  const db = createBearerClient(token)

  // 3. Body validation
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, { status: 400, cors })
  }
  const parsed = LinkedInIngestSchema.safeParse(raw)
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        error: 'invalid_body',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400, cors },
    )
  }
  const payload = parsed.data

  // 4. Profile lookup → organization_id (token-scoped, runs under RLS)
  const profileResult = await getProfile(db, user.id)
  if (!profileResult.ok) {
    Sentry.captureException(new Error(`profile_not_found: ${profileResult.code}`), {
      tags: { ...ROUTE_TAGS, subop: 'getProfile' },
    })
    return jsonResponse({ ok: false, error: 'profile_not_found' }, { status: 500, cors })
  }
  const organizationId = profileResult.data.organization_id

  // 5. Entitlement gate (audit blocker 1/2). The capture pipeline writes a
  // candidate row AND enqueues a Voyage embed (AI spend) — block non-entitled
  // orgs here, AFTER bearer auth + org resolution, BEFORE any write/enqueue.
  // isOrgEntitled fails CLOSED on a getEntitlement error (safe: no write).
  if (!(await isOrgEntitled(organizationId))) {
    return jsonResponse({ ok: false, error: 'subscription_inactive' }, { status: 402, cors })
  }

  // CR-01: the advisory-lock RPC was non-functional in production
  // (`pg_try_advisory_xact_lock` is a pg_catalog builtin not exposed via
  // PostgREST; even if exposed, separate HTTP calls run separate
  // transactions so the xact-scope lock couldn't span the upsert). The race
  // is bounded by user click-rate; the unique partial index on
  // `(organization_id, source_detail) where source = 'linkedin'`
  // (migration 20260520064500_phase3_candidates_linkedin_unique_source_detail)
  // converts the concurrent-write race into a deterministic 23505 that the
  // upsert helper's existing dedup branch already handles.

  // 6. Upsert (token-scoped, runs under RLS as the bearer user)
  const upsertResult = await upsertCandidateFromLinkedIn(db, {
    organizationId,
    profile: {
      name: payload.name,
      headline: payload.headline,
      current_role: payload.current_role,
      current_company: payload.current_company,
      location: payload.location,
      about: payload.about,
      skills: payload.skills,
      work_experience: payload.work_experience,
      education: payload.education,
      linkedin_url: payload.linkedin_url,
      email: payload.email ?? null,
    },
  })
  if (!upsertResult.ok) {
    return jsonResponse({ ok: false, error: 'upsert_failed' }, { status: 500, cors })
  }

  // 7. Inngest dispatch — Voyage embed runs out-of-band per D3-25.
  try {
    await inngest.send({
      name: 'linkedin/captured',
      data: {
        organization_id: organizationId,
        candidate_id: upsertResult.data.id,
        user_id: user.id,
      },
    })
  } catch (err) {
    // VERIFICATION R4: wrap name only — never the raw error to Sentry.
    const name = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${name}: inngest.send failed`), {
      tags: { ...ROUTE_TAGS, subop: 'inngest.send', candidate_id: upsertResult.data.id },
    })
    // The candidate row is already written; the batch embed sweep will
    // pick it up on its next 10-min cadence. Don't fail the request.
  }

  // 8. Success
  return jsonResponse(
    {
      ok: true,
      candidate_id: upsertResult.data.id,
      updated: !upsertResult.data.created,
    },
    { status: 200, cors },
  )
}

// Reject other methods explicitly so a stray GET doesn't return Next's
// default 405 with no CORS headers (the extension's worker would surface
// it as a generic error).
export async function GET(req: Request): Promise<Response> {
  const cors = corsHeadersFor(req.headers.get('origin'), getPinnedExtensionId())
  return statusOnly(405, cors, { allow: 'POST, OPTIONS' })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
