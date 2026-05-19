import { serve } from 'inngest/next'

import { inngest } from '@/lib/inngest/client'
import { bootstrapVectorIndex } from '@/lib/inngest/functions/bootstrap-vector-index'
import { embedBatch } from '@/lib/inngest/functions/embed-batch'
import { embedJobOnJDChange } from '@/lib/inngest/functions/embed-job-on-jd-change'
import { parseCVOnUpload } from '@/lib/inngest/functions/parse-cv'

// Inngest's `serve` adapter exposes GET (for function discovery), POST (for
// invocation), and PUT. Whitelisted in middleware PUBLIC_PATHS — Inngest
// authenticates via signing key, not Supabase session.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [parseCVOnUpload, embedBatch, embedJobOnJDChange, bootstrapVectorIndex],
})
