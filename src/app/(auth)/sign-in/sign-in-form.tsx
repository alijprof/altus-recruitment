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

export function SignInForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: 'pending' })

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Existing users only — do not auto-create on sign-in.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus({ kind: 'error', message: error.message })
      return
    }
    setStatus({ kind: 'sent' })
  }

  if (status.kind === 'sent') {
    return (
      <div className="border-border bg-card rounded-md border p-4 text-sm">
        Check <span className="font-medium">{email}</span> for a sign-in link.
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
      <Button type="submit" className="w-full" disabled={status.kind === 'pending'}>
        {status.kind === 'pending' ? 'Sending link…' : 'Send magic link'}
      </Button>
    </form>
  )
}
