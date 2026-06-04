'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { BRAND_DEFAULTS, safeHex } from '@/lib/branding/colours'

import { updateBrandingAction } from './actions'
import { updateBrandingSchema, type UpdateBrandingInput } from './schema'

export type BrandingFormProps = {
  initialBrandPrimary: string | null
  initialBrandSecondary: string | null
  initialLogoUrl: string | null
  isOwner: boolean
}

// BrandingForm — settings/branding (05-02 BRAND-01).
//
// Two colour fields each have:
//   - A native <input type="color"> picker (for visual UX)
//   - A hex text input (for exact values) — the RHF field
// They stay in sync: the color picker's onChange writes to the RHF field.
//
// The LIVE PREVIEW swatch reflects the current validated hex (or the Altus
// default if the field is empty/invalid). The raw picker value can only emit
// valid hex anyway (browsers enforce this), so we use it directly for the
// picker defaultValue — it's the text field that needs the hex validation.

function ColourField({
  label,
  name,
  description,
  defaultColour,
  readOnly,
  form,
}: {
  label: string
  name: 'brand_primary' | 'brand_secondary'
  description: string
  defaultColour: string
  readOnly: boolean
  // reason: react-hook-form UseFormReturn is complex generic; any is acceptable
  // here because we own both sides of this internal component boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        // Safe preview: use safeHex so the swatch never shows an unsanitised value.
        const previewColour = safeHex(field.value, defaultColour)

        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <div className="flex items-center gap-3">
                {/* Native colour picker — visual UX; syncs to text field. */}
                <input
                  type="color"
                  className="h-10 w-12 cursor-pointer rounded border p-0.5"
                  value={previewColour}
                  disabled={readOnly}
                  onChange={(e) => {
                    if (!readOnly) field.onChange(e.target.value)
                  }}
                  aria-label={`${label} colour picker`}
                />
                {/* Hex text input — the actual RHF-controlled value. */}
                <Input
                  {...field}
                  value={field.value ?? ''}
                  placeholder={defaultColour}
                  readOnly={readOnly}
                  aria-readonly={readOnly}
                  className="font-mono uppercase"
                  maxLength={7}
                />
                {/* Live preview swatch. */}
                <div
                  className="h-10 w-10 flex-shrink-0 rounded border"
                  style={{ backgroundColor: previewColour }}
                  aria-label={`Preview of ${label}: ${previewColour}`}
                  role="img"
                />
              </div>
            </FormControl>
            <FormDescription>{description}</FormDescription>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}

export function BrandingForm({
  initialBrandPrimary,
  initialBrandSecondary,
  initialLogoUrl,
  isOwner,
}: BrandingFormProps) {
  const [isPending, startTransition] = useTransition()

  const form = useForm<UpdateBrandingInput>({
    resolver: zodResolver(updateBrandingSchema),
    defaultValues: {
      brand_primary: initialBrandPrimary ?? '',
      brand_secondary: initialBrandSecondary ?? '',
      logo_url: initialLogoUrl ?? '',
    },
  })

  const onSubmit = (data: UpdateBrandingInput) => {
    if (!isOwner) {
      toast.error('Only owners can edit branding settings.')
      return
    }
    startTransition(async () => {
      try {
        const result = await updateBrandingAction(data)
        if (result.ok) {
          toast.success('Branding saved')
          return
        }
        if ('fieldErrors' in result) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            if (messages && messages.length > 0) {
              form.setError(field as keyof UpdateBrandingInput, { message: messages[0] })
            }
          }
          return
        }
        toast.error(result.formError)
      } catch (err) {
        console.error('Branding save failed:', err)
        toast.error(err instanceof Error ? err.message : "Couldn't save branding settings")
        // Do NOT close/reset the form on failure — user must retry or correct.
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <ColourField
          label="Primary colour"
          name="brand_primary"
          description={`Main accent colour (buttons, header). Leave blank to use the Altus default (${BRAND_DEFAULTS.primary}).`}
          defaultColour={BRAND_DEFAULTS.primary}
          readOnly={!isOwner}
          form={form}
        />

        <ColourField
          label="Secondary colour"
          name="brand_secondary"
          description={`Complementary accent colour. Leave blank to use the Altus default (${BRAND_DEFAULTS.secondary}).`}
          defaultColour={BRAND_DEFAULTS.secondary}
          readOnly={!isOwner}
          form={form}
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
                  placeholder="https://example.com/logo.png"
                  {...field}
                  value={field.value ?? ''}
                  readOnly={!isOwner}
                  aria-readonly={!isOwner}
                />
              </FormControl>
              <FormDescription>
                Paste a hosted image URL (PNG or SVG recommended). Logo upload UI lands in a
                future phase.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {isOwner ? (
          <div className="flex justify-end">
            <Button type="submit" className="h-11 md:h-10" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save branding'}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">Only owners can edit branding settings.</p>
        )}
      </form>
    </Form>
  )
}
