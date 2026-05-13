import Link from 'next/link'

import { SignUpForm } from './sign-up-form'

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground text-sm">
          A new organisation is created for you. You&apos;ll be its owner.
        </p>
      </div>
      <SignUpForm />
      <p className="text-muted-foreground text-sm">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
