# Feedback triage & proposed plan — 2026-08-11

Grounded in code + read-only production data (4 investigation agents; evidence
inline in the workflow journal). Companion to the raw capture in this folder.

## The headline discovery: the unpaid Inngest plan explains the reliability pain

Idle crons alone burn ~half the free tier's monthly step quota; the free tier
allows only 5 concurrent steps account-wide and PAUSES execution when quota
exhausts. Production evidence matches exactly: ALL background AI activity went
silent 6 Aug 13:00 → 9 Aug 22:00 UTC; the reconciler run that sat stuck for
days (concurrency-1 slot blocking every later cron) is the throttle mechanism;
SC's parse p50 is 0.2 min when Inngest runs vs multi-DAY tails when paused.
**Paying (Pro, $99/mo) is the single highest-leverage action from the whole
feedback session** — it likely fixes the stuck-jobs class, delayed retries,
and embed lag wholesale. Then: cheap hardening (function timeouts on the
concurrency-1 crons + Sentry heartbeats) so any future stall alerts same-day
instead of silently eating days.

## Item verdicts (perception vs reality)

1. **CV storage / revisions / editing / flagging** — storage, versioning, and
   per-field confidence ALL exist server-side; almost none of it is visible.
   No UI shows or downloads the stored file (RLS already permits it — pure UI
   gap); "Previous CVs" renders only when >1 version, without dates or links;
   confidence badges render only inside a sheet nobody opens (82 of 87 SC
   parses have ≥1 unsure field). The ONE hard gap: parsed rich fields (work
   history, education, skills, salaries, seniority…) are uneditable anywhere —
   a wrong accepted value is permanent. Fix path: view/download links (S) +
   proactive "N fields unsure" flag (S) + full parsed-field editing with
   re-embed-on-change (M).
2. **Branded CV** — genuine whole-feature gap, but parse coverage is 94-100%
   on the fill fields and brand colours exist (SC has NO logo uploaded; the
   field is URL-only — needs an upload flow). Design correction: generate
   ON-DEMAND, not at parse time (auto-on-parse goes stale the moment item 1's
   editing lands). Cheapest credible slice: branded profile page +
   print-to-PDF (S, zero new deps) to prove the template with Liam; the full
   feature (stored DOCX artifact + Outlook attachment send) is phase-sized.
3. **Search/matching + LinkedIn sourcing** — /search is complete and working;
   SC has never opened it once (adoption, not build). Real gaps: 7 of SC's 10
   applications predate auto-scoring and show no badge (backfill, pennies);
   matches page has refresh/stale friction (M). LinkedIn sourcing: recommend
   v1 = job-spec → boolean/X-ray search links + capture via the existing
   extension (zero GDPR/ToS risk); the in-app-suggestions vision requires a
   licensed people-data vendor and carries UK GDPR Art.14/DPIA/ICO-guidance
   obligations — options appraisal BEFORE any commitment.
4. **Website capture** — the apply form already exists: branded, bot-protected,
   feeding the full parse pipeline. Gaps: applicants arrive unattached to any
   job (no public job board), the URL is deliberately ugly (anti-enumeration),
   iframe embedding is deliberately blocked, "Powered by Altus" footer.
   Proposed boundary for the can-of-worms worry: PRODUCT = everything Altus
   hosts under the org slug (apply form, embed kit, job board, white-label
   knobs — all multi-tenant); SERVICES = Liam's own site (niche copy,
   affiliations, layout) — a separate conversation, not roadmap.
   Evidence note: 5 SC candidates carry source='apply_form' but July forensics
   showed staff uploaded those CVs — whether the public form has truly been
   used organically is a clarification for Liam.

## Proposed sequencing

**Founder, this week (no code):** pay Inngest Pro → I verify reliability
end-to-end · push the 6 pending migrations · upload SC's logo in
Settings→Branding · walk Liam through /search + matches tab (it works; he has
never seen it).

**Phase 7 — "CV lifecycle & trust" (product, ~1 wk PT):** item-1 trio (file
view/download everywhere + proactive unsure-fields flag + full parsed-field
editing w/ re-embed) + match-score backfill & auto-freshness + cron
timeouts/heartbeats. One coherent phase; directly answers the feedback that
carries Liam's daily pain.

**Phase 8 — "Branded CV" (after 4 clarifications below):** S-slice first
(branded page + print PDF), then stored-DOCX artifact + Outlook attachment.

**Decide-later (options prepared, no commitment):** X-ray sourcing v1 (M) ·
people-data vendor appraisal doc (S to write, big decision) · apply-form embed
kit (S-M) · public per-org job board (M-L, the standard ATS "careers page" —
the strongest multi-tenant play in the whole list) · website services boundary.

## Clarifications for Liam / founder

1. Inngest: has payment actually happened now, or only diagnosed?
2. Branded CV: Word or PDF to clients? Existing SC template/logo to replicate?
   Strip candidate contact details on the branded copy (recommended)?
3. Sourcing: is "system generates the searches, recruiter clicks through
   LinkedIn" an acceptable v1, or is in-app suggestion the bar (vendor cost +
   GDPR overhead)? Any budget appetite for a data vendor?
4. Website: does Liam want general CV registration or applications against
   SPECIFIC roles (fork between embed-kit and job-board)? Who edits his site?
   Were the July apply_form entries real applicants or his own tests?
5. Match scores: backfill the 7 older applications too? (pennies — recommend yes)
