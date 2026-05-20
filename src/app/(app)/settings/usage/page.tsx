import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getProfile } from '@/lib/db/profiles'
import { env } from '@/lib/env'
import { formatPence } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Plan 2 Task 2.3 — /settings/usage.
//
// Read-only RSC dashboard surfacing per-org AI spend. Reads `ai_usage`
// rows for the current calendar month (UTC) via RLS — naturally tenant-
// scoped, no service-role needed.
//
// Sections:
//   1. Headline number — month-to-date total spend (pence → £)
//   2. Per-purpose breakdown table
//   3. Match-spend ceiling indicator (Progress bar vs
//      env.MAX_MONTHLY_MATCH_SPEND_PENCE)
//   4. Top 10 most-expensive calls this month
//
// Visibility: all org members for Phase 2 (Phase 5 SaaS billing will
// gate by role).
// ---------------------------------------------------------------------------

type AiUsageRow = {
  id: string
  organization_id: string
  user_id: string | null
  model: string
  purpose: string
  input_tokens: number | null
  output_tokens: number | null
  cost_pence: number | null
  latency_ms: number | null
  created_at: string
}

export default async function UsagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/sign-in')
  }
  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) {
    redirect('/sign-in')
  }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()

  // reason: ai_usage columns include `purpose` and `cost_pence` from the
  // Phase 1 schema; generated Database type has them but TS sees the cast
  // through PostgREST as the raw row shape. RLS scopes naturally.
  const usageClient = supabase as unknown as {
    from: (table: 'ai_usage') => {
      select: (cols: string) => {
        gte: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{
            data: AiUsageRow[] | null
            error: unknown
          }>
        }
      }
    }
  }

  const { data: rowsRaw } = await usageClient
    .from('ai_usage')
    .select(
      'id, organization_id, user_id, model, purpose, input_tokens, output_tokens, cost_pence, latency_ms, created_at',
    )
    .gte('created_at', monthStart)
    .order('created_at', { ascending: false })
  const rows: AiUsageRow[] = rowsRaw ?? []

  const totalPence = rows.reduce((acc, r) => acc + (r.cost_pence ?? 0), 0)

  const byPurpose = new Map<string, { count: number; pence: number }>()
  for (const r of rows) {
    const entry = byPurpose.get(r.purpose) ?? { count: 0, pence: 0 }
    entry.count += 1
    entry.pence += r.cost_pence ?? 0
    byPurpose.set(r.purpose, entry)
  }
  const purposeBreakdown = Array.from(byPurpose.entries())
    .map(([purpose, v]) => ({ purpose, ...v }))
    .sort((a, b) => b.pence - a.pence)

  const matchSpendPence = byPurpose.get('match_score')?.pence ?? 0
  const ceilingPence = env.MAX_MONTHLY_MATCH_SPEND_PENCE
  const matchPctOfCeiling = Math.min(
    100,
    Math.round((matchSpendPence / ceilingPence) * 100),
  )

  const topExpensive = [...rows]
    .sort((a, b) => (b.cost_pence ?? 0) - (a.cost_pence ?? 0))
    .slice(0, 10)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Back to settings
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-muted-foreground text-sm font-normal">
          AI spend for this calendar month. Updated in real time.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">This month</CardTitle>
          <CardDescription>
            Total spent across all AI features ({rows.length} calls)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {formatPence(totalPence)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Match-scoring ceiling
          </CardTitle>
          <CardDescription>
            Sonnet match-scoring stops automatically when the org crosses this
            month-to-date spend cap. Recruiters retain the vector-only fallback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm tabular-nums">
            <span>
              {formatPence(matchSpendPence)} of {formatPence(ceilingPence)}
            </span>
            <span className="text-muted-foreground">{matchPctOfCeiling}%</span>
          </div>
          <Progress value={matchPctOfCeiling} aria-label="match-scoring spend" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">By purpose</CardTitle>
          <CardDescription>Spend per AI feature this month.</CardDescription>
        </CardHeader>
        <CardContent>
          {purposeBreakdown.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No AI usage recorded yet this month.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purposeBreakdown.map((row) => (
                  <TableRow key={row.purpose}>
                    <TableCell className="font-medium">{row.purpose}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPence(row.pence)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Top 10 most expensive calls
          </CardTitle>
          <CardDescription>
            High-cost calls help diagnose runaway prompts or oversized inputs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topExpensive.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No AI usage recorded yet this month.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topExpensive.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(row.created_at).toLocaleString('en-GB')}
                    </TableCell>
                    <TableCell>{row.purpose}</TableCell>
                    <TableCell className="text-xs">{row.model}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.latency_ms ?? 0}ms
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPence(row.cost_pence ?? 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
