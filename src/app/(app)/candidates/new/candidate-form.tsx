'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Separator } from '@/components/ui/separator'
import { CONSENT_TEXT_V1 } from '@/lib/legal/consent'

import { createCandidateAction } from './actions'
import {
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_SOURCE_VALUES,
  CONSENT_BASIS_LABELS,
  CONSENT_BASIS_VALUES,
  MARKET_STATUS_LABELS,
  MARKET_STATUS_VALUES,
  createCandidateSchema,
  type CreateCandidateInput,
} from './schema'

// RESEARCH §11 skeleton applied. Notes:
//   * Defaults pick the most conservative GDPR basis (consent, not legitimate
//     interest) per RESEARCH §12 — easier to defend under ICO guidance.
//   * Submit is disabled while pending OR while the consent box is unchecked.
//     The zod literal(true) re-checks server-side as the legal guarantee.
//   * Server-action field errors are pushed back via form.setError so they
//     render inside the same FormMessage components.
//   * Successful create redirects in the action; the client only sees a
//     thrown Next.js redirect, which we let propagate (no toast for success
//     because the next page IS the success indicator).
export function CandidateForm() {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const form = useForm<CreateCandidateInput>({
    resolver: zodResolver(createCandidateSchema),
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      location: '',
      current_role_title: '',
      current_company: '',
      market_status: 'passively_looking',
      source: 'direct_add',
      consent_basis: 'consent',
      // reason: literal(true) requires the type to be `true`, but a checkbox
      // starts unchecked. Cast through unknown so RHF accepts the seed value
      // — zod will reject `false` on submit which is exactly the behaviour
      // we want.
      consent_confirmed: false as unknown as true,
    },
  })

  // useWatch (vs form.watch) plays nicely with the React Compiler — see the
  // ESLint rule react-hooks/incompatible-library. Same value, subscribed
  // through context.
  const consentChecked = useWatch({ control: form.control, name: 'consent_confirmed' }) === true

  const onSubmit = (data: CreateCandidateInput) => {
    startTransition(async () => {
      const result = await createCandidateAction(data)
      // redirect() throws inside the action, so on success we never reach here.
      if (!result) return
      if ('fieldErrors' in result) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages && messages.length > 0) {
            form.setError(field as keyof CreateCandidateInput, { message: messages[0] })
          }
        }
        return
      }
      if ('formError' in result) {
        toast.error(result.formError)
        return
      }
      // Defensive: action returned ok but no redirect (shouldn't happen).
      if (result.ok) {
        router.push(`/candidates/${result.id}`)
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Candidate details</h2>

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
                    <Input
                      type="tel"
                      autoComplete="tel"
                      {...field}
                      value={field.value ?? ''}
                    />
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
                  <Input placeholder="City, country" {...field} value={field.value ?? ''} />
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
        </div>

        <Separator />

        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Data &amp; Consent</h2>
            <p className="text-muted-foreground mt-1 text-xs font-normal">
              UK GDPR Art. 7 requires us to record what was agreed, by whom, and when.
            </p>
          </div>

          <FormField
            control={form.control}
            name="consent_basis"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Lawful basis</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CONSENT_BASIS_VALUES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {CONSENT_BASIS_LABELS[v]}
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
            name="consent_confirmed"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    aria-required="true"
                  />
                </FormControl>
                <div className="space-y-1.5 leading-snug">
                  <FormLabel className="text-sm font-normal">{CONSENT_TEXT_V1}</FormLabel>
                  <p className="text-muted-foreground text-xs font-normal">
                    Captured on submission and stored against this candidate.
                  </p>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/candidates')}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="h-11 md:h-10"
            disabled={isPending || !consentChecked}
          >
            {isPending ? 'Adding…' : 'Add candidate'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
