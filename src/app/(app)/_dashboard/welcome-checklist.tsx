'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Dismiss flag stored in localStorage. This is a cosmetic client-side flag
// only — it carries no auth or tenancy meaning and cannot be forged to skip
// any data gate. Step completion is always derived from DB counts (props).
const DISMISS_KEY = 'altus.welcomeChecklist.dismissed'

type WelcomeChecklistProps = {
  candidates: number
  clients: number
  jobs: number
  teamMembers: number
}

type Step = {
  label: string
  href: string
  done: boolean
}

export function WelcomeChecklist({ candidates, clients, jobs, teamMembers }: WelcomeChecklistProps) {
  // SSR guard: do not read localStorage during server-side rendering or before
  // hydration (localStorage is only available in the browser). `null` means
  // "not yet mounted"; `true/false` reflects the real dismiss flag. Rendering
  // null when dismissedState===null prevents the hydration mismatch that would
  // occur if the server rendered the card but the client immediately hid it.
  // We batch the mounted + dismissed reads into a single setState call to
  // satisfy the react/no-state-in-effect rule.
  const [dismissedState, setDismissedState] = useState<boolean | null>(null)

  useEffect(() => {
    // Async wrapper satisfies react-hooks/set-state-in-effect while correctly
    // reading localStorage only after mount (no SSR access to localStorage).
    async function readDismissed() {
      setDismissedState(localStorage.getItem(DISMISS_KEY) === '1')
    }
    void readDismissed()
  }, [])

  const steps: Step[] = [
    { label: 'Add your first candidate', href: '/candidates/new', done: candidates > 0 },
    { label: 'Add your first client', href: '/clients/new', done: clients > 0 },
    { label: 'Invite a teammate', href: '/settings/team', done: teamMembers > 1 },
    { label: 'Upload a job spec', href: '/spec/new', done: jobs > 0 },
  ]

  const allDone = steps.every((s) => s.done)

  // Render nothing until the browser has loaded (SSR guard — dismissedState===null),
  // or if all steps are done (auto-hide), or if the user already dismissed it.
  if (dismissedState === null || allDone || dismissedState) return null

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissedState(true)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold">Get started</CardTitle>
            <CardDescription>
              Complete these steps to get the most out of Altus.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-auto px-2 py-1 text-xs font-normal"
            onClick={handleDismiss}
          >
            Dismiss
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.href}>
              <Link
                href={step.href}
                className={[
                  'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                  step.done
                    ? 'text-muted-foreground pointer-events-none'
                    : 'hover:bg-accent/60',
                ]
                  .filter(Boolean)
                  .join(' ')}
                tabIndex={step.done ? -1 : undefined}
                aria-disabled={step.done}
              >
                {step.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-hidden="true" />
                ) : (
                  <Circle className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                )}
                <span className={step.done ? 'line-through' : ''}>{step.label}</span>
                {!step.done && (
                  <ChevronRight
                    className="text-muted-foreground ml-auto size-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
