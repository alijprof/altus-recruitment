import { createBrowserClient } from '@supabase/ssr'

import { env } from '@/lib/env'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
}
