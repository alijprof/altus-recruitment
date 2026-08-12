import { formatDateLong } from '@/lib/date'
import type { BrandedCvState } from '@/lib/db/candidate-branded-cvs'
import { BRANDED_CV_FREE_TEXT_WARNING } from '@/lib/pdf/branded-cv-data'

import { BrandedCvGenerateButton } from './branded-cv-generate-button'

type BrandedCvPanelProps = {
  candidateId: string
  state: BrandedCvState
}

/**
 * "Branded CV" section (BCV-01/05/06/07, Phase 8 Plan 07) — sits directly
 * under CvFilesPanel in the candidate detail page's side panel.
 *
 * MIGRATION-TOLERANT BY DESIGN: renders NOTHING when `state.kind ===
 * 'unavailable'`. getBrandedCvState degrades to this tri-state member
 * whenever candidate_branded_cvs doesn't exist yet — this project's
 * migrations are pushed to production BY HAND, so code can (and here, does)
 * reach production ahead of its migration. The feature must be invisible,
 * not broken, until the founder's `db push` lands (T-08-44).
 *
 * SERVER component (no 'use client') — everything here is a pure render of
 * server-fetched state; only the Generate control itself
 * (branded-cv-generate-button.tsx) needs interactivity, same split as
 * CvFilesPanel / CvFileLink.
 *
 * THREE hard constraints protecting the frozen Phase-6 smoke spec
 * (tests/smoke/authed/cv-intake.smoke.ts — see cv-files-panel.tsx's header
 * comment for the same rules, restated here because this is a NEW section,
 * not a change to an existing one):
 *   a. No Alert component and no element carrying role="alert" anywhere in
 *      this section — waitForParseOutcome treats any role="alert" inside
 *      <main> as a parse failure.
 *   b. formatDateLong (an ABSOLUTE date), never formatTimeAgo — a relative
 *      timestamp can tick over between the smoke's before/after sidebar
 *      snapshot reads and flake the comparison.
 *   c. Deliberately NO View/Download link in this plan. The delivery route
 *      (08-08) does not exist yet — rendering a link to it now would ship a
 *      dead control, precisely the failure mode the Phase-7 CV-file-route
 *      hotfix (2026-08-11) exists to prevent. That link lands in 08-08.
 */
export function BrandedCvPanel({ candidateId, state }: BrandedCvPanelProps) {
  if (state.kind === 'unavailable') return null

  return (
    <section className="bg-card space-y-2 rounded-md border p-4">
      <h2 className="text-sm font-semibold">Branded CV</h2>
      {state.kind === 'ready' ? (
        <p className="text-muted-foreground text-xs font-normal">
          Branded copy · generated {formatDateLong(state.row.generated_at)}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs leading-relaxed">
          An agency-branded, contact-stripped PDF of this candidate — your
          colours and logo on a clean standard layout, built from their
          current data.
        </p>
      )}
      <BrandedCvGenerateButton
        candidateId={candidateId}
        label={state.kind === 'ready' ? 'Regenerate' : 'Generate'}
      />
      <p className="text-muted-foreground text-xs leading-relaxed">
        {BRANDED_CV_FREE_TEXT_WARNING}
      </p>
    </section>
  )
}
