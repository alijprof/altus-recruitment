// GDPR consent versioning — bump CURRENT_CONSENT_VERSION and add a CONSENT_TEXT_V<n>
// constant whenever the privacy text shown to recruiters changes. The version
// stored on candidates.consent_text_version must be the version the user
// actually saw (UK GDPR Art. 7 demonstrable consent).
//
// All consent-touching code paths (forms, server actions) import from this
// module — never inline the constant value elsewhere.

export const CURRENT_CONSENT_VERSION = 'v1' as const

export const CONSENT_TEXT_V1 =
  "I confirm we have appropriate consent or legitimate-interest basis to hold this candidate's data, in line with UK GDPR."

export type ConsentVersion = typeof CURRENT_CONSENT_VERSION
