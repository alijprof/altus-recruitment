'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { Input } from '@/components/ui/input'

export type SearchInputProps = {
  initialQuery?: string
  placeholder?: string
}

// UI-SPEC §1 "do NOT call on every keystroke" — 300ms debounce.
// We hold the input value in local state so the field reads instantly while
// the URL update lags behind. `router.replace` (not push) means search-as-
// you-type doesn't pollute the back-stack. Resets `?page=1` on every
// non-empty change so the user never lands on page 4 of an N=3 result.
//
// Why a hand-rolled debounce instead of use-debounce? RESEARCH §14 pitfalls
// note this is borderline — opting for inline to keep the dep tree small.
const DEBOUNCE_MS = 300

export function SearchInput({
  initialQuery = '',
  placeholder = 'Search candidates...',
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
    params.delete('page') // always reset pagination when the query changes
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  return (
    <Input
      type="search"
      value={value}
      onChange={(e) => {
        const next = e.target.value
        setValue(next)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => apply(next), DEBOUNCE_MS)
      }}
      placeholder={placeholder}
      aria-label="Search candidates"
      className="w-full sm:w-64"
    />
  )
}
