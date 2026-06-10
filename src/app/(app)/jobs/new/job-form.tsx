'use client'

import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'

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

import { createJobStandaloneAction } from './actions'
import { newJobFormSchema, type NewJobFormInput } from './schema'

type ClientOption = { id: string; name: string }

// Standalone job-create form (M-8). Same fields as the client-scoped JobForm
// plus a client picker at the top, since this route isn't pinned to a client.
export function NewJobForm({ clients }: { clients: ClientOption[] }) {
  const [isPending, startTransition] = useTransition()
  const form = useForm<NewJobFormInput>({
    resolver: zodResolver(newJobFormSchema),
    defaultValues: {
      company_id: '',
      title: '',
      job_type: 'perm',
      hiring_context: 'new_role',
      location: '',
      sector: '',
      salary_min: '',
      salary_max: '',
      description: '',
    },
  })

  function onSubmit(values: NewJobFormInput) {
    startTransition(async () => {
      const result = await createJobStandaloneAction(values)
      if (result && !result.ok) {
        if ('fieldErrors' in result) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            const message = messages?.[0]
            if (message) {
              form.setError(field as keyof NewJobFormInput, { message })
            }
          }
          return
        }
        toast.error(result.formError)
      }
      // Success path triggers a redirect from the server action.
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <FormField
          control={form.control}
          name="company_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
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
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job title</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  placeholder="Senior Wind Turbine Engineer"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="job_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="perm">Permanent</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="temp">Temp</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hiring_context"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hiring context</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="new_role">New role</SelectItem>
                    <SelectItem value="backfill">Backfill</SelectItem>
                  </SelectContent>
                </Select>
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
                <Input {...field} value={field.value ?? ''} placeholder="Edinburgh / Remote" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sector"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Sector</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? ''}
                  autoComplete="off"
                  placeholder="e.g. Renewable Energy, Software, Oil & Gas"
                />
              </FormControl>
              {/* Powers time-to-fill-by-sector in the buyer-value report (REPORT-02) */}
              <p className="text-muted-foreground text-xs">
                Used to break down time-to-fill by sector in reporting.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="salary_min"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Salary min (GBP)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    type="number"
                    inputMode="numeric"
                    placeholder="60000"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="salary_max"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Salary max (GBP)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    type="number"
                    inputMode="numeric"
                    placeholder="80000"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  rows={6}
                  placeholder="Headline responsibilities, must-haves, nice-to-haves…"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" className="h-11 md:h-10" disabled={isPending}>
            {isPending ? 'Creating…' : 'Create job'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
