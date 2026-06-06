import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { countCandidatesWithoutEmbedding } from '@/lib/db/embeddings'
import { getOutlookCredentials } from '@/lib/db/outlook-credentials'
import { env } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/types/database'

import {
  ConnectOutlookCard,
  type OutlookCardStatus,
} from './connect-outlook-card'
import { BackfillButton, BuildIndexButton } from './integration-buttons'

// Plan 1 Task 1.3 — /settings/integrations.
//
// MVP shell — Plan 4 layers Outlook Connect UI on top. For now:
//   * "Backfill embeddings" section — surfaces the count of unembedded
//     candidates and a button to fire `embed/backfill-org`.
//   * "HNSW index" section — reads hnsw_build_state for both tables;
//     when row count ≥ 100 AND built_at is null, surface "Build" button.
//
// The (app)/layout.tsx auth guard protects this page. Org-scoped RLS
// gates the count query; the hnsw_build_state lookup uses the service
// client (table is not under RLS — it's ops state, not tenant data).

const HNSW_MIN_ROWS = 100

type HnswStateRow = {
  table_name: 'candidates' | 'jobs'
  built_at: string | null
  last_attempt_at: string | null
  last_error: string | null
}

async function readHnswState(): Promise<HnswStateRow[]> {
  const supabase = createServiceClient()
  // reason: hnsw_build_state isn't yet in generated Database type.
  const untyped = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => Promise<{
        data: HnswStateRow[] | null
        error: unknown
      }>
    }
  }
  const { data } = await untyped
    .from('hnsw_build_state')
    .select('table_name, built_at, last_attempt_at, last_error')
  return data ?? []
}

async function countEmbeddedRows(
  // RLS-scoped server client — counts only THIS org's rows. Using the
  // service-role client here would bypass RLS and leak a platform-wide
  // count to every tenant (cross-tenant aggregate disclosure, RLS-01).
  supabase: SupabaseClient<Database>,
  table: 'candidates' | 'jobs',
): Promise<number> {
  const embeddingColumn =
    table === 'candidates' ? 'candidate_embedding' : 'job_embedding'
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .not(embeddingColumn, 'is', null)
  return count ?? 0
}

export default async function IntegrationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const unembeddedResult = await countCandidatesWithoutEmbedding(supabase)
  const unembeddedCount = unembeddedResult.ok ? unembeddedResult.data : 0

  const [hnswStates, candidatesEmbedded, jobsEmbedded, outlookResult] =
    await Promise.all([
      readHnswState(),
      countEmbeddedRows(supabase, 'candidates'),
      countEmbeddedRows(supabase, 'jobs'),
      getOutlookCredentials(supabase, user.id),
    ])

  const hnswByTable = new Map<'candidates' | 'jobs', HnswStateRow>()
  for (const row of hnswStates) {
    hnswByTable.set(row.table_name, row)
  }

  // Outlook card props — derived purely from the row state. Status:
  // disconnected (no row) | revoked (revoked_at set) | connected.
  const outlookRow = outlookResult.ok ? outlookResult.data : null
  let outlookStatus: OutlookCardStatus = 'disconnected'
  if (outlookRow) {
    outlookStatus = outlookRow.revoked_at ? 'revoked' : 'connected'
  }
  const adminConsentUrl =
    env.OUTLOOK_TENANT_ID && env.OUTLOOK_CLIENT_ID
      ? `https://login.microsoftonline.com/${env.OUTLOOK_TENANT_ID}/adminconsent?client_id=${env.OUTLOOK_CLIENT_ID}`
      : null

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-muted-foreground text-sm font-normal">
          Search index status, backfills, and external connections.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Backfill embeddings
          </CardTitle>
          <CardDescription>
            Embed every candidate that doesn&apos;t yet have a vector. Runs
            in the background via Inngest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unembeddedCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                {unembeddedCount}{' '}
                {unembeddedCount === 1 ? 'candidate' : 'candidates'} not yet
                embedded.
              </p>
              <BackfillButton count={unembeddedCount} />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              All candidates have embeddings.
            </p>
          )}
        </CardContent>
      </Card>

      <Separator />

      <ConnectOutlookCard
        status={outlookStatus}
        microsoftEmail={outlookRow?.microsoft_email ?? null}
        connectedAt={outlookRow?.created_at ?? null}
        adminConsentUrl={adminConsentUrl}
      />

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            HNSW vector index
          </CardTitle>
          <CardDescription>
            pgvector HNSW indexes accelerate semantic search at scale. We
            ship the build trigger here; the actual{' '}
            <code className="text-xs">CREATE INDEX CONCURRENTLY</code> step
            runs once manually per table — see{' '}
            <code className="text-xs">docs/hnsw-build-runbook.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <HnswTableRow
            table="candidates"
            rowCount={candidatesEmbedded}
            state={hnswByTable.get('candidates')}
          />
          <HnswTableRow
            table="jobs"
            rowCount={jobsEmbedded}
            state={hnswByTable.get('jobs')}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function HnswTableRow({
  table,
  rowCount,
  state,
}: {
  table: 'candidates' | 'jobs'
  rowCount: number
  state: HnswStateRow | undefined
}) {
  const built = Boolean(state?.built_at)
  const eligible = rowCount >= HNSW_MIN_ROWS && !built
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div>
        <p className="text-sm font-medium capitalize">{table}</p>
        <p className="text-muted-foreground text-xs">
          {rowCount} embedded ·{' '}
          {built ? (
            <>
              Built{' '}
              {state?.built_at
                ? new Date(state.built_at).toLocaleDateString()
                : ''}{' '}
              ✓
            </>
          ) : eligible ? (
            'Ready to build'
          ) : (
            <>Needs ≥ {HNSW_MIN_ROWS} rows ({HNSW_MIN_ROWS - rowCount} to go)</>
          )}
        </p>
        {state?.last_error ? (
          <p className="text-destructive mt-1 text-xs">
            Last attempt: {state.last_error}
          </p>
        ) : null}
      </div>
      {eligible ? <BuildIndexButton table={table} /> : null}
    </div>
  )
}
