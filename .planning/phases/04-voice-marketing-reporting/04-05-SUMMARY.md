---
phase: 04-voice-marketing-reporting
plan: "05"
subsystem: campaigns-ui
tags: [campaigns, email, wizard, segment, personalisation, MARKET-01, MARKET-02, MARKET-03]

dependency_graph:
  requires: [04-04]
  provides: [campaigns-list-page, campaign-builder-wizard, campaign-recipient-table, campaigns-nav-entry]
  affects: [top-nav, mobile-nav-drawer]

tech_stack:
  added: []
  patterns:
    - 3-step Tabs wizard with discriminated-union Status state machine
    - Command + Popover multi-select for enum filtering
    - AlertDialog MARKET-03 gate (no auto-send path)
    - 3s polling loop with useEffect + cancel ref
    - Server action pair for progress polling (getCampaignProgressAction + getRecipientStatusesAction)

key_files:
  created:
    - src/app/(app)/campaigns/page.tsx
    - src/app/(app)/campaigns/new/page.tsx
    - src/app/(app)/campaigns/new/campaign-builder-form.tsx
    - src/app/(app)/campaigns/new/progress-actions.ts
    - src/app/(app)/campaigns/new/_components/campaign-recipient-table.tsx
  modified:
    - src/lib/db/campaigns.ts  (added listCampaigns helper)
    - src/components/app/top-nav.tsx  (Campaigns nav entry)
    - src/components/app/mobile-nav-drawer.tsx  (Campaigns in SECONDARY_NAV)

decisions:
  - id: D-04-05-01
    decision: "Preview sample (up to 5) used for Review recipient table rather than full list"
    rationale: "approveCampaignAction re-queries the segment server-side — client never controls recipient list (T-04-23). Fetching full list client-side for display purposes adds a round-trip with no security benefit. Full list visible post-send via per-recipient status polling."
  - id: D-04-05-02
    decision: "JSON.stringify(marketStatuses) used as effect dependency"
    rationale: "Multi-select always creates a new array reference; value-based comparison needed to deduplicate identical filter sets and avoid redundant preview calls."
  - id: D-04-05-03
    decision: "progress-actions.ts separate from actions.ts"
    rationale: "Keeps approve/preview (write paths) isolated from read-only progress pollers. Clearer intent; easier to audit the MARKET-03 gate in isolation."

metrics:
  duration_minutes: 45
  completed_date: "2026-06-10"
  tasks_completed: 2
  tasks_total: 3
  files_created: 5
  files_modified: 3
---

# Phase 4 Plan 05: Campaign Builder UI Summary

**One-liner:** 3-step Tabs wizard with consent-gated segment preview, MARKET-03 AlertDialog send gate, and 3s polling progress bar wired to the 04-04 backend actions.

## What Was Built

### Task 1: Campaigns list page, recipient table, nav entry (commit 2f26e95)

- **`listCampaigns` db helper** added to `src/lib/db/campaigns.ts` — newest-first, 100-row limit, RLS-scoped
- **`/campaigns` list page** (RSC): `max-w-5xl mx-auto space-y-6`, "Campaigns" h1, "New campaign" Button with Plus icon, Table with Name/Status badge/Recipients/Sent/Created columns. Status badge colors match UI-SPEC campaign status palette exactly
- **`EmptyState`** with "No campaigns yet" / "Build a segmented email campaign..." per UI-SPEC copywriting contract
- **`CampaignRecipientTable`** client component: 20-row pagination with "Show more", `overflow-x-auto`, Last active hidden at `sm:` breakpoint, per-recipient status icons (CheckCircle2 green / XCircle red / Minus grey / AlertTriangle amber with native `title` tooltip)
- **`top-nav.tsx`** NAV_ITEMS: Campaigns inserted between Spec calls and Jobs
- **`mobile-nav-drawer.tsx`** SECONDARY_NAV: Campaigns mirrored in same position

### Task 2: Campaign builder wizard (commit 9539a9f)

- **`CampaignBuilderForm`** (`use client`): discriminated-union `WizardStatus` state machine (`building | previewing | approving | sending | sent | error`)
- **Step 1 — Segment**: campaign name Input, `MarketStatusMultiSelect` (Command + Popover multi-select), GDPR exclusion note, live recipient count via `previewCampaignAction` firing on filter change (cancelled on unmount), "Continue to message" disabled when count=0
- **Step 2 — Message**: subject Input (maxLength 200), body Textarea rows=12, personalisation helper text, `<details>` "How personalisation works" explainer
- **Step 3 — Review & send**: summary card (name, segment, recipient count, subject), AI cost transparency line (`~£0.002 × N`), recipient table, MARKET-03 `AlertDialog` gate with exact UI-SPEC copy ("Send this campaign?" / "Send {N} emails" / "Go back")
- **Post-send polling**: `getCampaignProgressAction` + `getRecipientStatusesAction` every 3s via `setTimeout` loop with cancel ref. `Progress h-2 aria-label="Campaign send progress"` + "{sent} of {total} sent" text
- **No auto-send path**: send only fires via AlertDialog confirm → `approveCampaignAction`. NEVER on segment/field change
- **Failure handling**: `toast.error` + stay on Review step — does NOT navigate away (CLAUDE.md mutation rule)
- **`progress-actions.ts`**: two server actions: `getCampaignProgressAction` (polls sent/failed/total), `getRecipientStatusesAction` (per-recipient status map for table live-update)
- **`new/page.tsx`**: RSC wrapper with back-link "← All campaigns" and max-w-5xl layout

### Task 3: Human checkpoint (pending)

The human verification checkpoint was not executed — it requires manual browser testing. See checkpoint details below.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written with one deliberate tradeoff:

**1. [Rule 2 — Scope decision] Preview sample capped at 5 for review table**
- **Found during:** Task 2 implementation
- **Issue:** `previewCampaignAction` returns a sample of up to 5 candidates for preview. The Review step recipient table uses this sample. For large campaigns (hundreds of recipients), only 5 rows are visible pre-send.
- **Decision:** Accepted. `approveCampaignAction` re-queries the full consent-gated segment server-side — the client never controls the actual recipient list (T-04-23 mitigated). Post-send, the poller updates per-recipient statuses for the visible rows. The 5-row limit is a UX tradeoff, not a security gap.
- **Future work:** Could add a `listCampaignPreviewRecipients` action returning full paginated list for the review table if desired.

## Known Stubs

None — all fields wire to live server actions and database data.

## Threat Flags

No new threat surface beyond what was modelled in the plan's `<threat_model>`. The two new server actions (`getCampaignProgressAction`, `getRecipientStatusesAction`) are read-only, behind `auth.getUser()`, and access only RLS-scoped data.

## Self-Check: PASSED

Files confirmed to exist:
- `src/app/(app)/campaigns/page.tsx` — FOUND
- `src/app/(app)/campaigns/new/page.tsx` — FOUND
- `src/app/(app)/campaigns/new/campaign-builder-form.tsx` — FOUND
- `src/app/(app)/campaigns/new/progress-actions.ts` — FOUND
- `src/app/(app)/campaigns/new/_components/campaign-recipient-table.tsx` — FOUND
- `src/lib/db/campaigns.ts` modified — FOUND

Commits confirmed:
- `2f26e95` — Task 1: campaigns list, recipient table, nav entry
- `9539a9f` — Task 2: campaign builder wizard
