import 'server-only'

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Plan 03-01 Task A.2 — server-side validation for the /api/linkedin/ingest
// POST body. Mirrors `chrome-extension/src/shared/scraped-profile-schema.ts`
// — keep the two in lockstep on field shape; server-side is authoritative.
//
// Per-field caps defend against payload-bomb attempts from a compromised
// content script. RESEARCH §"Security Domain" V5 row.
// ---------------------------------------------------------------------------

export const LinkedInWorkExperienceSchema = z.object({
  title: z.string().min(1).max(300),
  company: z.string().max(200).nullable(),
  dates: z.string().max(100).nullable(),
})

export const LinkedInEducationSchema = z.object({
  school: z.string().min(1).max(200),
  degree: z.string().max(200).nullable(),
  dates: z.string().max(100).nullable(),
})

export const LinkedInIngestSchema = z.object({
  name: z.string().min(1).max(200),
  headline: z.string().max(300).nullable(),
  current_role: z.string().max(300).nullable(),
  current_company: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  about: z.string().max(5_000).nullable(),
  work_experience: z.array(LinkedInWorkExperienceSchema).max(30),
  education: z.array(LinkedInEducationSchema).max(15),
  skills: z.array(z.string().min(1).max(100)).max(100),
  // url() is strict; min/max constrain payload size.
  linkedin_url: z.string().url().max(500),
  // Optional — extension may omit on partial scrapes; defaults to 0.
  capture_confidence: z.number().min(0).max(1).optional(),
  // Optional: extension may include an email scraped from the contact
  // section. Used for the dedupe-on-email branch. Lowercased + trimmed
  // at the boundary in upsertCandidateFromLinkedIn.
  email: z.string().email().max(320).optional().nullable(),
})

export type LinkedInIngestPayload = z.infer<typeof LinkedInIngestSchema>
