// Human-readable labels and badge variants for job enum values.
// Shared by jobs-table.tsx and jobs-cards.tsx to keep them in sync.

import type { Enums } from '@/types/database'

export const TYPE_LABEL: Record<Enums<'job_type'>, string> = {
  perm: 'Perm',
  contract: 'Contract',
  temp: 'Temp',
}

export const STATUS_VARIANT: Record<
  Enums<'job_status'>,
  'default' | 'outline' | 'secondary'
> = {
  draft: 'outline',
  open: 'default',
  on_hold: 'secondary',
  filled: 'secondary',
  cancelled: 'outline',
}

export const STATUS_LABEL: Record<Enums<'job_status'>, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  cancelled: 'Cancelled',
}
