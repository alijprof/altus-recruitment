import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { parseCV } from '@/lib/ai/claude'
import {
  DOCX_MIME,
  extractTextFromBuffer,
  PDF_MIME,
  UnsupportedCVMimeTypeError,
} from '@/lib/ai/cv-extract'
import {
  markCandidateFieldsFromCV,
  updateCandidateCVParse,
} from '@/lib/db/candidate-cvs'
import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase/service'

// Friendly message shown in the UI when parsing fails. Locked to the
// UI-SPEC §Error States literal so the panel renders the exact copy.
const FAILED_USER_MESSAGE =
  'Parsing failed. You can retry now or continue and parse later.'

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
 */
async function markCvFailed(args: { candidateCvId: string; userMessage: string }) {
  try {
    const supabase = createServiceClient()
    await updateCandidateCVParse(supabase, {
      id: args.candidateCvId,
      status: 'failed',
      parseError: args.userMessage,
    })
  } catch (err) {
    Sentry.captureException(
      new Error(
        (err instanceof Error ? err.name : 'unknown') +
          ': mark-cv-failed write failed',
      ),
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

/**
 * Extract a numeric `status` off an unknown error in a type-safe way.
 * Returns 'unknown' when not present. Used only for tagging Sentry
 * payloads — never for control flow.
 */
function readStatus(err: unknown): number | 'unknown' {
  if (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    return (err as { status: number }).status
  }
  return 'unknown'
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
      Sentry.captureException(
        new Error(`${error.name}: ${status} (onFailure handler)`),
        {
          tags: {
            layer: 'inngest',
            function: 'parse-cv-on-upload',
            handler: 'onFailure',
            candidate_cv_id: originalData.candidate_cv_id,
          },
        },
      )
      await markCvFailed({
        candidateCvId: originalData.candidate_cv_id,
        userMessage: FAILED_USER_MESSAGE,
      })
    },
  },
  async ({ event, step }) => {
    const data = asCVUploadedData(event.data)
    const {
      organization_id,
      candidate_id,
      candidate_cv_id,
      storage_path,
      mime_type,
      user_id,
    } = data

    // -----------------------------------------------------------------------
    // CRITICAL — tenant boundary check.
    //
    // The service-role client BYPASSES RLS. The only thing standing between
    // a malicious or buggy event payload (e.g. crafted via inngest.send
    // from a compromised account) and a cross-tenant read is THIS check.
    // RESEARCH §17 + §4. Do not move it inside a step.run — we want the
    // NonRetriableError to fire before Inngest spends an attempt on it.
    // -----------------------------------------------------------------------
    if (!storage_path.startsWith(`${organization_id}/${candidate_id}/`)) {
      throw new NonRetriableError('storage_path outside tenant boundary')
    }

    if (mime_type !== PDF_MIME && mime_type !== DOCX_MIME) {
      // Caught by uploadCVAction already, but defensive: reject here too
      // so a forged event can't smuggle in an unsupported type.
      throw new NonRetriableError(`unsupported mime type: ${mime_type}`)
    }

    try {
      // Step 1: download the file from Storage.
      // We serialize the bytes as a base64 string because Inngest's step
      // output must be JSON-serializable, and ArrayBuffer/Uint8Array are
      // not. Base64 round-trip is the standard pattern.
      const base64Buffer = await step.run('download-cv', async () => {
        const supabase = createServiceClient()
        const { data: blob, error } = await supabase.storage
          .from('cvs')
          .download(storage_path)
        if (error || !blob) {
          throw new NonRetriableError(
            `download failed: ${error?.message ?? 'no data'}`,
          )
        }
        const ab = await blob.arrayBuffer()
        return Buffer.from(ab).toString('base64')
      })

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
          // useful names. Don't retry — corruption won't fix itself.
          const name = err instanceof Error ? err.name : 'UnknownError'
          throw new NonRetriableError(`extract-text failed: ${name}`)
        }
      })

      if (!text || text.trim().length < MIN_EXTRACTED_CHARS) {
        // Almost certainly a scanned image PDF. Mark as failed with a
        // helpful UI message and stop the pipeline.
        await markCvFailed({
          candidateCvId: candidate_cv_id,
          userMessage:
            'CV appears to contain no extractable text (scanned image?).',
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
        await markCandidateFieldsFromCV(supabase, {
          candidateId: candidate_id,
          // The helper subset matches the parsed CV shape one-to-one.
          parsed: {
            email: parsed.email ?? null,
            phone: parsed.phone ?? null,
            location: parsed.location ?? null,
            current_role: parsed.current_role ?? null,
            current_company: parsed.current_company ?? null,
            seniority_level: parsed.seniority_level ?? null,
            salary_current_estimate: parsed.salary_current_estimate ?? null,
            salary_expectation: parsed.salary_expectation ?? null,
            // parseCV's tool schema doesn't return `currency` — leave null
            // and let the candidate column keep its 'GBP' default.
            currency: null,
            years_experience_total: parsed.years_experience_total ?? null,
            skills: parsed.skills ?? null,
            sector_tags: parsed.sector_tags ?? null,
          },
        })
      })
    } catch (err) {
      // Anything that fell through to here is either a NonRetriableError
      // (final) or an unexpected throw from outside a step. Either way,
      // mark the row failed so the UI shows the retry button. Inngest
      // re-throws NonRetriableError to surface in its dashboard.
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
      })
      throw err
    }
  },
)
