'use client'

// Quick task 260524-cwd — REPORT-02.
//
// Compact sparkline wrapper. No axes / no grid / no legend — just a thin
// monotone line designed to sit underneath a big-number readout (pipeline
// value card on `/reports/buyer-value`).
//
// `isAnimationActive={false}` because the parent re-renders on every date
// filter change; the default animation flashes on every navigation and is
// distracting in a dashboard context.
//
// MUST be a Client Component and consumed via `dynamic({ ssr: false })`
// (per RESEARCH §Pitfall 2).

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

export type SparklineDatum = { x: string; y: number }

export type SparklineProps = {
  data: Array<SparklineDatum>
  height?: 'h-16' | 'h-20' | 'h-24'
  strokeColor?: string
}

export function Sparkline({
  data,
  height = 'h-20',
  strokeColor = 'hsl(220 70% 55%)',
}: SparklineProps) {
  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Tooltip />
          <Line
            type="monotone"
            dataKey="y"
            stroke={strokeColor}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
