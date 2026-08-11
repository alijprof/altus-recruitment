'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { RepeatingRows, type RepeatingRowField } from '@/components/app/repeating-rows'
import { TagInput } from '@/components/app/tag-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { updateCandidateAction } from './actions'
import {
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_SOURCE_VALUES,
  MARKET_STATUS_LABELS,
  MARKET_STATUS_VALUES,
  SENIORITY_LEVEL_LABELS,
  SENIORITY_LEVEL_VALUES,
  editCandidateSchema,
  type EditCandidateInput,
} from './schema'

export type CandidateEditFormProps = {
  candidateId: string
  defaultValues: EditCandidateInput
}

// Radix Select forbids an empty-string item value (it's reserved for "no
// selection"/placeholder), but '' IS the schema's legitimate "cleared"
// sentinel for seniority_level. This constant is the Select-only stand-in —
// translated back to '' in onValueChange, never written to the form state.
const SENIORITY_NOT_SET = '__not_set__'

const WORK_EXPERIENCE_FIELDS: readonly RepeatingRowField[] = [
  { key: 'title', label: 'Title', placeholder: 'Senior Recruitment Consultant', required: true },
  { key: 'company', label: 'Company', placeholder: 'Altus Consultancy' },
  { key: 'dates', label: 'Dates', placeholder: 'Jan 2022 – Present' },
]

const EDUCATION_FIELDS: readonly RepeatingRowField[] = [
  { key: 'school', label: 'School', placeholder: 'University of Leeds', required: true },
  { key: 'degree', label: 'Degree', placeholder: 'BSc Computer Science' },
  { key: 'dates', label: 'Dates', placeholder: '2018 – 2021' },
]

// Row values coming off the form (from defaultValues or a prior submit) can
// have optional company/degree/dates keys entirely absent (the schema's
// WorkExperienceRow/EducationRow types); RepeatingRows binds every field to
// a controlled <Input value=... /> which cannot take undefined, so this
// fills the gaps with '' for display only — onChange still emits plain
// strings, which are valid values for those optional schema keys.
function toRepeatingRowValues(
  rows: Array<Record<string, string | undefined>> | undefined,
  keys: readonly string[],
): Record<string, string>[] {
  return (rows ?? []).map((row) => Object.fromEntries(keys.map((key) => [key, row[key] ?? ''])))
}

// Mirror of CandidateForm minus the consent block. Pre-populated from server-
// fetched row (passed down by the page). On submit calls updateCandidateAction
// which redirects on success — same redirect-throws-inside-the-action pattern.
export function CandidateEditForm({ candidateId, defaultValues }: CandidateEditFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const form = useForm<EditCandidateInput>({
    resolver: zodResolver(editCandidateSchema),
    defaultValues,
  })

  // CR-01 (review 2026-08-11) — READ DURING RENDER, deliberately.
  // react-hook-form's `formState` is a Proxy that only starts tracking a key
  // once that key has been read in a RENDER pass; a key read exclusively
  // inside an event handler is never subscribed, so its value is not
  // guaranteed to be current by submit time. This destructure IS the
  // subscription — it is load-bearing, not a convenience alias. Do not
  // inline it into onSubmit.
  const { dirtyFields } = form.formState

  // CR-01 — submit ONLY the fields the recruiter actually changed.
  //
  // `defaultValues` is a snapshot page.tsx took at page load. Between that
  // read and this submit, four live writers can legitimately fill this
  // candidate's AI-parsed columns: the `parse-cv` Inngest job finishing,
  // "Accept all" in the review sheet (possibly in another tab), the
  // `reconcile-cv-parses` heal-unmerged-profiles sweep (every 15 min), and a
  // second recruiter editing the same record. Submitting the whole snapshot
  // would send `skills: []`, `work_experience: []`, `headline: ''` … for
  // every field the recruiter never touched, and the action correctly treats
  // a present-but-empty value as a deliberate CLEAR — so a one-character
  // phone correction would silently wipe the entire parsed profile (and, via
  // the invalidate_candidate_embedding trigger, blank the embedding too).
  //
  // Omitting an untouched key makes it arrive as `undefined`, which the
  // action's toNullableString/toNullableNumber helpers and the `?.map` on the
  // two jsonb arrays already treat as "leave this column alone". That
  // omitted-vs-cleared machinery has existed since 07-03; this restores the
  // only caller that can actually reach it.
  //
  // A field the recruiter deliberately CLEARED is dirty (its value differs
  // from the page-load default), so it still arrives as '' / [] and still
  // persists as a clear. That distinction is the whole point.
  const onSubmit = (data: EditCandidateInput) => {
    const patch = Object.fromEntries(Object.entries(data).filter(([key]) => key in dirtyFields))
    // full_name / market_status / source are REQUIRED by the action's zod
    // schema, so they must be present on every submit even when untouched.
    // They are also the three the form always renders as populated controls,
    // so a last-write-wins on them matches exactly what the recruiter has on
    // screen. Every other key is optional-by-omission.
    const payload = {
      ...patch,
      full_name: data.full_name,
      market_status: data.market_status,
      source: data.source,
    }

    startTransition(async () => {
      const result = await updateCandidateAction(candidateId, payload)
      if (!result) return
      if ('fieldErrors' in result) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages && messages.length > 0) {
            form.setError(field as keyof EditCandidateInput, { message: messages[0] })
          }
        }
        return
      }
      if ('formError' in result) {
        toast.error(result.formError)
        return
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Accordion type="multiple" defaultValue={['basics']} className="w-full">
          <AccordionItem value="basics">
            <AccordionTrigger>Basics</AccordionTrigger>
            <AccordionContent className="space-y-6">
              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input type="tel" autoComplete="tel" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="current_role_title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current role</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="current_company"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current company</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="market_status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Market status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MARKET_STATUS_VALUES.map((v) => (
                            <SelectItem key={v} value={v}>
                              {MARKET_STATUS_LABELS[v]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CANDIDATE_SOURCE_VALUES.map((v) => (
                            <SelectItem key={v} value={v}>
                              {CANDIDATE_SOURCE_LABELS[v]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="profile">
            <AccordionTrigger>Profile</AccordionTrigger>
            <AccordionContent className="space-y-6">
              <FormField
                control={form.control}
                name="headline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Headline</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="about"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>About</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ''} rows={6} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="experience">
            <AccordionTrigger>Experience &amp; seniority</AccordionTrigger>
            <AccordionContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="seniority_level"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Seniority</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(v === SENIORITY_NOT_SET ? '' : v)}
                        value={
                          field.value && field.value.length > 0 ? field.value : SENIORITY_NOT_SET
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={SENIORITY_NOT_SET}>Not set</SelectItem>
                          {SENIORITY_LEVEL_VALUES.map((v) => (
                            <SelectItem key={v} value={v}>
                              {SENIORITY_LEVEL_LABELS[v]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="years_experience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Years experience</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          placeholder="6"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="compensation">
            <AccordionTrigger>Compensation</AccordionTrigger>
            <AccordionContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="salary_current_estimate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current salary (est.)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          type="number"
                          inputMode="numeric"
                          placeholder="55000"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="salary_expectation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected salary</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          type="number"
                          inputMode="numeric"
                          placeholder="65000"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="skills">
            <AccordionTrigger>Skills &amp; sectors</AccordionTrigger>
            <AccordionContent className="space-y-6">
              <FormField
                control={form.control}
                name="skills"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Skills</FormLabel>
                    <FormControl>
                      <TagInput
                        value={field.value ?? []}
                        onChange={field.onChange}
                        placeholder="Add a skill and press Enter…"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sector_tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sectors</FormLabel>
                    <FormControl>
                      <TagInput
                        value={field.value ?? []}
                        onChange={field.onChange}
                        placeholder="Add a sector and press Enter…"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="work-history">
            <AccordionTrigger>Work history</AccordionTrigger>
            <AccordionContent>
              <FormField
                control={form.control}
                name="work_experience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Work history</FormLabel>
                    <FormControl>
                      <RepeatingRows
                        value={toRepeatingRowValues(field.value, ['title', 'company', 'dates'])}
                        onChange={field.onChange}
                        fields={WORK_EXPERIENCE_FIELDS}
                        addLabel="Add work history"
                        rowLabel="Work history"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="education">
            <AccordionTrigger>Education</AccordionTrigger>
            <AccordionContent>
              <FormField
                control={form.control}
                name="education"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Education</FormLabel>
                    <FormControl>
                      <RepeatingRows
                        value={toRepeatingRowValues(field.value, ['school', 'degree', 'dates'])}
                        onChange={field.onChange}
                        fields={EDUCATION_FIELDS}
                        addLabel="Add education"
                        rowLabel="Education"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/candidates/${candidateId}`)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" className="h-11 md:h-10" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
