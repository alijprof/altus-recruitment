-- Migration: PECR one-click unsubscribe tokens + durable suppression flag
-- Quick task 260612-0f4 — append-only (never edit committed migrations).
--
-- 1. Adds email_campaign_recipients.unsubscribe_token (text, nullable)
--    with a partial unique index so token lookup is a single indexed read
--    and token collisions are rejected by the DB.
--    NOTE: tokens are generated in app code (randomBytes >=32, base64url) —
--    never as a DB default. A bare candidate UUID is explicitly forbidden
--    by the locked spec (insufficient entropy, correlatable).
--
-- 2. Adds candidates.email_marketing_unsubscribed_at (timestamptz, nullable)
--    as the durable PECR consent-withdrawal flag. NULL = still consented.
--    getCampaignSegment and the send loop both gate on IS NULL so that
--    a candidate who has unsubscribed is never re-emailed.
--
-- Security: no new RLS policies are added for the token. The public
-- /unsubscribe/{token} route uses the service-role client (no auth.uid()),
-- mirroring the apply-form pattern. Existing tenant-isolation policies on
-- email_campaign_recipients still block authenticated cross-tenant reads.

-- ---------------------------------------------------------------------------
-- 1. unsubscribe_token on email_campaign_recipients
-- ---------------------------------------------------------------------------

alter table public.email_campaign_recipients
  add column if not exists unsubscribe_token text;

-- Partial unique index: token lookup is O(log n) and a collision is a
-- DB-level unique violation (rejected, not silently overwritten).
-- Partial (WHERE unsubscribe_token IS NOT NULL) so NULL legacy rows don't
-- collide with each other.
create unique index if not exists email_campaign_recipients_unsub_token_idx
  on public.email_campaign_recipients (unsubscribe_token)
  where unsubscribe_token is not null;

comment on column public.email_campaign_recipients.unsubscribe_token is
  'Per-recipient unguessable token (node:crypto randomBytes >=32, base64url). '
  'NULL for legacy rows created before 260612-0f4. '
  'Used by /unsubscribe/{token} to identify the recipient and suppress the candidate. '
  'Indexed by email_campaign_recipients_unsub_token_idx (partial unique).';

-- ---------------------------------------------------------------------------
-- 2. email_marketing_unsubscribed_at on candidates
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column if not exists email_marketing_unsubscribed_at timestamptz;

comment on column public.candidates.email_marketing_unsubscribed_at is
  'PECR / UK GDPR consent-withdrawal timestamp. '
  'NULL = candidate has not withdrawn marketing consent. '
  'Set to now() by suppressByToken() when the candidate clicks the one-click '
  'unsubscribe link in a campaign email. '
  'getCampaignSegment gates on IS NULL (belt) and the send loop re-checks '
  'per recipient at send time (braces). Once set, this candidate will never '
  'receive another campaign email unless manually cleared by an operator.';
