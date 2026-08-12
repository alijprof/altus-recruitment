// src/app/(app)/candidates/[id]/branded-cv/route.ts — the target of the
// "View" control on the Branded CV panel (BCV-05, Plan 08-08).
//
// ROUTE-HANDLER EXCEPTION. CLAUDE.md reserves route handlers for
// "webhooks/public APIs", and this is neither. It is the same deliberate,
// narrow exception cv-file/[cvId]/route.ts already established: delivering a
// file to a new tab requires a NAVIGABLE GET that a plain <a href> can point
// at, so the browser performs the entire open in the user's click gesture
// with no client JavaScript anywhere in the path. A Server Action cannot be
// an anchor target. Established precedent for a file-delivery GET in this
// codebase: src/app/admin/[orgId]/export/route.ts,
// src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts.
//
// WHY THIS IS A ROUTE, NOT A SERVER ACTION (production incident, 2026-08-11):
// cv-file-link.tsx used to open a blank popup synchronously in the click and
// await a Server Action inside startTransition. On production the action
// responded 200 with a valid signed URL, but the client promise NEVER
// SETTLED — no branch ran, no toast, no pending state, and the popup sat
// orphaned at about:blank. This route is built the way that incident was
// fixed the first time: no popup handle, no pending promise, no client
// state machine. See 07-HOTFIX.md §4 for the full incident record; this
// route is a near-clone of the rework it describes.

import * as Sentry from '@sentry/nextjs'
import { notFound, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { recordExportAudit } from '@/lib/db/audit'
import { getBrandedCvForCandidate } from '@/lib/db/candidate-branded-cvs'
import { createClient } from '@/lib/supabase/server'

// Matches the sibling cv-file route's CV_SIGNED_URL_TTL_SECONDS — short
// enough that a leaked/logged URL is worthless within minutes, long enough
// that the redirect below always lands before it expires.
const BRANDED_CV_SIGNED_URL_TTL_SECONDS = 60

// Same shape-gate as cv-file/[cvId]/route.ts. Path segments are
// attacker-controlled strings; rejecting a non-uuid here means a malformed id
// never reaches the database at all.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The user-facing copy for a failed sign, matching the sibling route's copy
// verbatim so the recruiter reads the same message regardless of which
// document failed to open. Delivered as plain text because this response
// lands in a fresh tab with no app shell around it — there is no toast
// surface here, and the one thing this control must never do is fail
// silently.
const SIGN_FAILED_COPY = 'Couldn’t open this file. Please try again.'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: candidateId } = await params
  if (!UUID_RE.test(candidateId)) {
    notFound()
  }

  // Deliberately NO billing-entitlement gate here, unlike every mutation
  // action in candidates/[id]/actions.ts. Every other gate guards a mutation
  // or AI spend; this is a tenant reading back a document they already have.
  // Withholding a customer's own file behind a billing state is a
  // data-hostage posture we do not take — same reasoning already documented
  // on cv-file/[cvId]/route.ts and the generate-branded-CV action. This
  // route does not import that gate at all (pinned by a static source-scan
  // test — see branded-cv-route.test.ts).

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // The middleware already redirects unauthenticated traffic (/candidates is
  // not in PUBLIC_PATHS); this is defence in depth, mirroring (app)/layout.tsx.
  // Route handlers do NOT run layouts, so that guard does not cover this path.
  if (!user) {
    redirect('/sign-in')
  }

  // getBrandedCvForCandidate reads under the RLS-scoped SSR client — a
  // cross-tenant candidate id surfaces as `not_found`, which IS the tenancy
  // barrier. A missing row and a missing table (pre-migration deploy) ALSO
  // surface as `not_found` (the helper's own isMissingTableError branch) —
  // every failure below collapses to the same bare 404, so this route can't
  // be used as an existence oracle for another org's data OR for whether
  // this feature has shipped yet on this database.
  //
  // Unlike cv-file/[cvId]/route.ts there is no separate "candidate id in the
  // path must be the row's own" check: the table is keyed 1:1 on
  // candidate_id and the lookup here is BY candidate_id, so that invariant
  // is structural rather than something this route can fail. There is also
  // no isCvFileDownloadable equivalent — a row only exists once a PDF has
  // actually been stored, so "no row" already covers the not-generated-yet
  // case.
  const brandedResult = await getBrandedCvForCandidate(supabase, candidateId)
  if (!brandedResult.ok) {
    notFound()
  }
  const brandedCv = brandedResult.data

  const { data: signed, error: signError } = await supabase.storage
    .from('cvs')
    .createSignedUrl(brandedCv.storage_path, BRANDED_CV_SIGNED_URL_TTL_SECONDS)

  // Storage RLS ('Tenant select own org CVs') is the second, independent
  // tenancy gate — even if the RLS-scoped read above were ever bypassed, the
  // bucket policy alone still blocks a cross-tenant sign. On error or a
  // missing signedUrl, capture a PII-free Error (name + a fixed subop label
  // only — NEVER brandedCv.storage_path) and return a generic failure.
  if (signError || !signed?.signedUrl) {
    Sentry.captureException(new Error(signError?.name ?? 'MissingSignedUrl'), {
      tags: {
        layer: 'route',
        helper: 'brandedCvRoute',
        subop: 'createSignedUrl',
        candidate_branded_cv_id: brandedCv.id,
      },
    })
    return new NextResponse(SIGN_FAILED_COPY, {
      status: 502,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  // Audited BEFORE the redirect is issued — a failed audit write must never
  // block a customer reading their own document (recordExportAudit's
  // never-throw contract), but a successful signed URL must never reach the
  // browser without a row filed first. Filing against the CANDIDATE
  // (candidateId, not the branded-cv row id) is deliberate: it makes the
  // download appear in that candidate's access history through the existing
  // audit_log_org_entity_idx, mirroring cv-file/[cvId]/route.ts exactly.
  // Metadata carries ids + an ISO timestamp ONLY — no storage path, no
  // candidate name.
  //
  // WHAT THIS ROW MEANS: "a signed URL for this document was RELEASED to
  // this user" — release and delivery are the SAME HTTP response, so a row
  // can never be filed for a document the recruiter never received (see the
  // sibling route's header comment for the full incident-driven rationale).
  //
  // KNOWN, ACCEPTED GAP (inherited from cv-file/[cvId]/route.ts):
  // recordExportAudit swallows its own failures into Sentry and resolves
  // void, so a signed URL is still returned when the audit write itself
  // fails. Availability over completeness — a customer is never locked out
  // of their own document by our logging.
  await recordExportAudit(supabase, 'candidate', candidateId, {
    candidate_branded_cv_id: brandedCv.id,
    generated_at: brandedCv.generated_at,
  })

  // 302, not Next's default 307: this is a plain "the thing you asked for is
  // over there" for a GET, and 302 is what every browser and proxy handles
  // most predictably for a one-shot file handoff.
  const response = NextResponse.redirect(signed.signedUrl, 302)
  // The Location header carries a live, short-TTL credential. no-store keeps
  // it out of every shared cache and out of the browser's back/forward
  // cache, so a stale 302 can never resurface the URL after it has expired.
  response.headers.set('cache-control', 'no-store')
  return response
}
