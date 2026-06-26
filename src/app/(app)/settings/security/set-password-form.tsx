'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { PasswordStrengthMeter } from '@/components/app/password-strength-meter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

const MIN_LENGTH = 8

// Lets a signed-in user set or change their password. Runs entirely client-side
// (browser Supabase client) so the plaintext password never reaches our server.
// Mirrors the reset-password timeout race: @supabase/ssr's post-update session
// refresh occasionally hangs on the auth-token lock even though the password DID
// change, which would otherwise wedge the button forever.
export function SetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

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
    const supabase = createClient()

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
      console.error('Set password failed:', result.error.message)
      setError(result.error.message)
      toast.error("Couldn't update your password")
      return
    }

    // Clean success OR timeout — the password write lands quickly; a timeout
    // means only the session refresh hung, so the new password is already in
    // place. Reset the form either way.
    setPassword('')
    setConfirm('')
    toast.success('Password updated')
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <div className="relative">
          <Input
            id="new-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="pr-10"
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
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat password"
        />
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" className="h-11 md:h-10" disabled={pending}>
          {pending ? 'Saving…' : 'Save password'}
        </Button>
      </div>
    </form>
  )
}
