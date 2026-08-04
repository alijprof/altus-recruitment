import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { parseCV } from '@/lib/ai/claude'
import {
  DOCX_MIME,
  extractTextFromBuffer,
  PDF_MIME,
  UnsupportedCVMimeTypeError,
} from '@/lib/ai/cv-extract'
import { candidateEmbeddingText } from '@/lib/ai/embed-text'
import { isProfileEffectivelyEmpty } from '@/lib/ai/profile-completeness'
import { embed } from '@/lib/ai/voyage'
import {
  CV_BUDGET_CAPPED_MESSAGE,
  CV_NO_TEXT_MESSAGE,
  CV_PARSE_FAILED_MESSAGE,
  CV_UPLOAD_INCOMPLETE_MESSAGE,
} from '@/lib/cv/parse-messages'
import {
  getCandidateCV,
  markCandidateFieldsFromCV,
  toParsedCVSubset,
  updateCandidateCVParse,
} from '@/lib/db/candidate-cvs'
import { bumpCandidateEmbedding, getCandidateForEmbedding } from '@/lib/db/candidates'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { checkCap, CapExceededError } from '@/lib/stripe/cap-enforcement'
import { createServiceClient } from '@/lib/supabase/service'

// Friendly message shown in the UI when parsing fails. Locked to the
// UI-SPEC §Error States literal so the panel renders the exact copy.
// Shared with cv-review-panel.tsx via src/lib/cv/parse-messages.ts (SF-1).
const FAILED_USER_MESSAGE = CV_PARSE_FAILED_MESSAGE

// Shown when parsing is blocked by the AI budget (monthly £ ceiling or the
// cv_parse cap). Batch A item 1: an honest "paused" message — NOT a misleading
// "retry now", because retrying fails identically until the budget resets or is
// raised. The cv-review panel keys off the 'AI budget' substring to swap the
// retry button for a billing link. Keep that phrase if you edit this copy.
// Shared with cv-review-panel.tsx via src/lib/cv/parse-messages.ts (SF-1).
const BUDGET_CAPPED_USER_MESSAGE = CV_BUDGET_CAPPED_MESSAGE

// Cap raw CV text to avoid runaway tokens. Typical CV is < 10k chars;
// 60k is the conservative ceiling — anything longer is either OCR noise
// or a portfolio masquerading as a CV.
const MAX_CV_TEXT_CHARS = 60_000

// Minimum extracted text length below which we assume the PDF was a
// scanned image and the parse will produce garbage.
const MIN_EXTRACTED_CHARS = 50

type CVUploadedEventData = {
  organization_id: string
  candidate_id: string
  candidate_cv_id: string
  storage_path: string
  mime_type: string
  user_id: string | null
}

/**
 * Pull the original event payload out of a JSON-shaped value. Used both in
 * the body (where the runtime type is the event payload directly) and in
 * onFailure (where it's wrapped under event.data.event.data).
 */
function asCVUploadedData(value: unknown): CVUploadedEventData {
  // reason: Inngest typings are deliberately wide so user payload shapes
  // never block compilation. We trust the data because uploadCVAction is
  // the only producer in the codebase. RLS / tenant guard catches forgery.
  return value as CVUploadedEventData
}

/**
 * Record a final failure on the candidate_cvs row. Best-effort: if THIS
 * call itself fails we just log to Sentry — there's nothing else to do
 * (the row remains 'pending' and the user can hit Retry).
 *
 * `preserveExistingMessage` (SF-1 root-cause fix): today the scanned-PDF
 * branch writes a specific honest message, then throws NonRetriableError,
 * which fires onFailure, which used to call this with the GENERIC
 * FAILED_USER_MESSAGE — overwriting the honest one. This is exactly why the
 * audit found "the stored parse_error is the generic UI string; no root
 * cause persisted anywhere". When true, this reads the row first; if it's
 * already 'failed' with a non-empty parse_error, it leaves that message
 * alone instead of clobbering it. Every in-body call site keeps the
 * current overwrite behaviour (preserveExistingMessage defaults to false).
 */
async function markCvFailed(args: {
  candidateCvId: string
  userMessage: string
  parseErrorDetail?: string
  preserveExistingMessage?: boolean
}) {
  try {
    const supabase = createServiceClient()
    let userMessage = args.userMessage
    let parseErrorDetail = args.parseErrorDetail
    if (args.preserveExistingMessage) {
      const existing = await getCandidateCV(supabase, args.candidateCvId)
      if (
        existing.ok &&
        existing.data.parsing_status === 'failed' &&
        typeof existing.data.parse_error === 'string' &&
        existing.data.parse_error.length > 0
      ) {
        userMessage = existing.data.parse_error
        // Review 2026-08-04 L5: preserve BOTH or NEITHER. Overwriting the
        // detail while keeping the message destroyed the more useful stored
        // root cause ('extract-text yielded 0 chars for mime …',
        // 'download-cv: storage object not found') and replaced it with a
        // bare `${error.name}: ${status}`. `undefined` leaves the column
        // untouched (see updateCandidateCVParse).
        parseErrorDetail = undefined
      }
    }
    await updateCandidateCVParse(supabase, {
      id: args.candidateCvId,
      status: 'failed',
      parseError: userMessage,
      parseErrorDetail,
    })
  } catch (err) {
    Sentry.captureException(
      new Error((err instanceof Error ? err.name : 'unknown') + ': mark-cv-failed write failed'),
      {
        tags: {
          layer: 'inngest',
          function: 'parse-cv-on-upload',
          subop: 'mark-failed',
          candidate_cv_id: args.candidateCvId,
        },
      },
    )
  }
}

export const parseCVOnUpload = inngest.createFunction(
  {
    id: 'parse-cv-on-upload',
    triggers: [{ event: 'cv/uploaded' }],
    // Per-tenant concurrency cap so one org's bulk upload doesn't starve
    // others. 5 parallel parses is comfortably below Claude's 50 RPM
    // tier-1 default and well within Inngest's free-tier runner limits.
    concurrency: { limit: 5, key: 'event.data.organization_id' },
    retries: 3,
    onFailure: async ({ event, error }) => {
      // Belt-and-braces: if the body throws something we didn't catch,
      // mark the row failed so the UI surfaces the retry button.
      // VERIFICATION R4: never pass the original error object — wrap the
      // name + status so any prompt fragments in error.message can't
      // bypass the beforeSend PII scrub.
      const originalData = asCVUploadedData(event.data.event.data)
      const status = readStatus(error)
      Sentry.captureException(new Error(`${error.name}: ${status} (onFailure handler)`), {
        tags: {
          layer: 'inngest',
          function: 'parse-cv-on-upload',
          handler: 'onFailure',
          candidate_cv_id: originalData.candidate_cv_id,
        },
      })
      await markCvFailed({
        candidateCvId: originalData.candidate_cv_id,
        userMessage: FAILED_USER_MESSAGE,
        parseErrorDetail: `${error.name}: ${status}`,
        // SF-1 root-cause fix: don't clobber an honest in-body message
        // (e.g. the scanned-PDF branch's CV_NO_TEXT_MESSAGE) with this
        // generic fallback — see markCvFailed's doc comment.
        preserveExistingMessage: true,
      })
    },
  },
  async ({ event, step }) => {
    const data = asCVUploadedData(event.data)
    const { organization_id, candidate_id, candidate_cv_id, storage_path, mime_type, user_id } =
      data

    // -----------------------------------------------------------------------
    // CRITICAL — tenant boundary check.
    //
    // The service-role client BYPASSES RLS. The only thing standing between
    // a malicious or buggy event payload (e.g. crafted via inngest.send
    // from a compromised account) and a cross-tenant read is THIS check.
    // RESEARCH §17 + §4. Do not move it inside a step.run — we want the
    // NonRetriableError to fire before Inngest spends an attempt on it.
    //
    // Two valid path layouts (both bind org_id AND candidate_id into the
    // path so a forged event can't redirect us at another tenant's bytes):
    //   1. Recruiter upload:   <org>/<candidate>/<filename>
    //   2. Apply form upload:  <org>/applicants/<candidate>-<uuid>.<ext>
    // The apply-form layout is set in submitApplyAction (D2-... — keep
    // `applicants/` segregated for separate retention policy later).
    // -----------------------------------------------------------------------
    const isRecruiterUpload = storage_path.startsWith(`${organization_id}/${candidate_id}/`)
    const isApplyFormUpload = storage_path.startsWith(
      `${organization_id}/applicants/${candidate_id}-`,
    )
    if (!isRecruiterUpload && !isApplyFormUpload) {
      throw new NonRetriableError('storage_path outside tenant boundary')
    }

    if (mime_type !== PDF_MIME && mime_type !== DOCX_MIME) {
      // Caught by uploadCVAction already, but defensive: reject here too
      // so a forged event can't smuggle in an unsupported type.
      throw new NonRetriableError(`unsupported mime type: ${mime_type}`)
    }

    // -----------------------------------------------------------------------
    // Pre-flight AI budget check (Batch A item 1).
    //
    // A hard cap — the monthly £ AI-spend ceiling OR the cv_parse bucket cap —
    // is NOT a transient failure: parsing would fail identically on every one
    // of Inngest's 3 retries (burning quota and confusing the recruiter with a
    // "retry" button that never works). Detect it up-front, mark the row with
    // an honest "AI budget reached — parsing paused" message, and return
    // WITHOUT throwing so Inngest treats the run as complete (no retries, no
    // onFailure). A manual re-parse after the budget resets / is raised will
    // sail through. checkCap fails open, so a billing glitch never blocks here.
    // Wrapped in a step so the check (and any soft-cap email it fires) is
    // memoised and not re-run on later step replays.
    const budget = await step.run('check-ai-budget', () => checkCap(organization_id, 'cv_parse'))
    if (!budget.allow && budget.mode === 'hard') {
      await markCvFailed({
        candidateCvId: candidate_cv_id,
        userMessage: BUDGET_CAPPED_USER_MESSAGE,
        parseErrorDetail: 'pre-flight: AI budget cap (mode=hard)',
      })
      return
    }

    try {
      // Step 1: download the file from Storage.
      // We serialize the bytes as a base64 string because Inngest's step
      // output must be JSON-serializable, and ArrayBuffer/Uint8Array are
      // not. Base64 round-trip is the standard pattern.
      //
      // Review 2026-08-04 C2: this step used to THROW on a missing object, so
      // the in-body catch below wrote the GENERIC failure copy — destroying
      // the honest `fail-no-file` reason the reconciler had stored, on the
      // very first retry. It now returns a discriminated result so the caller
      // can record the accurate message BEFORE the NonRetriableError fires.
      const downloaded = await step.run('download-cv', async () => {
        const supabase = createServiceClient()
        const { data: blob, error } = await supabase.storage.from('cvs').download(storage_path)
        if (error || !blob) {
          // Distinguish "the object isn't there" (an abandoned upload — no
          // retry can ever succeed) from a transient Storage fault. Storage
          // errors carry no PII; we keep only the status/name either way.
          const statusCode = (error as { statusCode?: string | number } | null)?.statusCode
          const missing =
            String(statusCode ?? '') === '404' || /not\s*found/i.test(error?.message ?? '')
          return {
            ok: false as const,
            missing,
            reason: missing ? 'object-not-found' : (error?.name ?? 'no-data'),
          }
        }
        const ab = await blob.arrayBuffer()
        return { ok: true as const, base64: Buffer.from(ab).toString('base64') }
      })
      if (!downloaded.ok) {
        if (downloaded.missing) {
          await markCvFailed({
            candidateCvId: candidate_cv_id,
            userMessage: CV_UPLOAD_INCOMPLETE_MESSAGE,
            parseErrorDetail: 'download-cv: storage object not found',
          })
        }
        // A transient fault falls through to the in-body catch, which writes
        // the generic message — correct, because a retry there CAN succeed.
        throw new NonRetriableError(`download failed: ${downloaded.reason}`)
      }
      const base64Buffer = downloaded.base64

      // Step 2: extract plain text. Capped at MAX_CV_TEXT_CHARS so a
      // novel-length resume doesn't blow Haiku's context window.
      const text = await step.run('extract-text', async () => {
        const bytes = Buffer.from(base64Buffer, 'base64')
        try {
          const extracted = await extractTextFromBuffer(bytes, mime_type)
          return extracted.slice(0, MAX_CV_TEXT_CHARS)
        } catch (err) {
          if (err instanceof UnsupportedCVMimeTypeError) {
            throw new NonRetriableError(err.message)
          }
          // Corrupt PDF/DOCX. unpdf and mammoth throw plain Errors with
          // useful names + messages. Don't retry — corruption won't fix
          // itself. Include err.message (truncated) so the Inngest run
          // details surface what actually broke. Library parsing errors
          // don't contain candidate PII — they're library internals.
          const name = err instanceof Error ? err.name : 'UnknownError'
          const message = err instanceof Error ? err.message.slice(0, 500) : ''
          throw new NonRetriableError(`extract-text failed: ${name}: ${message}`)
        }
      })

      if (!text || text.trim().length < MIN_EXTRACTED_CHARS) {
        // SF-1 fix: almost certainly a scanned image PDF. Mark as failed
        // with an HONEST message — retrying the same bytes cannot work, so
        // CV_NO_TEXT_MESSAGE says so explicitly instead of inviting a
        // doomed retry. The detail carries the char count + mime type only
        // (never extracted text) for the recruiter-invisible root cause.
        await markCvFailed({
          candidateCvId: candidate_cv_id,
          userMessage: CV_NO_TEXT_MESSAGE,
          parseErrorDetail: `extract-text yielded ${text?.length ?? 0} chars for mime ${mime_type}`,
        })
        throw new NonRetriableError('cv contains no extractable text')
      }

      // Step 3: call Claude. parseCV() logs to ai_usage automatically
      // (CV-04 / CLAUDE.md mandate) — do NOT instantiate Anthropic here.
      const parsed = await step.run('claude-parse', async () => {
        return await parseCV({
          cvText: text,
          organizationId: organization_id,
          userId: user_id,
        })
      })

      // Step 4: persist the structured output. Two writes:
      //   (a) candidate_cvs.extracted_data + parsing_status='complete'
      //   (b) populate empty candidate fields (D-08)
      await step.run('write-extracted', async () => {
        const supabase = createServiceClient()
        const updateResult = await updateCandidateCVParse(supabase, {
          id: candidate_cv_id,
          status: 'complete',
          extractedData: parsed,
          parseError: null,
        })
        if (!updateResult.ok) {
          throw new Error('failed to write extracted data')
        }

        // D-08: empty-field merge ONLY. The helper enforces both null and
        // empty-array predicates so a CV row never clobbers user input.
        //
        // SF-2 fix: the merge result is CHECKED. Previously the return value
        // was discarded — a failed merge (e.g. a transient DB error) still
        // landed the row as parsing_status='complete', lying about the
        // candidate's profile state. Throwing here (inside step.run) makes
        // Inngest retry the step; if retries exhaust, onFailure marks the
        // row honestly failed instead of silently discarding the outcome.
        const mergeResult = await markCandidateFieldsFromCV(supabase, {
          candidateId: candidate_id,
          // toParsedCVSubset is the single source of truth for this
          // mapping — also used by the reconciler's heal-unmerged-profiles
          // step so the two call sites never drift.
          parsed: toParsedCVSubset(parsed),
        })
        if (!mergeResult.ok) {
          throw new Error(`markCandidateFieldsFromCV: ${mergeResult.code}`)
        }
      })

      // Step 5: embed the candidate (Plan 1 Task 1.1).
      // Reactive embed at the CV-parse moment — the candidate's structured
      // fields are freshly populated and the CV text is still in memory.
      // Failure here is non-fatal: the parse already committed, and the
      // scheduled `embed-candidates-batch` sweep picks the candidate up on
      // its next run (NULL embedding selector). We log to Sentry but do
      // NOT throw — we don't want a transient Voyage outage to NULL out a
      // successful parse.
      try {
        await step.run('embed-candidate', async () => {
          const supabase = createServiceClient()
          const candidateResult = await getCandidateForEmbedding(supabase, candidate_id)
          if (!candidateResult.ok) {
            // Row vanished between write-extracted and here — extremely
            // unlikely; surface and return so the sweep can retry.
            throw new Error(`getCandidateForEmbedding: ${candidateResult.code}`)
          }
          const candidate = candidateResult.data

          // SF-1 contamination guard: a CV whose text extracted but whose
          // structured fields all came back empty (Haiku returned nothing
          // usable, or the 2.2a merge failed) would otherwise still get
          // embedded from raw bytes with no profile behind it — findable
          // and scorable from nothing but a name. Skip the embed entirely;
          // the row keeps a NULL embedding and stays out of search/match
          // results, which is correct — a name-only candidate isn't
          // meaningfully searchable anyway.
          if (isProfileEffectivelyEmpty(candidate)) {
            return
          }

          // The hybrid embedding input: structured candidate summary + raw
          // CV text (capped via MAX_CV_CHARS_FOR_EMBED inside the builder).
          // `text` is the already-extracted plain text from Step 2.
          const embeddingText = candidateEmbeddingText(candidate, text)
          if (embeddingText.trim().length === 0) {
            // Defensive — both summary and text empty means we have nothing
            // to embed. Skip; the sweep won't pick this up either (it
            // filters on NULL embedding, but a degenerate row would just
            // keep failing).
            return
          }

          const { vectors } = await embed({
            organizationId: organization_id,
            userId: user_id,
            purpose: 'candidate_embed',
            inputType: 'document',
            inputs: [embeddingText],
          })
          const vector = vectors[0]
          if (!vector || vector.length === 0) {
            throw new Error('voyage embed returned no vector')
          }

          await bumpCandidateEmbedding(supabase, {
            candidateId: candidate_id,
            embedding: vector,
            embeddingVersion: (candidate.embedding_version ?? 0) + 1,
          })
        })
      } catch (embedErr) {
        // VERIFICATION R4: wrap name + status only — Voyage SDK errors
        // can echo input prompts in error.message which would bypass the
        // global Sentry beforeSend PII scrub.
        const name = embedErr instanceof Error ? embedErr.name : 'UnknownError'
        const status = readStatus(embedErr)
        Sentry.captureException(new Error(`${name}: ${status}`), {
          tags: {
            layer: 'inngest',
            function: 'parse-cv-on-upload',
            subop: 'embed-candidate',
            candidate_id,
          },
        })
        // Intentionally swallow — parse already succeeded. Sweep will
        // retry the embed on its next 10-min cadence.
      }
    } catch (err) {
      // Budget cap reached MID-PARSE (the pre-flight passed, but the AI £
      // ceiling / cv_parse cap tripped between the pre-flight and parseCV's
      // own internal checkCap, which throws CapExceededError). Treat it exactly
      // like the pre-flight: honest "paused" message + return WITHOUT throwing
      // so Inngest doesn't burn the 3 retries and onFailure can't overwrite the
      // message. Mirrors precompute-matches-for-job / send-email-campaign.
      if (err instanceof CapExceededError) {
        await markCvFailed({
          candidateCvId: candidate_cv_id,
          userMessage: BUDGET_CAPPED_USER_MESSAGE,
          parseErrorDetail: 'mid-parse: CapExceededError',
        })
        return
      }

      // Anything else that fell through is either a NonRetriableError (final)
      // or an unexpected throw from outside a step. Either way, mark the row
      // failed so the UI shows the retry button. Inngest re-throws
      // NonRetriableError to surface in its dashboard.
      //
      // VERIFICATION R4: pass only error.name + status to Sentry. Never
      // the original error object — Anthropic SDK errors can embed
      // prompt fragments in error.message which would bypass the global
      // beforeSend PII scrub.
      const name = err instanceof Error ? err.name : 'UnknownError'
      const status = readStatus(err)
      Sentry.captureException(new Error(`${name}: ${status}`), {
        tags: {
          layer: 'inngest',
          function: 'parse-cv-on-upload',
          candidate_cv_id,
        },
      })
      await markCvFailed({
        candidateCvId: candidate_cv_id,
        userMessage: FAILED_USER_MESSAGE,
        parseErrorDetail: `${name}: ${status}`,
        // Review 2026-08-04 C2: the in-body branches above (no-extractable-
        // text, storage-object-missing) already wrote an honest, specific
        // message for this same invocation. Without this flag the generic
        // copy overwrote it here — the exact SF-1 clobber onFailure was
        // fixed for. Safe: retryParseAction resets the row to 'pending' with
        // a NULL parse_error before re-dispatching, so a stale message from
        // a PREVIOUS attempt can never be resurrected.
        preserveExistingMessage: true,
      })
      throw err
    }
  },
)
