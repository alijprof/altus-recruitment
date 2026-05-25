'use client'

// Quick task 260525-ucn — Next 15+ disallows `dynamic({ ssr: false })` from
// Server Components. This Client Component owns the dynamic imports for the
// three Recharts wrappers used by `/reports/buyer-value/page.tsx` so the
// Server Component can stay free of `next/dynamic`. Each loading placeholder
// matches the eventual chart parent height (h-72 for StackedBar /
// HorizontalBar, h-20 for Sparkline) to prevent CLS.

import dynamic from 'next/dynamic'

const StackedBar = dynamic(
  () => import('@/components/charts/stacked-bar').then((m) => m.StackedBar),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" />
    ),
  },
)

const HorizontalBar = dynamic(
  () => import('@/components/charts/horizontal-bar').then((m) => m.HorizontalBar),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" />
    ),
  },
)

const Sparkline = dynamic(
  () => import('@/components/charts/sparkline').then((m) => m.Sparkline),
  {
    ssr: false,
    loading: () => (
      <div className="h-20 w-full animate-pulse rounded-md bg-muted/40" />
    ),
  },
)

export { StackedBar, HorizontalBar, Sparkline }
