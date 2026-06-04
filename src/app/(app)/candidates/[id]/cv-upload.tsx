'use client'

import { Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { uploadCVAction } from './actions'

type CvUploadProps = {
  candidateId: string
}

export function CvUpload({ candidateId }: CvUploadProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!file) return

    startTransition(async () => {
      const formData = new FormData()
      formData.append('candidateId', candidateId)
      formData.append('file', file)
      const result = await uploadCVAction(formData)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('CV uploaded — parsing…')
      reset()
      // Refresh so the review panel (PendingState → CompleteState) appears
      // without a manual reload.
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={isPending}
          aria-label="CV file"
          className="text-xs file:text-xs"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!file || isPending}
          className="h-11 shrink-0 md:h-9"
        >
          <Upload className="size-4" aria-hidden />
          {isPending ? 'Uploading…' : 'Upload CV'}
        </Button>
      </div>
      {file ? (
        <p className="text-muted-foreground text-xs font-normal">
          Ready to upload <span className="font-mono">{file.name}</span> (
          {(file.size / 1024).toFixed(0)} KB)
        </p>
      ) : (
        <p className="text-muted-foreground text-xs font-normal">
          PDF or DOCX, up to 10 MiB.
        </p>
      )}
    </form>
  )
}
