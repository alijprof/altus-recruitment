import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { getClient } from '@/lib/db/clients'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { ContactForm } from './contact-form'

export default async function NewContactPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseClient()
  const client = await getClient(supabase, id)
  if (!client.ok) {
    if (client.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">Couldn&apos;t load this client. Please refresh.</div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/clients/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          {client.data.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add contact</h1>
        <p className="text-muted-foreground text-sm">
          Add a person at {client.data.name} you work with on roles.
        </p>
      </div>
      <ContactForm companyId={id} />
    </div>
  )
}
