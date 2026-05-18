'use client'

import { zodResolver } from '@hookform/resolvers/zod'
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

import { updateProfileAction } from './actions'
import { updateProfileSchema, type UpdateProfileInput } from './schema'

export type ProfileFormProps = {
  initialFullName: string | null
  initialEmail: string
}

// Phase 1 simplification: editing email here only updates public.users.email
// (the display copy used in the top nav). Updating auth.users.email — which
// requires Supabase to re-verify ownership of the new address — is a Phase 2
// concern. Surface that to the user via a small note.
export function ProfileForm({ initialFullName, initialEmail }: ProfileFormProps) {
  const [isPending, startTransition] = useTransition()
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      full_name: initialFullName ?? '',
      email: initialEmail,
    },
  })

  const onSubmit = (data: UpdateProfileInput) => {
    startTransition(async () => {
      const result = await updateProfileAction(data)
      if (result.ok) {
        toast.success('Profile saved')
        return
      }
      if ('fieldErrors' in result) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages && messages.length > 0) {
            form.setError(field as keyof UpdateProfileInput, { message: messages[0] })
          }
        }
        return
      }
      toast.error(result.formError)
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <p className="text-muted-foreground text-xs font-normal">
                Display only. Changing the email used to sign in is a Phase 2 feature.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" className="h-11 md:h-10" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
