import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { getCandidate } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'

import { CandidateEditForm } from './candidate-edit-form'
import { SENIORITY_LEVEL_VALUES, type EditCandidateInput } from './schema'

// Permissive parsers for the jsonb work_experience/education columns —
// mirrors candidates/[id]/page.tsx's parseWorkExperience/parseEducation
// (same defensive shape: a malformed historical row is dropped rather than
// crashing the page), but defaults missing sub-fields to '' instead of null.
// RepeatingRows binds every field to a controlled <Input value=... />, which
// cannot take null/undefined, so '' is the right default here specifically
// (the display page's FieldRow, by contrast, wants null so it can render
// its own '—' placeholder).
type EditableWorkExperienceRow = { title: string; company: string; dates: string }
type EditableEducationRow = { school: string; degree: string; dates: string }

function parseWorkExperienceRows(raw: unknown): EditableWorkExperienceRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): EditableWorkExperienceRow | null => {
      if (!r || typeof r !== 'object') return null
      const obj = r as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title : ''
      if (!title) return null
      return {
        title,
        company: typeof obj.company === 'string' ? obj.company : '',
        dates: typeof obj.dates === 'string' ? obj.dates : '',
      }
    })
    .filter((e): e is EditableWorkExperienceRow => e !== null)
}

function parseEducationRows(raw: unknown): EditableEducationRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): EditableEducationRow | null => {
      if (!r || typeof r !== 'object') return null
      const obj = r as Record<string, unknown>
      const school = typeof obj.school === 'string' ? obj.school : ''
      if (!school) return null
      return {
        school,
        degree: typeof obj.degree === 'string' ? obj.degree : '',
        dates: typeof obj.dates === 'string' ? obj.dates : '',
      }
    })
    .filter((e): e is EditableEducationRow => e !== null)
}

// candidates.seniority_level is plain `text` (schema.ts:31-36), so a
// historical/off-vocabulary value must not be handed straight to the
// closed-enum Select — that would either crash or silently mismatch. Falls
// back to '' ("Not set") for anything outside the known vocabulary, same
// defensive-parse spirit as the jsonb rows above.
function toSeniorityLevelValue(raw: string | null): EditCandidateInput['seniority_level'] {
  if (raw && (SENIORITY_LEVEL_VALUES as readonly string[]).includes(raw)) {
    return raw as EditCandidateInput['seniority_level']
  }
  return ''
}

export default async function EditCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // Note: getCandidate writes an audit-log row (D-16). Loading the edit page
  // is effectively a detail-view — the recruiter is seeing the candidate's
  // data on screen. This matches the original CAND-06 intent.
  const result = await getCandidate(supabase, id)
  if (!result.ok) {
    if (result.code === 'not_found') notFound()
    return (
      <div className="text-destructive border-destructive/40 bg-destructive/5 rounded-md border p-6 text-sm">
        Couldn&apos;t load this candidate. Please refresh.
      </div>
    )
  }
  const candidate = result.data

  const defaultValues: EditCandidateInput = {
    full_name: candidate.full_name,
    email: candidate.email ?? '',
    phone: candidate.phone ?? '',
    location: candidate.location ?? '',
    current_role_title: candidate.current_role_title ?? '',
    current_company: candidate.current_company ?? '',
    market_status: candidate.market_status,
    source: candidate.source,
    seniority_level: toSeniorityLevelValue(candidate.seniority_level),
    years_experience: candidate.years_experience != null ? String(candidate.years_experience) : '',
    salary_current_estimate:
      candidate.salary_current_estimate != null ? String(candidate.salary_current_estimate) : '',
    salary_expectation:
      candidate.salary_expectation != null ? String(candidate.salary_expectation) : '',
    headline: candidate.headline ?? '',
    about: candidate.about ?? '',
    skills: candidate.skills ?? [],
    sector_tags: candidate.sector_tags ?? [],
    work_experience: parseWorkExperienceRows(candidate.work_experience),
    education: parseEducationRows(candidate.education),
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button
          variant="link"
          asChild
          className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
        >
          <Link href={`/candidates/${id}`}>← Back to candidate</Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit candidate</h1>
        <p className="text-muted-foreground mt-1 text-sm font-normal">
          Consent details are immutable — re-capture via a new candidate record if the basis
          changes.
        </p>
      </div>
      <CandidateEditForm candidateId={id} defaultValues={defaultValues} />
    </div>
  )
}
