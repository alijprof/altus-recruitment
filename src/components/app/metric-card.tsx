import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type MetricCardProps = {
  value: number | string
  label: string
  caption?: string
  className?: string
}

// UI-SPEC §6 — Dashboard metric tile. Display typography for the value, label
// typography for the label, optional caption row for "this month" / "open"
// scoping copy. Pure presentational; data fetching happens in the dashboard
// RSC.
export function MetricCard({ value, label, caption, className }: MetricCardProps) {
  return (
    <Card className={cn('gap-2 py-5', className)}>
      <CardContent className="space-y-1 px-5">
        <p className="text-muted-foreground text-xs font-normal">{label}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {caption ? (
          <p className="text-muted-foreground text-xs font-normal">{caption}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
