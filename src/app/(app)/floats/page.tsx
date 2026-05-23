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
        <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
          No floats yet. From a candidate&apos;s page, click <strong>Floats</strong> to
          record a speculative submission.
        </div>
      ) : (
        <FloatsShell rows={rows} />
      )}
    </div>
  )
}
