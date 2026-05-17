'use client'

import { useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Input } from '@/components/ui/input'

const DEBOUNCE_MS = 300

export function SearchInput({ placeholder = 'Search clients...' }: { placeholder?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''

  // Local state is initialised once from the URL; subsequent URL changes
  // (router.replace) are driven by our own typing, so a sync effect would
  // create a render loop. If a hard navigation lands on this page with a
  // different ?q=, the component remounts and re-reads the URL — covered.
  const [value, setValue] = useState(urlQuery)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function commit(next: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (next.length > 0) {
      params.set('q', next)
    } else {
      params.delete('q')
    }
    // Reset to page 1 on any query change (D-14).
    params.delete('page')
    const qs = params.toString()
    router.replace(qs.length > 0 ? `${pathname}?${qs}` : pathname)
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    setValue(next)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => commit(next), DEBOUNCE_MS)
  }

  return (
    <Input
      type="search"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full sm:w-64"
      aria-label="Search clients"
    />
  )
}
