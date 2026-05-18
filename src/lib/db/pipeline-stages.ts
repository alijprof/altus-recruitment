// Pipeline-stage constants + shared types used by BOTH client components
// (PipelineBoard, PipelineMobileList, PipelineCard) and server-side db
// helpers (src/lib/db/applications.ts).
//
// This module is intentionally NOT 'server-only' — it contains no
// secrets, no DB access, only the seven-stage enum slice and a card
// shape. Splitting it out of applications.ts means the client bundle
// doesn't try to ship the Supabase / Sentry imports.
//
// VERIFICATION: PIPELINE_STAGES MUST be the same seven values declared in
// the application_stage enum (line 42 of phase1_domain_schema.sql)
// EXCLUDING the terminal states `rejected` and `withdrawn` — those are
// triggered by the Reject action, not rendered as columns.

import type { Enums } from '@/types/database'

export const PIPELINE_STAGES = [
  'applied',
  'screening',
  'cv_submitted',
  'first_interview',
  'second_interview',
  'offer',
  'placed',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]
export type ApplicationStage = Enums<'application_stage'>

export type PipelineCardData = {
  id: string
  candidate_id: string
  candidate_name: string
  current_role_title: string | null
  current_company: string | null
  stage: ApplicationStage
  stage_changed_at: string
  days_in_stage: number
  job_id: string
  job_title: string | null
  // Review fix H2: only meaningful when stage is 'rejected' or 'withdrawn'.
  // Consumed by ApplicationsList on /jobs/[id] to display "(reason)" beside
  // a terminal stage badge. Always selected by listApplicationsForJob /
  // listAllApplicationsByStage so the chip renders consistently.
  decline_reason: Enums<'decline_reason'> | null
}

export type GroupedByStage = Record<PipelineStage, PipelineCardData[]>
