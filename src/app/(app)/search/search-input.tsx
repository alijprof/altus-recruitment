'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { Input } from '@/components/ui/input'

// Plan 1 Task 1.2 — debounced URL-driven search input + mode toggle.
//
// Mirrors src/app/(app)/candidates/search-input.tsx. The placeholder text
// is taken verbatim from CONTEXT.md <specifics> — DO NOT shorten it; the
// long example is the whole point ("show recruiters what natural language
// can do").
//
// The mode select is a plain <select> bound to URL state (no React state)
// so deep-linked URLs always render the same results.

const DEBOUNCE_MS = 300

const PLACEHOLDER =
  'e.g. senior Python developer with offshore wind experience in Aberdeen'

export type SearchInputProps = {
  initialQuery?: string
  initialMode?: 'semantic' | 'trigram'
}

export function SearchInput({
  initialQuery = '',
  initialMode = 'semantic',
}: SearchInputProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(initialQuery)
  const [, startTransition] = useTransition()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const apply = (next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    const trimmed = next.trim()
    if (trimmed) params.set('q', trimmed)
    else params.delete('q')
    params.delete('page')
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  const setMode = (nextMode: 'semantic' | 'trigram') => {
    const params = new URLSearchParams(searchParams.toString())
    if (nextMode === 'semantic') params.delete('mode')
    else params.set('mode', nextMode)
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Input
        type="search"
        value={value}
        onChange={(e) => {
          const next = e.target.value
          setValue(next)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => apply(next), DEBOUNCE_MS)
        }}
        placeholder={PLACEHOLDER}
        aria-label="Search candidates"
        className="w-full sm:max-w-xl"
      />
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="sr-only">Search mode</span>
        <select
          value={initialMode}
          onChange={(e) => setMode(e.target.value as 'semantic' | 'trigram')}
          aria-label="Search mode"
          className="border-input bg-background rounded-md border px-2 py-1.5 text-xs"
        >
          <option value="semantic">Semantic</option>
          <option value="trigram">Keyword</option>
        </select>
      </label>
    </div>
  )
}
