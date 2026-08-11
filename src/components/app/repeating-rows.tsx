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
  // WR-06 (review 2026-08-11): a MARKER, never the native `required`
  // attribute. workExperienceArraySchema/educationArraySchema deliberately
  // DROP rows with a blank title/school ("there is nothing to save, not an
  // error to surface"), but rendering `required` on the input handed the
  // decision to the browser's constraint validation, which blocks submit
  // before react-hook-form or zod ever runs. A recruiter who clicked "Add
  // work history", changed their mind and pressed Save got a native "Please
  // fill out this field" bubble on a control they considered empty on
  // purpose — and the documented drop behaviour was unreachable whenever
  // the section was open. This now only drives a visual hint.
  required?: boolean
}

export type RepeatingRowsProps = {
  value: Record<string, string>[]
  onChange: (next: Record<string, string>[]) => void
  fields: readonly RepeatingRowField[]
  addLabel: string
  // Used to build accessible names: "{rowLabel} 1", "Remove {rowLabel} 1".
  rowLabel: string
  // WR-11: shadcn's <FormControl> injects these three into its child via
  // Slot. TagInput accepts and forwards all three; this component declared
  // none, so they were silently dropped — the FormLabel's htmlFor pointed at
  // an id that existed nowhere, and FormMessage was never announced for
  // work_experience/education errors. Same prop shape as TagInput.
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export function RepeatingRows({
  value,
  onChange,
  fields,
  addLabel,
  rowLabel,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: RepeatingRowsProps) {
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
    // The group container carries the FormControl-injected props so the
    // FormLabel above it has something real to point at and FormMessage is
    // announced. aria-label mirrors the visible FormLabel text, which is
    // what a screen-reader user hears on entering the group.
    <div
      id={id}
      role="group"
      aria-label={rowLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className="space-y-3"
    >
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
                    <div className="flex items-center gap-1">
                      <Label
                        htmlFor={inputId}
                        className="text-muted-foreground text-xs font-normal"
                      >
                        {f.label}
                      </Label>
                      {f.required ? (
                        // Hint only, and a SIBLING of the Label rather than
                        // a child so the label's text — and therefore the
                        // input's accessible name — stays exactly "Title" /
                        // "School". The field is not `required` in the
                        // constraint-validation sense; it is the field that
                        // decides whether the row is KEPT.
                        <span
                          aria-hidden="true"
                          title={`Rows with no ${f.label.toLowerCase()} are discarded when you save`}
                          className="text-muted-foreground text-xs"
                        >
                          *
                        </span>
                      ) : null}
                    </div>
                    <Input
                      id={inputId}
                      value={row[f.key] ?? ''}
                      placeholder={f.placeholder}
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
