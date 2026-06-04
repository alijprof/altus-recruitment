import * as Sentry from '@sentry/nextjs'
import { Sparkles } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { embed } from '@/lib/ai/voyage'
import { listCandidates } from '@/lib/db/candidates'
import {
  countCandidatesWithoutEmbedding,
  hybridSearchCandidates,
} from '@/lib/db/embeddings'
import { createClient } from '@/lib/supabase/server'

import { SearchInput } from './search-input'
import { SearchResults, TrigramResults, type TrigramSearchResultsProps } from './search-results'

// Plan 1 Task 1.2 — /search RSC page. Vertical-slice of ROADMAP success #1:
// recruiter types natural language → embed query via Voyage → RRF hybrid
// search → ranked candidates with score badges.
//
// Mode toggle (URL ?mode=semantic|trigram, default semantic). The search
// box's placeholder text is the verbatim example from CONTEXT.md — the
// whole point of this page is showing what natural language unlocks.

const RESULT_LIMIT = 50
const MIN_QUERY_CHARS = 2
const MIN_COSINE = 0.3

type SearchSearchParams = {
  q?: string
  mode?: string
}

function parseMode(raw: string | undefined): 'semantic' | 'trigram' {
  if (raw === 'trigram') return 'trigram'
  return 'semantic'
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchSearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const q = params.q?.trim() ?? ''
  const mode = parseMode(params.mode)

  // Cheap unembedded-count query — informs the nudge below the input.
  const unembeddedResult = await countCandidatesWithoutEmbedding(supabase)
  const unembeddedCount = unembeddedResult.ok ? unembeddedResult.data : 0

  // -----------------------------------------------------------------------
  // Empty / too-short query state.
  // -----------------------------------------------------------------------
  if (q.length === 0) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          <p className="text-muted-foreground text-sm font-normal">
            Search candidates by skill, role, location, sector — natural
            language works.
          </p>
        </header>
        <SearchInput initialQuery="" initialMode={mode} />
        {unembeddedCount > 0 ? <UnembeddedNudge count={unembeddedCount} /> : null}
        <div className="bg-muted/30 rounded-md border border-dashed p-12 text-center">
          <Sparkles className="text-muted-foreground mx-auto mb-3 size-6" />
          <p className="text-sm font-medium">Try a natural-language search</p>
          <p className="text-muted-foreground mt-1 text-xs">
            e.g. &ldquo;senior Python developer with offshore wind experience
            in Aberdeen&rdquo;
          </p>
        </div>
      </div>
    )
  }

  if (q.length < MIN_QUERY_CHARS) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        </header>
        <SearchInput initialQuery={q} initialMode={mode} />
        <p className="text-muted-foreground text-sm">
          Enter at least {MIN_QUERY_CHARS} characters.
        </p>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Trigram mode — preserve the Phase 1 RPC-based path. Score badges
  // intentionally absent; trigram ranks by similarity-desc with no
  // numerical surface that's meaningful to a recruiter.
  // -----------------------------------------------------------------------
  if (mode === 'trigram') {
    const list = await listCandidates(supabase, {
      q,
      sort: 'created_at',
      dir: 'desc',
      offset: 0,
      limit: RESULT_LIMIT,
      mode: 'trigram',
    })
    const rows = list.ok
      ? list.data.rows.map((r) => ({
          id: r.id,
          full_name: r.full_name,
          current_role_title: r.current_role_title,
          current_company: r.current_company,
          location: r.location,
          market_status: r.market_status,
        }))
      : []
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        </header>
        <SearchInput initialQuery={q} initialMode={mode} />
        {unembeddedCount > 0 ? <UnembeddedNudge count={unembeddedCount} /> : null}
        <TrigramResults rows={rows} />
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Semantic mode — embed the query inline + hybrid RPC. The wrapper logs
  // cost to ai_usage automatically. We need the org id for the
  // ai_usage row attribution — read via current_organization_id() RPC
  // (declared SECURITY DEFINER so RLS doesn't recurse).
  // -----------------------------------------------------------------------
  let rows: Awaited<ReturnType<typeof hybridSearchCandidates>> | null = null
  try {
    const orgRpc = await supabase.rpc('current_organization_id')
    const organizationId = typeof orgRpc.data === 'string' ? orgRpc.data : null
    if (!organizationId) {
      throw new Error('no organization id in session')
    }
    const userResult = await supabase.auth.getUser()
    const userId = userResult.data.user?.id ?? null

    const { vectors } = await embed({
      organizationId,
      userId,
      purpose: 'search_query_embed',
      inputType: 'query',
      inputs: [q],
    })
    const queryEmbedding = vectors[0] ?? []
    if (queryEmbedding.length === 0) {
      throw new Error('voyage embed returned no vector')
    }

    rows = await hybridSearchCandidates(supabase, {
      queryText: q,
      queryEmbedding,
      organizationId,
      matchCount: RESULT_LIMIT,
      minCosineSimilarity: MIN_COSINE,
    })
  } catch (err) {
    // The Voyage embed (or the hybrid RPC) threw — most often a transient
    // Voyage rate-limit. Log it so it's visible in runtime logs, then fall
    // back to keyword results below instead of dead-ending the recruiter.
    console.error('semantic search failed; falling back to keyword:', err)
    Sentry.captureException(err, {
      tags: { layer: 'page', helper: 'SearchPage', branch: 'semantic-embed' },
    })
  }

  // Fail soft: if semantic ranking didn't come back, run the keyword (trigram)
  // path so the recruiter still sees candidates instead of a red dead-end.
  let fallbackRows: TrigramSearchResultsProps['rows'] = []
  if (!rows?.ok) {
    const list = await listCandidates(supabase, {
      q,
      sort: 'created_at',
      dir: 'desc',
      offset: 0,
      limit: RESULT_LIMIT,
      mode: 'trigram',
    })
    fallbackRows = list.ok
      ? list.data.rows.map((r) => ({
          id: r.id,
          full_name: r.full_name,
          current_role_title: r.current_role_title,
          current_company: r.current_company,
          location: r.location,
          market_status: r.market_status,
        }))
      : []
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      </header>
      <SearchInput initialQuery={q} initialMode={mode} />
      {unembeddedCount > 0 ? <UnembeddedNudge count={unembeddedCount} /> : null}
      {rows?.ok ? (
        <SearchResults rows={rows.data} mode="semantic" />
      ) : (
        <>
          <div className="rounded-md border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            Showing keyword results — semantic ranking is momentarily unavailable.
          </div>
          <TrigramResults rows={fallbackRows} />
        </>
      )}
    </div>
  )
}

function UnembeddedNudge({ count }: { count: number }) {
  return (
    <Alert>
      <AlertTitle>{count} candidates not yet indexed</AlertTitle>
      <AlertDescription>
        They may not appear in semantic results until the next embedding
        sweep (within 10 minutes).
      </AlertDescription>
    </Alert>
  )
}
