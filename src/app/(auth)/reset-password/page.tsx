import { Suspense } from 'react'

import { ResetPasswordForm } from './reset-password-form'

// /reset-password — destination of the password-recovery email link, and where
// "set my first password" lands too. Public route (see PUBLIC_PATHS in
// src/lib/supabase/middleware.ts). The form reads useSearchParams() for the
// recovery token, so it's wrapped in Suspense (same pattern as /sign-in).
export default function ResetPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-muted-foreground text-sm">
          Choose a password to finish resetting your account.
        </p>
      </div>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
