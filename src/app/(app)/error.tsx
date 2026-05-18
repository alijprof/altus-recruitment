'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

// (app) group error boundary. Catches every uncaught error inside the
// authenticated app shell while preserving the TopNav. Sentry receives the
// error via the route-level useEffect — the global instrumentation will also
// have captured it server-side; the explicit captureException here ensures
// pure client-side errors (e.g., a Client Component throwing during render)
// reach Sentry too.

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'app-error' } })
  }, [error])

  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-destructive text-xs font-normal tracking-widest uppercase">Error</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Something went wrong.</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm font-normal">
        We&apos;ve been notified and are looking into it. Try again, or refresh the page.
      </p>
      {error.digest ? (
        <p className="text-muted-foreground mt-2 text-xs font-normal">Ref: {error.digest}</p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => reset()} className="h-11 md:h-10">
          Try again
        </Button>
      </div>
    </div>
  )
}
