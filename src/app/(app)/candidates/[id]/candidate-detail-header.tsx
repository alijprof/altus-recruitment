import { MarketStatusBadge } from '@/components/app/market-status-badge'
import type { Tables } from '@/types/database'

// UI-SPEC §2: name = text-xl font-semibold, role/company = text-sm
// text-muted-foreground font-normal, email rendered in --font-mono per
// UI-SPEC §Typography "technical strings only".

export type CandidateDetailHeaderProps = {
  candidate: Tables<'candidates'>
}

export function CandidateDetailHeader({ candidate }: CandidateDetailHeaderProps) {
  const role = candidate.current_role_title
  const company = candidate.current_company
  const rolePlusCompany = [role, company].filter(Boolean).join(' · ')

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{candidate.full_name}</h1>
        {rolePlusCompany ? (
          <p className="text-muted-foreground text-sm font-normal">{rolePlusCompany}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <MarketStatusBadge status={candidate.market_status} />
          {candidate.email ? (
            <a
              href={`mailto:${candidate.email}`}
              className="text-muted-foreground hover:text-foreground font-mono text-xs transition-colors"
            >
              {candidate.email}
            </a>
          ) : null}
          {candidate.phone ? (
            <a
              href={`tel:${candidate.phone}`}
              className="text-muted-foreground hover:text-foreground font-mono text-xs transition-colors"
            >
              {candidate.phone}
            </a>
          ) : null}
        </div>
      </div>
    </header>
  )
}
