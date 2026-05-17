import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { ClientForm } from './client-form'

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/clients"
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Clients
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add client</h1>
        <p className="text-muted-foreground text-sm">
          Track a company you place candidates with. Add contacts and jobs once it&apos;s created.
        </p>
      </div>
      <ClientForm />
    </div>
  )
}
