'use client'

import { LABELS, scorePassword } from '@/lib/auth/password-strength'

// Light-theme strength meter for this repo's shadcn surfaces. Mechanics copied
// from altus-move's auth-strength-meter; colours retargeted to semantic Tailwind
// tokens so it reads correctly on the light auth/settings cards (the altus-move
// original is styled for a dark "midnight" theme).

type PasswordStrengthMeterProps = {
  password: string
}

const fillColour: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-amber-500',
  3: 'bg-blue-500',
  4: 'bg-emerald-500',
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const score = scorePassword(password)

  if (score === 0) return null

  const colour = fillColour[score]

  return (
    <div>
      {/* Bars are purely decorative — hide them from assistive tech. The text
          label below carries the strength signal for screen-reader users. */}
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={`h-1 flex-1 rounded-full ${segment <= score ? colour : 'bg-muted'}`}
          />
        ))}
      </div>
      <p className="text-muted-foreground mt-1 text-xs font-normal">
        <span className="sr-only">Password strength: </span>
        {LABELS[score]}
      </p>
    </div>
  )
}
