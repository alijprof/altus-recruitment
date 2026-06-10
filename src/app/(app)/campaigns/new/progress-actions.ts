'use server'

import { getCampaignProgress, getCampaignWithRecipients } from '@/lib/db/campaigns'
import { createClient } from '@/lib/supabase/server'
import type { CampaignProgress } from '@/lib/db/campaigns'

// ---------------------------------------------------------------------------
// Server actions for the campaign progress poller (04-05).
// These are separate from actions.ts to keep the approve/preview actions
// clean. The poller fires every 3s after approveCampaignAction returns.
// ---------------------------------------------------------------------------

export type GetCampaignProgressResult =
  | { ok: true; data: CampaignProgress }
  | { ok: false; error: string }

/**
 * Return the current sent/failed/total counts for a campaign.
 * Called client-side every 3s after approveCampaignAction returns.
 * RLS ensures only the org's campaigns are accessible.
 */
export async function getCampaignProgressAction(
  campaignId: string,
): Promise<GetCampaignProgressResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const result = await getCampaignProgress(supabase, campaignId)
  if (!result.ok) return { ok: false, error: 'Could not load campaign progress.' }
  return { ok: true, data: result.data }
}

// ---------------------------------------------------------------------------
// Recipient-status poller — returns per-recipient statuses for the table.
// ---------------------------------------------------------------------------

export type RecipientStatusRow = {
  id: string
  status: string
}

export type GetRecipientStatusesResult =
  | { ok: true; data: RecipientStatusRow[] }
  | { ok: false; error: string }

/**
 * Return the per-recipient status for the live progress table.
 * Only called after approveCampaignAction returns a campaignId.
 * RLS ensures only the org's campaigns are accessible.
 */
export async function getRecipientStatusesAction(
  campaignId: string,
): Promise<GetRecipientStatusesResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const result = await getCampaignWithRecipients(supabase, campaignId)
  if (!result.ok) return { ok: false, error: 'Could not load recipients.' }

  return {
    ok: true,
    data: result.data.recipients.map((r) => ({ id: r.candidate_id, status: r.status })),
  }
}
