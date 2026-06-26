'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeNext } from '@/lib/auth/safe-next'
import { createClient } from '@/lib/supabase/client'

type Status =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

type Method = 'magic' | 'password'

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

// Maps a Supabase signInWithPassword error to a friendly, non-leaky message.
// `invalid_credentials` is returned both for a wrong password AND for an account
// that has no password set yet (every passwordless/magic-link user) — and also
// for an unknown email, so it never reveals whether an account exists. We steer
// the user to the magic link (which always works) and the reset flow.
function passwordSignInMessage(error: { message: string; code?: string }): string {
  const code = error.code
  const msg = error.message.toLowerCase()
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Confirm your email first — sign in with a magic link below, which also confirms your address.'
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return "We couldn't sign you in with that password. If you've never set one, use a magic link to sign in, then add a password in Settings → Security — or reset it below."
  }
  // Fallback: Supabase's other signInWithPassword messages (rate limiting,
  // provider disabled) are themselves generic, so surfacing them is safe.
  return error.message
}

interface SignInFormProps {
  inviteMode: boolean
}

export function SignInForm({ inviteMode }: SignInFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Quick task 260524-iav (B2): inviteMode is supplied as a prop by the
  // parent server component, which reads the httpOnly altus_invite_token
  // cookie via next/headers. The URL ?invite=1 query parameter is no longer
  // honoured. This closes the spam / junk-org vector documented in
  // REVIEW.md B2 (quick task 260524-iav). The ?email= pre-fill from
  // searchParams is preserved — it's harmless on its own (cannot create an
  // account without also flipping shouldCreateUser, which is now strictly
  // gated by the server-side cookie).
  const prefilledEmail = useMemo(() => decodeEmailParam(searchParams.get('email')), [searchParams])
  const errorBanner = errorBannerMessage(searchParams.get('error'))
  // Deep-link return: middleware bounces unauthenticated users here with
  // ?next=<protected path>. safeNext() guards against open-redirect (returns '/'
  // for anything off-origin or malformed). Honoured by both sign-in methods.
  const nextPath = safeNext(searchParams.get('next'))

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

  // Magic link is the default and stays the canonical onboarding path. Password
  // is a fully opt-in alternative for returning users who set one in Settings →
  // Security. Invitees have no account yet (the OTP path uses
  // shouldCreateUser:true), so the password method is hidden in invite mode —
  // they MUST complete the magic-link round-trip for /accept-invite to attach
  // them to the inviter's org.
  const [method, setMethod] = useState<Method>('magic')
  const passwordMode = method === 'password' && !inviteMode

  function switchMethod(next: Method) {
    setMethod(next)
    setStatus({ kind: 'idle' })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: 'pending' })

    const supabase = createClient()
    if (passwordMode) {
      // Never trim/normalise the password — pass the raw value through.
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setStatus({ kind: 'error', message: passwordSignInMessage(error) })
        return
      }
      router.replace(nextPath)
      router.refresh()
      return
    }

    // Quick task 260524-iav (B2): inviteMode comes from the server-derived
    // cookie check in the parent page; the URL cannot influence it. When in
    // invite mode the user might not exist in auth.users yet (the inviter
    // typed their email; they have never signed in), so we set
    // shouldCreateUser:true. Defence in depth: /auth/callback re-verifies
    // the cookie's token against the invitation row inside the
    // public.accept_invitation() RPC, so even if the cookie is somehow
    // forged the worst case is the same as a regular /sign-up.
    // Forward the deep-link target through the callback so /auth/callback can
    // redirect there after the PKCE exchange (it reads ?next via safeNext).
    const callbackUrl =
      nextPath === '/'
        ? `${window.location.origin}/auth/callback`
        : `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: inviteMode,
        emailRedirectTo: callbackUrl,
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              Forgot / set a password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      ) : null}
      {status.kind === 'error' && (
        <p className="text-destructive text-sm" role="alert">
          {status.message}
        </p>
      )}
      <Button type="submit" className="h-11 w-full md:h-10" disabled={status.kind === 'pending'}>
        {status.kind === 'pending'
          ? passwordMode
            ? 'Signing in…'
            : 'Sending link…'
          : passwordMode
            ? 'Sign in'
            : 'Send magic link'}
      </Button>
      {!inviteMode ? (
        <p className="text-muted-foreground text-center text-sm">
          {passwordMode ? (
            <button
              type="button"
              onClick={() => switchMethod('magic')}
              className="text-foreground font-medium underline-offset-4 hover:underline"
            >
              Email me a magic link instead
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMethod('password')}
              className="text-foreground font-medium underline-offset-4 hover:underline"
            >
              Sign in with a password instead
            </button>
          )}
        </p>
      ) : null}
    </form>
  )
}
