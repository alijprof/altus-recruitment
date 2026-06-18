'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createCandidate } from '@/lib/db/candidates'
import { CURRENT_CONSENT_VERSION } from '@/lib/legal/consent'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient } from '@/lib/supabase/server'

import { createCandidateSchema } from './schema'

export type CreateCandidateResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

export async function createCandidateAction(rawInput: unknown): Promise<CreateCandidateResult> {
  // Belt + braces: client validates with zodResolver; we re-validate here so a
  // direct POST that bypasses the client still respects the schema.
  const parsed = createCandidateSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createClient()
  const result = await createCandidate(supabase, {
    full_name: parsed.data.full_name,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    location: parsed.data.location ?? null,
    current_role_title: parsed.data.current_role_title ?? null,
    current_company: parsed.data.current_company ?? null,
    market_status: parsed.data.market_status,
    source: parsed.data.source,
    consent_basis: parsed.data.consent_basis,
    // consent_at is set server-side per RESEARCH §11 — never trust client time
    // because the user's clock could be off and Art. 7 demands an accurate
    // timestamp of the agreement event.
    consent_at: new Date().toISOString(),
    consent_text_version: CURRENT_CONSENT_VERSION,
  })

  if (!result.ok) {
    return { ok: false, formError: 'Something went wrong. Please try again.' }
  }

  revalidatePath('/candidates')
  // redirect() throws a special internal error — must be outside try/catch.
  redirect(`/candidates/${result.data.id}`)
}
