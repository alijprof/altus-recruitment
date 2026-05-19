import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ClientRow } from '@/lib/db/clients'

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function ClientTable({ rows }: { rows: ClientRow[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-muted-foreground text-xs font-normal">Name</TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">Industry</TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">Status</TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">
              Last contacted
            </TableHead>
            <TableHead className="text-muted-foreground text-xs font-normal">Open jobs</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="group hover:bg-accent/30 transition-colors"
            >
              <TableCell className="font-medium">
                <Link
                  href={`/clients/${row.id}`}
                  className="group-hover:text-foreground hover:underline"
                >
                  {row.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {row.industry ?? '—'}
              </TableCell>
              <TableCell>
                {row.dormant ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-xs font-normal text-amber-700 dark:text-amber-300"
                  >
                    Dormant
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs font-normal">
                    Active
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatDate(row.last_contacted_at)}
              </TableCell>
              <TableCell className="text-sm">{row.active_jobs_count}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${row.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/clients/${row.id}`}>View</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/clients/${row.id}/edit`}>Edit</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
