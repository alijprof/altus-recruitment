import { serve } from 'inngest/next'

import { inngest } from '@/lib/inngest/client'
import { bootstrapVectorIndex } from '@/lib/inngest/functions/bootstrap-vector-index'
import { cleanupStaleSummaries } from '@/lib/inngest/functions/cleanup-stale-summaries'
import { createOutlookSubscription } from '@/lib/inngest/functions/create-outlook-subscription'
import { embedBatch } from '@/lib/inngest/functions/embed-batch'
import { embedCandidateFromLinkedIn } from '@/lib/inngest/functions/embed-candidate-from-linkedin'
import { embedJobOnJDChange } from '@/lib/inngest/functions/embed-job-on-jd-change'
import { parseCVOnUpload } from '@/lib/inngest/functions/parse-cv'
import { precomputeMatchesForJob } from '@/lib/inngest/functions/precompute-matches-for-job'
import { refreshOutlookSubscription } from '@/lib/inngest/functions/refresh-outlook-subscription'
import { syncOutlookHistory } from '@/lib/inngest/functions/sync-outlook-history'

// Inngest's `serve` adapter exposes GET (for function discovery), POST (for
// invocation), and PUT. Whitelisted in middleware PUBLIC_PATHS — Inngest
// authenticates via signing key, not Supabase session.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    parseCVOnUpload,
    embedBatch,
    embedCandidateFromLinkedIn,
    embedJobOnJDChange,
    bootstrapVectorIndex,
    precomputeMatchesForJob,
    cleanupStaleSummaries,
    createOutlookSubscription,
    syncOutlookHistory,
    refreshOutlookSubscription,
  ],
})
