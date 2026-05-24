'use client'

// Quick task 260524-cwd — REPORT-02.
//
// Generic horizontal-bar Recharts wrapper. Takes a list of
// `{ label, median, p90 }` rows and renders two bars per row (median +
// 90th percentile) — designed for the `/reports/buyer-value`
// "Time-to-fill by sector" card.
//
// Layout="vertical" swaps the Recharts axes: XAxis becomes the numeric scale
// and YAxis becomes the categorical label axis. width={120} on YAxis gives
// label text room to render at common viewport widths.
//
// MUST be a Client Component and consumed via `dynamic({ ssr: false })`
// (per RESEARCH §Pitfall 2).

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

export type HorizontalBarDatum = {
  label: string
  median: number
  p90: number
}

export type HorizontalBarProps = {
  data: Array<HorizontalBarDatum>
  height?: 'h-64' | 'h-72' | 'h-80'
}

export function HorizontalBar({ data, height = 'h-72' }: HorizontalBarProps) {
  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis dataKey="label" type="category" width={120} />
          <Tooltip />
          <Legend />
          <Bar dataKey="median" fill="hsl(220 70% 55%)" name="Median days" />
          <Bar dataKey="p90" fill="hsl(280 70% 55%)" name="p90 days" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
