// src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts — the target of the
// "View" control on the candidate page (D-01, Plan 07-01).
//
// ROUTE-HANDLER EXCEPTION. CLAUDE.md reserves route handlers for
// "webhooks/public APIs", and this is neither. It is a deliberate, narrow
// exception: delivering a file to a new tab requires a NAVIGABLE GET that a
// plain <a href> can point at, so the browser performs the entire open in the
// user's click gesture with no client JavaScript anywhere in the path. A
// Server Action cannot be an anchor target. Established precedent for a
// file-delivery GET in this codebase: src/app/admin/[orgId]/export/route.ts.
//
// WHY THIS REPLACED A SERVER ACTION (production incident, 2026-08-11):
// cv-file-link.tsx opened a blank popup synchronously in the click and then
// awaited getCvFileUrlAction inside startTransition. Verified live on
// production: the action responded 200 with a valid signed URL, but the
// client promise NEVER SETTLED — no branch ran, no toast, no pending state,
// and the popup was orphaned at about:blank. The recruiter saw the headline
// feature of this phase do nothing at all. window.open, opener-nulling and
// delayed navigation each worked in isolation; the popup + async-action
// combination itself was the broken piece, and jsdom tests cannot observe it.
// An anchor to this route removes the entire class of failure: no popup
// handle, no pending promise, no client state machine — the browser opens the
// tab, we mint the URL server-side, and a 302 hands it straight over.

import * as Sentry from '@sentry/nextjs'
import { notFound, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { isCvFileDownloadable } from '@/lib/cv/cv-file-display'
import { recordExportAudit } from '@/lib/db/audit'
import { getCandidateCV } from '@/lib/db/candidate-cvs'
import { createClient } from '@/lib/supabase/server'

// Matches the existing prior art at apply/[orgSlug]/actions.ts:155 — short
// enough that a leaked/logged URL is worthless within minutes, long enough
// that the redirect below always lands before it expires. This const moved
// here from actions.ts with getCvFileUrlAction: a 'use server' module may
// only export async functions, so it cannot be shared from there, and this
// route is now its only consumer.
const CV_SIGNED_URL_TTL_SECONDS = 60

// Same shape-gate as src/app/admin/[orgId]/export/route.ts. Path segments are
// attacker-controlled strings; rejecting a non-uuid here means a malformed id
// never reaches the database at all.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The user-facing copy for a failed sign, carried over verbatim from
// getCvFileUrlAction so the recruiter reads exactly what Phase 7 designed.
// Delivered as plain text because this response lands in a fresh tab with no
// app shell around it — there is no toast surface here, and the one thing
// this control must never do is fail silently.
const SIGN_FAILED_COPY = 'Couldn’t open this file. Please try again.'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; cvId: string }> },
): Promise<NextResponse> {
  const { id: candidateId, cvId } = await params
  if (!UUID_RE.test(candidateId) || !UUID_RE.test(cvId)) {
    notFound()
  }

  // Deliberately NO requireEntitledOrg() gate here, unlike every mutation
  // action in candidates/[id]/actions.ts. Every other gate guards a mutation
  // or AI spend; this is a tenant reading back a document they already gave
  // us. Withholding a customer's own file behind a billing state is a
  // data-hostage posture we do not take — same reasoning as the
  // erasure/export paths (deleteCandidateAction, /admin org export).

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

  // getCandidateCV reads under the RLS-scoped SSR client — a cross-tenant id
  // surfaces as `not_found`, which IS the tenancy barrier. Every failure below
  // collapses to the same bare 404: we never distinguish "wrong tenant" from
  // "no such row" from "no stored file", so this route can't be used as an
  // existence oracle for another org's data.
  const cvResult = await getCandidateCV(supabase, cvId)
  if (!cvResult.ok) {
    notFound()
  }
  const cv = cvResult.data

  // The candidate id in the path must be the row's own. Nothing security-
  // critical rests on this (the audit row below is filed against
  // cv.candidate_id, never the path), but it keeps the URL space honest: one
  // canonical address per file, and a hand-edited path fails loudly.
  if (cv.candidate_id !== candidateId) {
    notFound()
  }

  // Server-side mirror of the UI's disabled state — the same
  // server-mirrors-client-guard pattern retryParseAction uses for
  // isUnretryableParseFailure. A direct request bypassing the UI can't sign a
  // URL for a row with no stored file. 404 rather than a redirect back to the
  // candidate page: this response lands in a NEW TAB, so bouncing the user to
  // a second copy of the page they just came from is more confusing than an
  // honest "there is nothing here" — and the anchor isn't even rendered in
  // this state, so only a stale tab or a hand-typed URL can reach it.
  if (!isCvFileDownloadable(cv)) {
    notFound()
  }

  const { data: signed, error: signError } = await supabase.storage
    .from('cvs')
    .createSignedUrl(cv.storage_path, CV_SIGNED_URL_TTL_SECONDS)

  // Storage RLS ('Tenant select own org CVs', migration 20260517204501) is the
  // second, independent tenancy gate — even if the RLS-scoped read above were
  // ever bypassed, the bucket policy alone still blocks a cross-tenant sign.
  // On error or a missing signedUrl, capture a PII-free Error (name + a fixed
  // subop label only — NEVER cv.storage_path, which embeds a slugified
  // candidate name) and return a generic failure.
  if (signError || !signed?.signedUrl) {
    Sentry.captureException(new Error(signError?.name ?? 'MissingSignedUrl'), {
      tags: {
        layer: 'route',
        helper: 'cvFileRoute',
        subop: 'createSignedUrl',
        candidate_cv_id: cv.id,
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
  // browser without a row filed first. Filing against the CANDIDATE (not the
  // cv row) is deliberate: it makes the download appear in that candidate's
  // access history through the existing audit_log_org_entity_idx, which is how
  // "who accessed this candidate's data" stays answerable. Metadata carries
  // ids + an integer version ONLY — no filename, no storage path, no candidate
  // name.
  //
  // WHAT THIS ROW MEANS: "a signed URL for this document was RELEASED to this
  // user" — not "the bytes were fetched", which no server-side code here can
  // observe. Moving from a server action to a redirect STRENGTHENS that claim.
  // Under the old design the row's honesty depended on a client contract:
  // cv-file-link.tsx had to actually deliver the URL it received, and the
  // production incident that motivated this rework is precisely the case where
  // it did not — a row was filed for a URL the recruiter never got. Here,
  // release and delivery are the SAME HTTP response. If the redirect is
  // returned, the URL reached the browser; if it isn't, no row was filed.
  // There is no longer a gap between the two for a client bug to open.
  //
  // KNOWN, ACCEPTED GAP (IN-05, decided rather than left implied):
  // recordExportAudit swallows its own failures into Sentry and resolves void,
  // so a signed URL is still returned when the audit write itself fails. This
  // is an availability-over-completeness trade consistent with recordViewAudit
  // and getCandidate's inline audit — a customer is never locked out of their
  // own document by our logging. The cost is that a GDPR "who accessed this
  // CV" answer can be incomplete, with the only trace in Sentry. If that ever
  // becomes unacceptable for document exports specifically, the change is:
  // have recordExportAudit return a success flag and fail this route closed.
  await recordExportAudit(supabase, 'candidate', cv.candidate_id, {
    candidate_cv_id: cv.id,
    version: cv.version,
  })

  // 302, not Next's default 307: this is a plain "the thing you asked for is
  // over there" for a GET, and 302 is what every browser and proxy handles
  // most predictably for a one-shot file handoff.
  const response = NextResponse.redirect(signed.signedUrl, 302)
  // The Location header carries a live, short-TTL credential. no-store keeps
  // it out of every shared cache and out of the browser's back/forward cache,
  // so a stale 302 can never resurface the URL after it has expired — or,
  // worse, serve one user's signed URL from a cache to another.
  response.headers.set('cache-control', 'no-store')
  return response
}
