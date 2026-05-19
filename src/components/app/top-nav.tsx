import Link from 'next/link'

import { SignOutButton } from '@/components/app/sign-out-button'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/search', label: 'Search' },
  { href: '/clients', label: 'Clients' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/settings', label: 'Settings' },
] as const

interface TopNavProps {
  userEmail: string
  userName: string | null
  organizationName: string | null
}

export function TopNav({ userEmail, userName, organizationName }: TopNavProps) {
  return (
    <header className="border-border bg-background border-b">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight">
            Altus
          </Link>
          <nav className="hidden gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right text-xs leading-tight sm:block">
            <div className="font-medium">{userName ?? userEmail}</div>
            {organizationName && <div className="text-muted-foreground">{organizationName}</div>}
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  )
}
