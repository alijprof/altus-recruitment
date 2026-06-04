---
phase: 05-saas-shell
plan: 00
type: execute
wave: 0
depends_on: []
files_modified:
  - src/lib/env.ts
  - src/lib/supabase/middleware.ts
  - src/middleware.ts
  - src/lib/stripe/client.ts
  - src/lib/stripe/plans.ts
  - src/types/billing.ts
  - supabase/migrations/20260604120000_phase5_saas_billing.sql
  - supabase/migrations/20260604120100_phase5_super_admin_flag.sql
  - src/lib/db/organizations.ts
  - src/types/database.ts
autonomous: false
requirements: [BILL-01, BRAND-01, ADMIN-01, MARKETING-01, SAAS-01]
user_setup:
  - service: stripe
    why: "Phase 5 billing — Checkout, Customer Portal, webhooks. Build against TEST mode; live keys wired before go-live."
    env_vars:
      - name: STRIPE_SECRET_KEY
        source: "Stripe Dashboard (TEST mode) -> Developers -> API keys -> Secret key (sk_test_...)"
      - name: STRIPE_WEBHOOK_SECRET
        source: "Stripe Dashboard -> Developers -> Webhooks -> (your endpoint) -> Signing secret (whsec_...). For local dev: output of `stripe listen --forward-to localhost:3000/api/stripe/webhook`."
      - name: STRIPE_PRICE_STARTER
        source: "Stripe Dashboard -> Products -> Starter -> Price ID (price_...). Recurring, GBP, £59/seat/mo."
      - name: STRIPE_PRICE_PRO
        source: "Stripe Dashboard -> Products -> Pro -> Price ID. Recurring, GBP, £89/seat/mo."
      - name: STRIPE_PRICE_SCALE
        source: "Stripe Dashboard -> Products -> Scale -> Price ID. Recurring, GBP, £129/seat/mo."
    dashboard_config:
      - task: "Create three recurring GBP Products/Prices (Starter £59, Pro £89, Scale £129) per seat/mo in TEST mode"
        location: "Stripe Dashboard (TEST) -> Products"
      - task: "Configure Customer Portal (allow upgrade/downgrade/cancel; GBP currency) — see Assumption A5"
        location: "Stripe Dashboard (TEST) -> Settings -> Billing -> Customer portal"
      - task: "Register webhook endpoint pointing at https://<deploy>/api/stripe/webhook, subscribing to checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed, customer.subscription.trial_will_end"
        location: "Stripe Dashboard (TEST) -> Developers -> Webhooks"
      - task: "Set super_admin flag on the founder account (Supabase SQL editor — see Task 0.4 [BLOCKING] step)"
        location: "Supabase Dashboard -> SQL editor"

must_haves:
  truths:
    - "App boots (`pnpm build` / dev server) with ALL Stripe env vars absent — no boot crash"
    - "New public routes (/api/stripe/webhook, /welcome, /pricing, /features, /docs, /status) reach their handlers instead of 307-redirecting to /sign-in"
    - "organizations table has stripe_customer_id, brand_primary, brand_secondary columns with a hex CHECK constraint on the colour columns"
    - "subscriptions, stripe_webhook_events, ai_cap_notifications tables exist with RLS as specified"
    - "ai_cap_notifications enforces once-per-bucket-per-month dedup via UNIQUE (organization_id, bucket, notified_month)"
    - "Founder account carries super_admin:true in app_metadata"
    - "PLANS constant exposes Starter/Pro/Scale prices + per-seat AI caps matching the pricing doc"
    - "getOrganizationBySlug returns brand_primary + brand_secondary (BRAND-01 key link — the apply-site renderer in 05-02 reads these from the row)"
  artifacts:
    - path: "src/lib/stripe/client.ts"
      provides: "Fail-closed Stripe SDK singleton (null when key absent)"
      contains: "STRIPE_SECRET_KEY"
    - path: "src/lib/stripe/plans.ts"
      provides: "PLANS constant + PLAN_PRICE_IDS + AI caps per tier"
      contains: "export const PLANS"
    - path: "src/types/billing.ts"
      provides: "PlanKey, SubscriptionStatus, EntitlementStatus, AiCaps types"
      exports: ["PlanKey", "EntitlementStatus"]
    - path: "supabase/migrations/20260604120000_phase5_saas_billing.sql"
      provides: "subscriptions + stripe_webhook_events + ai_cap_notifications tables + organizations columns"
      contains: "create table public.subscriptions"
    - path: "supabase/migrations/20260604120100_phase5_super_admin_flag.sql"
      provides: "Documented SQL to set super_admin (run manually in Task 0.4)"
  key_links:
    - from: "src/lib/supabase/middleware.ts"
      to: "PUBLIC_PATHS"
      via: "array entries"
      pattern: "/api/stripe/webhook"
    - from: "src/lib/supabase/middleware.ts"
      to: "PUBLIC_PATHS"
      via: "marketing landing entry"
      pattern: "/welcome"
    - from: "src/lib/stripe/client.ts"
      to: "env.STRIPE_SECRET_KEY"
      via: "conditional instantiation"
      pattern: "env\\.STRIPE_SECRET_KEY"
    - from: "src/lib/db/organizations.ts"
      to: "organizations.brand_primary"
      via: "getOrganizationBySlug SELECT + OrganizationApplyRow"
      pattern: "brand_primary"
---

<objective>
Wave 0 hardening for the SaaS shell. Lays the foundation every downstream slice depends on: Stripe env-var isolation (so the phase ships without live keys), middleware PUBLIC_PATHS for the new public routes (the exact omission that caused P0/P1 bugs 260527-x2q and 260528-0rd), the fail-closed Stripe client + PLANS constant, all Phase-5 migrations applied to the linked DB (incl. the `ai_cap_notifications` dedup ledger 05-01 needs), the super_admin flag, AND the brand-column SELECT extension that BRAND-01's apply-site renderer (05-02) depends on.

Purpose: Everything else in Phase 5 is unbuildable or unsafe until this foundation is correct. The single highest-severity item (the /admin cross-tenant read gate) and the highest-likelihood regression (middleware omission) are both pre-empted here. The marketing landing route is pre-decided as `/welcome` and added to PUBLIC_PATHS here so 05-04 only creates route files, never touches middleware.
Output: env vars declared `.optional()`, PUBLIC_PATHS extended (incl. `/welcome`), Stripe client + plans + billing types, the Phase-5 migrations (billing tables + brand columns + ai_cap_notifications) pushed + types regenerated, super_admin set, organizations brand columns wired into the DB helper SELECTs.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-saas-shell/05-CONTEXT.md
@.planning/phases/05-saas-shell/05-RESEARCH.md
@CLAUDE.md
@docs/cost-and-pricing-analysis.md

<interfaces>
<!-- Extracted from codebase — executor should use these directly. -->

From src/lib/env.ts (existing pattern — all Phase 3/4 service keys are `.optional()` and fail-closed at call time):
  export const env = createEnv({ server: { ... }, client: { ... }, experimental__runtimeEnv: { ... }, emptyStringAsUndefined: true })

From src/lib/supabase/middleware.ts:
  const PUBLIC_PATHS = ['/sign-in', '/sign-up', '/auth/callback', '/api/inngest', '/apply', '/api/outlook/callback', '/api/outlook/webhook', '/api/linkedin/ingest', '/accept-invite']
  // isPublic matches `pathname === p || pathname.startsWith(`${p}/`)`

From src/lib/db/organizations.ts:
  // OrganizationRow ~lines 18-21:
  export type OrganizationRow = Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'> & { logo_url: string | null; apply_form_enabled: boolean }
  // OrganizationApplyRow ~lines 90-95 (used by the public apply page + apply server action):
  export type OrganizationApplyRow = { id: string; name: string; slug: string; apply_form_enabled: boolean }
  export async function getOrganization(supabase, organizationId): Promise<DbResult<OrganizationRow>>          // SELECT at ~line 29
  export async function updateOrganization(supabase, organizationId, patch: UpdateOrganizationPatch): Promise<DbResult<OrganizationRow>>  // SELECT at ~line 69
  export async function getOrganizationBySlug(supabase, slug): Promise<DbResult<OrganizationApplyRow>>          // SELECT string at ~line 103: '.select("id, name, slug, apply_form_enabled")'

From src/lib/supabase/service.ts:
  export function createServiceClient()  // service-role, bypasses RLS

AI-usage caps (AUTHORITATIVE — from docs/cost-and-pricing-analysis.md §5, per seat/month):
  Starter (£59, 1-3 seats): matchScores 300, cvParses 200, searches 1000, specMinutes 30, writingCalls 100
  Pro     (£89, up to 8 seats): matchScores 800, cvParses 600, searches 5000, specMinutes 120, writingCalls 300
  Scale   (£129, 8+ seats): high caps (3× Pro): matchScores 2400, cvParses 1800, searches 15000, specMinutes 360, writingCalls 900
  NOTE: these SUPERSEDE the [ASSUMED] placeholder numbers in 05-RESEARCH.md Code Examples. Use these.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 0.1: Stripe env vars (optional) + PLANS constant + billing types + Stripe client</name>
  <read_first>
    - src/lib/env.ts (the file being modified — match the existing `.optional()` + fail-closed-at-call-time pattern, e.g. OPENAI_API_KEY, TURNSTILE_SECRET_KEY)
    - docs/cost-and-pricing-analysis.md §5 (the AUTHORITATIVE cap numbers)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Code Examples: Stripe Singleton Client, Plan Definitions — but OVERRIDE the cap numbers with §5 values)
  </read_first>
  <action>
    In src/lib/env.ts `server` block, add as `.optional()`: STRIPE_SECRET_KEY (z.string().startsWith('sk_') optional), STRIPE_WEBHOOK_SECRET (z.string().startsWith('whsec_') optional), STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_SCALE (each z.string().min(1) optional). Add an inline comment block matching the existing style explaining: optional so `pnpm build` boots without Stripe; the Stripe client (Task 0.1) fails closed at call time, not module load. Do NOT add anything to the `client` block (no public Stripe keys needed).
    Create src/lib/stripe/plans.ts exporting `PLANS` (const, `as const`) keyed `starter`/`pro`/`scale`, each with: `label`, `pricePence` (5900/8900/12900), `seats` (3/8/99), `aiCaps` ({ matchScores, cvParses, searches, specMinutes, writingCalls } using the §5 AUTHORITATIVE numbers above). Export `type PlanKey = keyof typeof PLANS`. Export `PLAN_PRICE_IDS: Record<PlanKey, string>` reading `process.env.STRIPE_PRICE_STARTER/PRO/SCALE ?? ''`. Mark `pro` as the default in a comment. The `aiCaps` keys MUST align with the `ai_usage.purpose` values (cv_parse, match_score, search_query_embed, spec_transcribe, + writing purposes ad_generate/outreach_draft/dormant_outreach_draft) so the entitlement helper in 05-01 can aggregate by purpose.
    Create src/types/billing.ts exporting: `PlanKey` (re-export or mirror), `SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'none'`, `AiCaps`, `AiUsageAggregate`, and `EntitlementStatus` (planKey | 'none', planSeats, activeSeats, status, aiCaps, aiUsageThisMonth, softCapBreached, hardCapBreached). These are the contracts 05-01/05-05 implement against.
    Create src/lib/stripe/client.ts with `import 'server-only'`, importing Stripe and env. Export `const stripe` = `env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: <pinned>, typescript: true }) : null`. Type it so callers must null-check (e.g. `Stripe | null`). Verify the correct apiVersion string after install via `node -e "console.log(require('stripe').Stripe.PACKAGE_VERSION)"` or the SDK's expected version (Assumption A2 — do NOT hardcode 2025-06-30 blindly; use the version the installed SDK expects). Add a helper `assertStripe(): Stripe` that throws a clear "Stripe is not configured" error when `stripe` is null, for call sites to use.
    Run `pnpm add stripe papaparse && pnpm add -D @types/papaparse` first (packages [ASSUMED]-approved in 05-RESEARCH Package Legitimacy Audit — stripe is official Stripe Inc., papaparse 11yr established; no checkpoint needed).
  </action>
  <verify>
    <automated>pnpm typecheck && grep -c "STRIPE_SECRET_KEY\|STRIPE_WEBHOOK_SECRET\|STRIPE_PRICE_PRO" src/lib/env.ts && grep -q "export const PLANS" src/lib/stripe/plans.ts && grep -q "matchScores: 800" src/lib/stripe/plans.ts && grep -q "import 'server-only'" src/lib/stripe/client.ts</automated>
  </verify>
  <acceptance_criteria>
    - source: `grep "z.string().*optional" src/lib/env.ts` shows all 5 Stripe vars are `.optional()`
    - behavior: importing src/lib/env.ts with NO Stripe vars in process.env does not throw (run `node -e "require('./src/lib/env')"` equivalent via typecheck/build)
    - source: PLANS.pro.aiCaps.matchScores === 800, PLANS.starter.aiCaps.cvParses === 200, PLANS.scale.aiCaps.matchScores === 2400 (the §5 numbers, NOT the 05-RESEARCH placeholders)
    - behavior: `stripe` is `null` (not a thrown error) when STRIPE_SECRET_KEY is unset
    - test-command: `pnpm typecheck` passes
  </acceptance_criteria>
  <done>Stripe env vars optional, PLANS matches the pricing doc §5 exactly, billing types defined, Stripe client fails closed. `pnpm typecheck` green.</done>
</task>

<task type="auto">
  <name>Task 0.2: Extend PUBLIC_PATHS + middleware matcher for new public routes (incl. /welcome)</name>
  <read_first>
    - src/lib/supabase/middleware.ts (the file being modified — the PUBLIC_PATHS array + isPublic logic)
    - src/middleware.ts (the matcher — extended in 260528-0rd for the same class of bug)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Pitfall 3 — middleware omission was P0/P1 in 260527-x2q + 260528-0rd)
  </read_first>
  <action>
    In src/lib/supabase/middleware.ts, add to PUBLIC_PATHS (with an explanatory comment block per the existing style for each): `/api/stripe/webhook` (Stripe-signature-verified, no Supabase session — Stripe POSTs carry no cookies; gating it 307-redirects the webhook and breaks billing sync). NOTE checkout/portal (`/api/stripe/checkout`, `/api/stripe/portal`) are called by authenticated users, so they do NOT go in PUBLIC_PATHS.
    Add the marketing/docs/status public surfaces: `/welcome` (the pre-decided marketing landing route — DECIDED here in Wave 0 so 05-04 only creates route files and never touches middleware), `/pricing`, `/features`, `/docs`, `/status`. The marketing landing lives at `/welcome` (NOT at `/` — `/` remains the authenticated dashboard), so adding `/welcome` is unambiguous and does not require blanket-allowing `/`. 05-04 creates `(marketing)/welcome/page.tsx`, `pricing`, `features`, `/docs`, `/status` against these already-allowed paths.
    Confirm `/admin` is NOT added to PUBLIC_PATHS (it is authenticated + role-gated in the layout, per 05-RESEARCH Pitfall 8).
    Verify src/middleware.ts matcher does not already exclude these paths in a way that breaks them; the existing matcher excludes static assets only, so the new paths flow through updateSession() correctly — no matcher change is needed UNLESS /docs serves static MDX assets, in which case leave that to 05-04. Add a comment noting the matcher was reviewed for Phase 5 and needs no change.
  </action>
  <verify>
    <automated>grep -q "/api/stripe/webhook" src/lib/supabase/middleware.ts && grep -q "/welcome" src/lib/supabase/middleware.ts && grep -q "/pricing" src/lib/supabase/middleware.ts && grep -q "/docs" src/lib/supabase/middleware.ts && grep -q "/status" src/lib/supabase/middleware.ts && ! grep -q "'/admin'" src/lib/supabase/middleware.ts && pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - source: `grep -v '^\s*//' src/lib/supabase/middleware.ts | grep -c "/api/stripe/webhook"` ≥ 1
    - source: PUBLIC_PATHS contains `/welcome`, `/pricing`, `/features`, `/docs`, `/status`
    - source: PUBLIC_PATHS does NOT contain `/admin` and does NOT contain a bare `/api/stripe/checkout`-as-public (checkout is authenticated)
    - test-command: `pnpm typecheck` passes
  </acceptance_criteria>
  <done>The new public routes (incl. the pre-decided `/welcome` landing) reach their handlers; /admin stays gated; matcher reviewed. 05-04 inherits all marketing paths already allowlisted. Mirrors the fix pattern from 260527-x2q/260528-0rd preemptively.</done>
</task>

<task type="auto">
  <name>Task 0.3: Write Phase 5 migrations (billing tables + ai_cap_notifications + org columns + super_admin doc) + wire brand columns into the org DB helper</name>
  <read_first>
    - supabase/migrations/20260524000100_org_invitations.sql (reference for RLS policy + set_org trigger conventions on a new tenant table)
    - supabase/migrations/20260519092943_phase2_organizations_extensions.sql (reference for an `alter table organizations add column ... check (...)` pattern)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Subscriptions Table Migration shape + Pattern 5 hex CHECK)
    - src/lib/db/organizations.ts (the OrganizationRow type ~lines 18-21, OrganizationApplyRow ~lines 90-95, and the three SELECT strings at ~lines 29/69/103 to extend)
  </read_first>
  <action>
    Create supabase/migrations/20260604120000_phase5_saas_billing.sql (append-only — never edit a committed migration):
    (a) `create table public.subscriptions` with columns: id uuid PK default gen_random_uuid(); organization_id uuid not null UNIQUE references organizations(id) on delete cascade; stripe_customer_id text unique; stripe_subscription_id text unique; plan_key text not null default 'none' check (plan_key in ('starter','pro','scale','none')); plan_seats int not null default 0; status text not null default 'none' check (status in ('trialing','active','past_due','cancelled','none')); trial_end timestamptz; current_period_end timestamptz; created_at/updated_at timestamptz default now(). Add an `updated_at` BEFORE UPDATE trigger if the codebase has a shared one (check existing migrations for `set_updated_at` / `moddatetime`), else a simple trigger.
    (b) `alter table public.organizations add column stripe_customer_id text unique, add column brand_primary text check (brand_primary ~ '^#[0-9a-fA-F]{6}$'), add column brand_secondary text check (brand_secondary ~ '^#[0-9a-fA-F]{6}$')`. The hex CHECK is the DB-level half of the brand-XSS defence (Pitfall 5 / D-10).
    (c) `create table public.stripe_webhook_events (stripe_event_id text primary key, event_type text, created_at timestamptz not null default now())` — the idempotency table (UNIQUE on stripe_event_id via PK).
    (d) `create table public.ai_cap_notifications (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, bucket text not null, notified_month text not null, created_at timestamptz not null default now(), unique (organization_id, bucket, notified_month))` — the once-per-bucket-per-month dedup ledger for the 80% soft-cap warning email (consumed by 05-01 Task 1.4). `notified_month` is a 'YYYY-MM' string. RLS: enable row level security with NO authenticated policies (service-role only — cap enforcement runs server-side in claude.ts/Inngest; RLS-enabled-no-policy = deny-all for authenticated).
    (e) RLS for subscriptions/webhook-events: `alter table public.subscriptions enable row level security;` with a SELECT policy `org_members_read_own_subscription using (organization_id = public.current_organization_id())`. NO insert/update/delete policy — writes are service-role-only (webhook handler). `alter table public.stripe_webhook_events enable row level security;` with NO policies at all (service-role only; RLS-enabled-no-policy = deny-all for authenticated, service-role bypasses).
    (f) Grant column-level SELECT on the new organizations columns consistent with how logo_url/apply_form_enabled were granted (check 20260518202000 + 20260519092943 for the grant pattern). The `brand_primary` + `brand_secondary` SELECT grant must reach the anon/service path used by the public apply page (BRAND-01).
    Create supabase/migrations/20260604120100_phase5_super_admin_flag.sql as a DOCUMENTATION migration: a SQL comment block + the exact `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"super_admin": true}'::jsonb where email = 'alasdairj8@gmail.com';` statement, gated behind a guard so a fresh-DB `db push` does not fail if the founder account doesn't exist yet (wrap in a `do $$ begin ... if exists (...) then ... end if; end $$;` block). This makes the flag reproducible across environments without a manual-only step, while still being safe on a clean DB.
    Update src/lib/db/organizations.ts (this task OWNS the brand-column wiring — do it unconditionally; 05-02 only consumes the columns):
      1. Extend the `OrganizationRow` type (~lines 18-21) to add `stripe_customer_id: string | null; brand_primary: string | null; brand_secondary: string | null`.
      2. Extend the `OrganizationApplyRow` type (~lines 90-95) to add `logo_url: string | null; brand_primary: string | null; brand_secondary: string | null` (the apply page needs logo + both brand colours for the BRAND-01 render in 05-02).
      3. Extend the `getOrganizationBySlug` SELECT string (~line 103) from `'id, name, slug, apply_form_enabled'` to `'id, name, slug, apply_form_enabled, logo_url, brand_primary, brand_secondary'`. This is the BRAND-01 key link — without it the apply renderer in 05-02 has nothing to read.
      4. Extend the `getOrganization` SELECT (~line 29) and `updateOrganization` SELECT (~line 69) to include `stripe_customer_id, brand_primary, brand_secondary` so the settings page (05-02) can read/write brand colours.
      5. Extend `UpdateOrganizationPatch` (~lines 43-47) with `brand_primary?: string | null; brand_secondary?: string | null`, and add the corresponding conditional spreads to the `updatePayload` in `updateOrganization`.
    Keep the existing `as unknown as` boundary-cast comments accurate (the casts hold until Task 0.4 regenerates database.ts; extend the comment to mention the new columns).
    Do NOT run the migration in this task — Task 0.4 is the [BLOCKING] push.
  </action>
  <verify>
    <automated>grep -q "create table public.subscriptions" supabase/migrations/20260604120000_phase5_saas_billing.sql && grep -q "brand_primary text check" supabase/migrations/20260604120000_phase5_saas_billing.sql && grep -q "stripe_webhook_events" supabase/migrations/20260604120000_phase5_saas_billing.sql && grep -q "ai_cap_notifications" supabase/migrations/20260604120000_phase5_saas_billing.sql && grep -q "unique (organization_id, bucket, notified_month)" supabase/migrations/20260604120000_phase5_saas_billing.sql && grep -q "org_members_read_own_subscription" supabase/migrations/20260604120000_phase5_saas_billing.sql && grep -q "brand_primary, brand_secondary" src/lib/db/organizations.ts && grep -c "brand_primary" src/lib/db/organizations.ts && pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - source: subscriptions table has UNIQUE organization_id, plan_key + status CHECK constraints, RLS enabled with exactly one SELECT policy and no write policy
    - source: organizations gains stripe_customer_id (unique) + brand_primary + brand_secondary, both colour columns with `~ '^#[0-9a-fA-F]{6}$'` CHECK
    - source: stripe_webhook_events PK is stripe_event_id (UNIQUE idempotency)
    - source: ai_cap_notifications table exists with UNIQUE (organization_id, bucket, notified_month) and RLS-enabled-no-authenticated-policy (service-role only)
    - source: super_admin migration is idempotent/guarded (wrapped in an existence check) so `db push` is safe on a fresh DB
    - source: src/lib/db/organizations.ts `getOrganizationBySlug` SELECT string contains `logo_url, brand_primary, brand_secondary`, AND `OrganizationApplyRow` type declares `brand_primary` + `brand_secondary` (+ `logo_url`)
    - source: `OrganizationRow` + `getOrganization`/`updateOrganization` SELECTs include `brand_primary, brand_secondary`; `UpdateOrganizationPatch` has the two brand fields
    - test-command: `pnpm typecheck` passes
  </acceptance_criteria>
  <done>Two migration files written (billing tables + brand columns + idempotency table + ai_cap_notifications dedup ledger + RLS; guarded super_admin), organizations DB helper extended unconditionally so getOrganizationBySlug + OrganizationApplyRow expose the brand columns (BRAND-01 key link owned here, consumed by 05-02). Not yet pushed.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 0.4: [BLOCKING] Push migrations to linked Supabase + regenerate types + set super_admin</name>
  <what-built>
    Two migration files (20260604120000_phase5_saas_billing.sql — subscriptions, stripe_webhook_events, ai_cap_notifications, organizations columns; 20260604120100_phase5_super_admin_flag.sql) are written and ready to apply. Per project memory ([[supabase-migrations-manual-push]]), GitHub->Supabase auto-apply is unreliable — the push is manual and mandatory, and may require interactive Supabase auth.
  </what-built>
  <how-to-verify>
    Run, in order:
    1. `pnpm exec supabase db push --linked` — applies both new migrations to the linked cloud DB. If it prompts for auth, complete it.
    2. `pnpm db:types` — regenerates src/types/database.ts from the live schema (this replaces the hand-cast types in organizations.ts with canonical introspection output; the casts in Task 0.3 are a temporary boundary until this runs).
    3. Confirm in Supabase Dashboard SQL editor that `select * from public.subscriptions limit 1;`, `select brand_primary, brand_secondary from public.organizations limit 1;`, `select * from public.stripe_webhook_events limit 1;`, and `select * from public.ai_cap_notifications limit 1;` all succeed (empty result = OK; "relation does not exist" = FAIL).
    4. Confirm `select raw_app_meta_data->>'super_admin' from auth.users where email = 'alasdairj8@gmail.com';` returns `true`. If the guarded migration did not set it (account created after push), run the update statement from 20260604120100 manually.
    5. `pnpm typecheck` — must pass against the regenerated types.
  </how-to-verify>
  <resume-signal>Type "pushed" once all four tables exist (subscriptions, stripe_webhook_events, ai_cap_notifications, + the new organizations columns), types are regenerated, super_admin returns true, and typecheck passes — or describe the failure.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| build/runtime env | Missing Stripe keys must not crash the app; features degrade, app stays up |
| middleware → routes | New public routes must reach handlers; auth-gated routes must stay gated |
| client → DB (RLS) | subscriptions readable by own org only; webhook-events + ai_cap_notifications deny-all for authenticated |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-00-01 | Denial of Service | env.ts module load | mitigate | All Stripe vars `.optional()`; client fails closed at call time, never at boot (Pitfall 7) |
| T-05-00-02 | Elevation of Privilege | subscriptions RLS | mitigate | SELECT policy scoped to current_organization_id(); no write policy (service-role only) |
| T-05-00-03 | Information Disclosure | stripe_webhook_events + ai_cap_notifications | mitigate | RLS enabled, zero policies = deny-all for authenticated role |
| T-05-00-04 | Tampering | brand colour columns | mitigate | DB CHECK `~ '^#[0-9a-fA-F]{6}$'` (DB-level half of XSS defence; render-level half in 05-02) |
| T-05-00-05 | Spoofing | /api/stripe/webhook routing | mitigate | Added to PUBLIC_PATHS so signature-verified handler (05-01) actually runs instead of 307 |
| T-05-00-SC | Tampering | npm installs (stripe, papaparse) | accept | Both [ASSUMED]-approved in 05-RESEARCH audit: stripe = official Stripe Inc. (14yr), papaparse (11yr). No [SUS]/[SLOP] packages → no blocking checkpoint required. |
</threat_model>

<verification>
- `pnpm typecheck` and `pnpm lint` pass.
- `pnpm build` succeeds with NO Stripe env vars set (proves isolation).
- All four new tables (subscriptions, stripe_webhook_events, ai_cap_notifications, + organizations columns) queryable in Supabase; super_admin flag true for founder.
- PUBLIC_PATHS contains the five new public surfaces (`/welcome`, `/pricing`, `/features`, `/docs`, `/status`) + `/api/stripe/webhook`; /admin absent.
- getOrganizationBySlug SELECT + OrganizationApplyRow expose brand_primary/brand_secondary (BRAND-01 key link).
</verification>

<success_criteria>
- App boots and builds without any Stripe configuration.
- Migrations applied to linked DB; types regenerated; typecheck green against canonical types.
- PLANS constant encodes the §5 pricing-doc caps exactly.
- ai_cap_notifications dedup ledger exists for 05-01's soft-cap email once-per-bucket-per-month guarantee.
- Marketing landing route `/welcome` (+ /pricing /features /docs /status) is allowlisted in middleware; 05-04 inherits it.
- Brand columns are SELECTed by the org DB helper so 05-02's apply renderer can consume them.
- Foundation ready: 05-01..05-05 can build in parallel on top.
</success_criteria>

<output>
Create `.planning/phases/05-saas-shell/05-00-SUMMARY.md` when done.
</output>
