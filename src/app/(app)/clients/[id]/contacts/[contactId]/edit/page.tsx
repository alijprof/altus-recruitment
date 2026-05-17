import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { getClient } from '@/lib/db/clients'
import { getContact } from '@/lib/db/contacts'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { ContactForm } from '../../../contacts/new/contact-form'

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string; contactId: string }>
}) {
  const { id, contactId } = await params
  const supabase = await createSupabaseClient()

  const [client, contact] = await Promise.all([
    getClient(supabase, id),
    getContact(supabase, contactId),
  ])

  if (!client.ok) {
    if (client.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">Couldn&apos;t load this client. Please refresh.</div>
    )
  }
  if (!contact.ok) {
    if (contact.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">Couldn&apos;t load this contact. Please refresh.</div>
    )
  }
  // RLS already gates cross-tenant access; this defence-in-depth check catches
  // a contact that belongs to another company in the same org (e.g., a stale
  // bookmarked URL).
  if (contact.data.company_id !== id) {
    notFound()
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
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit contact</h1>
        <p className="text-muted-foreground text-sm">Update {contact.data.full_name}.</p>
      </div>
      <ContactForm
        companyId={id}
        contactId={contactId}
        defaultValues={{
          full_name: contact.data.full_name,
          role_title: contact.data.role_title ?? '',
          email: contact.data.email ?? '',
          phone: contact.data.phone ?? '',
          notes: contact.data.notes ?? '',
        }}
      />
    </div>
  )
}
