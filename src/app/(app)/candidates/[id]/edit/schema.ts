import { createCandidateSchema } from '../../new/schema'

// Edit form reuses the create schema minus the consent fields — consent is
// captured once at creation time (D-12 / GDPR Art. 7) and remains immutable
// in Phase 1. A consent_withdrawn_at flow is deferred to Phase 3 per
// CONTEXT.md `<deferred>`.
export const editCandidateSchema = createCandidateSchema.omit({
  consent_basis: true,
  consent_confirmed: true,
})

export type EditCandidateInput = ReturnType<typeof editCandidateSchema.parse>

export {
  MARKET_STATUS_VALUES,
  MARKET_STATUS_LABELS,
  CANDIDATE_SOURCE_VALUES,
  CANDIDATE_SOURCE_LABELS,
} from '../../new/schema'
