# Requirements: Altus — AI-First Recruitment CRM

**Defined:** 2026-05-17
**Core Value:** A recruiter can find the right candidate for a job in seconds using natural language — backed by AI parsing of every CV, semantic search across the database, and Sonnet-generated match explanations.

## v1 Requirements

Requirements for initial release (Phases 1–5, "ready for paying customer #2").

### Foundation (validated — Phase 1, Tasks 1–2 merged)

- [x] **FOUND-01**: Next.js 15 App Router scaffold with TypeScript strict and shadcn/ui
- [x] **FOUND-02**: Supabase auth shell — signup creates org + user row via trigger; signed-in layout with nav
- [x] **FOUND-03**: Phase 1 domain schema (organizations, users, companies, contacts, candidates, candidate_cvs, jobs, applications, activities, audit_log, ai_usage)
- [x] **FOUND-04**: RLS policies enforce tenant isolation via `current_organization_id()` helper
- [x] **FOUND-05**: pgvector + pg_trgm extensions enabled; `halfvec(1024)` reserved for embeddings
- [x] **FOUND-06**: Generated TypeScript types and seed data for development

### Candidates

- [ ] **CAND-01**: User can view a sortable, paginated list of candidates with name, role, location, market status, last contact, source
- [ ] **CAND-02**: User can view candidate detail page with all fields, activity timeline, CV history
- [ ] **CAND-03**: User can create a candidate manually with GDPR consent capture (basis + timestamp + privacy text version)
- [ ] **CAND-04**: User can edit candidate fields
- [ ] **CAND-05**: User can log notes, calls, and meetings against a candidate (writes to activities)
- [ ] **CAND-06**: Every read of a candidate detail page writes to `audit_log` with actor, entity, action, timestamp
- [ ] **CAND-07**: Candidate creation is blocked without GDPR consent

### CV & AI Parsing

- [ ] **CV-01**: User can upload a CV (PDF or DOCX) to a candidate; file stores to Supabase Storage at `cvs/{org_id}/{candidate_id}/{uuid}-{filename}`
- [ ] **CV-02**: CV is parsed by Claude Haiku via tool-use schema (name, contact, work history, skills, salary estimates, seniority, sector tags, confidence per field) in an Inngest background job
- [ ] **CV-03**: Parsing status (pending/complete/failed) is visible on candidate detail; review panel lets recruiter accept or edit extracted data
- [ ] **CV-04**: Every Claude call logs to `ai_usage` (model, tokens in/out, purpose, cost_pence, org_id)
- [ ] **CV-05**: Typed wrapper `src/lib/ai/claude.ts` centralises model selection, retries, and error handling

### Clients & Contacts

- [ ] **CLIENT-01**: User can view sortable list of clients with industry, last contact, active jobs count, dormant flag (>60 days no contact)
- [ ] **CLIENT-02**: User can view per-client management page with Contacts, Jobs, Activity tabs and notes section
- [ ] **CLIENT-03**: User can create/edit clients
- [ ] **CLIENT-04**: User can create/edit/delete contacts nested under a client
- [ ] **CLIENT-05**: `last_contacted_at` on client/contact updates when activity is logged

### Jobs & Pipeline

- [ ] **PIPE-01**: User can create a job against a client (title, type, hiring context, location, salary, description, owner)
- [ ] **PIPE-02**: User can view job detail with fields, applications, and pipeline tab
- [ ] **PIPE-03**: User can add an existing candidate to a job as an application (stage=applied, type=standard)
- [ ] **PIPE-04**: User can drag candidate cards between pipeline stages (applied → screening → submitted → 1st → 2nd → offer → placed)
- [ ] **PIPE-05**: Rejecting a candidate requires a structured `decline_reason` enum; stage changes auto-log to activities
- [ ] **PIPE-06**: User can view a global pipeline at `/pipeline` aggregated across all open jobs, filterable by owner/job/client

### Dashboard & Settings

- [ ] **DASH-01**: Authenticated home shows total candidates / active jobs / open applications / placements this month
- [ ] **DASH-02**: Dashboard shows recent activity feed (last 20 entries) with links
- [ ] **DASH-03**: Dashboard surfaces stale applications (>14 days in same stage) and candidates needing follow-up
- [ ] **DASH-04**: User can edit profile (name, email) and organisation (name, logo) at `/settings`
- [ ] **DASH-05**: User can invite a teammate by email; invitee signs up and joins the same org
- [ ] **DASH-06**: All list views have helpful empty states, loading skeletons, and mobile-responsive layout

### Semantic Search

- [ ] **SEARCH-01**: Candidate and job records have Voyage embeddings stored in `halfvec(1024)`; regenerate only on material change (`embedding_version`, `embedded_at` tracked)
- [ ] **SEARCH-02**: User can search candidates with natural language (e.g. "senior Python engineer with offshore wind experience in Aberdeen") — ranked by cosine similarity in Postgres
- [ ] **SEARCH-03**: User can search jobs by natural language and find jobs similar to a candidate (reverse search)
- [ ] **SEARCH-04**: New jobs auto-suggest top candidates by similarity

### AI Match Scoring

- [ ] **MATCH-01**: Each candidate-job pair shows a 0–100 match score with 2–3 strengths and 1–2 gaps, generated by Sonnet
- [ ] **MATCH-02**: Match explanations are cached per pair and regenerated only on material profile/job change
- [ ] **MATCH-03**: Match explanation includes suggested screening questions

### Public Apply Form & Email Capture

- [ ] **APPLY-01**: Public route hosts an apply form with CV upload, availability, salary, source capture, and GDPR consent
- [ ] **APPLY-02**: Apply submissions create a candidate record with `source` populated and trigger CV parsing
- [ ] **EMAIL-01**: User can connect Gmail via OAuth; inbound emails to/from a candidate/contact log to activities automatically

### LinkedIn Capture & Spec Workflow

- [ ] **LINKEDIN-01**: Chrome extension captures visible LinkedIn profile data in one click; creates/updates candidate and embedding
- [ ] **SPEC-01**: User can record or upload a spec call; Whisper transcribes; Sonnet structures into title, location, salary range, must-haves, nice-to-haves, culture notes, reporting line, urgency
- [ ] **SPEC-02**: Recruiter reviews and accepts/edits the structured JD before the job is created
- [ ] **AD-01**: User can generate a job ad from a structured JD with Sonnet; existing ads receive an inclusivity score with improvement suggestions

### Shortlists & Repeat Client Workflow

- [ ] **SHORT-01**: User can build a per-job shortlist by adding candidates to a working set (separate from formal applications)
- [ ] **SHORT-02**: User can submit a shortlisted candidate as a float/spec application without a specific job
- [ ] **REPEAT-01**: Dormant client dashboard widget flags clients silent >60/90 days with one-click outreach hook
- [ ] **REPEAT-02**: Source attribution report shows placements per source for ROI visibility

### Email Marketing & Reminders

- [ ] **MARKET-01**: User can build segmented email campaigns by `market_status` and send via Resend
- [ ] **MARKET-02**: Campaign emails are personalised per recipient with Sonnet drawing on CV + recent activity
- [ ] **MARKET-03**: Campaigns require explicit user approval before send (no auto-send)
- [ ] **REMIND-01**: Automated reminders for stale candidates (30+ days no contact, prioritised by market_status)

### Voice Notes & Natural-Language Reporting

- [ ] **VOICE-01**: User can dictate a voice note; Sonnet extracts key points, stage update recommendation, action items, candidate field updates
- [ ] **VOICE-02**: Recruiter approves changes before any candidate fields update
- [ ] **REPORT-01**: User can ask natural-language reporting questions; SQL is generated and validated against a schema-aware allowlist with read-only credentials before execution
- [ ] **REPORT-02**: Buyer-value dashboards: placements per recruiter per quarter, time-to-fill by sector, source ROI, repeat client rate, pipeline value, database engagement, commission summary

### SaaS Shell

- [ ] **SAAS-01**: Self-service signup creates a new organisation with onboarding flow (tour, sample data, CSV import)
- [x] **BILL-01**: Stripe subscription with billing portal; tiered plans
- [x] **BRAND-01**: Per-org branding — logo and colours on careers/apply site
- [ ] **ADMIN-01**: Super-admin support tooling (impersonation, plan overrides, usage review)
- [ ] **MARKETING-01**: Documentation site, marketing site, status page

## v2 Requirements

Deferred to a post-launch milestone.

### Temp / Contract (Phase 6 of original plan)

- **TEMP-01**: Assignments with pay rate, charge rate, IR35 status, contract dates
- **TEMP-02**: Weekly timesheets with approval workflow
- **TEMP-03**: Margin reporting (charge − pay) per assignment and recruiter
- **TEMP-04**: Umbrella/PAYE handling and renewal flows
- **TEMP-05**: Offshore compliance tickets (BOSIET, MIST, OPITO) if sector wedge chosen

### Future Enhancements

- **CV-RE**: Re-parse CV on demand (only triggers on material change in v1)
- **CV-EMAIL**: CV parsing from forwarded emails to `apply@…` inbox
- **CAND-SELF**: Candidate self-service page (view, update, delete data via tokenised link) — partially covered by APPLY in v1
- **REFERRAL-01**: Candidate referral tracking with payout events on placement
- **RTR-01**: Right to Represent records linked to applications with expiry warnings

## Out of Scope

Explicitly excluded from v1 and v2. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| LinkedIn outbound automation | LinkedIn detects automation and bans accounts; substitute is excellent email marketing |
| Chatbot "ask the CRM anything" UI | Gimmick; specific AI features at specific moments produce better outcomes |
| Auto-sending emails to candidates without approval | Recruiters' professional relationships are on the line |
| Generic CRM (deals, opportunities, custom pipelines) | Recruitment-specific workflows are the wedge |
| Invoicing / accounting | Xero/QuickBooks handles this; CRM tracks placements only |
| Native mobile app | Mobile-responsive web is sufficient for v1 |
| In-app voice/video calls | Dictation only; calls happen on existing channels |
| Synchronous AI calls in request handlers | Must move to Inngest if call may take >2s |

## Traceability

Phase mappings finalized by `/gsd:new-project` roadmap step — 2026-05-17.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| FOUND-06 | Phase 1 | Complete |
| CAND-01 | Phase 1 | Pending |
| CAND-02 | Phase 1 | Pending |
| CAND-03 | Phase 1 | Pending |
| CAND-04 | Phase 1 | Pending |
| CAND-05 | Phase 1 | Pending |
| CAND-06 | Phase 1 | Pending |
| CAND-07 | Phase 1 | Pending |
| CV-01 | Phase 1 | Pending |
| CV-02 | Phase 1 | Pending |
| CV-03 | Phase 1 | Pending |
| CV-04 | Phase 1 | Pending |
| CV-05 | Phase 1 | Pending |
| CLIENT-01 | Phase 1 | Pending |
| CLIENT-02 | Phase 1 | Pending |
| CLIENT-03 | Phase 1 | Pending |
| CLIENT-04 | Phase 1 | Pending |
| CLIENT-05 | Phase 1 | Pending |
| PIPE-01 | Phase 1 | Pending |
| PIPE-02 | Phase 1 | Pending |
| PIPE-03 | Phase 1 | Pending |
| PIPE-04 | Phase 1 | Pending |
| PIPE-05 | Phase 1 | Pending |
| PIPE-06 | Phase 1 | Pending |
| DASH-01 | Phase 1 | Pending |
| DASH-02 | Phase 1 | Pending |
| DASH-03 | Phase 1 | Pending |
| DASH-04 | Phase 1 | Pending |
| DASH-05 | Phase 1 | Pending |
| DASH-06 | Phase 1 | Pending |
| SEARCH-01 | Phase 2 | Pending |
| SEARCH-02 | Phase 2 | Pending |
| SEARCH-03 | Phase 2 | Pending |
| SEARCH-04 | Phase 2 | Pending |
| MATCH-01 | Phase 2 | Pending |
| MATCH-02 | Phase 2 | Pending |
| MATCH-03 | Phase 2 | Pending |
| APPLY-01 | Phase 2 | Pending |
| APPLY-02 | Phase 2 | Pending |
| EMAIL-01 | Phase 2 | Pending |
| LINKEDIN-01 | Phase 3 | Pending |
| SPEC-01 | Phase 3 | Pending |
| SPEC-02 | Phase 3 | Pending |
| AD-01 | Phase 3 | Pending |
| SHORT-01 | Phase 3 | Pending |
| SHORT-02 | Phase 3 | Pending |
| REPEAT-01 | Phase 3 | Pending |
| REPEAT-02 | Phase 3 | Pending |
| MARKET-01 | Phase 4 | Pending |
| MARKET-02 | Phase 4 | Pending |
| MARKET-03 | Phase 4 | Pending |
| REMIND-01 | Phase 4 | Pending |
| VOICE-01 | Phase 4 | Pending |
| VOICE-02 | Phase 4 | Pending |
| REPORT-01 | Phase 4 | Pending |
| REPORT-02 | Phase 4 | Pending |
| SAAS-01 | Phase 5 | Pending |
| BILL-01 | Phase 5 | Complete |
| BRAND-01 | Phase 5 | Complete |
| ADMIN-01 | Phase 5 | Pending |
| MARKETING-01 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 53 total (6 Complete + 47 Pending)
- Mapped to phases: 53/53
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-17*
*Last updated: 2026-05-17 — traceability expanded to per-requirement rows by roadmap step*
