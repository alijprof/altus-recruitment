import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { getClient } from '@/lib/db/clients'
import { createClient } from '@/lib/supabase/server'

import { EditClientForm } from './edit-client-form'

// Quick task 260604-cn5 (Item 4) — the /clients list "Edit" dropdown linked to
// /clients/[id]/edit which 404'd because no route existed. This page mirrors
// clients/new/ (fetch the row via getClient, seed the form) using the existing
// updateClientAction. RLS scopes getClient to the caller's org.

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const result = await getClient(supabase, id)
  if (!result.ok) {
    notFound()
  }
  const client = result.data

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/clients/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Back to client
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit client</h1>
        <p className="text-muted-foreground text-sm">
          Update this company&apos;s details. Contacts and jobs are managed from the client
          page.
        </p>
      </div>
      <EditClientForm
        clientId={id}
        defaults={{
          name: client.name ?? '',
          industry: client.industry ?? '',
          website: client.website ?? '',
          notes: client.notes ?? '',
        }}
      />
    </div>
  )
}
