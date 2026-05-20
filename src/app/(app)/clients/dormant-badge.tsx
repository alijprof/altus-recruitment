import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { getDormantClients } from '@/lib/db/dormant-clients'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Plan 03-05 / Task E.2 — REPEAT-01 + D3-19.
//
// Tiny Server Component rendered in the /clients page header. Counts the
// dormant clients (via the same `dormant_clients` RPC used by the dashboard
// widget) and anchors back to the dashboard so the recruiter can act.
//
// Returns null when the count is zero — no noise in the header on an org
// with nothing dormant.
// ---------------------------------------------------------------------------

export async function DormantBadge() {
  const supabase = await createClient()
  const result = await getDormantClients(supabase)
  if (!result.ok) return null
  const count = result.data.length
  if (count === 0) return null
  return (
    <Link href="/#dormant-clients" className="inline-flex" aria-label={`${count} dormant clients`}>
      <Badge variant="secondary" className="font-normal">
        {count} dormant
      </Badge>
    </Link>
  )
}
