import * as Sentry from '@sentry/nextjs'

import {
  isProfileEffectivelyEmpty,
  PROFILE_COMPLETENESS_COLUMNS,
} from '@/lib/ai/profile-completeness'
import { CV_STUCK_MESSAGE, CV_UPLOAD_INCOMPLETE_MESSAGE } from '@/lib/cv/parse-messages'
import { decideStuckPendingAction, STUCK_PENDING_GRACE_MS } from '@/lib/cv/reconcile-decisions'
import {
  markCandidateFieldsFromCV,
  toParsedCVSubset,
  updateCandidateCVParse,
  type ParsedCVSubset,
} from '@/lib/db/candidate-cvs'
import { getCandidateForEmbedding } from '@/lib/db/candidates'
import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { checkCap } from '@/lib/stripe/cap-enforcement'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// reconcile-cv-parses — 15-min cron sweep (SF-4 + SF-5 + SF-2 remediation).
//
// 2026-07-31 Steele Charles feature review: a recruiter fought a stuck CV
// parse for 7 hours with nothing telling anyone; two candidates parsed
// "complete" but their extracted data never reached their profile; four
// apply-form CVs are permanently stuck 'pending'; the UI promises a
// budget-cap auto-resume that no code performs. This sweep heals all four.
//
// Modeled structurally on embed-batch.ts: cron trigger, concurrency 1,
// createServiceClient() per step.run, per-iteration try/catch (one bad row
// or org must never abort the sweep), PII-safe Sentry.
//
// Three independent steps, each with its own hard row cap:
//   A. sweep-stuck-pending      — requeue / fail-no-file / fail-stuck / skip
//   B. resume-budget-capped     — makes "resumes automatically" copy true
//   C. heal-unmerged-profiles   — re-runs the D-08 merge for rows whose CV
//                                  parsed 'complete' but never reached the
//                                  candidate row (SF-2 production casualties)
// ---------------------------------------------------------------------------

const STUCK_PENDING_ROW_CAP = 50
const BUDGET_CAPPED_ROW_CAP = 50
const HEAL_ROW_CAP = 25

type StuckPendingRow = {
  id: string
  organization_id: string
  candidate_id: string
  storage_path: string
  mime_type: string
  created_at: string
}

type BudgetCappedRow = {
  id: string
  organization_id: string
  candidate_id: string
  storage_path: string
  mime_type: string
}

type UnmergedProfileRow = {
  id: string
  candidate_id: string
  extracted_data: unknown
}

// Copied locally rather than exported from embed-batch.ts (plan directive —
// keep the two sweep functions decoupled).
function groupByOrg<T extends { organization_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const list = out.get(r.organization_id) ?? []
    list.push(r)
    out.set(r.organization_id, list)
  }
  return out
}

/**
 * Split a Storage path into (dir, basename) for the `storage.list(dir,
 * { search: basename }) + exact-name match` existence-check idiom used
 * throughout this codebase (see confirmApplyAction).
 */
function splitStoragePath(path: string): { dir: string; basename: string } {
  const lastSlash = path.lastIndexOf('/')
  return {
    dir: lastSlash >= 0 ? path.slice(0, lastSlash) : '',
    basename: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
  }
}

/** True when toParsedCVSubset produced at least one field worth merging. */
function hasAnyUsableField(parsed: ParsedCVSubset): boolean {
  return (
    Boolean(parsed.name) ||
    Boolean(parsed.email) ||
    Boolean(parsed.phone) ||
    Boolean(parsed.location) ||
    Boolean(parsed.current_role) ||
    Boolean(parsed.current_company) ||
    Boolean(parsed.seniority_level) ||
    parsed.salary_current_estimate != null ||
    parsed.salary_expectation != null ||
    parsed.years_experience_total != null ||
    (Array.isArray(parsed.skills) && parsed.skills.length > 0) ||
    (Array.isArray(parsed.sector_tags) && parsed.sector_tags.length > 0) ||
    (Array.isArray(parsed.work_history) && parsed.work_history.length > 0) ||
    (Array.isArray(parsed.education) && parsed.education.length > 0)
  )
}

export const reconcileCvParses = inngest.createFunction(
  {
    id: 'reconcile-cv-parses',
    triggers: [{ cron: 'TZ=Europe/London */15 * * * *' }],
    concurrency: { limit: 1 },
    retries: 1,
  },
  async ({ step }) => {
    // -------------------------------------------------------------------
    // Step A — sweep-stuck-pending.
    // -------------------------------------------------------------------
    await step.run('sweep-stuck-pending', async () => {
      const supabase = createServiceClient()
      const cutoff = new Date(Date.now() - STUCK_PENDING_GRACE_MS).toISOString()
      const { data: rawRows, error } = await supabase
        .from('candidate_cvs')
        .select('id, organization_id, candidate_id, storage_path, mime_type, created_at')
        .eq('parsing_status', 'pending')
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(STUCK_PENDING_ROW_CAP)
      if (error) {
        Sentry.captureException(error, {
          tags: {
            layer: 'inngest',
            function: 'reconcile-cv-parses',
            subop: 'sweep-stuck-pending-select',
          },
        })
        return
      }
      const rows = (rawRows ?? []) as unknown as StuckPendingRow[]
      const now = Date.now()

      for (const row of rows) {
        try {
          const ageMs = now - new Date(row.created_at).getTime()
          const { dir, basename } = splitStoragePath(row.storage_path)
          const { data: listing, error: listError } = await supabase.storage
            .from('cvs')
            .list(dir, { search: basename, limit: 1 })
          if (listError) {
            // A single row's Storage list failure must not abort the sweep.
            Sentry.captureException(new Error(`reconcile-cv-parses: storage.list failed`), {
              tags: {
                layer: 'inngest',
                function: 'reconcile-cv-parses',
                subop: 'sweep-stuck-pending-storage-list',
                candidate_cv_id: row.id,
              },
            })
            continue
          }
          const hasStorageObject = (listing ?? []).some((o) => o.name === basename)
          const action = decideStuckPendingAction({ ageMs, hasStorageObject })

          if (action === 'requeue') {
            await inngest.send({
              name: 'cv/uploaded',
              data: {
                organization_id: row.organization_id,
                candidate_id: row.candidate_id,
                candidate_cv_id: row.id,
                storage_path: row.storage_path,
                mime_type: row.mime_type,
                user_id: null,
              },
            })
          } else if (action === 'fail-no-file') {
            await updateCandidateCVParse(supabase, {
              id: row.id,
              status: 'failed',
              parseError: CV_UPLOAD_INCOMPLETE_MESSAGE,
              parseErrorDetail: 'reconciler: no storage object',
            })
          } else if (action === 'fail-stuck') {
            await updateCandidateCVParse(supabase, {
              id: row.id,
              status: 'failed',
              parseError: CV_STUCK_MESSAGE,
              parseErrorDetail: 'reconciler: still pending after 45m',
            })
          }
          // 'skip' — no-op, still inside the grace window.
        } catch (rowErr) {
          Sentry.captureException(
            formatErrorForSentry(rowErr, 'reconcile-cv-parses sweep-stuck-pending row:'),
            {
              tags: {
                layer: 'inngest',
                function: 'reconcile-cv-parses',
                subop: 'sweep-stuck-pending-row',
                candidate_cv_id: row.id,
              },
            },
          )
        }
      }
    })

    // -------------------------------------------------------------------
    // Step B — resume-budget-capped. This is what makes the existing
    // "Parsing resumes automatically…" UI copy actually true.
    // -------------------------------------------------------------------
    await step.run('resume-budget-capped', async () => {
      const supabase = createServiceClient()
      const { data: rawRows, error } = await supabase
        .from('candidate_cvs')
        .select('id, organization_id, candidate_id, storage_path, mime_type')
        .eq('parsing_status', 'failed')
        .ilike('parse_error', '%AI budget%')
        .limit(BUDGET_CAPPED_ROW_CAP)
      if (error) {
        Sentry.captureException(error, {
          tags: {
            layer: 'inngest',
            function: 'reconcile-cv-parses',
            subop: 'resume-budget-capped-select',
          },
        })
        return
      }
      const rows = (rawRows ?? []) as unknown as BudgetCappedRow[]
      if (rows.length === 0) return

      const byOrg = groupByOrg(rows)
      for (const [orgId, orgRows] of byOrg) {
        try {
          // One checkCap call per org per sweep — never per row.
          const capResult = await checkCap(orgId, 'cv_parse')
          if (!capResult.allow) {
            // Still capped — expected state, not an error. Skip silently
            // (same reasoning as embed-batch's CapExceededError continue).
            continue
          }
          for (const row of orgRows) {
            await updateCandidateCVParse(supabase, {
              id: row.id,
              status: 'pending',
              parseError: null,
            })
            await inngest.send({
              name: 'cv/uploaded',
              data: {
                organization_id: row.organization_id,
                candidate_id: row.candidate_id,
                candidate_cv_id: row.id,
                storage_path: row.storage_path,
                mime_type: row.mime_type,
                user_id: null,
              },
            })
          }
        } catch (orgErr) {
          Sentry.captureException(
            formatErrorForSentry(orgErr, 'reconcile-cv-parses resume-budget-capped org:'),
            {
              tags: {
                layer: 'inngest',
                function: 'reconcile-cv-parses',
                subop: 'resume-budget-capped-org',
                org_id: orgId,
              },
            },
          )
        }
      }
    })

    // -------------------------------------------------------------------
    // Step C — heal-unmerged-profiles (SF-2 remediation path). This sweep
    // IS how the two known production casualties (candidates
    // 62783324-4ec4-4d53-8405-cf913bfe7195 and
    // 3bf8ffe0-d54f-4649-aa1e-0949adb73b2c, Steele Charles org) self-heal
    // on the first run after deploy — a manual SQL backfill was ruled out.
    //
    // REVIEW 2026-08-04 C1 — the selector, not the post-fetch guard, is
    // what decides reachability. The original query took the NEWEST 25
    // 'complete' rows across all tenants and applied isProfileEffectivelyEmpty
    // AFTER selection: healthy rows consumed every slot, skipped rows changed
    // no state, and the same window was re-scanned every 15 minutes forever.
    // Rows older than that window — including both named casualties — were
    // permanently unreachable.
    //
    // The "needs heal" predicate now lives in SQL:
    //   * `candidates!inner(...)` + per-column filters = the exact field set
    //     isProfileEffectivelyEmpty inspects (see PROFILE_COMPLETENESS_*
    //     in src/lib/ai/profile-completeness.ts).
    //   * `extracted_data` must be a non-empty object, so a selected row can
    //     actually contribute something.
    // A healed candidate stops satisfying the join predicate and DROPS OUT of
    // the result set, so the 25-row cap now drains instead of stalling — and
    // `ascending: true` drains OLDEST-FIRST, which is where the casualties are.
    // -------------------------------------------------------------------
    await step.run('heal-unmerged-profiles', async () => {
      const supabase = createServiceClient()
      const { data: rawRows, error } = await supabase
        .from('candidate_cvs')
        .select('id, candidate_id, extracted_data, candidates!inner(id)')
        .eq('parsing_status', 'complete')
        .not('extracted_data', 'is', null)
        // A '{}' blob can never populate a field — excluding it in SQL stops
        // such a row from squatting a slot on every future run.
        .neq('extracted_data', '{}')
        // --- SQL mirror of isProfileEffectivelyEmpty ---------------------
        .is('candidates.current_role_title', null)
        .is('candidates.current_company', null)
        .is('candidates.location', null)
        .is('candidates.seniority_level', null)
        .is('candidates.years_experience', null)
        // `col <@ '{}'` is true only for an empty text[] — the array
        // equivalent of the IS NULL checks above.
        .containedBy('candidates.skills', [])
        .containedBy('candidates.sector_tags', [])
        // -----------------------------------------------------------------
        .order('created_at', { ascending: true })
        .limit(HEAL_ROW_CAP)
      if (error) {
        Sentry.captureException(error, {
          tags: {
            layer: 'inngest',
            function: 'reconcile-cv-parses',
            subop: 'heal-unmerged-profiles-select',
          },
        })
        return
      }
      const rows = (rawRows ?? []) as unknown as UnmergedProfileRow[]

      // Drift counters. The SQL selector above and isProfileEffectivelyEmpty
      // are meant to agree exactly; a non-zero count here means they don't
      // (a new ProfileCompletenessFields key that only one side knows about,
      // or a whitespace-only string that SQL sees as present and TS sees as
      // empty). Reported once per sweep, never per row.
      let postFetchDrops = 0
      let noProgressRows = 0

      for (const row of rows) {
        try {
          const candidateResult = await getCandidateForEmbedding(supabase, row.candidate_id)
          if (!candidateResult.ok) continue

          // Defence in depth: the row was selected BECAUSE the candidate is
          // empty, so this should never fire. If it does, SQL and TS have
          // drifted — count it and report below rather than skipping silently.
          if (!isProfileEffectivelyEmpty(candidateResult.data)) {
            postFetchDrops++
            continue
          }

          const parsedSubset = toParsedCVSubset(row.extracted_data)
          if (!hasAnyUsableField(parsedSubset)) continue

          const mergeResult = await markCandidateFieldsFromCV(supabase, {
            candidateId: row.candidate_id,
            parsed: parsedSubset,
          })
          if (!mergeResult.ok) {
            Sentry.captureException(
              new Error(`reconcile-cv-parses: heal-unmerged-profile merge failed`),
              {
                tags: {
                  layer: 'inngest',
                  function: 'reconcile-cv-parses',
                  subop: 'heal-unmerged-profile',
                  candidate_id: row.candidate_id,
                  merge_code: mergeResult.code,
                },
              },
            )
            continue
          }
          Sentry.addBreadcrumb({
            category: 'cv-parse',
            message: 'reconciler healed an unmerged profile',
            level: 'info',
            data: { fieldsPopulated: mergeResult.data.fieldsPopulated.length },
          })

          // A merge that populated only fields OUTSIDE the completeness set
          // (e.g. email/phone only) leaves the candidate still "effectively
          // empty", so this row is re-selected on the next sweep. It cannot
          // starve the cap silently — surface it.
          const madeProgress = mergeResult.data.fieldsPopulated.some((f) =>
            (PROFILE_COMPLETENESS_COLUMNS as readonly string[]).includes(f),
          )
          if (!madeProgress) noProgressRows++
        } catch (rowErr) {
          Sentry.captureException(
            formatErrorForSentry(rowErr, 'reconcile-cv-parses heal-unmerged-profiles row:'),
            {
              tags: {
                layer: 'inngest',
                function: 'reconcile-cv-parses',
                subop: 'heal-unmerged-profiles-row',
                candidate_id: row.candidate_id,
              },
            },
          )
        }
      }

      // Ids and counts only — no PII (CLAUDE.md).
      if (postFetchDrops > 0 || noProgressRows > 0) {
        Sentry.captureMessage('reconcile-cv-parses: heal selector/guard mismatch', {
          level: 'warning',
          tags: {
            layer: 'inngest',
            function: 'reconcile-cv-parses',
            subop: 'heal-unmerged-profiles-drift',
          },
          extra: {
            selected: rows.length,
            post_fetch_drops: postFetchDrops,
            no_progress_rows: noProgressRows,
          },
        })
      }
    })
  },
)
