'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Filter } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type PipelineFiltersProps = {
  owners: { id: string; label: string }[]
  jobs: { id: string; label: string }[]
  clients: { id: string; label: string }[]
}

const ALL = '__all__'

// D-12: URL search params drive the filters. Selecting a value writes a
// query string and the RSC re-renders.
export function PipelineFilters({ owners, jobs, clients }: PipelineFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const owner = searchParams.get('owner') ?? ''
  const job = searchParams.get('job') ?? ''
  const client = searchParams.get('client') ?? ''
  const activeCount = [owner, job, client].filter(Boolean).length

  function setParam(key: 'owner' | 'job' | 'client', value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === '' || value === ALL) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    startTransition(() => {
      router.push(`/pipeline?${params.toString()}`)
    })
  }

  function clearAll() {
    startTransition(() => {
      router.push('/pipeline')
    })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          <Filter className="mr-1 size-4" />
          Filters
          {activeCount > 0 ? (
            <span className="bg-primary text-primary-foreground ml-2 rounded-full px-1.5 text-xs font-normal">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="filter-owner">Owner</Label>
          <Select value={owner || ALL} onValueChange={(v) => setParam('owner', v)}>
            <SelectTrigger id="filter-owner">
              <SelectValue placeholder="All owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All owners</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-job">Job</Label>
          <Select value={job || ALL} onValueChange={(v) => setParam('job', v)}>
            <SelectTrigger id="filter-job">
              <SelectValue placeholder="All jobs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All jobs</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="filter-client">Client</Label>
          <Select value={client || ALL} onValueChange={(v) => setParam('client', v)}>
            <SelectTrigger id="filter-client">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAll} className="w-full">
            Clear filters
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
