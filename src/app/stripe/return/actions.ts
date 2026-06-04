'use server'

// Server action for the Stripe return page to poll subscription status.
// Called from the client component to check if the webhook has synced the
// subscription row yet (Pitfall 1: webhook race after checkout).

import { redirect } from 'next/navigation'

import { getSubscriptionForOrg } from '@/lib/db/subscriptions'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

// Returns the subscription status string ('trialing', 'active', etc.)
// or 'none' if no subscription row exists yet, or null on error.
export async function checkSubscriptionStatus(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) return null

  const subscriptionResult = await getSubscriptionForOrg(supabase, profile.data.organization_id)
  if (!subscriptionResult.ok) {
    return 'none'
  }

  return subscriptionResult.data.status
}
