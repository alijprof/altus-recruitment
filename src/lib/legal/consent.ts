// GDPR consent versioning — bump CURRENT_CONSENT_VERSION and add a CONSENT_TEXT_V<n>
// constant whenever the privacy text shown to a user (recruiter or applicant)
// changes. The version stored on candidates.consent_text_version must be the
// version the user actually saw (UK GDPR Art. 7 demonstrable consent).
//
// All consent-touching code paths (forms, server actions) import from this
// module — never inline the constant value elsewhere.
//
// V1 (recruiter-facing, /candidates/new): short attestation by a recruiter
// adding a candidate. The recruiter asserts their lawful basis on behalf of
// the agency. Historical candidates retain `consent_text_version='v1'` — no
// migration.
//
// V2 (Plan 3 — public apply form): long-form, applicant-facing text rendered
// inline above the submit button. The applicant ticks the checkbox themselves
// — this is explicit consent under UK GDPR Art. 6(1)(a). Placeholders
// `{org_name}` and `{contact_email}` are filled server-side at render time
// (see src/app/(public)/apply/[orgSlug]/page.tsx) so the stored version
// number maps to a single immutable copy.
//
// All NEW writes (apply-form AND recruiter manual entries via /candidates/new
// once that form is bumped to v2) stamp `consent_text_version='v2'`. The
// /candidates/new form continues to render CONSENT_TEXT_V1 for now (the
// short recruiter attestation copy still applies to that form); when the
// recruiter form is updated to display v2 copy, the imports here are the
// single rename point.

export const CURRENT_CONSENT_VERSION = 'v2' as const

export const CONSENT_TEXT_V1 =
  "I confirm we have appropriate consent or legitimate-interest basis to hold this candidate's data, in line with UK GDPR."

// Plan 3 / D2-12: the long-form text shown to candidates on the public apply
// form. Replace {org_name} and {contact_email} at render time. Legal review
// pending — drafted from RESEARCH §C.15 lines 161–178.
export const CONSENT_TEXT_V2 = `By submitting this application, I consent to {org_name} processing my personal data (including my CV, contact details, and application information) for the purpose of evaluating my suitability for current and future opportunities.

I understand:
- My data will be stored securely for up to 2 years from last contact
- I can request a copy, correction, or deletion of my data at any time by emailing {contact_email}
- My data will not be shared with third parties without my further consent
- See {org_name}'s privacy policy for full details.`

export type ConsentVersion = typeof CURRENT_CONSENT_VERSION

/**
 * Replace `{org_name}` and `{contact_email}` placeholders in CONSENT_TEXT_V2.
 * Server-side render only — never persists; the candidate row stores the
 * version number, not the rendered text.
 */
export function renderConsentTextV2(args: {
  orgName: string
  contactEmail: string
}): string {
  return CONSENT_TEXT_V2.replaceAll('{org_name}', args.orgName).replaceAll(
    '{contact_email}',
    args.contactEmail,
  )
}
