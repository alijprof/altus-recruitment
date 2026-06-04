'use server'

// Seed synthetic sample data into a new org.
//
// Idempotency guard: if the org already has ANY candidates, we skip all
// seeding so repeat clicks are a no-op. This is the conservative guard —
// "don't double-seed if the user already has data." If the user explicitly
// wants sample data after having real candidates, they can import via CSV.
//
// RLS scoping: all writes go through the existing createCandidate /
// createClient / createJob helpers which rely on the candidates_set_org /
// set_organization_id triggers to fill in organization_id from the auth
// session. No service-role key; no explicit org_id in payload.

import * as Sentry from '@sentry/nextjs'

import { createCandidate } from '@/lib/db/candidates'
import { createClient as createClientRecord } from '@/lib/db/clients'
import { createJob } from '@/lib/db/jobs'
import { CURRENT_CONSENT_VERSION } from '@/lib/legal/consent'
import { SAMPLE_CANDIDATES, SAMPLE_CLIENTS, SAMPLE_JOBS } from '@/lib/onboarding/sample-data'
import { createClient } from '@/lib/supabase/server'

export type SeedSummary = {
  candidatesCreated: number
  clientsCreated: number
  jobsCreated: number
  skippedAlreadySeeded: boolean
}

export type SeedSampleDataResult =
  | { ok: true; summary: SeedSummary }
  | { ok: false; error: string }

export async function seedSampleDataAction(): Promise<SeedSampleDataResult> {
  const supabase = await createClient()

  // Auth gate.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, error: 'You must be signed in to seed sample data.' }
  }

  // Idempotency guard: check if the org already has candidates.
  // RLS scopes this query to the caller's org automatically.
  const { count, error: countError } = await supabase
    .from('candidates')
    .select('id', { count: 'exact', head: true })

  if (countError) {
    Sentry.captureException(countError, {
      tags: { action: 'seedSampleDataAction', step: 'idempotency_check' },
    })
    return { ok: false, error: 'Could not check existing data. Please try again.' }
  }

  if ((count ?? 0) > 0) {
    // Already has candidates — skip seeding.
    return {
      ok: true,
      summary: {
        candidatesCreated: 0,
        clientsCreated: 0,
        jobsCreated: 0,
        skippedAlreadySeeded: true,
      },
    }
  }

  const now = new Date().toISOString()
  let candidatesCreated = 0
  let clientsCreated = 0
  let jobsCreated = 0

  // Seed candidates.
  for (const candidate of SAMPLE_CANDIDATES) {
    const result = await createCandidate(supabase, {
      ...candidate,
      consent_at: now,
      consent_text_version: CURRENT_CONSENT_VERSION,
    })
    if (result.ok) {
      candidatesCreated++
    } else {
      Sentry.captureException(new Error('seed: candidate create failed'), {
        tags: { action: 'seedSampleDataAction', step: 'create_candidate' },
      })
    }
  }

  // Seed clients and capture the first created client's id for the job.
  let firstClientId: string | null = null
  for (const client of SAMPLE_CLIENTS) {
    const result = await createClientRecord(supabase, client)
    if (result.ok) {
      if (firstClientId === null) firstClientId = result.data.id
      clientsCreated++
    } else {
      Sentry.captureException(new Error('seed: client create failed'), {
        tags: { action: 'seedSampleDataAction', step: 'create_client' },
      })
    }
  }

  // Seed jobs (requires at least one client).
  if (firstClientId) {
    for (const job of SAMPLE_JOBS) {
      const result = await createJob(supabase, {
        ...job,
        company_id: firstClientId,
        owner_user_id: user.id,
      })
      if (result.ok) {
        jobsCreated++
      } else {
        Sentry.captureException(new Error('seed: job create failed'), {
          tags: { action: 'seedSampleDataAction', step: 'create_job' },
        })
      }
    }
  }

  return {
    ok: true,
    summary: {
      candidatesCreated,
      clientsCreated,
      jobsCreated,
      skippedAlreadySeeded: false,
    },
  }
}
