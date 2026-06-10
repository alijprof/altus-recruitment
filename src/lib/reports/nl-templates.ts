// NL_TEMPLATES — single source of truth for the NL reporting allowlist.
//
// Mirrors the PURPOSE_CAP_BUCKETS pattern from src/lib/stripe/usage.ts:
// a plain TypeScript constant that is both the Sonnet picker prompt and
// the security allowlist checked in nlQueryAction before any supabase.rpc().
//
// INVARIANT: every key here MUST correspond to a `create or replace function
// public.<key>` in supabase/migrations/20260610000000_phase4_hardening.sql,
// and every such nl_ function MUST have an entry here. Drift = a bug.
//
// Phase 4 / Plan 04-01 (Wave 0 hardening).

export type NlTemplate = {
  /** Human-readable label shown to the recruiter in the results panel. */
  label: string
  /** Shown to Sonnet in the template-picker prompt to help it select. */
  description: string
  /** Parameter descriptions keyed by PostgreSQL param name. */
  params: Record<string, { type: 'date' | 'int'; description: string }>
}

// ---------------------------------------------------------------------------
// NL_TEMPLATES
// ---------------------------------------------------------------------------
// Keys are exact Postgres function names (public.<key>).
// Values describe the template for Sonnet and for the UI.
// ---------------------------------------------------------------------------

export const NL_TEMPLATES: Record<string, NlTemplate> = {
  nl_placements_by_sector: {
    label: 'Placements by sector',
    description:
      'Count and total fee for placements grouped by job sector, within a date range.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_placements_by_recruiter: {
    label: 'Placements by recruiter',
    description:
      'Count and total fee for placements attributed to each recruiter, within a date range.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_time_to_fill_by_recruiter: {
    label: 'Time to fill by recruiter',
    description: 'Median days from job creation to placement for each recruiter.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_source_roi: {
    label: 'Source ROI',
    description:
      'Placement count and total fee by candidate source (LinkedIn, referral, apply form, etc.).',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_pipeline_value_by_stage: {
    label: 'Pipeline value by stage',
    description:
      'Candidate count and estimated fee value for each active pipeline stage right now.',
    params: {},
  },

  nl_candidates_added_per_month: {
    label: 'Candidates added per month',
    description: 'Monthly count of new candidates added to the database.',
    params: {
      p_months: { type: 'int', description: 'Number of months to look back, default 6' },
    },
  },

  nl_applications_per_job: {
    label: 'Applications per job',
    description: 'Application count per job role, showing which vacancies attract the most candidates.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_fees_by_month: {
    label: 'Fees by month',
    description: 'Monthly total fee revenue and placement count over the last N months.',
    params: {
      p_months: { type: 'int', description: 'Number of months to look back, default 12' },
    },
  },

  nl_fees_by_recruiter: {
    label: 'Fees by recruiter',
    description: 'Total fees billed and placement count attributed to each recruiter.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_dormant_clients_count: {
    label: 'Dormant clients count',
    description: 'Number of previously-placed clients the org has not spoken to within the threshold.',
    params: {
      p_dormant_days: {
        type: 'int',
        description: 'Days of silence before a client is considered dormant, default 60',
      },
    },
  },

  nl_conversion_rate: {
    label: 'Conversion rate (CV submission to placement)',
    description:
      'Percentage of CV submissions that convert to a placement, within a date range.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_average_fee_by_sector: {
    label: 'Average fee by sector',
    description: 'Average placement fee grouped by job sector — shows which sectors pay most.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_placements_this_quarter: {
    label: 'Placements this quarter',
    description: 'Total placements and fees made in the current calendar quarter.',
    params: {},
  },

  nl_top_sources_by_placements: {
    label: 'Top sources by placements',
    description:
      'The top N candidate sources ranked by placement count, with percentage of total.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 365 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
      p_limit: { type: 'int', description: 'Number of top sources to return, default 5' },
    },
  },

  nl_candidates_by_market_status: {
    label: 'Candidates by market status',
    description:
      'Count of candidates in each market status (hot, actively looking, passive, placed, cold).',
    params: {},
  },

  nl_jobs_opened_per_month: {
    label: 'Jobs opened per month',
    description: 'Monthly count of new job vacancies added over the last N months.',
    params: {
      p_months: { type: 'int', description: 'Number of months to look back, default 6' },
    },
  },

  nl_jobs_filled_vs_open: {
    label: 'Jobs filled vs open',
    description: 'Count of jobs in each status (open, on hold, filled, draft, cancelled) right now.',
    params: {},
  },

  nl_activity_volume_by_recruiter: {
    label: 'Activity volume by recruiter',
    description: 'Count of activities (calls, notes, emails, meetings) logged by each recruiter.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 30 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
    },
  },

  nl_fastest_fills: {
    label: 'Fastest fills',
    description: 'The top N quickest placements ranked by days from job creation to placement.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 90 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
      p_limit: { type: 'int', description: 'Number of results to return, default 10' },
    },
  },

  nl_biggest_fees: {
    label: 'Biggest fees',
    description: 'The top N highest-value placements ranked by fee amount.',
    params: {
      p_from: { type: 'date', description: 'Start date (YYYY-MM-DD), default 365 days ago' },
      p_to: { type: 'date', description: 'End date (YYYY-MM-DD), default today' },
      p_limit: { type: 'int', description: 'Number of results to return, default 10' },
    },
  },
} as const
