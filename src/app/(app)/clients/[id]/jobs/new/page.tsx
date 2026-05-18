import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { getClient } from '@/lib/db/clients'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { JobForm } from './job-form'

export default async function NewJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseClient()

  // Confirm the client exists and the user can read it (RLS gate). 404 if
  // not — covers both "wrong id" and "wrong org" cases without leaking which.
  const clientResult = await getClient(supabase, id)
  if (!clientResult.ok) {
    if (clientResult.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">
        Couldn&apos;t load this client. Please refresh.
      </div>
    )
  }
  const client = clientResult.data

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/clients/${id}?tab=jobs`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          {client.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create job</h1>
        <p className="text-muted-foreground text-sm">
          A job opens a pipeline. Once it&apos;s created you can add candidates and track them
          through stages.
        </p>
      </div>
      <JobForm companyId={id} companyName={client.name} />
    </div>
  )
}
