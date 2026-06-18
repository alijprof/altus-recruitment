'use server'

import { matchNlTemplate } from '@/lib/ai/nl-template-match'
import { getProfile } from '@/lib/db/profiles'
import { NL_TEMPLATES } from '@/lib/reports/nl-templates'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// nlQueryAction — Plan 04-07 Task 1.
//
// Flow: auth → Sonnet template pick → allowlist validate → param whitelist →
// supabase.rpc (security invoker, RLS enforces tenancy) → return rows.
//
// SECURITY (Research §Pitfall 5):
//   If pick.functionName is NOT in NL_TEMPLATES we return no-matching-template
//   and NEVER call supabase.rpc with an unvalidated function name.
//   This is belt-and-braces on top of the security invoker — the nl_ RPCs are
//   already RLS-scoped, but we must not call arbitrary Postgres functions.
//
// SECURITY (Research §Pitfall extra-params):
//   Params are restricted to the keys declared in NL_TEMPLATES[fn].params —
//   any extra key Sonnet hallucinated is dropped before the RPC call.
// ---------------------------------------------------------------------------

export type NlQueryResult =
  | {
      ok: true
      question: string
      matchedTemplate: string
      rows: Record<string, unknown>[]
    }
  | { ok: false; error: 'not-signed-in' | 'profile-not-found' | 'no-matching-template' | string }

export async function nlQueryAction(question: string): Promise<NlQueryResult> {
  // 1. Auth + profile
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not-signed-in' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'profile-not-found' }
  const { organization_id: organizationId } = profileResult.data

  // Entitlement gate — NL query drives Sonnet spend; block non-entitled orgs.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  // 2. Sonnet template pick
  let pick: { functionName: string; params: Record<string, unknown> }
  try {
    pick = await matchNlTemplate({
      organizationId,
      userId: user.id,
      question,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown AI error'
    return { ok: false, error: `ai-error: ${msg}` }
  }

  // 3. SECURITY: validate function name against NL_TEMPLATES allowlist BEFORE
  //    calling supabase.rpc. Off-list returns no-matching-template.
  const template = NL_TEMPLATES[pick.functionName]
  if (!template) {
    return { ok: false, error: 'no-matching-template' }
  }

  // 4. Whitelist params to only keys declared in the template spec.
  //    Drop any extras Sonnet hallucinated.
  const declaredParamKeys = Object.keys(template.params)
  const validatedParams: Record<string, unknown> = {}
  for (const key of declaredParamKeys) {
    if (key in pick.params) {
      validatedParams[key] = pick.params[key]
    }
  }

  // 5. Call the security-invoker RPC (RLS enforces tenancy).
  const { data, error: rpcError } = await supabase.rpc(
    pick.functionName as never, // reason: RPC names are validated above; TS doesn't know the exact union
    validatedParams as never,
  )

  if (rpcError) {
    return { ok: false, error: `rpc-error: ${rpcError.message}` }
  }

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : []

  return {
    ok: true,
    question,
    matchedTemplate: template.label,
    rows,
  }
}
