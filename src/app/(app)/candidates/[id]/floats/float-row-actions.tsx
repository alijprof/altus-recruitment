'use client'

import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { removeApplicationAction } from '@/app/(app)/jobs/[id]/actions'

// Per-row delete on the candidate floats list. Reuses removeApplicationAction
// because a float IS an application (application_type='float',
// job_id IS NULL). Hard-deletes the junction row + writes an audit_log
// entry inside the action.

type Props = {
  applicationId: string
}

export function FloatRowActions({ applicationId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const onDelete = () => {
    if (!window.confirm('Remove this float? The candidate record is not affected.')) {
      return
    }
    startTransition(async () => {
      const res = await removeApplicationAction({
        applicationId,
        // jobId intentionally null — floats have no job.
        jobId: null,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Float removed.')
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Remove float"
      disabled={isPending}
      onClick={onDelete}
      className="text-muted-foreground hover:text-destructive size-8"
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  )
}
