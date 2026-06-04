'use server'

// ---------------------------------------------------------------------------
// src/app/admin/actions.ts — Super-admin plan override server actions.
//
// SECURITY INVARIANT (defence in depth):
//   Every action calls requireSuperAdmin() FIRST, before touching createServiceClient().
//   This re-checks the gate at the action level — the layout gate is the page
//   boundary, but mutations must never rely solely on layout rendering to gate them.
//   A direct action invocation (e.g. from a crafted fetch) must be independently
//   blocked by the requireSuperAdmin() call inside the action.
//
// MUTATION DISCIPLINE:
//   - Mutations return a discriminated result (not fire-and-forget).
//   - Callers must display success/error via toast (sonner) — no silent success.
//   - revalidatePath('/admin') + revalidatePath(`/admin/${orgId}`) after writes.
//
// D-14 NOTE: No impersonation, no audit log in v1 — explicitly descoped.
//   updated_by is recorded on the plan_overrides row for traceability.
// ---------------------------------------------------------------------------

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { requireSuperAdmin } from '@/lib/admin/guard'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Shared action result type.
// ---------------------------------------------------------------------------
export type AdminActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// PlanOverrideRow cast boundary (pre-push plan_overrides table).
// reason: plan_overrides is added by 20260604130000_phase5_admin_overrides.sql
// which has NOT been pushed yet (Task 5.3 [BLOCKING] Wave 2 push). The cast
// boundary pattern matches src/lib/db/organizations.ts.
// ---------------------------------------------------------------------------
type PlanOverridesWriteClient = {
  from: (table: 'plan_overrides') => {
    upsert: (
      payload: {
        organization_id: string
        trial_end_override?: string | null
        cap_multiplier?: number | null
        note?: string | null
        updated_by: string
        updated_at: string
      },
      opts: { onConflict: string },
    ) => {
      select: (cols: string) => Promise<{ data: unknown; error: unknown }>
    }
    delete: () => {
      eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>
    }
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: {
            trial_end_override: string | null
            cap_multiplier: number | null
          } | null
          error: unknown
        }>
      }
    }
  }
}

// ---------------------------------------------------------------------------
// extendTrialAction — set/update trial_end_override for an org.
//
// Input: orgId (uuid), newTrialEnd (ISO datetime string)
// Effect: upserts plan_overrides row with trial_end_override = newTrialEnd
//
// GATE: requireSuperAdmin() → only then createServiceClient()
// ---------------------------------------------------------------------------

const extendTrialSchema = z.object({
  orgId: z.string().uuid(),
  newTrialEnd: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: 'Trial end must be in the future.',
    }),
})

export async function extendTrialAction(
  orgId: string,
  newTrialEnd: string,
): Promise<AdminActionResult> {
  // GATE — must be first; service-role client only created after this passes.
  const admin = await requireSuperAdmin()

  const parsed = extendTrialSchema.safeParse({ orgId, newTrialEnd })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input: ' + parsed.error.message }
  }

  const serviceClient = createServiceClient()
  const writeClient = serviceClient as unknown as PlanOverridesWriteClient

  try {
    const { error } = await writeClient
      .from('plan_overrides')
      .upsert(
        {
          organization_id: orgId,
          trial_end_override: newTrialEnd,
          updated_by: admin.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      )
      .select('organization_id, trial_end_override')

    if (error) {
      Sentry.captureException(error, {
        tags: { layer: 'admin', action: 'extendTrialAction', org_id: orgId },
      })
      return { ok: false, error: 'Database write failed. Check Sentry for details.' }
    }
  } catch (err) {
    // Catches the case where plan_overrides table does not exist yet (pre-push).
    Sentry.captureException(err, {
      tags: { layer: 'admin', action: 'extendTrialAction', org_id: orgId },
    })
    return {
      ok: false,
      error:
        'Could not write override — migration may not be pushed yet. Push 20260604130000_phase5_admin_overrides.sql first.',
    }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/${orgId}`)

  return { ok: true, message: `Trial extended to ${new Date(newTrialEnd).toLocaleDateString('en-GB')}` }
}

// ---------------------------------------------------------------------------
// setCapOverrideAction — set/clear the cap_multiplier for an org.
//
// Input: orgId (uuid), capMultiplier (number > 0, or null to clear the override)
// Effect: upserts plan_overrides row with cap_multiplier = capMultiplier
//
// GATE: requireSuperAdmin() → only then createServiceClient()
// ---------------------------------------------------------------------------

const capOverrideSchema = z.object({
  orgId: z.string().uuid(),
  capMultiplier: z.number().positive().max(10).nullable(),
  note: z.string().max(500).optional(),
})

export async function setCapOverrideAction(
  orgId: string,
  capMultiplier: number | null,
  note?: string,
): Promise<AdminActionResult> {
  // GATE — must be first.
  const admin = await requireSuperAdmin()

  const parsed = capOverrideSchema.safeParse({ orgId, capMultiplier, note })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input: ' + parsed.error.message }
  }

  const serviceClient = createServiceClient()
  const writeClient = serviceClient as unknown as PlanOverridesWriteClient

  try {
    if (capMultiplier === null) {
      // Clearing the cap. Read the current row to decide whether anything
      // meaningful remains. If the row has no trial_end_override either, there
      // is no reason to keep an empty shell with a stale note — DELETE it so
      // queries.ts hasOverride (computed from row existence / fields) stays
      // consistent. Otherwise, upsert with cap_multiplier=null AND note=null —
      // clearing the cap also clears the note (the note describes the cap).
      const { data: current, error: readError } = await writeClient
        .from('plan_overrides')
        .select('trial_end_override, cap_multiplier')
        .eq('organization_id', orgId)
        .maybeSingle()

      if (readError) {
        Sentry.captureException(readError, {
          tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
        })
        return { ok: false, error: 'Database read failed. Check Sentry for details.' }
      }

      if (!current || current.trial_end_override === null) {
        // Nothing meaningful left — remove the row entirely.
        const { error: deleteError } = await writeClient
          .from('plan_overrides')
          .delete()
          .eq('organization_id', orgId)

        if (deleteError) {
          Sentry.captureException(deleteError, {
            tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
          })
          return { ok: false, error: 'Database write failed. Check Sentry for details.' }
        }
      } else {
        // Trial override remains — keep the row but clear cap_multiplier and note.
        const { error } = await writeClient
          .from('plan_overrides')
          .upsert(
            {
              organization_id: orgId,
              cap_multiplier: null,
              note: null,
              updated_by: admin.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'organization_id' },
          )
          .select('organization_id, cap_multiplier')

        if (error) {
          Sentry.captureException(error, {
            tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
          })
          return { ok: false, error: 'Database write failed. Check Sentry for details.' }
        }
      }
    } else {
      const { error } = await writeClient
        .from('plan_overrides')
        .upsert(
          {
            organization_id: orgId,
            cap_multiplier: capMultiplier,
            ...(note !== undefined ? { note } : {}),
            updated_by: admin.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id' },
        )
        .select('organization_id, cap_multiplier')

      if (error) {
        Sentry.captureException(error, {
          tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
        })
        return { ok: false, error: 'Database write failed. Check Sentry for details.' }
      }
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
    })
    return {
      ok: false,
      error:
        'Could not write override — migration may not be pushed yet. Push 20260604130000_phase5_admin_overrides.sql first.',
    }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/${orgId}`)

  const label =
    capMultiplier === null
      ? 'Cap override cleared (reverted to plan default)'
      : `Cap multiplier set to ${capMultiplier}× (${Math.round((capMultiplier - 1) * 100)}% above plan default)`

  return { ok: true, message: label }
}
