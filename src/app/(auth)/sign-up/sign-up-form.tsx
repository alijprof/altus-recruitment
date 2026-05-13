'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

type Status =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export function SignUpForm() {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: 'pending' })

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        // The on_auth_user_created Postgres trigger reads these and creates
        // the organizations + public.users rows.
        data: {
          full_name: fullName,
          organization_name: organizationName,
        },
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
        Check <span className="font-medium">{email}</span> for a confirmation link to finish signing
        up.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="organizationName">Organisation name</Label>
        <Input
          id="organizationName"
          required
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="Acme Recruitment"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input
          id="fullName"
          required
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Jane Smith"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@agency.com"
        />
      </div>
      {status.kind === 'error' && (
        <p className="text-destructive text-sm" role="alert">
          {status.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={status.kind === 'pending'}>
        {status.kind === 'pending' ? 'Sending link…' : 'Send sign-up link'}
      </Button>
    </form>
  )
}
