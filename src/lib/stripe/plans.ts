// PLANS is the single source of truth for plan metadata consumed by:
//   - The billing entitlement helper (05-01) for cap enforcement
//   - The pricing page (05-04) for display
//   - The Stripe checkout handler (05-01) for price ID routing
//
// AI cap numbers are AUTHORITATIVE from docs/cost-and-pricing-analysis.md §5.
// They SUPERSEDE the placeholder numbers in 05-RESEARCH.md.
//
// The `aiCaps` keys align with `ai_usage.purpose` values so the entitlement
// helper can aggregate month-to-date usage directly by purpose:
//   cv_parse       → cvParses
//   match_score    → matchScores
//   search_query_embed → searches
//   spec_transcribe    → specMinutes (minutes, not calls)
//   ad_generate / outreach_draft / dormant_outreach_draft → writingCalls

export const PLANS = {
  starter: {
    label: 'Starter',
    pricePence: 5900, // £59/seat/month
    seats: 3, // maximum seats
    // Default for teams of 1–3. All core recruiting features included.
    aiCaps: {
      matchScores: 300,
      cvParses: 200,
      searches: 1000,
      specMinutes: 30,
      writingCalls: 100,
    },
  },
  pro: {
    label: 'Pro', // recommended / default plan
    pricePence: 8900, // £89/seat/month
    seats: 8, // maximum seats
    aiCaps: {
      matchScores: 800,
      cvParses: 600,
      searches: 5000,
      specMinutes: 120,
      writingCalls: 300,
    },
  },
  scale: {
    label: 'Scale',
    pricePence: 12900, // £129/seat/month
    seats: 99, // effectively unlimited (8+ seat agencies)
    // Caps are 3× Pro across every dimension.
    aiCaps: {
      matchScores: 2400,
      cvParses: 1800,
      searches: 15000,
      specMinutes: 360,
      writingCalls: 900,
    },
  },
} as const

export type PlanKey = keyof typeof PLANS

// Price IDs are resolved from env vars at runtime (not build time) so the
// build succeeds without Stripe configured. Callers must handle the '' case
// (price IDs absent = Stripe not yet set up in this environment).
export const PLAN_PRICE_IDS: Record<PlanKey, string> = {
  starter: process.env.STRIPE_PRICE_STARTER ?? '',
  pro: process.env.STRIPE_PRICE_PRO ?? '',
  scale: process.env.STRIPE_PRICE_SCALE ?? '',
}
