'use client'

import { useRouter, useSearchParams } from 'next/navigation'
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

// E2E-only password fallback: visiting /sign-in?password=1 renders a
// password input alongside the email field. The form falls back to
// signInWithPassword instead of signInWithOtp. Gated to non-production builds
// so a leaked URL on prod still only allows magic-link sign-in.
const PASSWORD_AUTH_AVAILABLE = process.env.NEXT_PUBLIC_ALLOW_PASSWORD_AUTH === '1'

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const passwordMode = PASSWORD_AUTH_AVAILABLE && searchParams.get('password') === '1'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: 'pending' })

    const supabase = createClient()
    if (passwordMode) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setStatus({ kind: 'error', message: error.message })
        return
      }
      router.replace('/')
      router.refresh()
      return
    }

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
      {passwordMode ? (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-muted-foreground text-xs font-normal">
            Dev-only password sign-in (E2E). Production sign-in always uses magic link.
          </p>
        </div>
      ) : null}
      {status.kind === 'error' && (
        <p className="text-destructive text-sm" role="alert">
          {status.message}
        </p>
      )}
      <Button type="submit" className="w-full h-11 md:h-10" disabled={status.kind === 'pending'}>
        {status.kind === 'pending'
          ? passwordMode
            ? 'Signing in…'
            : 'Sending link…'
          : passwordMode
            ? 'Sign in'
            : 'Send magic link'}
      </Button>
    </form>
  )
}
