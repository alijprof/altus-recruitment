/**
 * Plan 03-01 Task A.1 — shared Zod schema for the ingest payload.
 *
 * The extension cannot import `@/lib/validation/linkedin-ingest-schema` from
 * the main app (chrome-extension/ lives outside src/), so this file is the
 * extension-side mirror. The route handler (Task A.2) ships an identical
 * server-side schema in `src/lib/validation/linkedin-ingest-schema.ts`; if
 * one diverges, the server-side one is authoritative. Keep these two files
 * in lock-step on the captured-field list per D3-03.
 *
 * Field caps mirror the server-side schema:
 *   - name        ≤ 200
 *   - headline    ≤ 300
 *   - location    ≤ 200
 *   - about       ≤ 5_000
 *   - work_experience.length ≤ 30; per-entry title ≤ 300, company ≤ 200
 *   - education.length ≤ 15; per-entry school ≤ 200, degree ≤ 200
 *   - skills.length ≤ 100; per-skill ≤ 100
 *   - linkedin_url ≤ 500 + URL format
 */

import { z } from 'zod'

export const WorkExperienceSchema = z.object({
  title: z.string().min(1).max(300),
  company: z.string().max(200).nullable(),
  dates: z.string().max(100).nullable(),
})

export const EducationSchema = z.object({
  school: z.string().min(1).max(200),
  degree: z.string().max(200).nullable(),
  dates: z.string().max(100).nullable(),
})

export const ScrapedProfilePayloadSchema = z.object({
  // Required: at minimum we need a name to upsert anything useful.
  name: z.string().min(1).max(200),
  headline: z.string().max(300).nullable(),
  current_role: z.string().max(300).nullable(),
  current_company: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  about: z.string().max(5_000).nullable(),
  work_experience: z.array(WorkExperienceSchema).max(30),
  education: z.array(EducationSchema).max(15),
  skills: z.array(z.string().min(1).max(100)).max(100),
  linkedin_url: z.string().url().max(500),
  // 0..1 — the extension's own confidence read; the server uses it for
  // telemetry but doesn't gate on it (low-confidence captures still land).
  capture_confidence: z.number().min(0).max(1),
})

export type ScrapedProfilePayload = z.infer<typeof ScrapedProfilePayloadSchema>
