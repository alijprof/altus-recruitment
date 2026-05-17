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
import { Textarea } from '@/components/ui/textarea'

import {
  createContactAction,
  updateContactAction,
  type ContactActionResult,
} from '../../actions'
import { contactFormSchema, type ContactFormInput } from './schema'

export type ContactFormProps = {
  companyId: string
  // When `contactId` is provided the form runs in update mode.
  contactId?: string
  defaultValues?: Partial<ContactFormInput>
  submitLabel?: string
}

export function ContactForm({
  companyId,
  contactId,
  defaultValues,
  submitLabel,
}: ContactFormProps) {
  const [isPending, startTransition] = useTransition()
  const form = useForm<ContactFormInput>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      full_name: defaultValues?.full_name ?? '',
      role_title: defaultValues?.role_title ?? '',
      email: defaultValues?.email ?? '',
      phone: defaultValues?.phone ?? '',
      notes: defaultValues?.notes ?? '',
    },
  })

  function onSubmit(values: ContactFormInput) {
    startTransition(async () => {
      const result: ContactActionResult | undefined = contactId
        ? await updateContactAction(companyId, contactId, values)
        : await createContactAction(companyId, values)
      if (result && !result.ok) {
        if ('fieldErrors' in result) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            const message = messages?.[0]
            if (message) {
              form.setError(field as keyof ContactFormInput, { message })
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
          name="full_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="name" placeholder="Jane Smith" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="role_title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role / title</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? ''}
                  placeholder="Head of Engineering"
                />
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
                <Input
                  {...field}
                  value={field.value ?? ''}
                  type="email"
                  autoComplete="email"
                  placeholder="jane@acme.com"
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
                  {...field}
                  value={field.value ?? ''}
                  type="tel"
                  autoComplete="tel"
                  placeholder="+44 20 1234 5678"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  rows={3}
                  placeholder="Decision maker for senior hires; prefers email."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending
              ? contactId
                ? 'Saving…'
                : 'Adding…'
              : (submitLabel ?? (contactId ? 'Save changes' : 'Add contact'))}
          </Button>
        </div>
      </form>
    </Form>
  )
}
