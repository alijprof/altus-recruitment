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

import { updateOrganizationAction } from './actions'
import { updateOrganizationSchema, type UpdateOrganizationInput } from './schema'

export type OrganizationFormProps = {
  initialName: string
  initialLogoUrl: string | null
  isOwner: boolean
}

// Phase 1 ships text-only logo_url (per VERIFICATION R2 — the column exists
// after migration 20260518202000_organizations_logo_url.sql; the
// Storage-backed upload UI is deferred to Phase 2). Non-owners see the fields
// read-only.
export function OrganizationForm({
  initialName,
  initialLogoUrl,
  isOwner,
}: OrganizationFormProps) {
  const [isPending, startTransition] = useTransition()
  const form = useForm<UpdateOrganizationInput>({
    resolver: zodResolver(updateOrganizationSchema),
    defaultValues: {
      name: initialName,
      logo_url: initialLogoUrl ?? '',
    },
  })

  const onSubmit = (data: UpdateOrganizationInput) => {
    if (!isOwner) {
      toast.error('Only owners can edit organisation settings.')
      return
    }
    startTransition(async () => {
      const result = await updateOrganizationAction(data)
      if (result.ok) {
        toast.success('Organisation saved')
        return
      }
      if ('fieldErrors' in result) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages && messages.length > 0) {
            form.setError(field as keyof UpdateOrganizationInput, { message: messages[0] })
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
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organisation name</FormLabel>
              <FormControl>
                <Input {...field} readOnly={!isOwner} aria-readonly={!isOwner} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="logo_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Logo URL</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  placeholder="https://…/logo.png"
                  {...field}
                  value={field.value ?? ''}
                  readOnly={!isOwner}
                  aria-readonly={!isOwner}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs font-normal">
                Paste a hosted image URL. Logo upload lands in Phase 2.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        {isOwner ? (
          <div className="flex justify-end">
            <Button type="submit" className="h-11 md:h-10" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save organisation'}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs font-normal">
            Only owners can edit organisation settings.
          </p>
        )}
      </form>
    </Form>
  )
}
