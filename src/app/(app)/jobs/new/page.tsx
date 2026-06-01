import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { EmptyState } from '@/components/app/empty-state'
import { listClientOptions } from '@/lib/db/clients'
import { createClient } from '@/lib/supabase/server'

import { NewJobForm } from './job-form'

// M-8 — standalone /jobs/new. Gives jobs the same direct create entry point
// that /candidates/new and /clients/new already have. Jobs still hang off a
// client, so the form opens with a client picker; if no clients exist yet we
// route the recruiter to create one first (or record a spec call).
export default async function NewJobPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // Layout guard already redirects; belt-and-braces for direct hits.
    redirect('/sign-in')
  }

  const clients = await listClientOptions(supabase)
  const clientOptions = clients.ok ? clients.data : []

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href="/jobs"
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Jobs
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create job</h1>
        <p className="text-muted-foreground text-sm">
          Pick the client and set the basics — you can refine details after it&apos;s
          created. Prefer to dictate the brief? Record a spec call and we&apos;ll draft
          the JD for you.
        </p>
      </div>

      {clientOptions.length === 0 ? (
        <EmptyState
          heading="Add a client first"
          body="Jobs are created against a client. Add your first client, then come back to create a job — or record a spec call to capture both at once."
          cta={{ href: '/clients/new', label: 'Add a client' }}
          secondaryCta={{ href: '/spec/new', label: 'Record a spec call' }}
        />
      ) : (
        <NewJobForm clients={clientOptions} />
      )}
    </div>
  )
}
