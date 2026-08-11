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

// A rendered chip: the text to show, a key that is unique among siblings,
// and the lowercased form used to match every stored entry it stands for.
type Chip = { value: string; lower: string; key: string }

/**
 * WR-05 (review 2026-08-11) — the DISPLAY set, deduped case-insensitively.
 *
 * mergeTags stops the component ever ADDING a duplicate, but `value` comes
 * straight from `candidates.skills`, and nothing dedupes on write:
 * coerceStringArray only drops non-strings and blanks, and the LinkedIn
 * ingest writes the scraped array verbatim. Claude returning
 * `["React","React"]` is entirely ordinary. Rendering that raw produced a
 * React duplicate-key warning (chips were keyed by their own text) and,
 * worse, clicking one chip's X removed BOTH copies — then CR-01's array
 * write persisted the result.
 *
 * Blank entries are dropped from the display too; the edit schema's
 * tagArraySchema already drops them on submit, so showing an empty chip
 * would only offer a control for something that is not saved anyway.
 */
function toChips(value: string[]): Chip[] {
  const seen = new Set<string>()
  const chips: Chip[] = []
  value.forEach((raw, index) => {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return
    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) return
    seen.add(lower)
    // Index-based key: unique by construction (each index appears once) and
    // free of the collision the old `key={tag}` had. Badges hold no state,
    // so the remount when an earlier chip is removed costs nothing.
    chips.push({ value: trimmed, lower, key: `${index}-${lower}` })
  })
  return chips
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
  const chips = React.useMemo(() => toChips(value), [value])

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
    if (e.key === 'Backspace' && draft.length === 0 && chips.length > 0) {
      // Remove the last CHIP, not the last stored entry — with a stored
      // duplicate those are not the same thing, and slicing the raw array
      // would leave the chip on screen looking unresponsive.
      const lastChip = chips[chips.length - 1]
      if (lastChip) removeChip(lastChip)
    }
  }

  // Removes every stored entry the chip stands for. A chip is the ONLY
  // control for its value, so leaving a hidden case-insensitive duplicate
  // behind would make the chip reappear after a click that visibly removed
  // it. Exactly one chip disappears per click, which is the contract.
  function removeChip(chip: Chip) {
    onChange(value.filter((v) => v.trim().toLowerCase() !== chip.lower))
  }

  return (
    <div className="space-y-2">
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge
              key={chip.key}
              variant="secondary"
              className="gap-1 py-1 pr-1 text-xs font-normal"
            >
              {chip.value}
              <button
                type="button"
                onClick={() => removeChip(chip)}
                aria-label={`Remove ${chip.value}`}
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
