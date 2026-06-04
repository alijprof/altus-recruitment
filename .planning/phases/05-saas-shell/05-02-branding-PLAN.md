---
phase: 05-saas-shell
plan: 02
type: execute
wave: 1
depends_on: ["05-00"]
files_modified:
  - src/app/(app)/settings/branding/page.tsx
  - src/app/(app)/settings/branding/branding-form.tsx
  - src/app/(app)/settings/branding/actions.ts
  - src/app/(app)/settings/branding/schema.ts
  - src/lib/branding/colours.ts
  - src/app/(public)/apply/[orgSlug]/page.tsx
  - src/app/(public)/apply/[orgSlug]/apply-form.tsx
autonomous: true
requirements: [BRAND-01]

must_haves:
  truths:
    - "An owner can set a logo and two brand colours (primary + secondary) from /settings/branding"
    - "Non-hex colour input is rejected at the Server Action (and the DB CHECK constraint blocks any bypass)"
    - "The public apply/careers page renders the org's logo and brand colours"
    - "A malicious colour value (e.g. '; }<script>') cannot escape into a style/script context"
  artifacts:
    - path: "src/lib/branding/colours.ts"
      provides: "Hex validation + safeHex fallback helper, shared by Server Action and render"
      exports: ["isHexColour", "safeHex", "BRAND_DEFAULTS"]
    - path: "src/app/(app)/settings/branding/actions.ts"
      provides: "Owner-gated Server Action to persist logo_url + brand colours"
      exports: ["updateBrandingAction"]
    - path: "src/app/(public)/apply/[orgSlug]/page.tsx"
      provides: "Branded apply page injecting validated colours as CSS custom properties"
      contains: "--brand-primary"
  key_links:
    - from: "src/app/(public)/apply/[orgSlug]/page.tsx"
      to: "org.brand_primary"
      via: "safeHex → style custom property"
      pattern: "safeHex|--brand-primary"
    - from: "src/app/(app)/settings/branding/actions.ts"
      to: "updateOrganization"
      via: "validated patch with brand_primary/brand_secondary"
      pattern: "brand_primary"
---

<objective>
Per-org branding (BRAND-01): an owner sets a logo + two brand colours that render on their public apply/careers site. The single non-trivial risk is CSS-injection XSS through the colour fields — defended in depth (Zod hex regex at the Server Action + DB CHECK from 05-00 + re-validation at render + injection only as a React `style` object custom property, never into a `<style>` tag).

This is a thin vertical slice: settings form → validated Server Action → DB → branded public render. After it, an org's apply page visibly carries their brand.

Purpose: A self-serve customer can make the candidate-facing surface look like their agency, which is the point of BRAND-01.
Output: branding settings page + form + action + schema, a shared colour-validation helper, and the branded apply page render.
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
@src/app/(public)/apply/[orgSlug]/page.tsx
@src/lib/db/organizations.ts

<interfaces>
<!-- 05-00 added brand_primary/brand_secondary (and logo_url on the apply row) to the org DB helpers + the SELECT strings. This plan ONLY consumes them. -->

From src/lib/db/organizations.ts (extended in 05-00 — DONE there, not here):
  export type OrganizationRow = { id; name; slug; logo_url; apply_form_enabled; stripe_customer_id; brand_primary: string | null; brand_secondary: string | null }
  export type OrganizationApplyRow = { id; name; slug; apply_form_enabled; logo_url: string | null; brand_primary: string | null; brand_secondary: string | null }
  export type UpdateOrganizationPatch = { name?; logo_url?; apply_form_enabled?; brand_primary?: string | null; brand_secondary?: string | null }
  export async function getOrganization(supabase, orgId): Promise<DbResult<OrganizationRow>>
  // getOrganizationBySlug SELECT (set in 05-00) is: 'id, name, slug, apply_form_enabled, logo_url, brand_primary, brand_secondary'
  export async function getOrganizationBySlug(supabase, slug): Promise<DbResult<OrganizationApplyRow>>
  export async function updateOrganization(supabase, orgId, patch): Promise<DbResult<OrganizationRow>>

From src/app/(public)/apply/[orgSlug]/page.tsx (existing — service-role read, force-dynamic, anti-enumeration notFound()):
  // currently renders org.name; this plan adds logo + colour CSS custom properties

Existing settings pattern: src/app/(app)/settings/{page.tsx, organization-form.tsx, actions.ts, schema.ts} — owner-only Server Actions, zodResolver client form, toast on error (no silent success).

Brand defaults (Altus): primary '#0A3D5C' (Midnight), secondary '#5DCAA5' (Mint).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 2.1: Hex-validation helper + owner-gated branding Server Action + settings form</name>
  <read_first>
    - "src/app/(app)/settings/organization-form.tsx" + "src/app/(app)/settings/actions.ts" + "src/app/(app)/settings/schema.ts" (the exact owner-gated Server Action + zodResolver form + toast pattern to mirror)
    - src/lib/db/organizations.ts (updateOrganization + UpdateOrganizationPatch, extended in 05-00)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Pattern 5 + Pitfall 5 — hex regex, never a style tag)
  </read_first>
  <behavior>
    - isHexColour('#0A3D5C') is true; isHexColour('#fff') is false (must be 6 hex digits); isHexColour('; }<script>') is false; isHexColour('red') is false; isHexColour('#GGGGGG') is false
    - safeHex(valid, fallback) returns the valid value; safeHex(invalid|null, fallback) returns the fallback
    - updateBrandingAction rejects a non-hex colour with a fieldError (no DB write); accepts empty string as "clear colour" then stores null
  </behavior>
  <action>
    Create src/lib/branding/colours.ts (no 'use client'; importable from both server and client) exporting: BRAND_DEFAULTS = { primary: '#0A3D5C', secondary: '#5DCAA5' }; a module-private HEX_RE = /^#[0-9a-fA-F]{6}$/; isHexColour(v): v is string; safeHex(raw, fallback). This is the SINGLE source of truth for hex validation, reused by the Server Action AND the render (Task 2.2).
    Create src/app/(app)/settings/branding/schema.ts with a Zod schema: brand_primary and brand_secondary each z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal('')).optional() (empty string allowed = clear); logo_url z.string().url().or(z.literal('')).optional(). Mirror the existing settings schema conventions.
    Create src/app/(app)/settings/branding/actions.ts updateBrandingAction(rawInput) (server action): parse with the schema; createClient()+getUser(); RLS-scoped role check on users then reject non-owner BEFORE any write (mirror inviteMemberAction R8 ordering); map empty strings to null; call updateOrganization(supabase, me.organization_id, { brand_primary, brand_secondary, logo_url }). Return ActionResult (ok:true | fieldErrors | formError). revalidatePath('/settings/branding'). Never log colour values or PII to Sentry — tag-only.
    Create src/app/(app)/settings/branding/page.tsx (RSC, owner-only gate) reading getOrganization for current values, and branding-form.tsx (client, 'use client', zodResolver) with two colour inputs (an <input type="color"> plus an exact-hex text field, or a hex text input — Claude's discretion) + a logo URL field + a live preview swatch, calling updateBrandingAction with toast on success/error (no silent false-success — CLAUDE.md). Add a "Branding" entry to the settings nav next to "Billing"/"Usage".
    Add a unit test src/lib/branding/colours.test.ts covering the isHexColour/safeHex cases in the behavior block (including the injection payloads).
  </action>
  <verify>
    <automated>grep -qE "safeHex" src/lib/branding/colours.ts && grep -q "owner" "src/app/(app)/settings/branding/actions.ts" && pnpm typecheck && pnpm test -- src/lib/branding/colours.test.ts && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - behavior: isHexColour rejects 3-digit hex, named colours, and injection payloads; accepts 6-digit hex (unit-tested)
    - source: HEX_RE in colours.ts is the only place the hex pattern is authored for render; the schema mirrors it for the form
    - source: updateBrandingAction rejects non-owner BEFORE any DB write (R8 ordering)
    - behavior: submitting a non-hex colour returns a fieldError and writes nothing
    - behavior: form shows a toast on error (no silent success)
    - test-command: `pnpm typecheck && pnpm test -- src/lib/branding/colours.test.ts && pnpm lint` pass
  </acceptance_criteria>
  <done>Shared hex helper (single source of truth), owner-gated branding action with Zod + render-level validation, and a settings form with live preview. Validation unit-tested against injection payloads.</done>
</task>

<task type="auto">
  <name>Task 2.2: Render org logo + brand colours on the public apply/careers page (XSS-safe)</name>
  <read_first>
    - src/app/(public)/apply/[orgSlug]/page.tsx (the file being modified — service-role read, force-dynamic, the SECURITY NOTE about the unauthenticated read)
    - src/app/(public)/apply/[orgSlug]/apply-form.tsx (where brand colours may cascade into button styling)
    - src/lib/branding/colours.ts (safeHex + BRAND_DEFAULTS — created Task 2.1)
    - .planning/phases/05-saas-shell/05-RESEARCH.md (Pattern 5 — inject as style object custom properties, NEVER a style tag)
  </read_first>
  <action>
    In src/app/(public)/apply/[orgSlug]/page.tsx: getOrganizationBySlug ALREADY returns logo_url + brand_primary + brand_secondary — 05-00 added these three fields to OrganizationApplyRow AND extended the SELECT string to `'id, name, slug, apply_form_enabled, logo_url, brand_primary, brand_secondary'`. This task does NOT touch organizations.ts; it only consumes the row. Compute brandPrimary = safeHex(org.brand_primary, BRAND_DEFAULTS.primary) and brandSecondary = safeHex(org.brand_secondary, BRAND_DEFAULTS.secondary) — re-validate at render even though the DB CHECK + Server Action already validated (defence in depth, Pitfall 5). Wrap the page content in a div with `style={{ '--brand-primary': brandPrimary, '--brand-secondary': brandSecondary } as React.CSSProperties}`. NEVER build a <style> string. Render the org logo: if org.logo_url is present, show it (use a plain <img> or next/image as the codebase convention dictates) in the header; fall back to the org name wordmark when absent.
    In apply-form.tsx (and/or the page's CTA): style the primary button / accent using the `var(--brand-primary)` / `var(--brand-secondary)` custom properties (Tailwind arbitrary value e.g. `bg-[var(--brand-primary)]` or an inline style referencing the var). Keep contrast/readability sane with the defaults. Do NOT interpolate the raw hex into a className string in a way that defeats validation — always go through the CSS custom property set on the wrapper.
    Keep the anti-enumeration behaviour intact (unknown slug / apply_form_enabled=false still notFound()).
  </action>
  <verify>
    <automated>grep -q "safeHex" "src/app/(public)/apply/[orgSlug]/page.tsx" && grep -q -- "--brand-primary" "src/app/(public)/apply/[orgSlug]/page.tsx" && ! grep -qE "<style" "src/app/(public)/apply/[orgSlug]/page.tsx" && pnpm typecheck && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - source: apply page calls safeHex on both colours at render time (render-level re-validation)
    - source: colours injected via a React style object custom property; NO <style> tag string anywhere in the file
    - source: this task does NOT modify src/lib/db/organizations.ts — the brand/logo columns are already on OrganizationApplyRow + the SELECT (owned by 05-00)
    - behavior: an org with no brand colours renders the Altus defaults (no crash, no empty var)
    - behavior: org logo renders when logo_url set; wordmark fallback otherwise
    - behavior: unknown/disabled org still returns notFound() (anti-enumeration preserved)
    - test-command: `pnpm typecheck && pnpm lint` pass
  </acceptance_criteria>
  <done>The public apply page shows the org's logo and brand colours via validated CSS custom properties (read from the row 05-00 already widened), with defaults as fallback and the XSS vector closed at every layer.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| owner → brand colour fields | Owner-controlled input that ends up in a CSS context on a PUBLIC page |
| public visitor → apply page | Anonymous render of org-controlled brand values |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-02-01 | Tampering/XSS | brand colour → CSS context | mitigate | Hex regex at Server Action (Zod) + DB CHECK (05-00) + safeHex re-validation at render + inject only via React style-object custom property, never a `<style>` tag (Pitfall 5 / ApostropheCMS CVE) |
| T-05-02-02 | Elevation of Privilege | branding Server Action | mitigate | Owner-role check before any write (R8 ordering) |
| T-05-02-03 | Information Disclosure | apply page service-role read | accept | Pre-existing justified service-role read by slug (non-secret); SELECT widened only by name/slug/logo/colours — no PII |
| T-05-02-04 | Tampering | logo_url field | mitigate | z.string().url() validation; rendered as an image src (no script context) |
</threat_model>

<verification>
- `pnpm typecheck`, `pnpm lint`, and the colours unit test pass.
- Manual: set colours + logo in /settings/branding → visit /apply/[slug] and see them applied; submitting a non-hex value is rejected with a field error.
- Grep confirms no `<style>` tag and safeHex used at render.
</verification>

<success_criteria>
- Owner sets logo + brand colours; the public apply page renders them; the CSS-injection XSS vector is closed in depth.
</success_criteria>

<output>
Create `.planning/phases/05-saas-shell/05-02-SUMMARY.md` when done.
</output>
