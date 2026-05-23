'use client'

import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { deleteSpecDraftAction } from './actions'

type Props = {
  draftId: string
  title: string
}

export function SpecDeleteButton({ draftId, title }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const onClick = () => {
    startTransition(async () => {
      const result = await deleteSpecDraftAction({ specDraftId: draftId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Draft deleted.')
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Delete ${title}`}
      disabled={isPending}
      onClick={onClick}
      className="text-muted-foreground hover:text-destructive size-8"
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  )
}
