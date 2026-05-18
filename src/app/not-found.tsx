import Link from 'next/link'

import { Button } from '@/components/ui/button'

// UI-SPEC Error States — 404 fallback. Renders for any unmatched route. Kept
// intentionally minimal: no header chrome (the `(app)` layout doesn't wrap
// 404s), just a centered hero with a way back to the dashboard.

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-muted-foreground text-xs font-normal tracking-widest uppercase">
        404
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">This page doesn&apos;t exist.</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm font-normal">
        The link may be broken, or the page may have moved. Head back to the dashboard to keep
        going.
      </p>
      <Button asChild className="mt-8 h-11 md:h-10">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  )
}
