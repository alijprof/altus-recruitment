import { EmptyState } from '@/components/app/empty-state'
import { listAllFloats } from '@/lib/db/shortlists'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { FloatsShell } from './floats-shell'

/**
 * Org-wide floats list (SHORT-02).
 *
 * Shows every floated candidate across the org. D3-29 mandates org-wide
 * visibility — anchor agency is 2-3 people; transparency wins over an
 * owner-only filter. The UI may surface a "mine only" toggle later but
 * that's a client-side filter on top of the same RPC.
 */
export default async function FloatsPage() {
  const supabase = await createSupabaseClient()
  const floatsResult = await listAllFloats(supabase)
  const rows = floatsResult.ok ? floatsResult.data : []

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Floats</h1>
        <p className="text-muted-foreground text-sm">
          Speculative candidate submissions with no job attached. Org-wide view.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          heading="No floats yet"
          body="A float is a speculative candidate submission with no specific job — 'you should meet this person'. From any candidate's page, click Floats to record one."
          cta={{ href: '/candidates', label: 'Browse candidates' }}
        />
      ) : (
        <FloatsShell rows={rows} />
      )}
    </div>
  )
}
