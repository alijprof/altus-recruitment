'use server'

import type { ApplyFormInput } from './schema'

// Plan 3 Task 3.1 — placeholder shells. Task 3.2 lands the trust-boundary
// implementation (Turnstile verify, rate limit, honeypot, blocklist,
// signed-URL minting, audit, Inngest dispatch). This stub exists so the
// client form compiles in Task 3.1; calling either action before Task 3.2
// returns a formError so dev testing surfaces the gap clearly.
//
// CRITICAL — when Task 3.2 lands, the security comment cluster moves to
// the top of THIS file. See PLAN 3 task 3.2 step 4.

export type FileMeta = { name: string; size: number; type: string }

export type SubmitApplyResult =
  | {
      ok: true
      signedUrl: string
      candidateCvId: string
      candidateId: string
      organizationId: string
    }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

export type ConfirmApplyResult =
  | { ok: true; redirectTo: string }
  | { ok: false; formError: string }

export async function submitApplyAction(
  _input: ApplyFormInput,
  _fileMeta: FileMeta,
  _slug: string,
): Promise<SubmitApplyResult> {
  return {
    ok: false,
    formError:
      'Apply submission is not yet wired (Plan 3 Task 3.2 will land it).',
  }
}

export async function confirmApplyAction(_args: {
  candidateId: string
  candidateCvId: string
  organizationId: string
  orgSlug: string
}): Promise<ConfirmApplyResult> {
  return {
    ok: false,
    formError:
      'Apply confirmation is not yet wired (Plan 3 Task 3.2 will land it).',
  }
}
