'use client'

import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { PasswordStrengthMeter } from '@/components/app/password-strength-meter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

const MIN_LENGTH = 8

// Recovery-session bootstrap phase. We must establish a recovery session before
// updateUser({ password }) will work.
type Phase = 'verifying' | 'ready' | 'expired'

// Hardened reset flow copied from altus-move, minus its onAuthStateChange
// listener — this project is server-driven and deliberately avoids client auth
// subscribers (the onAuthStateChange deadlock class). We instead resolve the
// recovery session explicitly: token_hash → verifyOtp, ?code → exchange, or a
// short getSession poll for the legacy implicit hash.
export function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // One client instance for the component so verifyOtp/exchange and updateUser
  // share the same session state.
  const [supabase] = useState(() => createClient())

  const [phase, setPhase] = useState<Phase>('verifying')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  // Recovery tokens are single-use; guard against React strict-mode's double
  // effect invocation (and any searchParams ref churn) calling verifyOtp twice,
  // which would consume the token and falsely flip us to "expired".
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    async function init() {
      // verifyOtp/exchangeCodeForSession/getSession RETURN {error} for known
      // auth failures, but THROW for non-auth failures (network TypeError, or a
      // navigator.locks acquire-timeout). Without this guard a throw would leave
      // phase stuck on 'verifying' forever (button disabled, no recovery). Treat
      // any throw as an unusable link → 'expired' so the user can request a new
      // one. (The browser client now uses noopLock, so the lock-timeout throw is
      // no longer expected — this stays as defence in depth.)
      try {
        // Supabase bounced an invalid/expired link back with an error param.
        const errorParam = searchParams.get('error') ?? searchParams.get('error_code')
        if (errorParam) {
          setPhase('expired')
          return
        }

        const tokenHash = searchParams.get('token_hash')
        const type = searchParams.get('type')
        const code = searchParams.get('code')

        // Path 1 — token_hash query param (the preferred, cross-device pattern;
        // mirrors this repo's /auth/confirm route). Needs the recovery email
        // template configured to use {{ .TokenHash }} (see Task 5 checklist).
        if (tokenHash && type === 'recovery') {
          const { error: verifyErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          })
          setPhase(verifyErr ? 'expired' : 'ready')
          return
        }

        // Path 2 — PKCE ?code= (the default recovery email template with the
        // @supabase/ssr browser client; same-device only).
        if (code) {
          const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
          setPhase(exchangeErr ? 'expired' : 'ready')
          return
        }

        // Path 3 — legacy implicit hash (#access_token=...&type=recovery). The
        // browser client parses it on mount (detectSessionInUrl); poll once, then
        // retry after a short delay to let that parse land.
        let session = (await supabase.auth.getSession()).data.session
        if (!session) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          session = (await supabase.auth.getSession()).data.session
        }
        setPhase(session ? 'ready' : 'expired')
      } catch (err) {
        // Never log the token; only the (non-PII) message.
        console.error('Reset recovery init failed:', err instanceof Error ? err.message : err)
        setPhase('expired')
      }
    }

    void init()
  }, [supabase, searchParams])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (phase !== 'ready') {
      setError(
        "This reset link isn't active yet. Wait a moment and try again, or request a new one below.",
      )
      return
    }
    // Never trim/normalise — validate and submit the raw value.
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }

    setPending(true)

    // Timeout race. The password change lands quickly, but @supabase/ssr's
    // post-update session refresh occasionally hangs on the auth-token lock,
    // leaving the button stuck forever even though the password DID change. Cap
    // the wait at 5s and proceed — the new password is already in place; worst
    // case the middleware bounces the user to /sign-in to use it.
    type UpdateResult = { error: { message: string } | null } | { timedOut: true }
    const updatePromise: Promise<UpdateResult> = supabase.auth
      .updateUser({ password })
      .then((r) => ({ error: r.error ? { message: r.error.message } : null }))
      .catch((e: Error) => ({ error: { message: e.message } }))
    const timeoutPromise = new Promise<UpdateResult>((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), 5000),
    )

    const result = await Promise.race([updatePromise, timeoutPromise])
    setPending(false)

    if ('error' in result && result.error) {
      // Never log the password; only the (non-PII) error message.
      console.error('Reset password error:', result.error.message)
      setError(result.error.message)
      return
    }

    // Success or timeout — the recovery session is valid, so / lands the user
    // authenticated; if the refresh hung, the middleware bounces them to
    // /sign-in to sign in with their new password.
    router.replace('/')
  }

  if (phase === 'expired') {
    return (
      <div className="space-y-4">
        <p className="text-destructive text-sm" role="alert">
          This reset link is invalid or has expired. Request a new one below.
        </p>
        <Button asChild className="h-11 w-full md:h-10">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="reset-password">New password</Label>
        <div className="relative">
          <Input
            id="reset-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="pr-10"
            disabled={phase !== 'ready'}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <PasswordStrengthMeter password={password} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reset-confirm">Confirm new password</Label>
        <Input
          id="reset-confirm"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat password"
          disabled={phase !== 'ready'}
        />
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        className="h-11 w-full md:h-10"
        disabled={pending || phase === 'verifying'}
      >
        {phase === 'verifying' ? 'Checking your link…' : pending ? 'Updating…' : 'Update password'}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Link not working?{' '}
        <Link
          href="/forgot-password"
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Request a new one
        </Link>
      </p>
    </form>
  )
}
