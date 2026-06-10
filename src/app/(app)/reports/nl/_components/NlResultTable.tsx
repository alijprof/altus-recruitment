'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Plan 04-07 Task 2 — NL result table.
//
// Dynamic-column Table: headers from first row keys (sentence-cased).
// Numeric values right-aligned with tabular-nums.
// Wrapped in overflow-x-auto — column count is dynamic, must scroll not truncate.
// ---------------------------------------------------------------------------

type NlResultTableProps = {
  rows: Record<string, unknown>[]
}

/** Convert snake_case / camelCase / kebab-case column name to sentence case. */
function toSentenceCase(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** Return true if the value looks numeric (number, or string that parses as float). */
function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return true
  if (typeof value === 'string') {
    const n = Number(value)
    return !isNaN(n) && value.trim() !== ''
  }
  return false
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function NlResultTable({ rows }: NlResultTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No data returned for this query.</p>
    )
  }

  const firstRow = rows[0]
  if (!firstRow) return null

  const columns = Object.keys(firstRow)

  // Determine which columns are numeric (check first row's value)
  const numericColumns = new Set(
    columns.filter((col) => isNumericValue(firstRow[col])),
  )

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col}
                className={numericColumns.has(col) ? 'text-right tabular-nums' : undefined}
              >
                {toSentenceCase(col)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell
                  key={col}
                  className={numericColumns.has(col) ? 'text-right tabular-nums' : undefined}
                >
                  {formatCell(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
