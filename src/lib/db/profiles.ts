import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import type { DbResult } from './types'

export async function getProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DbResult<Pick<Tables<'users'>, 'full_name' | 'email' | 'organization_id' | 'role'>>> {
  const { data, error } = await supabase
    .from('users')
    .select('full_name, email, organization_id, role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getProfile' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}

export type UpdateProfilePatch = Partial<
  Pick<Tables<'users'>, 'full_name' | 'email'>
>

// Updates the public.users row for the calling user. Note: changing the auth
// email (auth.users.email) is a Phase 2 concern — Phase 1 only updates the
// display copy in public.users.email. Document this contract inline; the
// Settings page surfaces a note to the user.
export async function updateProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  patch: UpdateProfilePatch,
): Promise<DbResult<Pick<Tables<'users'>, 'full_name' | 'email'>>> {
  const { data, error } = await supabase
    .from('users')
    .update({
      full_name: patch.full_name ?? null,
      email: patch.email,
    })
    .eq('id', userId)
    .select('full_name, email')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'updateProfile' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}
