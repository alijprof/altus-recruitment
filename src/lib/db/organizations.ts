import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import type { DbResult } from './types'

export async function getOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<DbResult<Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'>>> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', organizationId)
    .maybeSingle()

  if (error) {
    // TODO: Sentry.captureException(error, { tags: { layer: 'db', helper: 'getOrganization' } }) — added in Task 0.5
    console.error('[db/organizations.getOrganization]', error)
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}
