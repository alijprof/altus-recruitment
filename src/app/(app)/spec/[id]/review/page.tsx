import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSpecDraft } from '@/lib/db/spec-drafts'
import { createClient } from '@/lib/supabase/server'

import { SpecReviewForm } from './spec-review-form'

type StructuredJd = {
  title?: string
  seniority_level?: string | null
  job_type?: string | null
  location?: string | null
  salary_range_min?: number | null
  salary_range_max?: number | null
  currency?: string | null
  must_haves?: string[]
  nice_to_haves?: string[]
  culture_notes?: string | null
  reporting_line?: string | null
  urgency?: string | null
  hiring_context?: string | null
  confidence_per_field?: Record<string, 'high' | 'medium' | 'low'>
  ambiguities?: string[]
}

export default async function SpecReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const result = await getSpecDraft(supabase, id)
  if (!result.ok) {
    if (result.code === 'not_found') notFound()
    throw new Error('Failed to load spec draft')
  }
  const draft = result.data

  // If transcription isn't done yet, bounce to the status poller.
  if (draft.status === 'pending' || draft.status === 'transcribing') {
    redirect(`/spec/${id}`)
  }

  // Companies list for the client picker. RLS scopes to the tenant.
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .order('name', { ascending: true })
    .limit(200)

  const structured = (draft.structured_data ?? {}) as StructuredJd
  const ambiguities = structured.ambiguities ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Button
            variant="link"
            asChild
            className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
          >
            <Link href="/spec">← All spec calls</Link>
          </Button>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Review draft JD</h1>
        </div>
        <Badge variant={draft.status === 'approved' ? 'secondary' : 'default'}>
          {draft.status}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Structured JD</CardTitle>
            </CardHeader>
            <CardContent>
              <SpecReviewForm
                draftId={draft.id}
                clients={companies ?? []}
                initialCompanyId={draft.company_id}
                initial={{
                  title: structured.title ?? '',
                  seniority_level: structured.seniority_level ?? null,
                  job_type: structured.job_type ?? null,
                  location: structured.location ?? null,
                  salary_range_min: structured.salary_range_min ?? null,
                  salary_range_max: structured.salary_range_max ?? null,
                  currency: structured.currency ?? null,
                  must_haves: structured.must_haves ?? [],
                  nice_to_haves: structured.nice_to_haves ?? [],
                  culture_notes: structured.culture_notes ?? null,
                  reporting_line: structured.reporting_line ?? null,
                  urgency: structured.urgency ?? null,
                  hiring_context: structured.hiring_context ?? null,
                  confidence_per_field: structured.confidence_per_field ?? {},
                }}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {ambiguities.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Verify with client</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <ul className="list-disc space-y-2 pl-5">
                  {ambiguities.map((a, idx) => (
                    <li key={idx}>{a}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/40 max-h-[500px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                {draft.transcript ?? '(no transcript captured)'}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
