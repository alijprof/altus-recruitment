import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'

import { SetPasswordForm } from './set-password-form'

// Settings → Security. Lets any signed-in user set or change their password.
//
// Every existing user signed up passwordless (magic link), so they have no
// password until they set one here — this page doubles as "set my first
// password". updateUser({ password }) runs CLIENT-SIDE in SetPasswordForm so
// the plaintext password goes browser → Supabase directly and never transits
// our server (the strongest form of "never log the password").
export default async function SecuritySettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // Layout guard already redirects, but belt-and-braces for direct hits.
    redirect('/sign-in')
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm font-normal">
          Add a password so you can sign in without waiting for a magic link.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Password</CardTitle>
          <CardDescription>
            Set or change the password for{' '}
            <span className="text-foreground font-medium">{user.email}</span>. Magic-link sign-in
            keeps working either way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm />
        </CardContent>
      </Card>
    </div>
  )
}
