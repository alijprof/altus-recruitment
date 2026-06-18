import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import { generateUnsubscribeToken } from '@/lib/email/unsubscribe'
import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// campaigns helpers (Plan 04-04).
//
// segment query MUST filter consent_basis IS NOT NULL (PECR / UK GDPR) — only
// candidates who actively gave consent (or legitimate_interest basis) are
// eligible for marketing campaigns.
// Quick task 260612-0f4: also filters email_marketing_unsubscribed_at IS NULL
// (belt) — the send loop re-checks per recipient at send time (braces).
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
  organizationId: string,
  marketStatuses: Database['public']['Enums']['market_status'][],
): Promise<DbResult<CampaignSegmentCandidate[]>> {
  if (marketStatuses.length === 0) {
    return { ok: true, data: [] }
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id, organization_id, full_name, email, market_status, current_role_title, current_company')
    // Tenant scoping (WR-05): defence-in-depth index hint under RLS for
    // session callers, HARD requirement under service-role callers where
    // current_organization_id() is NULL and RLS does not apply.
    .eq('organization_id', organizationId)
    // PECR / UK GDPR gate — MUST NOT be removed (Research Pitfall 6).
    // consent_basis IS NOT NULL means the candidate gave consent or legitimate_interest basis.
    .not('consent_basis', 'is', null)
    // Only candidates with a valid email can receive campaign emails
    .not('email', 'is', null)
    // PECR withdrawal gate (260612-0f4 belt): exclude candidates who have
    // unsubscribed from marketing emails. The send loop re-checks per-recipient
    // at send time (braces) for long campaigns.
    // reason: email_marketing_unsubscribed_at not yet in generated Database type
    // (added by migration 20260612000000, regenerated in Task 4). The column
    // exists in the DB — PostgREST accepts it; the cast makes TS happy pre-regen.
    .is('email_marketing_unsubscribed_at' as unknown as keyof Database['public']['Tables']['candidates']['Row'], null)
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
// findRecentDuplicateCampaign — idempotency guard for approveCampaignAction.
//
// A double-submit / Server-Action retry / second tab can call approve twice,
// each creating a fresh campaign row with fresh recipient UUIDs — so the same
// consented contact receives the email TWICE (a PECR problem + doubled Resend
// and Sonnet spend that cannot be un-sent). This server-side guard finds an
// existing just-created campaign with the same (org, name, segment) so the
// caller can short-circuit instead of sending again. The window is deliberately
// short so a deliberate re-send of a same-named campaign later is still allowed
// (audit rank 7).
//
// SCOPE / LIMIT: this is a check-then-act read with no backing DB unique
// constraint, so it reliably catches SEQUENTIAL resubmits (the realistic case:
// retry after an apparent hang, a re-click seconds later, a second tab) but is
// NOT atomic against two genuinely simultaneous approvals racing the SELECT
// before either INSERTs. The client isSending gate covers same-tab simultaneity.
// The fully-atomic fix (recommended fast-follow) is an idempotency_key column +
// partial unique index, treating 23505 as "duplicate exists".
// ---------------------------------------------------------------------------
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

export async function findRecentDuplicateCampaign(
  supabase: SupabaseClient<Database>,
  orgId: string,
  name: string,
  marketStatuses: string[],
): Promise<DbResult<{ id: string; recipientCount: number | null } | null>> {
  const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('email_campaigns')
    .select('id, segment_market_statuses, recipient_count')
    .eq('organization_id', orgId)
    .eq('name', name)
    .in('status', ['approved', 'sending', 'sent'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'findRecentDuplicateCampaign' },
    })
    // Fail toward sending: a transient dedupe-read error must not block a
    // legitimate first send. Worst case reverts to today's behaviour; the
    // guard still catches the overwhelming majority of double-submits.
    return { ok: true, data: null }
  }

  // Compare segments as sets (order-insensitive). Postgres array equality in the
  // query is awkward; matching in JS over the small recent-window set is simpler.
  const target = new Set(marketStatuses)
  const match = (data ?? []).find((row) => {
    const seg = (row.segment_market_statuses ?? []) as string[]
    return seg.length === target.size && seg.every((s) => target.has(s))
  })
  if (!match) return { ok: true, data: null }
  return { ok: true, data: { id: match.id, recipientCount: match.recipient_count } }
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

  // reason: unsubscribe_token is added by migration 20260612000000 but not yet
  // in the generated Database type (regenerated in Task 4). Use the
  // `as unknown as` escape hatch (mirrors apply-form-rate-limit.ts pattern)
  // so typecheck passes before the regen while the column is present in the DB.
  const rows = recipients.map((r) => ({
    campaign_id: r.campaignId,
    organization_id: r.organizationId,
    candidate_id: r.candidateId,
    email: r.email,
    status: 'pending',
    // Per-recipient unguessable token for the PECR one-click unsubscribe URL.
    // Generated here at insert time so every recipient has a token before the
    // send loop runs (T-0f4-TOKENGAP: belt; send loop handles legacy rows as braces).
    unsubscribe_token: generateUnsubscribeToken(),
  })) as unknown as TablesInsert<'email_campaign_recipients'>[]

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
  options?: {
    resendEmailId?: string
    errorMessage?: string
    // Quick task 260612-0f4 (IN-02): persist the Sonnet-generated per-recipient
    // personalisation. These columns exist in the DB (phase4_hardening migration)
    // but have never been written — closing the IN-02 gap.
    personalisedIntro?: string
    personalisedOutro?: string
  },
): Promise<void> {
  // reason: personalised_intro and personalised_outro exist in the DB
  // (20260610000000_phase4_hardening.sql) but are not yet in the generated
  // Database type (TablesUpdate<'email_campaign_recipients'> lags the regen —
  // Task 4 blocking checkpoint regenerates types). Use the `as unknown as`
  // escape hatch so typecheck passes before the regen while the columns exist.
  const basePatch: TablesUpdate<'email_campaign_recipients'> = {
    status,
    ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
    ...(options?.resendEmailId !== undefined ? { resend_email_id: options.resendEmailId } : {}),
    ...(options?.errorMessage !== undefined ? { error_message: options.errorMessage } : {}),
  }

  const patch = {
    ...basePatch,
    ...(options?.personalisedIntro !== undefined
      ? { personalised_intro: options.personalisedIntro }
      : {}),
    ...(options?.personalisedOutro !== undefined
      ? { personalised_outro: options.personalisedOutro }
      : {}),
  } as unknown as TablesUpdate<'email_campaign_recipients'>

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

  // Explicit column list — unsubscribe_token is deliberately NEVER selected
  // here (WR-02): this helper feeds session-client RSC pages, and per-recipient
  // unsubscribe tokens must only transit the service-role send loop. The column
  // is nullable, so rows without the key remain assignable to the row type.
  const { data: recipients, error: recipientsErr } = await supabase
    .from('email_campaign_recipients')
    .select(
      'id, organization_id, campaign_id, candidate_id, email, personalised_intro, personalised_outro, resend_email_id, status, error_message, sent_at, created_at',
    )
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })

  if (recipientsErr) {
    Sentry.captureException(recipientsErr, {
      tags: { layer: 'db', helper: 'getCampaignWithRecipients', subop: 'recipients' },
    })
    return { ok: false, code: 'internal' }
  }

  // reason: rows deliberately omit unsubscribe_token (never selected for
  // session-client callers — WR-02); the column is nullable so consumers
  // reading it get undefined, which no UI consumer does.
  const safeRecipients = (recipients ?? []) as unknown as CampaignRecipientRow[]

  return { ok: true, data: { ...campaign, recipients: safeRecipients } }
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
