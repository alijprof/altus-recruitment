import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

import { NlQueryForm } from './_components/NlQueryForm'

// ---------------------------------------------------------------------------
// Plan 04-07 Task 2 — REPORT-01 NL reporting page.
//
// RSC wrapper: auth guard + back-link + heading/subheading. All interactivity
// is in NlQueryForm (Client Component). No chart bundle needed — results are
// tabular only, no ssr:false pitfall.
// ---------------------------------------------------------------------------

export default async function NlReportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) redirect('/sign-in')

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 sm:px-6">
      {/* Back link — mirrors buyer-value page pattern */}
      <Link
        href="/reports"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Reports
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ask a question</h1>
        <p className="text-muted-foreground text-sm">
          Ask about your desk in plain English. Powered by a curated library of validated queries.
        </p>
      </header>

      <NlQueryForm />
    </div>
  )
}
