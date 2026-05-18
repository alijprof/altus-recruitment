'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
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

import { updateCandidateAction } from './actions'
import {
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_SOURCE_VALUES,
  MARKET_STATUS_LABELS,
  MARKET_STATUS_VALUES,
  editCandidateSchema,
  type EditCandidateInput,
} from './schema'

export type CandidateEditFormProps = {
  candidateId: string
  defaultValues: EditCandidateInput
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

  const onSubmit = (data: EditCandidateInput) => {
    startTransition(async () => {
      const result = await updateCandidateAction(candidateId, data)
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
                  <Input type="email" autoComplete="email" {...field} value={field.value ?? ''} />
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
