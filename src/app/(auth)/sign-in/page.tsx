import Link from 'next/link'
import { Suspense } from 'react'

import { SignInForm } from './sign-in-form'

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          We&apos;ll email you a magic link to sign you in.
        </p>
      </div>
      {/* SignInForm reads useSearchParams() to opt into a dev-only password
          fallback at /sign-in?password=1 — wrap in Suspense so static export
          doesn't bail out. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
      <p className="text-muted-foreground text-sm">
        No account yet?{' '}
        <Link
          href="/sign-up"
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  )
}
