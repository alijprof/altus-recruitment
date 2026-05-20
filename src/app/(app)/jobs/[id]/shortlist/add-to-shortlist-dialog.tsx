'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
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

import { searchCandidatesAction } from '@/app/(app)/jobs/[id]/actions'

import { addToShortlistAction } from './actions'

type CandidateOption = {
  id: string
  full_name: string
  current_role_title: string | null
  current_company: string | null
}

type AddToShortlistDialogProps = {
  jobId: string
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/**
 * Add-to-shortlist popover — mirrors AddCandidateForm in the job detail
 * page. Same search_candidates RPC under the hood (re-imported from the
 * sibling actions module so we don't double-define the action).
 */
export function AddToShortlistDialog({ jobId }: AddToShortlistDialogProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  type SearchState =
    | { kind: 'idle' }
    | { kind: 'loading'; q: string }
    | { kind: 'done'; q: string; options: CandidateOption[] }
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const debouncedQuery = useDebounced(query, 250)
  const reqRef = useRef(0)

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- transitioning back to idle on cleared query
      setSearch((prev) => (prev.kind === 'idle' ? prev : { kind: 'idle' }))
      return
    }
    const reqId = ++reqRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- request lifecycle requires loading marker before async fetch
    setSearch({ kind: 'loading', q })
    void searchCandidatesAction(q).then((res) => {
      if (reqRef.current !== reqId) return
      if (!res.ok) {
        setSearch({ kind: 'done', q, options: [] })
        toast.error(res.formError)
        return
      }
      setSearch({ kind: 'done', q, options: res.data })
    })
  }, [debouncedQuery])

  function pick(candidateId: string) {
    setOpen(false)
    setQuery('')
    startTransition(async () => {
      const res = await addToShortlistAction({ jobId, candidateId })
      if (!res.ok) {
        toast.error(res.formError)
        return
      }
      toast.success('Added to shortlist.')
    })
  }

  const options = search.kind === 'done' ? search.options : []
  const isSearching = search.kind === 'loading'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={isPending}>
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
          Add to shortlist
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search candidates…"
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList>
            {query.trim().length < 2 ? (
              <CommandEmpty className="text-muted-foreground p-3 text-xs">
                Type at least 2 characters.
              </CommandEmpty>
            ) : isSearching ? (
              <CommandEmpty className="text-muted-foreground p-3 text-xs">
                Searching…
              </CommandEmpty>
            ) : options.length === 0 ? (
              <CommandEmpty className="text-muted-foreground p-3 text-xs">
                No candidates match.
              </CommandEmpty>
            ) : (
              <CommandGroup heading="Candidates">
                {options.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => pick(c.id)}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm">{c.full_name}</span>
                      {c.current_role_title || c.current_company ? (
                        <span className="text-muted-foreground text-xs">
                          {[c.current_role_title, c.current_company]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
