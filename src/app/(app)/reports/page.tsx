import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

// Plan 03-06 / Task F.3 — REPEAT-02.
//
// Reports hub. For Phase 3 it lists a single card (source attribution).
// Future phases will append more cards (NL reporting, candidate pipeline
// throughput, recruiter activity, etc.).

type ReportCard = {
  href: string
  title: string
  description: string
}

const REPORTS: ReportCard[] = [
  {
    href: '/reports/source-attribution',
    title: 'Source attribution',
    description:
      'Placements grouped by candidate source — counts, fee revenue, and average time-to-place per channel.',
  },
]

export default async function ReportsPage() {
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm font-normal">
          Aggregated insights across candidates, jobs, and placements.
        </p>
      </header>

      <ul className="space-y-3">
        {REPORTS.map((report) => (
          <li key={report.href}>
            <Link href={report.href} className="block">
              <Card className="hover:bg-muted/30 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      {report.title}
                    </CardTitle>
                    <CardDescription>{report.description}</CardDescription>
                  </div>
                  <ChevronRight className="text-muted-foreground size-5" />
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
