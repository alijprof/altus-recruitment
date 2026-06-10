import { serve } from 'inngest/next'

import { inngest } from '@/lib/inngest/client'
import { bootstrapVectorIndex } from '@/lib/inngest/functions/bootstrap-vector-index'
import { cleanupStaleSummaries } from '@/lib/inngest/functions/cleanup-stale-summaries'
import { createJobFromSpec } from '@/lib/inngest/functions/create-job-from-spec'
import { createOutlookSubscription } from '@/lib/inngest/functions/create-outlook-subscription'
import { draftOutreachEmailFn } from '@/lib/inngest/functions/draft-outreach-email'
import { embedBatch } from '@/lib/inngest/functions/embed-batch'
import { embedCandidateFromLinkedIn } from '@/lib/inngest/functions/embed-candidate-from-linkedin'
import { embedJobOnJDChange } from '@/lib/inngest/functions/embed-job-on-jd-change'
import { parseCVOnUpload } from '@/lib/inngest/functions/parse-cv'
import { precomputeMatchesForJob } from '@/lib/inngest/functions/precompute-matches-for-job'
import { probeFfmpeg } from '@/lib/inngest/functions/probe-ffmpeg'
import { refreshOutlookSubscription } from '@/lib/inngest/functions/refresh-outlook-subscription'
import { specAudioRetentionSweep } from '@/lib/inngest/functions/spec-audio-retention-sweep'
import { specDraftCleanupSweep } from '@/lib/inngest/functions/spec-draft-cleanup-sweep'
import { syncOutlookHistory } from '@/lib/inngest/functions/sync-outlook-history'
import { transcribeAndStructureSpec } from '@/lib/inngest/functions/transcribe-and-structure-spec'
import { transcribeAndExtractVoiceNote } from '@/lib/inngest/functions/transcribe-and-extract-voice-note'
import { voiceNoteAudioRetentionSweep } from '@/lib/inngest/functions/voice-note-audio-retention-sweep'

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
    probeFfmpeg,
    cleanupStaleSummaries,
    createOutlookSubscription,
    syncOutlookHistory,
    refreshOutlookSubscription,
    // Phase 3 — spec workflow (Plan 03-02).
    transcribeAndStructureSpec,
    createJobFromSpec,
    specAudioRetentionSweep,
    specDraftCleanupSweep,
    // Phase 3 — dormant outreach (Plan 03-05).
    draftOutreachEmailFn,
    // Phase 4 — voice notes (Plan 04-02).
    transcribeAndExtractVoiceNote,
    voiceNoteAudioRetentionSweep,
  ],
})
