import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

import { SpecUploadForm } from './spec-upload-form'

export default async function NewSpecCallPage() {
  // Light client list for the optional picker. RLS scopes to the tenant.
  const supabase = await createClient()
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .order('name', { ascending: true })
    .limit(200)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button
          variant="link"
          asChild
          className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
        >
          <Link href="/spec">← All spec calls</Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New spec call</h1>
        <p className="text-muted-foreground mt-1 text-sm font-normal">
          Upload a recording from Voice Memos, Zoom, or your phone. We&apos;ll
          transcribe it and draft the JD for you to review.
        </p>
      </div>
      <SpecUploadForm clients={companies ?? []} />
    </div>
  )
}
