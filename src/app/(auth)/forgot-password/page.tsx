import Link from 'next/link'

import { ForgotPasswordForm } from './forgot-password-form'

// /forgot-password — request a password reset (also "set my first password" for
// any of the passwordless magic-link users). Public route: see PUBLIC_PATHS in
// src/lib/supabase/middleware.ts, or the middleware 307s unauthenticated users
// here straight back to /sign-in.
export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-muted-foreground text-sm">
          Enter your email and we&apos;ll send you a link to set a new password.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-muted-foreground text-sm">
        Remembered it?{' '}
        <Link
          href="/sign-in"
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
