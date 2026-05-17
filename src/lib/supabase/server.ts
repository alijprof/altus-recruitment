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
