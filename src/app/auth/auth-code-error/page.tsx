import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Sign-in link expired</h1>
        <p className="text-muted-foreground text-sm">
          The link is no longer valid. Magic links can only be used once and expire after a short
          time. Request a new one and try again.
        </p>
        <Link href="/sign-in" className={buttonVariants({ className: 'w-full' })}>
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
