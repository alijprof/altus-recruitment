'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Turnstile } from '@marsidev/react-turnstile'
import { useCallback, useState, useTransition } from 'react'
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
import { Textarea } from '@/components/ui/textarea'

import { confirmApplyAction, submitApplyAction } from './actions'
import {
  applyFormSchema,
  AVAILABILITY_LABELS,
  AVAILABILITY_VALUES,
  type ApplyFormInput,
} from './schema'

// Plan 3 Task 3.1 — public apply form Client Component.
//
// Two-stage submit pattern (RESEARCH §C.14 — signed upload URL flow):
//   Stage 1: client posts form fields (NOT the file) to submitApplyAction.
//            Action validates, mints a signed upload URL, returns it.
//   Stage 2: client PUTs the file directly to Supabase Storage.
//   Stage 3: client posts to confirmApplyAction which fires `cv/uploaded`.
//            Browser navigates to /apply/<slug>/success.
//
// File is held in React state (not RHF) — RHF's input/output types don't
// play well with File objects. We validate size + presence here as UX;
// the action re-validates from fileMeta.
//
// Turnstile dev affordance: when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset
// (local dev before the user provisions a Cloudflare account) the widget
// is replaced by a "Skip captcha (dev)" button that stamps
// turnstile_token='dev-bypass'. The server-side helper accepts that token
// ONLY when NODE_ENV !== 'production'. The dev affordance is intentional
// and documented; production deploys MUST set the site key.

const MAX_BYTES = 10 * 1024 * 1024 // 10 MiB — matches storage bucket cap
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export type ApplyFormProps = {
  orgSlug: string
  orgName: string
  consentText: string
  // The agency's own (controller) contact email, resolved server-side from the
  // org owner. Shown in upload-error copy so applicants reach the agency — never
  // a vendor address (audit blocker 6).
  contactEmail: string
}

export function ApplyForm({ orgSlug, orgName, consentText, contactEmail }: ApplyFormProps) {
  const [isPending, startTransition] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  // Bumping this key forces the Turnstile widget to remount + re-issue a
  // fresh token after a failed submission. Cheaper to reason about than the
  // ref-based imperative reset() API and side-steps the React Compiler's
  // "no refs in render" rule.
  const [turnstileKey, setTurnstileKey] = useState(0)

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const devBypass = !siteKey

  const form = useForm<ApplyFormInput>({
    resolver: zodResolver(applyFormSchema),
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      location: '',
      current_role_title: '',
      availability: 'immediate',
      salary_expectation: '',
      source_detail: '',
      // reason: literal(true) requires the type to be `true`, but a
      // checkbox starts unchecked. zod rejects `false` on submit which is
      // exactly the behaviour we want; the disabled-submit guard below is
      // a UX safety net.
      consent_confirmed: false as unknown as true,
      marketing_consent: false,
      hp: '',
      turnstile_token: '',
    },
  })

  const consentChecked =
    useWatch({ control: form.control, name: 'consent_confirmed' }) === true
  const turnstileToken = useWatch({ control: form.control, name: 'turnstile_token' })

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null)
    const f = e.target.files?.[0] ?? null
    if (!f) {
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setFileError('File must be smaller than 10 MB.')
      setFile(null)
      return
    }
    if (!ALLOWED_MIMES.has(f.type)) {
      setFileError('Please upload a PDF or DOCX file.')
      setFile(null)
      return
    }
    setFile(f)
  }

  // Reset = clear the form token + remount the widget (via key bump).
  // Tokens are single-use; a failed submission must re-challenge.
  const resetTurnstile = useCallback(() => {
    form.setValue('turnstile_token', '')
    setTurnstileKey((k) => k + 1)
  }, [form])

  const onSubmit = (data: ApplyFormInput) => {
    if (!file) {
      setFileError('Please attach your CV.')
      return
    }

    startTransition(async () => {
      // Stage 1 — submit form data + file metadata. Server mints signed URL.
      const fileMeta = { name: file.name, size: file.size, type: file.type }
      const submitResult = await submitApplyAction(data, fileMeta, orgSlug)

      if (!submitResult.ok) {
        if ('fieldErrors' in submitResult) {
          for (const [field, messages] of Object.entries(submitResult.fieldErrors)) {
            if (messages && messages.length > 0) {
              form.setError(field as keyof ApplyFormInput, { message: messages[0] })
            }
          }
          resetTurnstile()
          return
        }
        toast.error(submitResult.formError)
        resetTurnstile()
        return
      }

      // Stage 2 — upload file directly to Supabase Storage via signed URL.
      let uploadOk = false
      try {
        const uploadResponse = await fetch(submitResult.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': fileMeta.type },
          body: file,
        })
        uploadOk = uploadResponse.ok
      } catch {
        uploadOk = false
      }
      if (!uploadOk) {
        toast.error(`CV upload failed. Please try again, or email ${contactEmail}.`)
        resetTurnstile()
        return
      }

      // Stage 3 — confirm. Server verifies the object exists and fires
      // the cv/uploaded event into the existing parse-cv → embed pipeline.
      const confirmResult = await confirmApplyAction({
        candidateId: submitResult.candidateId,
        candidateCvId: submitResult.candidateCvId,
        orgSlug,
      })
      if (!confirmResult.ok) {
        toast.error(
          `Your CV uploaded but we couldn’t confirm it. Email ${contactEmail} and we’ll sort it.`,
        )
        resetTurnstile()
        return
      }

      // Hard navigation — avoids any in-app state lingering for a candidate
      // who is otherwise unauthenticated, and gives the success page a fresh
      // RSC render.
      window.location.href = confirmResult.redirectTo
    })
  }

  const submitDisabled = isPending || !consentChecked || !turnstileToken || !file

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">About you</h2>

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

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
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
                  <FormLabel>Phone (optional)</FormLabel>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="City, country"
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
              name="current_role_title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current role (optional)</FormLabel>
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
              name="availability"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Availability</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {AVAILABILITY_VALUES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {AVAILABILITY_LABELS[v]}
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
              name="salary_expectation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Salary expectation (optional, GBP)</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="55000"
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
            name="source_detail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>How did you hear about us? (optional)</FormLabel>
                <FormControl>
                  <Textarea
                    rows={2}
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Your CV</h2>
          <Input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={onFileChange}
            aria-required="true"
          />
          <p className="text-muted-foreground text-xs">
            PDF or DOCX up to 10 MB.
          </p>
          {fileError ? (
            <p className="text-destructive text-sm" role="alert">
              {fileError}
            </p>
          ) : null}
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Consent &amp; permissions</h2>
          <div className="text-muted-foreground rounded-md border p-3 text-xs whitespace-pre-line">
            {consentText}
          </div>
          <p className="text-muted-foreground text-xs">
            Read our{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              privacy policy
            </a>{' '}
            for full details on how your data is handled.
          </p>

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
                  <FormLabel className="text-sm font-normal">
                    I have read and agree to the above.
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="marketing_consent"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={(v) => field.onChange(v === true)}
                  />
                </FormControl>
                <div className="space-y-1.5 leading-snug">
                  <FormLabel className="text-sm font-normal">
                    I would also like to be considered for future similar
                    roles at {orgName}.
                  </FormLabel>
                </div>
              </FormItem>
            )}
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Verification</h2>
          {devBypass ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">
                NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set — dev affordance.
                Production deploys MUST set this var.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => form.setValue('turnstile_token', 'dev-bypass')}
              >
                Skip captcha (dev)
              </Button>
              {turnstileToken === 'dev-bypass' ? (
                <p className="text-xs text-green-600">Dev token set.</p>
              ) : null}
            </div>
          ) : (
            <Turnstile
              key={turnstileKey}
              siteKey={siteKey ?? ''}
              onSuccess={(token) => form.setValue('turnstile_token', token)}
              onExpire={() => form.setValue('turnstile_token', '')}
              onError={() => form.setValue('turnstile_token', '')}
            />
          )}
          {/* The form-level field message attaches to turnstile_token. */}
          <FormField
            control={form.control}
            name="turnstile_token"
            render={() => (
              <FormItem>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/*
          Honeypot — hidden from real users (visually + screen-readers).
          Bots that auto-fill every input will trip this and the server
          action drops their submission silently.
        */}
        <div aria-hidden="true" className="sr-only absolute -left-[9999px]">
          <label htmlFor="hp">Leave this field empty.</label>
          <input
            id="hp"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            {...form.register('hp')}
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          {/* Brand primary colour applied via var(--brand-primary), which is set as a
              CSS custom property on the page wrapper div in page.tsx (style object,
              never a <style> tag). The colour value never touches this className. */}
          <Button
            type="submit"
            className="h-11 md:h-10"
            disabled={submitDisabled}
            style={{
              backgroundColor: 'var(--brand-primary)',
              borderColor: 'var(--brand-primary)',
            }}
          >
            {isPending ? 'Submitting…' : 'Submit application'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
