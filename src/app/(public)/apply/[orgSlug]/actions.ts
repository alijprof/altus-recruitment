'use server'

/**
 * SECURITY-SENSITIVE FILE — read before editing.
 *
 * This is the FIRST unauthenticated DB-writer in the codebase. Service-role
 * is used because there's no auth.uid(). The tenant boundary lives in three
 * places only:
 *
 *   1. The slug → organizations lookup. `slug` is the only client-supplied
 *      tenancy signal we trust. We re-derive `org.id` from it on every call
 *      and NEVER read it from any other client input.
 *
 *   2. The Storage path prefix `<org.id>/applicants/...`. The bucket RLS
 *      enforces the path layout for authenticated callers; service-role
 *      bypasses but the path is server-constructed. An explicit
 *      `storagePath.startsWith(...)` assertion fires before mint (M-2).
 *
 *   3. The candidates / candidate_cvs rows' organization_id, set from
 *      `org.id` derived from the slug lookup. NEVER read this from the
 *      client; NEVER trust an `organizationId` field in the request body.
 *
 * Any new field that takes a tenant ID from the client is a vulnerability.
 * See 01-LEARNINGS.md → "Code review catches what executors' self-checks
 * cannot" for the C1 cross-tenant injection class.
 *
 * PII discipline (M-4): NEVER pass applicant email or full_name through to
 * Sentry. Catch blocks log `err.name + status` only; helper-layer Sentry
 * tags include only fixed strings + slug/org_id.
 */

import { createHash } from 'node:crypto'

import * as Sentry from '@sentry/nextjs'
import { headers } from 'next/headers'

import { createActivity } from '@/lib/db/activities'
import {
  createCandidate,
  getCandidateByEmailForOrg,
  updateCandidate,
} from '@/lib/db/candidates'
import { createCandidateCV, nextCVVersion } from '@/lib/db/candidate-cvs'
import { getOrganizationBySlug } from '@/lib/db/organizations'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { checkApplyFormRateLimit } from '@/lib/integrations/apply-form-rate-limit'
import { verifyTurnstileToken } from '@/lib/integrations/turnstile'
import { isBlockedEmailDomain } from '@/lib/legal/apply-form-blocklist'
import { CURRENT_CONSENT_VERSION } from '@/lib/legal/consent'
import { createServiceClient } from '@/lib/supabase/service'

import { applyFormSchema, type ApplyFormInput } from './schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileMeta = { name: string; size: number; type: string }

export type SubmitApplyResult =
  | {
      ok: true
      signedUrl: string
      candidateCvId: string
      candidateId: string
      organizationId: string
    }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

export type ConfirmApplyResult =
  | { ok: true; redirectTo: string }
  | { ok: false; formError: string }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BYTES = 10 * 1024 * 1024 // 10 MiB — bucket cap
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashIp(): Promise<string> {
  // Read from the request headers — Vercel sets `x-forwarded-for`; nginx
  // and others set `x-real-ip`. Fall back to a fixed marker when neither
  // is present (dev / direct browser hit) — we still want a stable hash
  // so the rate limiter functions.
  const h = await headers()
  const xff = h.get('x-forwarded-for')
  const xri = h.get('x-real-ip')
  const rawIp = (xff?.split(',')[0]?.trim() || xri || '0.0.0.0').slice(0, 64)
  return createHash('sha256').update(rawIp).digest('hex')
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return 'bin'
  return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
}

// ---------------------------------------------------------------------------
// submitApplyAction — the trust-boundary entry point
// ---------------------------------------------------------------------------

export async function submitApplyAction(
  input: ApplyFormInput,
  fileMeta: FileMeta,
  slug: string,
): Promise<SubmitApplyResult> {
  try {
    // 0. IP hash (for rate-limit + audit). Never the raw IP — GDPR.
    const ipHash = await hashIp()

    // 1. Honeypot. Real users never see the input; bots that auto-fill
    //    every field will trip this. Drop silently with a generic error
    //    so the bot can't tune its behaviour.
    if (typeof input?.hp === 'string' && input.hp.length > 0) {
      Sentry.addBreadcrumb({
        category: 'apply-form',
        message: 'honeypot-tripped',
        level: 'info',
      })
      return { ok: false, formError: 'Your submission was flagged.' }
    }

    // 2. Turnstile verification FIRST (cheapest reject; one network call).
    //    Dev affordance: a fixed 'dev-bypass' token is accepted only when
    //    NODE_ENV !== 'production' so local development without a CF
    //    account can still exercise the happy path.
    if (input?.turnstile_token === 'dev-bypass') {
      if (env.NODE_ENV === 'production') {
        return {
          ok: false,
          formError: 'Verification failed. Please retry the challenge.',
        }
      }
      // dev-bypass: skip the network call.
    } else {
      const turnstile = await verifyTurnstileToken(input?.turnstile_token ?? '')
      if (!turnstile.success) {
        return {
          ok: false,
          formError: 'Verification failed. Please retry the challenge.',
        }
      }
    }

    // 3. Zod re-validate (belt + braces — the client already validated).
    const parsed = applyFormSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        fieldErrors: parsed.error.flatten().fieldErrors as Record<
          string,
          string[] | undefined
        >,
      }
    }

    // 4. Email-domain blocklist.
    if (isBlockedEmailDomain(parsed.data.email)) {
      return {
        ok: false,
        fieldErrors: {
          email: ['Please use a personal or work email address.'],
        },
      }
    }

    // 5. File-meta validation. The browser POSTs only meta; bytes follow
    //    via signed URL. Re-check here so a tampered client can't shove
    //    an arbitrary mime/size past the bucket cap.
    if (
      !fileMeta ||
      typeof fileMeta.name !== 'string' ||
      fileMeta.name.length === 0 ||
      fileMeta.name.length > 255 ||
      typeof fileMeta.size !== 'number' ||
      fileMeta.size <= 0 ||
      fileMeta.size > MAX_BYTES ||
      typeof fileMeta.type !== 'string' ||
      !ALLOWED_MIMES.has(fileMeta.type)
    ) {
      return { ok: false, fieldErrors: { cv: ['Invalid CV file.'] } }
    }

    // 6. Service-role client. RLS-bypassing — tenant boundary lives in
    //    the slug → organizations lookup below.
    //
    //    CRITICAL: org.id is the ONLY trusted tenant identifier in this
    //    action. Service-role bypasses RLS. Any client-supplied org field
    //    is ignored. See the header comment block for the full rationale.
    const supabase = createServiceClient()

    const orgResult = await getOrganizationBySlug(supabase, slug)
    if (!orgResult.ok || orgResult.data.apply_form_enabled === false) {
      // Same response for unknown slug AND disabled-form (anti-enumeration).
      return { ok: false, formError: 'Submissions are not currently accepted.' }
    }
    const org = orgResult.data

    // 7. Rate limit (per IP+org). Fail-OPEN on transient DB errors.
    const rl = await checkApplyFormRateLimit(supabase, {
      ipHash,
      organizationId: org.id,
    })
    if (!rl.allowed) {
      return {
        ok: false,
        formError:
          'Too many submissions from this network. Please try again in a few hours.',
      }
    }

    // 8. Duplicate detection. If the email exists in this org, append a
    //    new CV row to the existing candidate (re-application path) per
    //    RESEARCH §C.16.
    const existing = await getCandidateByEmailForOrg(supabase, {
      organizationId: org.id,
      email: parsed.data.email,
    })
    if (!existing.ok) {
      return { ok: false, formError: 'Something went wrong. Please try again.' }
    }

    let candidateId: string
    if (existing.data) {
      candidateId = existing.data.id
      // Bump cold → actively_looking; leave other statuses alone.
      if (existing.data.market_status === 'cold') {
        await updateCandidate(supabase, candidateId, {
          market_status: 'actively_looking',
        })
      }
      const activityRes = await createActivity(supabase, {
        kind: 'system',
        entity_type: 'candidate',
        entity_id: candidateId,
        body: 'Re-applied via public form',
        actor_user_id: null,
        metadata: {
          apply_form: true,
          slug,
          marketing_consent: parsed.data.marketing_consent === true,
        },
      })
      if (!activityRes.ok) {
        // Activity write failure is non-fatal — the candidate exists, the
        // CV row will land next. Sentry already captured the error from
        // inside createActivity; we keep going.
      }
    } else {
      // New candidate. Pass organization_id explicitly — the apply path
      // is service-role + no session, so the trigger has no
      // current_organization_id() to read.
      const insertRes = await createCandidate(supabase, {
        full_name: parsed.data.full_name,
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
        location: parsed.data.location ?? null,
        current_role_title: parsed.data.current_role_title ?? null,
        current_company: null,
        market_status: 'actively_looking',
        source: 'apply_form',
        source_detail: parsed.data.source_detail || slug,
        organization_id: org.id,
        consent_basis: 'consent',
        // Server-side timestamp; never trust the client clock — UK GDPR
        // Art. 7 demonstrable consent requires accuracy.
        consent_at: new Date().toISOString(),
        consent_text_version: CURRENT_CONSENT_VERSION,
      })
      if (!insertRes.ok) {
        return {
          ok: false,
          formError: 'Something went wrong. Please try again.',
        }
      }
      candidateId = insertRes.data.id

      // Initial system activity.
      await createActivity(supabase, {
        kind: 'system',
        entity_type: 'candidate',
        entity_id: candidateId,
        body: 'Candidate applied via public form',
        actor_user_id: null,
        metadata: {
          apply_form: true,
          slug,
          marketing_consent: parsed.data.marketing_consent === true,
        },
      })
    }

    // 9. Storage path. The `applicants/` segment differentiates apply-form
    //    uploads from recruiter-uploaded paths (`<org>/<candidate>/...`),
    //    enabling separate retention policies later if needed.
    const ext = fileExt(fileMeta.name)
    const storagePath = `${org.id}/applicants/${candidateId}-${crypto.randomUUID()}.${ext}`

    // 9a. EXPLICIT TENANT ASSERTION (VERIFICATION M-2 — BLOCKER).
    //     Mirrors Phase 1's C1 cross-tenant FK-guard lesson: even when both
    //     sides are server-constructed, machine-checkable assertions
    //     prevent future "looks-safe-but-not-asserted" regressions.
    if (!storagePath.startsWith(`${org.id}/applicants/`)) {
      Sentry.captureException(
        new Error('apply: storage path tenant assertion failed'),
        {
          tags: {
            layer: 'server-action',
            action: 'submitApplyAction',
            org_slug: slug,
          },
        },
      )
      return { ok: false, formError: 'Something went wrong. Please try again.' }
    }

    // 9b. Mint signed upload URL. Single-use, scoped to storagePath,
    //     default ~2h expiry (plenty for client PUT).
    const { data: signed, error: signError } = await supabase.storage
      .from('cvs')
      .createSignedUploadUrl(storagePath)
    if (signError || !signed) {
      Sentry.captureException(
        new Error(`apply: createSignedUploadUrl failed: ${signError?.message ?? 'unknown'}`),
        {
          tags: {
            layer: 'server-action',
            action: 'submitApplyAction',
            subop: 'createSignedUploadUrl',
            org_slug: slug,
          },
        },
      )
      return { ok: false, formError: 'Something went wrong. Please try again.' }
    }

    // 10. candidate_cvs row. FK guard:
    //     candidate_cvs_verify_same_org_check enforces same-org on
    //     candidate_id (Phase 1 commit 0966875).
    const versionRes = await nextCVVersion(supabase, candidateId)
    if (!versionRes.ok) {
      return { ok: false, formError: 'Something went wrong. Please try again.' }
    }
    const cvRes = await createCandidateCV(supabase, {
      candidateId,
      storagePath,
      mimeType: fileMeta.type,
      fileSizeBytes: fileMeta.size,
      version: versionRes.data,
      uploadedBy: null,
    })
    if (!cvRes.ok) {
      // Roll back the soon-to-be-orphaned signed URL? The Storage object
      // hasn't been written yet — no cleanup needed. Just bail.
      return { ok: false, formError: 'Something went wrong. Please try again.' }
    }
    const candidateCvId = cvRes.data.id

    // 11. Anonymous audit. Plan 0's record_audit_anonymous accepts an
    //     explicit org id (no auth.uid()). ip_hash in metadata for fraud
    //     forensics — never raw IP.
    // reason: record_audit_anonymous is not yet in the generated RPC types.
    const supabaseRpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message?: string } | null }>
    }
    const { error: auditError } = await supabaseRpc.rpc(
      'record_audit_anonymous',
      {
        p_organization_id: org.id,
        p_action: 'create',
        p_entity_type: 'candidate',
        p_entity_id: candidateId,
        p_metadata: { source: 'apply_form', ip_hash: ipHash },
      },
    )
    if (auditError) {
      // Audit failure is non-fatal — the candidate + CV rows still exist.
      // Surface in Sentry for forensics.
      Sentry.captureException(
        new Error(`apply: record_audit_anonymous failed`),
        {
          tags: {
            layer: 'server-action',
            action: 'submitApplyAction',
            subop: 'record_audit_anonymous',
            org_slug: slug,
          },
        },
      )
    }

    // 12. Return signed URL + ids. NOTE: we DO NOT fire cv/uploaded here —
    //     the Storage object doesn't exist yet (the client PUTs next).
    //     confirmApplyAction fires the event after the upload completes.
    return {
      ok: true,
      signedUrl: signed.signedUrl,
      candidateCvId,
      candidateId,
      organizationId: org.id,
    }
  } catch (err) {
    // PII discipline (R4): NEVER pass `err` directly. Only err.name + a
    // fixed subop label go to Sentry. Email / full_name never leave the
    // function.
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`apply-submit: ${errName}`), {
      tags: {
        layer: 'server-action',
        action: 'submitApplyAction',
        org_slug: slug,
      },
    })
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }
}

// ---------------------------------------------------------------------------
// confirmApplyAction — runs AFTER the client has PUT the file to Storage
// ---------------------------------------------------------------------------

export async function confirmApplyAction(args: {
  candidateId: string
  candidateCvId: string
  organizationId: string
  orgSlug: string
}): Promise<ConfirmApplyResult> {
  try {
    const supabase = createServiceClient()

    // 1. Re-verify tenant boundary: the CV row must exist AND belong to
    //    the (org, candidate) pair the client claims. This blocks a
    //    malicious client from confirming a CV they don't own.
    const { data: cvRow, error: cvReadError } = await supabase
      .from('candidate_cvs')
      .select('id, organization_id, candidate_id, storage_path, mime_type')
      .eq('id', args.candidateCvId)
      .eq('organization_id', args.organizationId)
      .eq('candidate_id', args.candidateId)
      .maybeSingle()
    if (cvReadError || !cvRow) {
      Sentry.addBreadcrumb({
        category: 'apply-form',
        message: 'confirm: cv row not found or tenant mismatch',
        level: 'warning',
      })
      return { ok: false, formError: 'CV record not found.' }
    }

    // 2. Verify the Storage object exists (client genuinely uploaded it).
    //    list() within the parent dir + filter on filename basename.
    const lastSlash = cvRow.storage_path.lastIndexOf('/')
    const dir = lastSlash >= 0 ? cvRow.storage_path.slice(0, lastSlash) : ''
    const basename =
      lastSlash >= 0 ? cvRow.storage_path.slice(lastSlash + 1) : cvRow.storage_path
    const { data: listing, error: listError } = await supabase.storage
      .from('cvs')
      .list(dir, { search: basename, limit: 1 })
    if (listError) {
      Sentry.captureException(
        new Error(`apply-confirm: storage.list failed`),
        {
          tags: {
            layer: 'server-action',
            action: 'confirmApplyAction',
            subop: 'storage.list',
            org_slug: args.orgSlug,
          },
        },
      )
      return { ok: false, formError: 'Could not confirm upload. Please try again.' }
    }
    const objectExists = (listing ?? []).some((o) => o.name === basename)
    if (!objectExists) {
      return {
        ok: false,
        formError: 'CV upload did not complete. Please try again.',
      }
    }

    // 3. Fire cv/uploaded. Reuses the Phase 1 parse pipeline → Plan 1
    //    embed chain. NEVER add a parallel path.
    //
    //    Failure handling (VERIFICATION M-8): wrap in try/catch + Sentry.
    //    DO NOT roll back — the audit + DB rows are still useful; the
    //    recruiter can manually retry parsing from the candidate detail
    //    page via the Phase 1 Retry button.
    try {
      await inngest.send({
        name: 'cv/uploaded',
        data: {
          organization_id: args.organizationId,
          candidate_id: args.candidateId,
          candidate_cv_id: args.candidateCvId,
          storage_path: cvRow.storage_path,
          mime_type: cvRow.mime_type,
          user_id: null,
        },
      })
    } catch (sendErr) {
      const errName = sendErr instanceof Error ? sendErr.name : 'UnknownError'
      Sentry.captureException(
        new Error(`apply-confirm: inngest.send ${errName}`),
        {
          tags: {
            layer: 'server-action',
            action: 'confirmApplyAction',
            subop: 'inngest.send',
            org_slug: args.orgSlug,
          },
        },
      )
      // M-8 fallback: candidate + cv rows persist. parsing_status stays
      // 'pending'; Phase 1's Retry button on the candidate detail page
      // re-fires cv/uploaded. Return ok so the user reaches the success
      // page — their CV IS safely uploaded; only the parse hasn't queued.
    }

    return { ok: true, redirectTo: `/apply/${args.orgSlug}/success` }
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`apply-confirm: ${errName}`), {
      tags: {
        layer: 'server-action',
        action: 'confirmApplyAction',
        org_slug: args.orgSlug,
      },
    })
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }
}
