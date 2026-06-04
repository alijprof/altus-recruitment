import Link from 'next/link'
import { Check } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { PLANS, type PlanKey } from '@/lib/stripe/plans'

// Format pence to a GBP display string: 5900 → "£59"
function formatGBP(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pence / 100)
}

// Feature labels for AI caps — human-readable descriptions
function capsToFeatures(
  caps: (typeof PLANS)[PlanKey]['aiCaps'],
  planKey: PlanKey,
): string[] {
  return [
    `${caps.matchScores.toLocaleString()} AI match scores / seat / mo`,
    `${caps.cvParses.toLocaleString()} CV parses / seat / mo`,
    `${caps.searches.toLocaleString()} semantic searches / seat / mo`,
    `${caps.specMinutes} spec-call minutes / seat / mo`,
    `${caps.writingCalls} AI writing calls / seat / mo`,
    planKey === 'scale'
      ? `Unlimited seats (${PLANS.pro.seats}+)`
      : `Up to ${PLANS[planKey].seats} seats`,
  ]
}

// Static benefits shared across all plans
const SHARED_FEATURES = [
  'AI CV parsing (automatic on upload)',
  'Semantic candidate search',
  'Candidate pipeline & shortlists',
  'Client & contact management',
  'Spec-call → job (voice transcription)',
  'Outlook email capture',
  'LinkedIn PDF import',
  'Public apply form',
  'Multi-recruiter workspace',
  'GDPR consent & audit log',
]

// Plan order for display
const PLAN_KEYS: PlanKey[] = ['starter', 'pro', 'scale']

interface PricingTableProps {
  /** If true, render in a compact card-row layout for the landing page embed. */
  compact?: boolean
}

export function PricingTable({ compact = false }: PricingTableProps) {
  return (
    <div
      className={
        compact
          ? 'grid gap-4 sm:grid-cols-3'
          : 'grid gap-6 sm:grid-cols-3'
      }
      aria-label="Pricing plans"
    >
      {PLAN_KEYS.map((key) => {
        const plan = PLANS[key]
        const isPro = key === 'pro'
        const features = capsToFeatures(plan.aiCaps, key)

        return (
          <Card
            key={key}
            className={
              isPro
                ? 'border-2 shadow-lg relative'
                : 'relative'
            }
            style={isPro ? { borderColor: '#0A3D5C' } : undefined}
          >
            {/* Recommended badge */}
            {isPro && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                <Badge
                  className="px-3 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: '#0A3D5C' }}
                >
                  Recommended
                </Badge>
              </div>
            )}

            <CardHeader className={compact ? 'pb-3 pt-5' : 'pb-4 pt-6'}>
              <div className="space-y-1">
                <h3
                  className="text-lg font-semibold"
                  style={isPro ? { color: '#0A3D5C' } : undefined}
                >
                  {plan.label}
                </h3>
                <div className="flex items-baseline gap-1">
                  <span
                    className="text-3xl font-bold tracking-tight"
                    style={isPro ? { color: '#0A3D5C' } : undefined}
                  >
                    {formatGBP(plan.pricePence)}
                  </span>
                  <span className="text-muted-foreground text-sm">/seat/mo</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {key === 'scale' ? 'Unlimited seats' : `Up to ${plan.seats} seats`}
                </p>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <Button
                asChild
                className="w-full"
                variant={isPro ? 'default' : 'outline'}
                style={isPro ? { backgroundColor: '#0A3D5C' } : undefined}
              >
                <Link href={`/sign-up?plan=${key}`}>
                  {isPro ? 'Start with Pro' : `Start with ${plan.label}`}
                </Link>
              </Button>

              {!compact && (
                <>
                  {/* AI usage caps */}
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                      AI usage (per seat / month)
                    </p>
                    <ul className="space-y-1" aria-label={`${plan.label} AI caps`}>
                      {features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check
                            className="mt-0.5 size-3.5 shrink-0"
                            style={{ color: '#5DCAA5' }}
                            aria-hidden="true"
                          />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Shared features */}
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                      Included in all plans
                    </p>
                    <ul className="space-y-1" aria-label="Features included in all plans">
                      {SHARED_FEATURES.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check
                            className="mt-0.5 size-3.5 shrink-0"
                            style={{ color: '#5DCAA5' }}
                            aria-hidden="true"
                          />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
