import { cookies } from 'next/headers'
import Link from 'next/link'
import { Suspense } from 'react'

import { INVITE_COOKIE_NAME } from '@/lib/invitations/cookie'

import { SignInForm } from './sign-in-form'

export default async function SignInPage() {
  // Quick task 260524-iav (B2): inviteMode is derived from the httpOnly
  // altus_invite_token cookie set by /accept-invite. The URL ?invite=1 is no
  // longer honoured — see REVIEW.md B2 (quick task 260524-iav). Presence-only
  // check is sufficient here: the token's validity is re-verified server-side
  // inside the public.accept_invitation() RPC after PKCE exchange. The flag
  // is purely a UX/banner + shouldCreateUser:true switch on the OTP send.
  const cookieStore = await cookies()
  const inviteMode = cookieStore.get(INVITE_COOKIE_NAME)?.value != null

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          We&apos;ll email you a magic link to sign you in.
        </p>
      </div>
      {/* SignInForm reads useSearchParams() to opt into a dev-only password
          fallback at /sign-in?password=1 and to pre-fill ?email=. Wrap in
          Suspense so static export doesn't bail out. inviteMode is supplied
          here as a prop (server-derived from the httpOnly invite cookie); the
          URL ?invite=1 is no longer honoured — see REVIEW.md B2 (quick task
          260524-iav). */}
      <Suspense fallback={null}>
        <SignInForm inviteMode={inviteMode} />
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
