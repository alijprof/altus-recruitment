/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-04 executor replaces `.todo` with real
// `.it` bodies once src/lib/ai/ad-inclusivity.ts (Sonnet inclusivity rubric)
// lands. Sonnet stub will return canned scores for fixture ads.

describe('src/lib/ai/ad-inclusivity.scoreInclusivity (AD-01)', () => {
  it.todo('well-written inclusive ad scores >= 80 (calibration anchor)')
  it.todo('gendered ad ("aggressive rockstar ninja") scores < 60 (calibration anchor)')
  it.todo('returns specific suggestions citing the offending phrases')
  it.todo('logs ai_usage with purpose=job_ad_inclusivity_score (or combined job_ad_with_inclusivity)')
  it.todo('Sentry tags include phase: p3, layer: ai-wrapper, helper: scoreInclusivity')
  it.todo('returns score as integer 0-100 (matches job_ads.inclusivity_score CHECK)')
})
