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

import { inviteTeammateAction } from './actions'
import { inviteTeammateSchema, type InviteTeammateInput } from './schema'

// Owner-only: sends a Supabase Auth magic-link invite. The recipient lands on
// /auth/callback after clicking; the handle_new_user_invite trigger reads
// raw_user_meta_data.invited_to_org and attaches them as 'recruiter' to this
// org.
export function InviteForm() {
  const [isPending, startTransition] = useTransition()
  const form = useForm<InviteTeammateInput>({
    resolver: zodResolver(inviteTeammateSchema),
    defaultValues: { email: '', full_name: '' },
  })

  const onSubmit = (data: InviteTeammateInput) => {
    startTransition(async () => {
      const result = await inviteTeammateAction(data)
      if (result.ok) {
        toast.success('Invitation sent')
        form.reset({ email: '', full_name: '' })
        return
      }
      if ('fieldErrors' in result) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages && messages.length > 0) {
            form.setError(field as keyof InviteTeammateInput, { message: messages[0] })
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
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Teammate email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="off" placeholder="name@company.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name (optional)</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" className="h-11 md:h-10" disabled={isPending}>
            {isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
