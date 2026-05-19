'use client'

import { Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { submitSpecCallAction } from './actions'

type SpecUploadFormProps = {
  // Optional list of {id, name} for the client picker. Wired by the server
  // page so this client component stays free of DB calls.
  clients: Array<{ id: string; name: string }>
}

export function SpecUploadForm({ clients }: SpecUploadFormProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [companyId, setCompanyId] = useState<string>('')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!file) return
    startTransition(async () => {
      const fd = new FormData()
      fd.append('audio', file)
      if (companyId) fd.append('company_id', companyId)
      const result = await submitSpecCallAction(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Audio uploaded — transcribing…')
      router.push(`/spec/${result.draftId}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="spec-audio">Audio recording</Label>
        <Input
          id="spec-audio"
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={isPending}
          aria-describedby="spec-audio-hint"
          className="text-xs file:text-xs"
        />
        <p id="spec-audio-hint" className="text-muted-foreground text-xs font-normal">
          MP3, M4A, WAV, or WebM. Up to 100 MiB, max 60 minutes.
        </p>
      </div>

      {clients.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="spec-company">Client (optional)</Label>
          {/* Native select keeps the form simple — shadcn Select is async
              and we want the option list to render immediately. */}
          <select
            id="spec-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={isPending}
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            <option value="">— Not yet linked —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <Button type="submit" disabled={!file || isPending} className="w-full">
        <Upload className="size-4" aria-hidden />
        {isPending ? 'Uploading…' : 'Upload & transcribe'}
      </Button>

      {file ? (
        <p className="text-muted-foreground text-xs font-normal">
          Ready to upload <span className="font-mono">{file.name}</span> (
          {(file.size / 1024 / 1024).toFixed(1)} MB)
        </p>
      ) : null}
    </form>
  )
}
