'use client'

// Generic add/remove row editor driven by a field spec, used by both
// work_experience {title, company, dates} and education {school, degree,
// dates} on the candidate edit form — one component instead of two
// near-identical editors. See 07-04-PLAN.md Task 1 for the spec.

import * as React from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type RepeatingRowField = {
  key: string
  label: string
  placeholder?: string
  required?: boolean
}

export type RepeatingRowsProps = {
  value: Record<string, string>[]
  onChange: (next: Record<string, string>[]) => void
  fields: readonly RepeatingRowField[]
  addLabel: string
  // Used to build accessible names: "{rowLabel} 1", "Remove {rowLabel} 1".
  rowLabel: string
}

export function RepeatingRows({ value, onChange, fields, addLabel, rowLabel }: RepeatingRowsProps) {
  function updateCell(rowIndex: number, key: string, next: string) {
    onChange(value.map((row, i) => (i === rowIndex ? { ...row, [key]: next } : row)))
  }

  function removeRow(rowIndex: number) {
    onChange(value.filter((_, i) => i !== rowIndex))
  }

  function addRow() {
    const blank = Object.fromEntries(fields.map((f) => [f.key, ''] as const))
    onChange([...value, blank])
  }

  return (
    <div className="space-y-3">
      {value.map((row, rowIndex) => {
        const rowNumber = rowIndex + 1
        const rowName = `${rowLabel} ${rowNumber}`
        return (
          <div
            key={rowIndex}
            role="group"
            aria-label={rowName}
            className="bg-background space-y-2 rounded-md border p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">{rowName}</span>
              <button
                type="button"
                onClick={() => removeRow(rowIndex)}
                aria-label={`Remove ${rowName}`}
                className="text-muted-foreground hover:text-destructive rounded-sm p-1"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {fields.map((f) => {
                const inputId = `${rowLabel}-${rowIndex}-${f.key}`
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                return (
                  <div key={f.key} className="space-y-1">
                    <Label htmlFor={inputId} className="text-muted-foreground text-xs font-normal">
                      {f.label}
                    </Label>
                    <Input
                      id={inputId}
                      value={row[f.key] ?? ''}
                      placeholder={f.placeholder}
                      required={f.required}
                      onChange={(e) => updateCell(rowIndex, f.key, e.target.value)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        {addLabel}
      </Button>
    </div>
  )
}
