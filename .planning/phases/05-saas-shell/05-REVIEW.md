# Phase 5 (SaaS Shell) — Code Review

**Method:** multi-agent review (6 parallel `gsd-code-reviewer` agents by subsystem) → each finding adversarially verified by a second agent. 32 agents, ~1.78M tokens.
**Scope:** 59 changed source files on `feat/phase-5-saas-shell`.
**Result:** 37 confirmed, 6 refuted/downgraded.
**Date:** 2026-06-04

Severities reflect the verifier's adjusted rating. `Fix` = fixed before UAT. `Defer` = documented, not fixed (rationale given).

---

## HIGH (5) — all fixed

| # | File | Finding | Disposition |
|---|------|---------|-------------|
| H1 | `api/stripe/webhook/route.ts` | Idempotency row committed BEFORE processing; on a processing throw the catch returns 200, so Stripe's retry hits the dup-key short-circuit and the event is **permanently lost** (paid customer → no subscription row). `upsertFromSubscription` also ignores `upsert .ok`, losing failed DB writes silently. | **Fix** — SELECT-precheck for replays → process → INSERT ledger only on success → return 500 on throw so Stripe retries; make the upsert caller throw on `!ok`. (No migration.) |
| H2 | `api/stripe/webhook/route.ts` | `invoice.payment_failed` resolves org via `invoice.metadata.organization_id`, which is **never set** (Stripe doesn't copy subscription/customer metadata onto invoices) → `past_due` flip + dunning email never fire. | **Fix** — resolve org from the retrieved subscription's metadata (`invoice.parent.subscription_details`). |
| H3 | `settings/billing/manage-billing-button.tsx` | `router.push(data.url)` to a cross-origin Stripe portal URL — App Router `router.push` doesn't reliably navigate external origins → **Manage-billing button broken**. | **Fix** — `window.location.href = data.url` (matches the codebase's external-redirect pattern). |
| H4 | `api/stripe/webhook/route.ts` | `derivePlanKey` silently `?? 'pro'` on an unknown price ID → a Starter customer can be written with Pro seats/caps (over-provision) on price rotation or a dashboard-set legacy price. | **Fix** — Sentry-capture (org_id + price_id, no PII) and SKIP the plan write instead of defaulting to Pro. |
| H5 | `api/stripe/checkout/route.ts` | No owner-role gate — any authenticated member can create the org's Stripe customer + subscription. The sibling portal route already enforces owner-only. | **Fix** — add the same `role !== 'owner' → 403` gate before any Stripe/DB write. |

## MEDIUM (7)

| # | File | Finding | Disposition |
|---|------|---------|-------------|
| M1 | `lib/admin/queries.ts` | Overview swallows subscription/usage errors (Sentry-only) and **discards the seats query error entirely**, rendering fabricated £0 / 0-seats / 'none' zero-states the founder can't distinguish from real failures. | **Fix** — capture all sub-query errors (incl. seats) + surface a "data incomplete" flag in the UI. |
| M2 | `candidates/import/actions.ts`, `column-map.ts` | Comments falsely claim Zod validation in `createCandidate`; **no email-format validation anywhere** → junk cells stored as candidate emails, polluting dedup/outreach. | **Fix** — validate email shape before `createCandidate` (skip/flag bad rows); correct the false comments. |
| M3 | `_dashboard/sample-data-action.ts` | Seed never `revalidatePath('/')` → checklist/counts stay stale after seeding (the code comment admits the gap but does nothing). | **Fix** — `revalidatePath('/')` after a successful seed. |
| M4 | `candidates/import/actions.ts` | Import never revalidates `/candidates` → imported rows don't appear without a hard refresh (every other create flow revalidates). | **Fix** — `revalidatePath('/candidates')` + `'/'` when `created > 0`. |
| M5 | `candidates/import/import-wizard.tsx` | `applyMappingOverrides` → `Papa.unparse` infers columns from row 0; a ragged first row missing the email cell **silently drops the email column for ALL rows**, defeating dedup (empirically reproduced). | **Fix** — `Papa.unparse(rows, { columns: headerRemap.map(h => h.to) })`. |
| M6 | `marketing-nav.tsx`, `(marketing)/welcome`, `(marketing)/features` | White text on brand teal `#5DCAA5` = 2.01:1, fails WCAG AA on the nav badge + primary CTAs. | **Fix** — navy `#0A3D5C` on teal / navy-bg CTAs to clear AA. |
| M7 | `migrations/…_saas_billing.sql` (organizations) | `organizations.stripe_customer_id` is writable by owners via the pre-existing org UPDATE policy (no column restriction), violating its documented service-role-only invariant (owner could clear/forge their own Stripe linkage). | **Fix** — new migration: `REVOKE UPDATE (stripe_customer_id) ON public.organizations FROM authenticated` (the app only writes it via service-role). **Needs a founder push.** |

## LOW (selected for fix)

| File | Finding | Disposition |
|------|---------|-------------|
| `settings/billing/page.tsx` + `entitlement.ts` + `types/billing.ts` | Trial-end hardcoded to `'soon'` (EntitlementStatus never exposes `trial_end`). | **Fix** — thread `trialEnd`/`currentPeriodEnd` through entitlement → render real date. |
| `api/stripe/checkout/route.ts` + `portal/route.ts` | Relative success/cancel/return URLs when `NEXT_PUBLIC_SITE_URL` unset → Stripe rejects with opaque 500. | **Fix** — 503 with a clear message if site URL absent. |
| `admin/actions.ts` + `OverrideForm.tsx` | `cap_multiplier` has no upper bound — a fat-finger 1000× blows up AI spend. | **Fix** — `z.number().positive().max(10)` + input `max`. |
| `admin/[orgId]/OverrideForm.tsx` | `datetime-local` → `toISOString()` shifts trial end by the UTC offset on round-trip. | **Fix** — parse/display consistently as UTC. |
| `admin/actions.ts` + `queries.ts` | Cap-clear can't truly remove an override (leaves a shell row + stale note); `hasOverride` is row-existence not field-state. | **Fix** — delete the row when all fields empty; compute `hasOverride` from fields. |
| `lib/admin/queries.ts` | `plan_overrides` fail-open swallows ALL errors (catch is dead for the PostgREST path), not just missing-table. | **Fix** — only treat `42P01` as fail-open; Sentry-capture the rest. |
| `admin/[orgId]/OverrideForm` / `extendTrialSchema` | `z.string().datetime()` allows past trial dates (no-op override). | **Fix** — `.refine(future)`. |
| `import-wizard.tsx` | Partial CSV parse errors swallowed when ≥1 row parses. | **Fix** — non-blocking "N rows skipped" warning. |
| `status/page.tsx` | DB probe has no timeout — a slow DB stalls the status page render. | **Fix** — `Promise.race` 3–5s → 'degraded'. |
| `settings/branding/schema.ts` + apply `page.tsx` | `logo_url` comment falsely claims `z.string().url()`; validator is a weak `http(s)://` prefix regex, no DB CHECK. | **Fix** — correct comment + tighten to `https://`-only. |
| `(marketing)/pricing` metadata, `docs/content.ts` | Prices hardcoded in SEO metadata + docs prose, decoupled from `PLANS` → drift. | **Fix** — derive from `PLANS`. |
| `(marketing)/welcome` hero, `pricing-table.tsx` | `text-white/50` hero subtext ~4.08:1 (sub-AA); Scale "8+" seat copy hardcoded. | **Fix** — `/70`; derive `8+` from `PLANS`. |
| `lib/admin/queries.ts` | Dead `usersClient` binding (built then `void`-discarded). | **Fix** — delete. |
| `apply/[orgSlug]/apply-form.tsx` | `brandPrimary/brandSecondary` declared required but unused (CSS-var approach). | **Fix** — remove dead props. |

## LOW / deferred (documented, not fixed)

| File | Finding | Why deferred |
|------|---------|--------------|
| `lib/admin/queries.ts` | Month-to-date cost uses UTC boundary vs en-GB local display. | Zero impact Oct–Mar (GMT==UTC); ≤1h window in summer; internal qualitative margin view, not billed. Documented next to `currentMonthStart()`. |
| `admin/actions.ts` | `note` annotates the whole override row (drift between trial/cap notes). | Split columns is over-engineering for a one-operator internal tool; the cap-clear-deletes-row fix removes the worst case. |
| `lib/stripe/entitlement.ts` | `getEntitlement` ignores its `_supabase` param (always service-role). | Deliberate — it's also called from the Inngest/`claude.ts` path with no session client, so context-agnostic service-role is the simpler/robust design; org boundary is enforced by the `orgId` arg. Misleading JSDoc corrected (comment-only). |
| `_dashboard/sample-data-action.ts` | Check-then-act seed race (concurrent double-seed). | Best-effort per-tab guard + idempotency count-check is adequate for a 2–3 person agency; true serialization is disproportionate. |

## Refuted (6) — correctly dismissed by adversarial verification

1. **Super-admin gate trusts stale cached `app_metadata`** — FALSE: `getUser()` does a live network re-read of `auth.users` (not the cached JWT), so grant/revocation take effect immediately. Gate is correct.
2. **`logo_url` via `next/image unoptimized` = XSS/SSRF on public page** — FALSE: owner-only self-scoped write, `<img>` doesn't execute SVG script, no cross-tenant/script path. (Hardening tracked separately as the low logo_url item.)
3. **Intra-batch duplicate emails create duplicates** — FALSE: the import loop is sequential `await` (read-after-write on primary), so a same-file duplicate is correctly skipped.
4. **No file-size cap (DoS)** — FALSE: Next 16 enforces a 1 MB Server Action body limit (413) before parse; the 500-row cap is the spec'd mitigation. Only a self-inflicted client-tab freeze remains (cosmetic).
5. **`formatGBP` rounds non-whole prices** — FALSE: only ever called with the `as const` literal `PLANS` pence (all ×100); no runtime input path.
6. **`plan_overrides` SELECT policy omits `to authenticated`** — FALSE: anon has no table GRANT (permission-denied before RLS) and `current_organization_id()` is null for anon → zero rows. Cosmetic consistency nit only.
