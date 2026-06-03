'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu } from 'lucide-react'

import { SignOutButton } from '@/components/app/sign-out-button'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// Altus monogram inline — matches the one in top-nav.tsx but smaller.
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

// Primary nav (Dashboard → Pipeline) — top 5, inside one-thumb reach.
const PRIMARY_NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/search', label: 'Search' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/pipeline', label: 'Pipeline' },
] as const

// Secondary nav (Clients → Settings) — below the divider.
const SECONDARY_NAV = [
  { href: '/clients', label: 'Clients' },
  { href: '/floats', label: 'Floats' },
  { href: '/spec', label: 'Spec calls' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
  { href: '/help', label: 'Help' },
] as const

interface NavItemProps {
  href: string
  label: string
  pathname: string
  onClick: () => void
}

function NavItem({ href, label, pathname, onClick }: NavItemProps) {
  const isActive =
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  return (
    <SheetClose asChild>
      <Link
        href={href}
        onClick={onClick}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-center rounded-md px-4 text-sm transition-colors',
          'mx-2 hover:bg-white/10',
          isActive ? 'bg-white/10 font-medium text-slate-50' : 'text-slate-200',
        )}
      >
        {label}
      </Link>
    </SheetClose>
  )
}

interface MobileNavDrawerProps {
  userEmail: string
  userName: string | null
  organizationName: string | null
}

export function MobileNavDrawer({ userEmail, userName, organizationName }: MobileNavDrawerProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  function handleClose() {
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-100 hover:bg-white/10 md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="flex w-72 flex-col border-r border-[#0f1a26] bg-[#1a2738] p-0 text-slate-100"
      >
        {/* Drawer header — monogram + wordmark for context */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 shadow-sm">
            <AltusMonogram className="h-5 w-5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium tracking-[0.18em] text-slate-400 uppercase">
              Recruitment CRM
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-50">
              ALTUS <span className="text-[#5DCAA5]">Recruit</span>
            </span>
          </span>
        </div>

        {/* Primary nav group */}
        <nav className="py-2">
          {PRIMARY_NAV.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              pathname={pathname}
              onClick={handleClose}
            />
          ))}
        </nav>

        {/* Divider between primary and secondary groups */}
        <div className="mx-4 border-t border-white/10" aria-hidden="true" />

        {/* Secondary nav group */}
        <nav className="py-2">
          {SECONDARY_NAV.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              pathname={pathname}
              onClick={handleClose}
            />
          ))}
        </nav>

        {/* Footer — user identity + sign out */}
        <div className="mt-auto border-t border-white/10 p-4">
          <div className="mb-3 text-xs leading-tight">
            <div className="font-medium text-slate-100">{userName ?? userEmail}</div>
            {organizationName && (
              <div className="mt-0.5 text-slate-400">{organizationName}</div>
            )}
          </div>
          <SignOutButton />
        </div>
      </SheetContent>
    </Sheet>
  )
}
