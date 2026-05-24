'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

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

function decodeEmailParam(raw: string | null): string {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function errorBannerMessage(errorParam: string | null): string | null {
  if (errorParam === 'invalid-invite') {
    return "That invitation link isn't valid. Ask your teammate to send a new one."
  }
  if (errorParam === 'expired-invite') {
    return 'That invitation has expired or already been used. Ask your teammate to send a new one.'
  }
  return null
}

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const passwordMode = PASSWORD_AUTH_AVAILABLE && searchParams.get('password') === '1'

  // Quick task 260524-bpy: read ?email= for pre-fill and ?invite=1 to flip
  // shouldCreateUser. The invite banner is rendered unconditionally when
  // ?invite=1 is present — the cookie set by /accept-invite is the defence
  // in depth; the banner here is purely a UX nudge.
  const prefilledEmail = useMemo(
    () => decodeEmailParam(searchParams.get('email')),
    [searchParams],
  )
  const inviteMode = searchParams.get('invite') === '1'
  const errorBanner = errorBannerMessage(searchParams.get('error'))

  // React-19 idiom: derive state from changing props by tracking the previous
  // prefilled value and resetting `email` inline during render when the URL
  // param changes (avoids the react-hooks/set-state-in-effect lint rule —
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [email, setEmail] = useState(prefilledEmail)
  const [prevPrefilled, setPrevPrefilled] = useState(prefilledEmail)
  if (prefilledEmail !== prevPrefilled) {
    setPrevPrefilled(prefilledEmail)
    setEmail(prefilledEmail)
  }
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

    // Quick task 260524-bpy: when in invite mode the user might not exist in
    // auth.users yet (the inviter typed their email; they have never signed
    // in). Set shouldCreateUser:true ONLY when ?invite=1 is present — never
    // for plain /sign-in. Defence in depth: the /auth/callback handler
    // re-verifies the cookie's token against the invitation row's email
    // server-side inside the public.accept_invitation() RPC, so a forged
    // ?invite=1 URL without a matching signed cookie cannot escalate
    // privilege beyond "create a fresh-org account" (which the regular
    // /sign-up flow already permits).
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: inviteMode,
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
      {inviteMode ? (
        <div
          role="status"
          className="border-border bg-muted/40 text-foreground rounded-md border p-3 text-sm"
        >
          You&apos;ve been invited to Altus — sign in with this email to accept the invitation.
        </div>
      ) : null}
      {errorBanner ? (
        <p className="text-destructive text-sm" role="alert">
          {errorBanner}
        </p>
      ) : null}
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
