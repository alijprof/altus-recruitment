'use client'

import { Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { MicRecorder } from '@/app/(app)/spec/new/mic-recorder'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { submitVoiceNoteAction } from './actions'

type VoiceNoteFormProps = {
  candidateId: string
}

export function VoiceNoteForm({ candidateId }: VoiceNoteFormProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!file) return
    startTransition(async () => {
      const fd = new FormData()
      fd.append('audio', file)
      fd.append('candidate_id', candidateId)
      const result = await submitVoiceNoteAction(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Recording uploaded — processing…')
      router.push(`/candidates/${candidateId}/voice-notes/${result.voiceNoteId}/review`)
    })
  }

  // Clear the file input when the recorder takes over (and vice versa), so
  // the "Ready to upload" hint reflects which source the submit will use.
  const onRecordingChange = (next: File | null) => {
    if (next && inputRef.current) inputRef.current.value = ''
    setFile(next)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label>Start voice note</Label>
        <MicRecorder disabled={isPending} onRecording={onRecordingChange} />
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <span className="border-border w-full border-t" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card text-muted-foreground px-2 text-xs font-normal uppercase">
            or
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="voice-audio">Or upload an audio file</Label>
        <Input
          id="voice-audio"
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={isPending}
          aria-describedby="voice-audio-hint"
          className="text-xs file:text-xs"
        />
        <p id="voice-audio-hint" className="text-muted-foreground text-xs font-normal">
          MP3, M4A, WAV, or WebM. Up to 100 MiB.
        </p>
      </div>

      <Button type="submit" disabled={!file || isPending} className="w-full">
        <Upload className="size-4" aria-hidden />
        {isPending ? 'Uploading…' : 'Submit for processing'}
      </Button>

      {isPending ? (
        <p role="status" aria-live="polite" className="text-muted-foreground text-sm">
          Processing your note… this usually takes under 30 seconds.
        </p>
      ) : null}

      {file && !isPending ? (
        <p className="text-muted-foreground text-xs font-normal">
          Ready to upload <span className="font-mono">{file.name}</span> (
          {(file.size / 1024 / 1024).toFixed(1)} MB)
        </p>
      ) : null}
    </form>
  )
}
