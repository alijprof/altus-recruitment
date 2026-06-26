'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

type Status =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: 'pending' })

    const supabase = createClient()
    // The reset link lands the user on /reset-password where the new-password
    // form lives. window.location.origin keeps this correct across prod and
    // preview domains. NOTE: /reset-password must be in Supabase's allowed
    // redirect URLs (Auth → URL Configuration) — see the Task 5 checklist.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      // resetPasswordForEmail does not reveal whether the email exists, so any
      // error here is a genuine transport/rate-limit failure — safe to surface.
      setStatus({ kind: 'error', message: error.message })
      return
    }
    // Neutral confirmation regardless of whether the address has an account —
    // never disclose which emails exist.
    setStatus({ kind: 'sent' })
  }

  if (status.kind === 'sent') {
    return (
      <div className="border-border bg-card rounded-md border p-4 text-sm">
        If an account exists for <span className="font-medium">{email}</span>, we&apos;ve sent a
        link to set a new password. Check your inbox (and spam).
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@agency.com"
        />
      </div>
      {status.kind === 'error' && (
        <p className="text-destructive text-sm" role="alert">
          {status.message}
        </p>
      )}
      <Button type="submit" className="h-11 w-full md:h-10" disabled={status.kind === 'pending'}>
        {status.kind === 'pending' ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  )
}
