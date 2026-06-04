# Phase 5: SaaS Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 5-saas-shell
**Areas discussed:** Signup access, Trial/payment, Plan structure, Admin console

---

## Signup access (SAAS-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Open self-serve + trial | Anyone signs up, creates org, using it in minutes; email verification + apply-form abuse guards | ✓ |
| Gated waitlist / approval | Signups join a waitlist; founder approves each org | |
| Invite-code gated | Only code-holders can create an org | |

**User's choice:** Open self-serve + trial.
**Notes:** Matches the phase goal ("using the product within 30 minutes"). Reuses existing org-bootstrap path.

---

## Trial / payment (BILL-01)

| Option | Description | Selected |
|--------|-------------|----------|
| 14-day free trial, no card | Lowest friction; card needed to continue | |
| Card required upfront | Card captured at signup, trial runs on it | ✓ |
| Freemium (free tier + paid) | Permanently-free limited tier | |

**User's choice:** Card required upfront.
**Notes:** Higher intent, near-zero involuntary churn at trial end. Captured via Stripe Checkout; 14-day trial auto-converts.

---

## Plan structure (BILL-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Per-seat tiers, AI bundled | Starter £59 / Pro £89 / Scale £129 per seat (from pricing analysis) | ✓ |
| Single per-seat plan (£89) | One plan, AI bundled | |
| Per-org flat plans | Flat monthly per org | |

**User's choice:** Per-seat tiers, AI bundled.
**Notes:** Aligns with `docs/pricing-overheads-breakeven-2026-06-04.md` and competitor norm (Firefish/Vincere per-seat). Pro is the default highlighted tier.

---

## Admin console (ADMIN-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Full impersonation + overrides, audited | Log in as any org, overrides, per-tenant cost, full audit | |
| Read-only support view | See data + usage, no acting-as | |
| Usage + billing dashboard only | Per-tenant cost + billing status only | |
| **(Re-asked after explanation)** Lean: ops dashboard + overrides | Per-tenant AI cost + billing dashboard + plan/trial overrides; NO impersonation in v1 | ✓ |

**User's choice:** Lean: ops dashboard + overrides (after a follow-up explanation of what the console is for and what competitors do).
**Notes:** Founder questioned whether full impersonation + audit was necessary for "a simple, straightforward platform." Agreed: the per-tenant cost view is real margin-protection value from day one; impersonation + audit are enterprise-scale concerns, descoped to a later iteration (cheap to add).

## Claude's Discretion

- Stripe data model + webhook handling + entitlement resolution.
- Route structure for `(marketing)`, `/docs`, `/admin`.
- CSV parser + column-mapping UX; sample-data contents.
- Brand-colour field set + apply-site theming cascade.
- Status-page mechanism.
- Stripe per-seat-quantity vs price-tier modelling.

## Deferred Ideas

- Super-admin impersonation + audit-logging layer (post-v1).
- Freemium / permanently-free tier.
- Annual billing + discount.
- Full per-org app re-skinning (beyond the public apply site).
- Rich status page / incident management.
