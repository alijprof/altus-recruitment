import Link from 'next/link'

import { SuccessToast } from './success-toast'

// Plan 3 Task 3.1 — apply-form success page. Static, no DB calls. The toast
// is fired by a small client wrapper on mount.

type Props = { params: Promise<{ orgSlug: string }> }

export default async function ApplySuccessPage({ params }: Props) {
  // We intentionally do NOT validate the slug here — this page is reached
  // only via a successful client redirect, and re-validating would add a
  // second DB read for no security benefit (no data is rendered from the
  // slug).
  await params

  return (
    <div className="space-y-4 text-center">
      <SuccessToast />
      <h1 className="text-2xl font-semibold tracking-tight">
        Application received
      </h1>
      <p className="text-muted-foreground text-sm font-normal">
        Thanks for applying. We&apos;ll review your CV and reach out about
        relevant opportunities. You can close this window or visit{' '}
        <Link href="/" className="underline">
          our website
        </Link>
        .
      </p>
    </div>
  )
}
