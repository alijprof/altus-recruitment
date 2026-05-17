import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Enums } from '@/types/database'

export type MarketStatusBadgeProps = {
  status: Enums<'market_status'>
  className?: string
}

// UI-SPEC §Color "Semantic status colors" — fixed mapping. We use the shadcn
// Badge as a base for shape/typography (text-xs font-normal px-2 py-0.5
// rounded-full) then override colours via className per the spec table.
//
// `cold` falls back to the shadcn `secondary` variant per the spec.
const COLOR_BY_STATUS: Record<Enums<'market_status'>, string> = {
  actively_looking: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-transparent',
  passively_looking: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-transparent',
  hot: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-transparent',
  placed: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-transparent',
  cold: '', // uses default secondary variant
}

const LABEL_BY_STATUS: Record<Enums<'market_status'>, string> = {
  actively_looking: 'Actively looking',
  passively_looking: 'Passively looking',
  hot: 'Hot',
  placed: 'Placed',
  cold: 'Cold',
}

export function MarketStatusBadge({ status, className }: MarketStatusBadgeProps) {
  const variant = status === 'cold' ? 'secondary' : 'outline'
  return (
    <Badge
      variant={variant}
      className={cn('font-normal', COLOR_BY_STATUS[status], className)}
    >
      {LABEL_BY_STATUS[status]}
    </Badge>
  )
}
