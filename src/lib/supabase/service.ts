import 'server-only'

import { createClient } from '@supabase/supabase-js'

import { env } from '@/lib/env'
import type { Database } from '@/types/database'

// Service-role client. Bypasses RLS — use ONLY in trusted server contexts:
//   - Inngest functions (no Supabase session available)
//   - Admin server actions invoked after explicit role checks
//
// Never import this from a Client Component. The `import 'server-only'` line
// makes any such import a compile error.
export function createServiceClient() {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
