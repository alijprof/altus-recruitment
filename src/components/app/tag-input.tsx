'use client'

// Dependency-free chip input over Input + Badge for text[] fields (skills,
// sector_tags). Controlled: the caller owns `value`/`onChange`, this
// component only owns the in-progress draft string typed into the visible
// Input. See 07-04-PLAN.md Task 1 for the full behavior spec.

import * as React from 'react'
import { X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export type TagInputProps = {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

// Trim + drop blanks + dedupe case-insensitively (first-seen casing wins),
// merging `additions` into `current`. Returns the same array reference when
// nothing actually changed, so callers can skip a no-op onChange.
function mergeTags(current: string[], additions: string[]): string[] {
  let next = current
  let changed = false
  for (const raw of additions) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const exists = next.some((v) => v.toLowerCase() === trimmed.toLowerCase())
    if (exists) continue
    next = [...next, trimmed]
    changed = true
  }
  return changed ? next : current
}

export function TagInput({
  value,
  onChange,
  placeholder,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: TagInputProps) {
  const [draft, setDraft] = React.useState('')

  // Comma handling lives in onChange (not onKeyDown) because the comma
  // character isn't present in the input's committed value yet at keydown
  // time for a controlled input — onChange fires after the browser has
  // already inserted it, so splitting there sees the real string.
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (!raw.includes(',')) {
      setDraft(raw)
      return
    }
    const parts = raw.split(',')
    const remainder = parts.pop() ?? ''
    const next = mergeTags(value, parts)
    if (next !== value) onChange(next)
    setDraft(remainder)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // Prevent this Input from submitting the surrounding candidate-edit
      // form — Enter here means "commit this tag", not "save the form".
      e.preventDefault()
      if (draft.trim().length === 0) return
      const next = mergeTags(value, [draft])
      if (next !== value) onChange(next)
      setDraft('')
      return
    }
    if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  function removeTag(tag: string) {
    onChange(value.filter((v) => v !== tag))
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 py-1 pr-1 text-xs font-normal">
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove ${tag}`}
                className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Input
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    </div>
  )
}
