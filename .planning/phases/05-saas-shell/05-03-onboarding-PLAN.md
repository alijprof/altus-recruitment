---
phase: 05-saas-shell
plan: 03
type: execute
wave: 1
depends_on: ["05-00"]
files_modified:
  - src/app/(app)/candidates/import/page.tsx
  - src/app/(app)/candidates/import/import-wizard.tsx
  - src/app/(app)/candidates/import/actions.ts
  - src/app/(app)/candidates/import/column-map.ts
  - src/lib/onboarding/sample-data.ts
  - src/app/(app)/_dashboard/sample-data-action.ts
  - src/app/(app)/_dashboard/welcome-checklist.tsx
  - src/app/(app)/page.tsx
autonomous: true
requirements: [SAAS-01]

must_haves:
  truths:
    - "A new org owner sees a welcome checklist that now includes 'Import candidates' and 'Seed sample data'"
    - "An owner can one-click seed a small set of synthetic sample records (no real PII) into their empty org"
    - "An owner can upload a CSV of candidates, map columns, and create candidate records — deduping by lowercased email"
    - "CSV rows missing required fields (name) are skipped with a per-row report, not a crash"
  artifacts:
    - path: "src/app/(app)/candidates/import/actions.ts"
      provides: "Server Action that parses CSV (PapaParse) and creates candidates via the existing path"
      exports: ["importCandidatesAction"]
    - path: "src/lib/onboarding/sample-data.ts"
      provides: "Synthetic sample candidates/clients/job definitions (no real PII)"
      exports: ["SAMPLE_CANDIDATES", "SAMPLE_CLIENTS"]
    - path: "src/app/(app)/_dashboard/welcome-checklist.tsx"
      provides: "Extended onboarding checklist with import + seed steps"
      contains: "Import candidates"
  key_links:
    - from: "src/app/(app)/candidates/import/actions.ts"
      to: "createCandidate (existing path)"
      via: "per-row creation with lowercased-email dedupe"
      pattern: "createCandidate|toLowerCase"
    - from: "src/app/(app)/_dashboard/welcome-checklist.tsx"
      to: "/candidates/import"
      via: "checklist step link"
      pattern: "/candidates/import"
---

<objective>
Self-service onboarding (SAAS-01): extend the existing first-run welcome checklist with two new steps — seed sample data and import candidates — and build a CSV candidate-import wizard (PapaParse → column mapping → the existing candidate-creation path, deduping by lowercased email) plus a one-click synthetic sample-data seed so an empty org isn't intimidating.

This is a thin vertical slice on top of existing infrastructure: the org-bootstrap (callback), the welcome checklist, and the candidate-creation path all already exist (D-01/D-12 — reuse, don't rebuild). After it, a brand-new agency can go from empty org to "the product feels alive" in minutes.

Purpose: Removes the manual hand-holding that currently makes onboarding founder-dependent — the gate to self-serve customer #2+.
Output: candidate import wizard (page + client + Server Action + column-map), sample-data seed + action, extended welcome checklist.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/05-saas-shell/05-CONTEXT.md
@.planning/phases/05-saas-shell/05-RESEARCH.md
@CLAUDE.md
@src/app/(app)/_dashboard/welcome-checklist.tsx
@src/app/(app)/candidates/new/actions.ts

<interfaces>
<!-- Reuse, don't rebuild (D-01/D-12). -->

From src/lib/db/candidates.ts (existing):
  export type CreateCandidateInput = { full_name; email?; phone?; location?; current_role_title?; current_company?; market_status: Enums<'market_status'>; source: Enums<'candidate_source'>; consent_basis: Enums<'consent_basis'>; consent_at; consent_text_version; organization_id? }
  export async function createCandidate(supabase, input): Promise<DbResult<{ id: string }>>
  // email is lowercased + trimmed at the write boundary already (260604-cn5 fix) — dedupe-safe.
  // There is an existing findCandidateByEmail / getCandidateByEmailForOrg helper for dedupe checks.

From src/app/(app)/candidates/new/actions.ts (existing — the creation path + consent defaults to copy):
  consent_at: new Date().toISOString(); consent_text_version: CURRENT_CONSENT_VERSION (from @/lib/legal/consent)

From src/app/(app)/_dashboard/welcome-checklist.tsx (existing client component):
  props: { candidates; clients; jobs; teamMembers }
  steps: [ 'Add your first candidate' /candidates/new, 'Add your first client' /clients/new, 'Invite a teammate' /settings/team, 'Upload a job spec' /spec/new ]
  // step.done derived from DB counts (props). localStorage only holds the dismiss flag.

From src/app/(app)/page.tsx (dashboard RSC): fetches the counts and renders <WelcomeChecklist ... />.

PapaParse (installed in 05-00): import Papa from 'papaparse'; Papa.parse<Record<string,string>>(text, { header:true, skipEmptyLines:true, transformHeader: h => h.trim().toLowerCase() }).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 3.1: CSV candidate import — column mapping + Server Action (dedupe by lowercased email)</name>
  <read_first>
    - src/app/(app)/candidates/new/actions.ts (the createCandidateAction + consent defaults to reuse exactly)
    - src/lib/db/candidates.ts (createCandidate signature + the existing findCandidateByEmail dedupe helper + email lowercasing at the write boundary)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Pattern 6 CSV import; Security Domain row on CSV injection — PapaParse strings only, Zod validates before write)
    - src/lib/legal/consent.ts (CURRENT_CONSENT_VERSION + consent basis for imported candidates)
  </read_first>
  <behavior>
    - column-map normalises header variants: {'first name','firstname','name','full name','candidate'} → full_name; {'email','email address','e-mail'} → email; {'phone','mobile','telephone'} → phone; {'location','city','town'} → location; {'role','title','current role','job title'} → current_role_title; {'company','employer','current company'} → current_company
    - a row with no resolvable full_name is skipped and reported (not created)
    - email is lowercased+trimmed; a row whose email already exists in the org is treated as a dedupe-skip (reported as 'duplicate'), not a second record
    - import returns a summary: { created, skippedNoName, skippedDuplicate, errors }
  </behavior>
  <action>
    Create src/app/(app)/candidates/import/column-map.ts: an exported HEADER_ALIASES map and a `mapRow(row: Record<string,string>): MappedCandidate | null` that returns null when no full_name resolves. Pure function, unit-testable.
    Create src/app/(app)/candidates/import/actions.ts importCandidatesAction(formData | parsed rows): 'use server'; createClient()+getUser(); load caller org via RLS. Accept either a CSV File (Papa.parse with header:true, skipEmptyLines, transformHeader lowercased) or already-parsed+mapped rows from the wizard (Claude's discretion — pick one contract and keep it). For each row: mapRow → skip+report if null; lowercase email; if email present, check the existing org dedupe helper (findCandidateByEmail) → report 'duplicate' and skip if found; else call createCandidate with consent_basis (use a sensible imported-data basis — e.g. 'legitimate_interest' or the existing default used by the apply form; consent_at = now; consent_text_version = CURRENT_CONSENT_VERSION) and source = an appropriate Enums<'candidate_source'> value (e.g. 'import' if it exists, else the closest existing enum — do NOT invent a new enum value; if none fits, use the existing fallback and note it). Cap the import at a sane batch size (e.g. 500 rows) to avoid runaway server-action time; report truncation. Return the summary object. Validate every field through the same constraints createCandidate enforces (Zod / DB) before write — never trust CSV content. Sentry: never log candidate names/emails (PII) — counts + tags only.
    Add a unit test src/app/(app)/candidates/import/column-map.test.ts covering the header-variant mapping + the null-on-no-name case + an injection-ish cell value (e.g. '=cmd()') being treated as a plain string.
  </action>
  <verify>
    <automated>grep -q "mapRow\|HEADER_ALIASES" "src/app/(app)/candidates/import/column-map.ts" && grep -q "createCandidate" "src/app/(app)/candidates/import/actions.ts" && grep -qE "toLowerCase|findCandidateByEmail" "src/app/(app)/candidates/import/actions.ts" && pnpm typecheck && pnpm test -- "src/app/(app)/candidates/import/column-map.test.ts"</automated>
  </verify>
  <acceptance_criteria>
    - behavior: mapRow maps common header variants to canonical fields; returns null when no name resolves (unit-tested)
    - behavior: import skips no-name rows and email-duplicates, reporting each in the summary
    - source: import goes through the existing createCandidate path (not a raw insert); email lowercased; PII never sent to Sentry
    - source: no new candidate_source / consent enum value invented; uses existing enum members
    - test-command: `pnpm typecheck && pnpm test -- column-map.test.ts` pass
  </acceptance_criteria>
  <done>CSV import column-mapping + Server Action create candidates via the existing path, deduping by lowercased email, with a per-row summary. Mapping unit-tested.</done>
</task>

<task type="auto">
  <name>Task 3.2: Import wizard UI + sample-data seed + extended welcome checklist</name>
  <read_first>
    - "src/app/(app)/candidates/import/actions.ts" + "column-map.ts" (created Task 3.1 — the contract the wizard calls)
    - src/app/(app)/_dashboard/welcome-checklist.tsx (the file being modified — its props + step shape + DB-count-derived done logic)
    - src/app/(app)/page.tsx (dashboard RSC that renders the checklist + supplies counts)
    - src/app/(app)/candidates/new/page.tsx (form/layout conventions for the wizard)
  </read_first>
  <action>
    Create src/app/(app)/candidates/import/page.tsx (RSC) + import-wizard.tsx (client, 'use client'): a simple 3-step wizard — (1) upload/paste a CSV file; (2) preview detected column mapping with the option to override (a per-column dropdown to remap), built on column-map.ts's aliases; (3) confirm → call importCandidatesAction → show the summary (created / skipped-no-name / duplicates) with a toast (success and partial-failure both surfaced — no silent success per CLAUDE.md). Include a tiny downloadable example CSV / column hint. Keep UI functional; a design polish pass on customer-facing surfaces happens at build time.
    Create src/lib/onboarding/sample-data.ts exporting SAMPLE_CANDIDATES (3-5 synthetic candidates — fictional names, no real PII), SAMPLE_CLIENTS (2 clients), and one sample open job definition. Use clearly-synthetic data (e.g. obviously-fictional names + example.com emails) so it's never mistaken for real candidates.
    Create src/app/(app)/_dashboard/sample-data-action.ts seedSampleDataAction(): 'use server'; owner-or-member gated (createClient+getUser, RLS-scoped); creates the SAMPLE_* records via the existing createCandidate / client / job creation paths under the caller's org (RLS auto-scopes org). Idempotency: guard so repeat clicks don't duplicate (e.g. skip seeding if the org already has candidates, or tag sample rows so a second run no-ops). Return a summary; surface via toast.
    Edit welcome-checklist.tsx: add two steps — 'Seed sample data' (links to a dashboard control that triggers seedSampleDataAction; done when candidates>0) and 'Import candidates' (links to /candidates/import; done when candidates>0). Keep the existing DB-count-derived `done` logic and the localStorage-dismiss-only invariant (no auth/tenancy meaning in localStorage). Wire the seed action trigger from the dashboard (page.tsx passes a handler or the checklist renders a button that calls the server action). Ensure no `await` of a Supabase call sits inside any subscriber callback (N/A here, but keep effects clean per CLAUDE.md).
    Update src/app/(app)/page.tsx if the checklist needs an extra prop (it already passes candidates/clients/jobs/teamMembers — likely sufficient; add only if a new count is needed).
  </action>
  <verify>
    <automated>grep -q "Import candidates" "src/app/(app)/_dashboard/welcome-checklist.tsx" && grep -q "/candidates/import" "src/app/(app)/_dashboard/welcome-checklist.tsx" && grep -qE "SAMPLE_CANDIDATES" src/lib/onboarding/sample-data.ts && grep -q "importCandidatesAction" "src/app/(app)/candidates/import/import-wizard.tsx" && pnpm typecheck && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - behavior: welcome checklist shows 'Seed sample data' + 'Import candidates' steps, each marked done when candidates>0 (DB-derived, not localStorage)
    - behavior: import wizard previews column mapping, allows override, and shows a created/skipped summary toast
    - behavior: seedSampleDataAction creates clearly-synthetic records and is idempotent (repeat clicks do not duplicate)
    - source: sample data contains no real PII (example.com emails / fictional names)
    - source: wizard surfaces partial-failure (no silent success)
    - test-command: `pnpm typecheck && pnpm lint` pass
  </acceptance_criteria>
  <done>Import wizard, synthetic sample-data seed, and the extended welcome checklist let a brand-new org fill itself in minutes — all on the existing creation paths.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| owner → CSV upload | Untrusted file content parsed and turned into DB rows |
| owner → seed action | Authenticated write into the caller's own org (RLS-scoped) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-03-01 | Injection | CSV import | mitigate | PapaParse yields strings only; every field re-validated by the existing createCandidate Zod/DB constraints before write; formula cells stay inert strings |
| T-05-03-02 | Information Disclosure | import Sentry logs | mitigate | Only counts/tags to Sentry — never candidate names/emails (CLAUDE.md PII rule) |
| T-05-03-03 | Tampering | seed/import org scoping | mitigate | All writes go through RLS-scoped createCandidate (org auto-set by trigger); no service-role, no cross-org |
| T-05-03-04 | Abuse (resource) | bulk CSV | mitigate | Batch size cap (e.g. 500 rows) with truncation report; dedupe prevents row amplification |
</threat_model>

<verification>
- `pnpm typecheck`, `pnpm lint`, and the column-map unit test pass.
- Manual: upload a CSV with mixed/duplicate emails → correct created/skipped/duplicate counts; seed sample data into an empty org then re-click (no duplicates); checklist reflects the new steps.
</verification>

<success_criteria>
- A new org can seed sample data and bulk-import candidates via column-mapped CSV (deduped by lowercased email), guided by the extended welcome checklist — no founder intervention.
</success_criteria>

<output>
Create `.planning/phases/05-saas-shell/05-03-SUMMARY.md` when done.
</output>
