import Link from 'next/link'

import { MobileNavDrawer } from '@/components/app/mobile-nav-drawer'
import { SignOutButton } from '@/components/app/sign-out-button'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/search', label: 'Search' },
  { href: '/clients', label: 'Clients' },
  { href: '/floats', label: 'Floats' },
  { href: '/spec', label: 'Spec calls' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
  { href: '/help', label: 'Help' },
] as const

// Altus monogram (matches the standalone SVG asset). Drawn with currentColor
// where possible — green accent stays #5DCAA5 to lock the brand mark.
function AltusMonogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <line x1="8" y1="40" x2="24" y2="8" stroke="#5DCAA5" strokeWidth="4" strokeLinecap="round" />
      <line x1="40" y1="40" x2="24" y2="8" stroke="#5DCAA5" strokeWidth="4" strokeLinecap="round" />
      <line x1="14" y1="27" x2="34" y2="27" stroke="#5DCAA5" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

interface TopNavProps {
  userEmail: string
  userName: string | null
  organizationName: string | null
}

export function TopNav({ userEmail, userName, organizationName }: TopNavProps) {
  return (
    <header className="border-b border-[#0f1a26] bg-[#1a2738] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3 md:gap-6">
          {/* Hamburger — only visible below md; renders the mobile nav drawer */}
          <MobileNavDrawer
            userEmail={userEmail}
            userName={userName}
            organizationName={organizationName}
          />
          <Link
            href="/"
            className="flex items-center gap-3 transition-opacity hover:opacity-90"
            aria-label="Altus Recruit — home"
          >
            {/* Monogram: condensed on mobile (h-8 w-8), full size at md+ */}
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-50 shadow-sm md:h-10 md:w-10">
              <AltusMonogram className="h-5 w-5 md:h-6 md:w-6" />
            </span>
            <span className="hidden h-9 w-px bg-slate-100/15 sm:block" aria-hidden="true" />
            {/* Wordmark — hidden on mobile (sm:flex keeps it off phones, which are < 640px) */}
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-[10px] font-medium tracking-[0.18em] text-slate-400 uppercase">
                Recruitment CRM
              </span>
              <span className="text-base font-semibold tracking-tight text-slate-50">
                ALTUS <span className="text-[#5DCAA5]">Recruit</span>
              </span>
              <span className="text-[10px] text-slate-400">from Altus</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex lg:gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-slate-300 transition-colors hover:bg-white/10 hover:text-slate-50"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* Email/org chip — hidden below md; available in the drawer footer on mobile */}
          <div className="hidden text-right text-xs leading-tight md:block">
            <div className="font-medium text-slate-100">{userName ?? userEmail}</div>
            {organizationName && <div className="text-slate-400">{organizationName}</div>}
          </div>
          {/* SignOutButton — desktop only; mobile uses the one in the drawer footer */}
          <div className="hidden md:block">
            <SignOutButton />
          </div>
        </div>
      </div>
    </header>
  )
}
