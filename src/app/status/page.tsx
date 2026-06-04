// force-dynamic so the DB probe runs on every request (not cached at build).
// This is intentional: the whole point of /status is a live health check.
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { CheckCircle, AlertTriangle } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'

// T-05-04-01: The DB probe is a count on a public/non-sensitive table.
// It exposes only up/down — no tenant data, no row contents.
// The anon key is used (RLS is active), so even a compromised probe
// cannot read protected rows.

type ComponentStatus = 'operational' | 'degraded'

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    const supabase = await createClient()
    // Lightweight reachability probe — count on a small public-schema table.
    // We use organizations because it always exists and is extremely small.
    // RLS allows anon to see 0 rows; the important thing is the query succeeds.
    const { error } = await supabase.from('organizations').select('id', { count: 'exact', head: true })
    if (error) return 'degraded'
    return 'operational'
  } catch {
    return 'degraded'
  }
}

// App is always "operational" if this page renders (proves the Next.js
// app itself is reachable). Only the DB probe can return degraded.

export const metadata = {
  title: 'Status — Altus',
  description: 'Current operational status for Altus.',
}

export default async function StatusPage() {
  const dbStatus = await checkDatabase()
  const appStatus: ComponentStatus = 'operational'
  const allOperational = dbStatus === 'operational'
  const checkedAt = new Date().toUTCString()

  return (
    <div className="flex min-h-svh flex-col bg-white">
      {/* Header */}
      <header className="border-border/60 border-b">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/welcome"
            className="text-xl font-bold"
            style={{ color: '#0A3D5C' }}
            aria-label="Altus — home"
          >
            Altus
          </Link>
          <span className="text-muted-foreground text-sm">Status</span>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:px-6">
        {/* Overall headline */}
        <div className="mb-10 text-center">
          {allOperational ? (
            <>
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-green-50">
                <CheckCircle className="size-7 text-green-600" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-semibold" style={{ color: '#0A3D5C' }}>
                All systems operational
              </h1>
              <p className="text-muted-foreground mt-2 text-sm">
                Altus is running normally.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-amber-50">
                <AlertTriangle className="size-7 text-amber-500" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-semibold text-amber-700">
                Degraded performance
              </h1>
              <p className="text-muted-foreground mt-2 text-sm">
                One or more components are experiencing issues. We are investigating.
              </p>
            </>
          )}
        </div>

        {/* Component status table */}
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm" aria-label="Component status">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="px-4 py-3 text-left font-semibold" style={{ color: '#0A3D5C' }}>
                  Component
                </th>
                <th className="px-4 py-3 text-right font-semibold" style={{ color: '#0A3D5C' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <StatusRow label="App" status={appStatus} />
              <StatusRow label="Database" status={dbStatus} />
            </tbody>
          </table>
        </div>

        {/* Timestamp */}
        <p className="text-muted-foreground mt-6 text-center text-xs">
          Last checked: <time dateTime={checkedAt}>{checkedAt}</time>
        </p>

        {/* Uptime history note */}
        <p className="text-muted-foreground mt-2 text-center text-xs">
          Historical uptime metrics are not yet available.{' '}
          {/* PLACEHOLDER — link to an uptime history page or external monitor when available */}
        </p>
      </main>

      {/* Footer */}
      <footer className="border-border/60 border-t py-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 text-xs sm:px-6">
          <span className="text-muted-foreground">
            &copy; {new Date().getFullYear()} Altus
          </span>
          <div className="text-muted-foreground flex gap-4">
            <Link href="/welcome" className="hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/docs" className="hover:text-foreground transition-colors">
              Docs
            </Link>
            <Link href="/pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── StatusRow helper ──────────────────────────────────────────────────────────

function StatusRow({
  label,
  status,
}: {
  label: string
  status: ComponentStatus
}) {
  const isOperational = status === 'operational'
  return (
    <tr>
      <td className="px-4 py-4 font-medium">{label}</td>
      <td className="px-4 py-4 text-right">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            isOperational
              ? 'bg-green-50 text-green-700'
              : 'bg-amber-50 text-amber-700'
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${isOperational ? 'bg-green-500' : 'bg-amber-500'}`}
            aria-hidden="true"
          />
          {isOperational ? 'Operational' : 'Degraded'}
        </span>
      </td>
    </tr>
  )
}
