import { createBrowserClient } from '@supabase/ssr'

import { env } from '@/lib/env'
import type { Database } from '@/types/database'

// Pass-through lock that skips navigator.locks serialisation. createBrowserClient
// defaults to navigator.locks for auth-token serialisation, which a single-account
// SPA does not need but DOES get bitten by — the "lock-stolen"/lock-hang wedge
// (e.g. verifyOtp + updateUser contending) that the reset/set-password forms
// otherwise have to paper over with timeout races. Default to noopLock per the
// cross-project Supabase browser-lock rule. (The password-auth forms keep their
// 5s timeout races as belt-and-braces.)
async function noopLock<R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  return fn()
}

export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { lock: noopLock },
    },
  )
}
