import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import type { DbResult } from './types'

export async function getProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DbResult<Pick<Tables<'users'>, 'full_name' | 'email' | 'organization_id'>>> {
  const { data, error } = await supabase
    .from('users')
    .select('full_name, email, organization_id')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    // TODO: Sentry.captureException(error, { tags: { layer: 'db', helper: 'getProfile' } }) — added in Task 0.5
    console.error('[db/profiles.getProfile]', error)
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}
