'use client'

// Quick task 260524-cwd — REPORT-02.
//
// Generic stacked-bar Recharts wrapper. Presentational only — takes already
// shaped data + a key list and renders one stacked Bar per key. Used by the
// `/reports/buyer-value` "Placements per recruiter per quarter" card.
//
// IMPORTANT: must be a Client Component and consumed via
// `dynamic({ ssr: false })` from the RSC page — Recharts' ResponsiveContainer
// reads DOM measurements at render time, which produces a hydration mismatch
// when rendered server-side (per RESEARCH §Pitfall 2).
//
// The wrapper enforces an explicit-height parent via the `height` prop so
// ResponsiveContainer always has a non-zero box to fill (per RESEARCH §Pitfall 1).

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type StackedBarDatum = { category: string } & Record<string, string | number>

export type StackedBarProps = {
  data: Array<StackedBarDatum>
  keys: string[]
  categoryKey?: string
  height?: 'h-64' | 'h-72' | 'h-80'
}

export function StackedBar({
  data,
  keys,
  categoryKey = 'category',
  height = 'h-72',
}: StackedBarProps) {
  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={categoryKey} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {keys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="a"
              fill={`hsl(${(i * 53) % 360} 70% 55%)`}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
