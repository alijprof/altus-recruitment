---
phase: 04-voice-marketing-reporting
plan: "04"
subsystem: campaigns
tags: [campaign, email, personalisation, inngest, resend, gdpr, market-03]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [campaign-db-helpers, campaign-personaliser, send-email-campaign-inngest, preview-approve-actions]
  affects: [src/lib/email/resend.ts, src/app/api/inngest/route.ts]
tech_stack:
  added: []
  patterns:
    - "Sequential Inngest fan-out (step.run per recipient, no Promise.all) for Resend 2 req/s rate limit"
    - "CapExceededError caught per-recipient (not per-campaign) to degrade gracefully"
    - "Triple-quote-fenced candidate data in Sonnet SYSTEM_PROMPT (T-04-14 prompt injection)"
    - "MARKET-03 gate: campaign/send-approved emitted only in approveCampaignAction"
    - "HARD RULE 4: candidate.organization_id asserted before every Sonnet call"
key_files:
  created:
    - src/lib/db/campaigns.ts
    - src/lib/ai/campaign-personalise.ts
    - src/lib/inngest/functions/send-email-campaign.ts
    - src/app/(app)/campaigns/new/actions.ts
  modified:
    - src/lib/email/resend.ts
    - src/app/api/inngest/route.ts
decisions:
  - "Use consent_basis IS NOT NULL (actual DB column) not gdpr_consent_basis (RESEARCH doc discrepancy)"
  - "Unsubscribe URL uses mailto: fallback in Inngest function; 04-05 will wire per-candidate URL"
  - "Zod v4 uses .issues[] not .errors[] — fixed on first typecheck"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-10"
  tasks_completed: 3
  files_modified: 6
---

# Phase 4 Plan 04: Campaign Backend (MARKET-01/02/03) Summary

Campaign data layer + send engine: consent-gated segment query, Sonnet-personalised intro/outro, sequential idempotent Inngest fan-out, and explicit-approval server actions.

## What Was Built

### Task 1: campaigns DB helper + Sonnet personaliser + Resend extension

**`src/lib/db/campaigns.ts`** — typed DB helpers mirroring spec-drafts.ts pattern:
- `getCampaignSegment`: filters `consent_basis IS NOT NULL` + `email IS NOT NULL` + `market_status IN (...)` — PECR/UK GDPR gate (Research Pitfall 6)
- `createCampaign`, `insertCampaignRecipients`, `updateRecipientStatus`, `getCampaignWithRecipients`, `getCampaignProgress` — discriminated-union returns throughout

**`src/lib/ai/campaign-personalise.ts`** — Sonnet tool-use wrapper:
- Tool returns `{ intro_paragraph, outro_paragraph }` only (D4-07 — recruiter body never touches the model)
- `purpose: 'campaign_intro_outro'` → maps to writingCalls cap bucket (04-01)
- SYSTEM_PROMPT triple-quote-fences candidate data (T-04-14 prompt injection defence)
- Exports `draftCampaignIntroOutro` returning `{ introParagraph, outroParagraph, costPence }`

**`src/lib/email/resend.ts`** — extended with:
- `assembleCampaignHtml`: server-side HTML assembly with HTML-escaped intro/bodyTemplate/outro + mandatory PECR unsubscribe footer
- `escapeHtml` helper for all interpolated values
- `sendResendEmail` unchanged

### Task 2: send-email-campaign Inngest fan-out + registration

**`src/lib/inngest/functions/send-email-campaign.ts`**:
- Event: `campaign/send-approved`; id: `send-email-campaign`
- Concurrency: `{ limit: 2, key: 'event.data.organization_id' }` — org-level, NOT user_id
- Retries: 1 (expensive; avoid double-send)
- `onFailure`: marks campaign.status='failed', Sentry logs name+status only (no PII)
- Per-recipient sequential loop via `step.run('send-to-${recipient.id}')`:
  - Idempotency: status='sent' recipients skipped
  - HARD RULE 4: `candidate.organization_id` asserted before Sonnet call
  - CapExceededError caught → 'failed_cap_exceeded', loop continues
  - `assembleCampaignHtml` + `sendResendEmail` + `updateRecipientStatus` always called
- Final step updates `sent_count`, `failed_count`, `status='sent'`

**`src/app/api/inngest/route.ts`** — `sendEmailCampaign` appended to functions array; voice-note registrations preserved.

### Task 3: previewCampaignAction + approveCampaignAction

**`src/app/(app)/campaigns/new/actions.ts`**:
- `previewCampaignAction`: no writes, no event — returns count + sample of 5
- `approveCampaignAction`: re-queries segment server-side → createCampaign → insertCampaignRecipients → `inngest.send('campaign/send-approved')`
- `campaign/send-approved` emitted ONLY here (MARKET-03, T-04-12)
- All inputs Zod-validated; marketStatuses constrained to market_status enum

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod v4 uses `.issues[]` not `.errors[]`**
- Found during: Task 3 typecheck
- Issue: `parsed.error.errors[0]` does not exist in Zod 4; the property is `issues`
- Fix: Changed to `parsed.error.issues[0]?.message` in both validation blocks
- Files modified: `src/app/(app)/campaigns/new/actions.ts`
- Commit: 345a285

**2. [Rule 1 - Schema discrepancy] `gdpr_consent_basis` column doesn't exist**
- Found during: Task 1 — RESEARCH.md referenced `gdpr_consent_basis` and `gdpr_consent_withdrawn_at` but the actual DB schema uses `consent_basis` (no withdrawal column)
- Fix: Used `consent_basis IS NOT NULL` (the actual column) with a clear comment explaining the mapping
- Files modified: `src/lib/db/campaigns.ts`
- Commit: 1ca6cd1

## Known Stubs

**Unsubscribe URL in `send-email-campaign.ts` (line 190)**
- File: `src/lib/inngest/functions/send-email-campaign.ts`
- Stub: `mailto:unsubscribe@altusmove.com?subject=Unsubscribe` fallback
- Reason: The 04-05 builder UI hasn't been built yet; per-candidate unsubscribe URL generation requires the UI flow. The PECR-compliant footer with visible unsubscribe link is present in `assembleCampaignHtml`; 04-05 will wire the real URL.
- Resolution: Plan 04-05 campaign builder UI should pass a real unsubscribe URL to `approveCampaignAction` which threads it to recipients.

## Threat Flags

All threats in the plan's STRIDE register were mitigated:
- T-04-12: send event emitted only in `approveCampaignAction` after status='approved'
- T-04-13: `candidate.organization_id === organization_id` asserted per-recipient before Sonnet
- T-04-14: candidate data triple-quote-fenced in SYSTEM_PROMPT; body_template never through AI
- T-04-15: `consent_basis IS NOT NULL` gate + unsubscribe footer in every email
- T-04-16: sequential loop, concurrency 2/org, retries 1, idempotency on status='sent'
- T-04-17: CapExceededError marks 'failed_cap_exceeded', doesn't bypass cap

## Commits

| Hash | Message |
|------|---------|
| 1ca6cd1 | feat(04-04): campaigns DB helper + Sonnet personaliser + Resend extension |
| 91a62b7 | feat(04-04): send-email-campaign Inngest fan-out + registration |
| 345a285 | feat(04-04): previewCampaignAction + approveCampaignAction (MARKET-03 gate) |

## Self-Check: PASSED

All created files verified on disk. All task commits verified in git log.
