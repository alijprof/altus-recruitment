'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import { addCandidateToJobAction, searchCandidatesAction } from './actions'

type CandidateOption = {
  id: string
  full_name: string
  current_role_title: string | null
  current_company: string | null
}

type AddCandidateFormProps = {
  jobId: string
}

// 250 ms debounce on the search input — search_candidates RPC is cheap but
// hammering it on every keystroke is wasteful. RESEARCH §21 pitfall.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

export function AddCandidateForm({ jobId }: AddCandidateFormProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Combined state machine — fewer setState calls inside the effect (the
  // lint rule react-hooks/set-state-in-effect forbids "useEffect + setState"
  // patterns where they could be unified).
  type SearchState =
    | { kind: 'idle' }
    | { kind: 'loading'; q: string }
    | { kind: 'done'; q: string; options: CandidateOption[] }
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const debouncedQuery = useDebounced(query, 250)
  // Track the latest in-flight request so stale responses don't overwrite
  // newer results (last-write-wins).
  const reqRef = useRef(0)

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (q.length < 2) {
      return // render derives the empty state from `debouncedQuery`.
    }
    const myReq = ++reqRef.current
    let cancelled = false
    // Single setState per effect invocation, batched by React 19 — the only
    // way to avoid the lint rule firing while still showing a "Searching…"
    // affordance.
    void (async () => {
      const res = await searchCandidatesAction(q)
      if (cancelled || reqRef.current !== myReq) return
      setSearch({ kind: 'done', q, options: res.ok ? res.data : [] })
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  const visibleOptions =
    search.kind === 'done' && search.q === debouncedQuery.trim() ? search.options : []
  const isSearching =
    debouncedQuery.trim().length >= 2 &&
    (search.kind !== 'done' || search.q !== debouncedQuery.trim())

  function handleSelect(candidateId: string) {
    startTransition(async () => {
      const res = await addCandidateToJobAction({ jobId, candidateId })
      if (!res.ok) {
        toast.error(res.formError)
        return
      }
      toast.success('Candidate added to pipeline.')
      setOpen(false)
      setQuery('')
      setSearch({ kind: 'idle' })
    })
  }

  const emptyMessage = useMemo(() => {
    if (query.trim().length < 2) return 'Type to search candidates…'
    if (isSearching) return 'Searching…'
    return 'No matching candidates.'
  }, [query, isSearching])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button disabled={isPending}>
          <Plus className="mr-1 size-4" />
          Add candidate to job
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search candidates…"
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {visibleOptions.length > 0 ? (
              <CommandGroup>
                {visibleOptions.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={(v) => handleSelect(v)}
                    disabled={isPending}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{c.full_name}</span>
                      {c.current_role_title || c.current_company ? (
                        <span className="text-muted-foreground truncate text-xs font-normal">
                          {c.current_role_title ?? ''}
                          {c.current_role_title && c.current_company ? ' · ' : ''}
                          {c.current_company ?? ''}
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
