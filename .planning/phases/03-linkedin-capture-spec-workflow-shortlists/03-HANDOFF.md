---
phase: 03
created: "2026-05-20"
purpose: "Operational handoff after Phase 3 execution, verification, code review, and ship. Lists the actions that require a human + live environment to close out."
blocking_deploy: true
---

# Phase 3 Handoff — what's left before this is in front of a recruiter

Phase 3 code is on `main` + pushed to origin (`6b0f3cf...9e90419`). PR #2 (retroactive review) is open against `pre-phase-3-baseline`. Verification, learnings, code review, UAT inventory, and 4 review-fix commits (CR-01, CR-02, WR-02, WR-07) are committed.

The remaining work is operational — needs a human + live Supabase + live Vercel.

---

## 1. Vercel project setup (10 min)

### 1a. Investigate the failing Vercel check on PR #2

The PR #2 Vercel check reports **FAILURE** with target URL:
```
https://vercel.com/alijprofs-projects/altus-recruitment/A6MzQrv6sC7GAH8w9Eo7fSgEMhtu
```

But the Vercel MCP `list_projects` under team `alijprofs-projects` returns only `altus-move` (an unrelated removals app). The `altus-recruitment` project either:
- Exists on a personal Vercel account (not the team)
- Was deleted and the GitHub→Vercel webhook is orphaned
- Sits on a different team you have access to

**Action:** Open https://vercel.com/dashboard and find the `altus-recruitment` project. If missing, recreate by importing the GitHub repo. If on a different team, that's where future ops belong.

### 1b. Install Vercel CLI (recommended)

The session-start notice flagged: "The Vercel CLI is not installed."

```bash
npm i -g vercel
vercel login
cd ~/altus-recruitment
vercel link            # links to the altus-recruitment project
vercel env pull        # pulls existing env vars into .env.local
```

This unlocks `vercel env pull`, `vercel deploy`, `vercel logs` for the Vercel agent skills.

---

## 2. Environment variables to set on Vercel (5 min)

Phase 3 introduces **new** required env vars. Set these for both Preview and Production:

| Var | Value | Used by |
|-----|-------|---------|
| `OPENAI_API_KEY` | `sk-...` from OpenAI dashboard | Whisper spec-call transcription |
| `LINKEDIN_EXTENSION_ID` | Extension ID after side-loading (see step 4) | `/api/linkedin/ingest` CORS allowlist |
| `LINKEDIN_EXTENSION_MIN_VERSION` | `"0.1.0"` (initial version from `chrome-extension/manifest.json`) | Server-side version pin check |

Already present from Phase 2 (verify they're still set):
- `ANTHROPIC_API_KEY`
- `VOYAGE_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- Microsoft Graph OAuth client/secret/tenant (for Outlook)
- `EMAIL_TOKEN_ENCRYPTION_KEY`

```bash
# via Vercel CLI (after vercel link)
vercel env add OPENAI_API_KEY production
vercel env add OPENAI_API_KEY preview
# repeat for each
```

---

## 3. Apply Supabase migrations (5 min)

11 new Phase 3 migrations need to land on the live Supabase project:

```bash
cd ~/altus-recruitment

# Verify migration status against the linked Supabase project
pnpm exec supabase db diff --linked

# Apply
pnpm exec supabase db push
```

Migrations in chronological order:
1. `20260520003437_phase3_spec_drafts.sql` — spec_drafts table
2. `20260520003438_phase3_spec_audio_bucket.sql` — Storage bucket + RLS
3. `20260520010418_phase3_application_type_shortlist.sql` — enum value
4. `20260520010419_phase3_applications_nullable_job_id.sql` — drop NOT NULL + CHECK
5. `20260520010420_phase3_applications_same_org_guard_null_safe.sql` — null-safe FK guard
6. `20260520020702_phase3_job_ads.sql` — job_ads table
7. `20260520023100_phase3_applications_placement_fields.sql` — placement columns
8. `20260520023200_phase3_source_attribution_rpc.sql` — RPC
9. `20260520031200_phase3_dormant_clients_rpc.sql` — RPC
10. `20260520031300_phase3_activity_kind_email_draft.sql` — enum value
11. `20260520065652_phase3_candidates_linkedin_unique_source_detail.sql` — CR-01 fix unique index

If any migration fails, do NOT edit it — add a NEW migration to fix forward (per CLAUDE.md "Migrations are append-only").

---

## 4. Side-load the Chrome extension (10 min)

The extension is shipped as an unpacked developer-mode build (Chrome Web Store submission deferred per D3-01).

```bash
cd ~/altus-recruitment/chrome-extension
pnpm install
pnpm build
```

Then in Chrome:
1. Open `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select `~/altus-recruitment/chrome-extension/dist/`
5. Copy the **Extension ID** that Chrome assigns (a 32-char alphanumeric string)
6. Paste that ID into Vercel as `LINKEDIN_EXTENSION_ID` (Production + Preview)
7. Redeploy preview so the env var takes effect

Optional: pin the extension in the Chrome toolbar so the recruiter can click it from any LinkedIn tab.

---

## 5. Run UAT against the deployed preview (~30 min)

Open `.planning/phases/03-linkedin-capture-spec-workflow-shortlists/03-UAT.md` and walk through the 15 tests. Mark each as `pass`, `issue` (with description), or `skipped` (with reason). Reset `result: blocked` to the actual outcome.

Then re-run: `/gsd-verify-work 3` to update the UAT.md frontmatter to `status: complete` and trigger gap-closure planning if any tests failed.

**Highest-risk tests** (where Phase 3 introduced new infrastructure):
- Test 4 (Spec call → Whisper → Sonnet → approve): exercises OPENAI_API_KEY + ffmpeg on Vercel + Inngest concurrency + the WR-02 audio-pipeline collapse
- Test 12 (Send check-in via Outlook): exercises Microsoft Mail.Send incremental consent — first send will surface the consent screen
- Test 6 (Generate ad on job): exercises Sonnet ad-generation + cost logging
- Test 2 (LinkedIn capture): exercises CR-01 (now removed advisory lock) + CR-02 (tightened URL validation) + the new unique partial index

**G4 from VERIFICATION.md:** Before any real spec-call upload, fire the `ops/probe-ffmpeg` Inngest function once to confirm `@ffmpeg-installer/ffmpeg` runs within Vercel's function size + memory limits.

---

## 6. Close PR #2 (1 min)

Since PR #2 is retroactive (work already on `main` per `branching_strategy: "none"`), there's nothing to merge. After review:

```bash
gh pr close 2 --comment "Phase 3 reviewed and shipped retroactively — work was committed directly to main per branching_strategy=none. PR exists for review history only."
```

Optionally delete the `pre-phase-3-baseline` branch on origin once you're confident you won't need it again:
```bash
git push origin --delete pre-phase-3-baseline
```

---

## 7. Open code-review follow-ups (deferred from REVIEW.md)

The following warnings were left for follow-up rather than fixed in the post-review pass — re-opening them as discrete tasks when the relevant features come into focus:

| ID | What | When to fix |
|----|------|-------------|
| WR-01 | `sendOutreachAction` activity update lacks `organization_id` defence-in-depth predicate (RLS still protects) | Before first real outreach send |
| WR-03 | `addToShortlistAction` / `addFloatAction` don't set `owner_user_id` — future "mine only" UI toggle returns zero rows | When the toggle UI ships |
| WR-04 | `removeFromShortlistAction` hard-deletes with no audit trail | When audit-completeness review happens (recommend Phase 5 SaaS shell) |
| WR-05 | Unsound type cast on `placements[0].jobs` shape in outreach Inngest fn | Next time `draft-outreach-email.ts` is touched |
| WR-06 | `recompressToOpus` / `probeDurationSeconds` lack inner timeout race; rely on Inngest function-level timeout | Tolerable — Inngest catches it. Revisit if spec calls start timing out |
| IN-01..05 | Cosmetic / test coverage | Opportunistic |

REVIEW.md is the source of truth for the full context on each.

---

## 8. Phase 4 planning (when ready)

Phase 4 is **not planned yet**. The ROADMAP says `Plans: TBD`. Phase 4 scope per ROADMAP.md:

- VOICE-01/02: voice notes during/after meetings → Sonnet structured updates → recruiter approves
- MARKET-01/02/03: segmented email campaigns via Resend, per-recipient personalisation
- REMIND-01: stale candidate + dormant client reminders
- REPORT-01/02: natural-language reporting ("how many placements last quarter by sector?") + buyer-value dashboards

When ready: `/gsd-discuss-phase 4` → `/gsd-plan-phase 4` → `/gsd-execute-phase 4`.

Phase 3 unlocks Phase 4 dependencies:
- Whisper wrapper exists (reuse for voice notes)
- Sonnet structured-extraction pattern is proven (reuse for voice → structured update)
- Inngest concurrency-per-user pattern established
- `ai_usage` cost tracking battle-tested

---

## Summary of remaining blockers

| Step | Owner | Blocker |
|------|-------|---------|
| 1a — find/recreate Vercel project | User | Vercel dashboard access |
| 1b — install Vercel CLI | User | local machine |
| 2 — set env vars | User | OPENAI_API_KEY purchase + dashboard access |
| 3 — apply migrations | User | Supabase linked project access |
| 4 — side-load extension | User | Chrome developer mode + local build |
| 5 — UAT walk-through | User | Above 4 done + browser session |
| 6 — close PR #2 | User | After review |
| 7 — follow-up issues | Future Claude sessions | Triggered by feature work |
| 8 — Phase 4 planning | User decision | Phase 3 UAT pass + business priority |

Nothing in this list is runnable from a CLI orchestrator. All require either user action or a live deployed environment.
