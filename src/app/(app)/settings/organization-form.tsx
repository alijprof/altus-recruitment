'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
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
  isOwner: boolean
}

// Phase 1 shipped a text-only logo_url field here (per VERIFICATION R2 — the
// column existed after migration 20260518202000_organizations_logo_url.sql).
// Phase 8 Plan 06 (BCV-04) delivered the real upload UI on
// /settings/branding and DELIBERATELY removed the logo field from this form
// — it was the second of two live surfaces writing organizations.logo_url,
// and an owner pasting a URL here could silently clobber an uploaded logo
// (08-RESEARCH.md Pitfall 1). This form no longer edits the logo in any way;
// see the pointer link to Branding below. Non-owners see the name field
// read-only.
export function OrganizationForm({ initialName, isOwner }: OrganizationFormProps) {
  const [isPending, startTransition] = useTransition()
  const form = useForm<UpdateOrganizationInput>({
    resolver: zodResolver(updateOrganizationSchema),
    defaultValues: {
      name: initialName,
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
        <p className="text-muted-foreground text-xs font-normal">
          Your agency logo is managed in{' '}
          <Link href="/settings/branding" className="text-foreground underline underline-offset-2">
            Settings → Branding
          </Link>
          .
        </p>
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
