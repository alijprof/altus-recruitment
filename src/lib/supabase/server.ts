import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import { env } from '@/lib/env'
import type { Database } from '@/types/database'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // setAll was called from a Server Component. Safe to ignore when
            // middleware is refreshing sessions on every request.
          }
        },
      },
    },
  )
}

/**
 * Token-scoped client for bearer-authenticated route handlers (e.g. the
 * LinkedIn capture extension, which sends `Authorization: Bearer <token>`
 * instead of Supabase cookies). PostgREST runs as that user, so RLS enforces
 * tenancy. No cookies are read or written — this client is scoped solely to
 * the supplied access token. Construction lives here (not inline in the route)
 * to keep all Supabase client wiring in lib/supabase and to keep route
 * handlers mockable in tests.
 */
export function createBearerClient(token: string) {
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      cookies: { getAll: () => [], setAll: () => {} },
    },
  )
}
