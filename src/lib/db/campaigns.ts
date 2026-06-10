import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// campaigns helpers (Plan 04-04).
//
// segment query MUST filter consent_basis IS NOT NULL (PECR / UK GDPR) — only
// candidates who actively gave consent (or legitimate_interest basis) are
// eligible for marketing campaigns. There is no withdrawal tracking column in
// the current schema, so IS NOT NULL is the authoritative gate.
//
// Service-role callers (Inngest) MUST pass organizationId explicitly because
// current_organization_id() returns NULL under service-role.
// ---------------------------------------------------------------------------

export type CampaignRow = Tables<'email_campaigns'>
export type CampaignRecipientRow = Tables<'email_campaign_recipients'>

// Minimal candidate shape returned by getCampaignSegment — only the fields
// needed for personalisation and sending.
export type CampaignSegmentCandidate = {
  id: string
  organization_id: string
  full_name: string
  email: string
  market_status: Database['public']['Enums']['market_status']
  current_role_title: string | null
  current_company: string | null
}

// ---------------------------------------------------------------------------
// getCampaignSegment — consent-gated segment query (MARKET-01, Research Pitfall 6)
// ---------------------------------------------------------------------------

export async function getCampaignSegment(
  supabase: SupabaseClient<Database>,
  marketStatuses: Database['public']['Enums']['market_status'][],
): Promise<DbResult<CampaignSegmentCandidate[]>> {
  if (marketStatuses.length === 0) {
    return { ok: true, data: [] }
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id, organization_id, full_name, email, market_status, current_role_title, current_company')
    // PECR / UK GDPR gate — MUST NOT be removed (Research Pitfall 6).
    // consent_basis IS NOT NULL means the candidate gave consent or legitimate_interest basis.
    .not('consent_basis', 'is', null)
    // Only candidates with a valid email can receive campaign emails
    .not('email', 'is', null)
    .in('market_status', marketStatuses)
    .order('full_name', { ascending: true })

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getCampaignSegment' } })
    return { ok: false, code: 'internal' }
  }

  // Filter out rows with null email at the type level (the .not('email', 'is', null)
  // filter guarantees this at runtime, but TS doesn't narrow the type automatically).
  const safe = (data ?? []).filter(
    (c): c is typeof c & { email: string } => typeof c.email === 'string',
  )

  return { ok: true, data: safe as CampaignSegmentCandidate[] }
}

// ---------------------------------------------------------------------------
// createCampaign — insert an email_campaigns row
// ---------------------------------------------------------------------------

export type CreateCampaignInput = {
  organizationId: string
  createdBy: string
  name: string
  subjectTemplate: string
  bodyTemplate: string
  segmentMarketStatuses: string[]
  recipientCount: number
}

export async function createCampaign(
  supabase: SupabaseClient<Database>,
  input: CreateCampaignInput,
): Promise<DbResult<Pick<CampaignRow, 'id' | 'organization_id'>>> {
  const payload: TablesInsert<'email_campaigns'> = {
    organization_id: input.organizationId,
    created_by: input.createdBy,
    name: input.name,
    subject_template: input.subjectTemplate,
    body_template: input.bodyTemplate,
    segment_market_statuses: input.segmentMarketStatuses,
    recipient_count: input.recipientCount,
    status: 'approved',
    approved_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('email_campaigns')
    .insert(payload)
    .select('id, organization_id')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createCampaign' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// insertCampaignRecipients — bulk-insert recipient rows for a campaign
// ---------------------------------------------------------------------------

export type CampaignRecipientInput = {
  campaignId: string
  organizationId: string
  candidateId: string
  email: string
}

export async function insertCampaignRecipients(
  supabase: SupabaseClient<Database>,
  recipients: CampaignRecipientInput[],
): Promise<DbResult<{ count: number }>> {
  if (recipients.length === 0) {
    return { ok: true, data: { count: 0 } }
  }

  const rows: TablesInsert<'email_campaign_recipients'>[] = recipients.map((r) => ({
    campaign_id: r.campaignId,
    organization_id: r.organizationId,
    candidate_id: r.candidateId,
    email: r.email,
    status: 'pending',
  }))

  const { error } = await supabase.from('email_campaign_recipients').insert(rows)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'insertCampaignRecipients' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { count: rows.length } }
}

// ---------------------------------------------------------------------------
// updateRecipientStatus — called by Inngest per-recipient after send attempt
// ---------------------------------------------------------------------------

export async function updateRecipientStatus(
  supabase: SupabaseClient<Database>,
  recipientId: string,
  status: 'sent' | 'failed' | 'failed_cap_exceeded',
  options?: { resendEmailId?: string; errorMessage?: string },
): Promise<void> {
  const patch: TablesUpdate<'email_campaign_recipients'> = {
    status,
    ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
    ...(options?.resendEmailId !== undefined ? { resend_email_id: options.resendEmailId } : {}),
    ...(options?.errorMessage !== undefined ? { error_message: options.errorMessage } : {}),
  }

  const { error } = await supabase
    .from('email_campaign_recipients')
    .update(patch)
    .eq('id', recipientId)

  if (error) {
    // Non-fatal — Inngest will surface this but we don't want a status-update
    // failure to crash the whole send loop.
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateRecipientStatus', recipient_id: recipientId },
    })
  }
}

// ---------------------------------------------------------------------------
// getCampaignWithRecipients — load campaign + all recipients (for send engine)
// ---------------------------------------------------------------------------

export type CampaignWithRecipients = CampaignRow & {
  recipients: CampaignRecipientRow[]
}

export async function getCampaignWithRecipients(
  supabase: SupabaseClient<Database>,
  campaignId: string,
): Promise<DbResult<CampaignWithRecipients>> {
  const { data: campaign, error: campaignErr } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignErr) {
    Sentry.captureException(campaignErr, {
      tags: { layer: 'db', helper: 'getCampaignWithRecipients' },
    })
    return { ok: false, code: 'internal' }
  }
  if (!campaign) return { ok: false, code: 'not_found' }

  const { data: recipients, error: recipientsErr } = await supabase
    .from('email_campaign_recipients')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })

  if (recipientsErr) {
    Sentry.captureException(recipientsErr, {
      tags: { layer: 'db', helper: 'getCampaignWithRecipients', subop: 'recipients' },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: { ...campaign, recipients: recipients ?? [] } }
}

// ---------------------------------------------------------------------------
// listCampaigns — all campaigns for the current org, newest first (04-05)
// ---------------------------------------------------------------------------

export type CampaignListRow = Pick<
  CampaignRow,
  'id' | 'name' | 'status' | 'recipient_count' | 'sent_count' | 'created_at'
>

export async function listCampaigns(
  supabase: SupabaseClient<Database>,
): Promise<DbResult<CampaignListRow[]>> {
  const { data, error } = await supabase
    .from('email_campaigns')
    .select('id, name, status, recipient_count, sent_count, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listCampaigns' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

// ---------------------------------------------------------------------------
// getCampaignProgress — sent/failed/total counts for the UI poller (04-05)
// ---------------------------------------------------------------------------

export type CampaignProgress = {
  sent: number
  failed: number
  total: number
  status: string
}

export async function getCampaignProgress(
  supabase: SupabaseClient<Database>,
  campaignId: string,
): Promise<DbResult<CampaignProgress>> {
  const { data: campaign, error: campaignErr } = await supabase
    .from('email_campaigns')
    .select('sent_count, failed_count, recipient_count, status')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignErr) {
    Sentry.captureException(campaignErr, {
      tags: { layer: 'db', helper: 'getCampaignProgress' },
    })
    return { ok: false, code: 'internal' }
  }
  if (!campaign) return { ok: false, code: 'not_found' }

  return {
    ok: true,
    data: {
      sent: campaign.sent_count,
      failed: campaign.failed_count,
      total: campaign.recipient_count ?? 0,
      status: campaign.status,
    },
  }
}
