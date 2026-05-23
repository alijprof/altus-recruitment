'use client'

import { Mic, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

// In-browser recorder for spec calls. Records to a Blob via MediaRecorder,
// hands it back as a File so the existing upload action treats it the same
// as a file-picker upload. Works on desktop Chrome/Firefox/Edge (webm/opus)
// and iOS Safari 14.3+ (mp4/aac) — both already in the server allow-list.

const HARD_CAP_MS = 60 * 60_000 // 60 minutes

type State =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'recording'; startedAt: number; elapsed: number }
  | { kind: 'preview'; file: File; durationMs: number; url: string }
  | { kind: 'unsupported' }
  | { kind: 'denied' }

type MicRecorderProps = {
  disabled: boolean
  // Notify the parent whenever the active recording changes. `null` clears
  // the parent's file slot (so a re-record doesn't leave the old File
  // selected).
  onRecording: (file: File | null) => void
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function MicRecorder({ disabled, onRecording }: MicRecorderProps) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef<number>(0)

  // Detect support once on mount.
  useEffect(() => {
    if (typeof MediaRecorder === 'undefined' || pickMime() === '') {
      setState({ kind: 'unsupported' })
    }
  }, [])

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
  }

  const start = async () => {
    setState({ kind: 'requesting' })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      mediaRecorderRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        // Strip codec params so the file's MIME matches the server allow-list
        // verbatim (e.g., 'audio/webm;codecs=opus' → 'audio/webm').
        const baseType = (rec.mimeType || mime || 'audio/webm').split(';')[0] || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: baseType })
        const ext = baseType === 'audio/mp4' ? 'm4a' : 'webm'
        const file = new File([blob], `spec-recording.${ext}`, { type: baseType })
        const durationMs = Date.now() - startedAtRef.current
        const url = URL.createObjectURL(blob)
        setState({ kind: 'preview', file, durationMs, url })
        onRecording(file)
        cleanup()
      }
      startedAtRef.current = Date.now()
      rec.start()
      setState({ kind: 'recording', startedAt: startedAtRef.current, elapsed: 0 })
    } catch (err) {
      cleanup()
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setState({ kind: 'denied' })
      } else {
        setState({ kind: 'idle' })
      }
    }
  }

  const stop = () => {
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  const reset = () => {
    if (state.kind === 'preview') URL.revokeObjectURL(state.url)
    onRecording(null)
    setState({ kind: 'idle' })
  }

  // Tick the elapsed counter while recording. Stops naturally when state
  // transitions out of 'recording'.
  useEffect(() => {
    if (state.kind !== 'recording') return
    const id = window.setInterval(() => {
      setState((s) => {
        if (s.kind !== 'recording') return s
        const elapsed = Date.now() - s.startedAt
        if (elapsed >= HARD_CAP_MS) {
          // Hit the 60-minute cap — stop. The rec.onstop handler will
          // transition to 'preview'.
          stop()
          return s
        }
        return { ...s, elapsed }
      })
    }, 250)
    return () => window.clearInterval(id)
  }, [state.kind])

  // Cleanup on unmount — stop any active recording + revoke any preview URL.
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop()
        } catch {
          // Best effort — already stopping or invalid state.
        }
      }
      cleanup()
    }
  }, [])

  if (state.kind === 'unsupported') {
    return (
      <p className="text-muted-foreground text-xs font-normal">
        Browser microphone recording isn&apos;t available — please upload a file below.
      </p>
    )
  }

  if (state.kind === 'denied') {
    return (
      <div className="space-y-2">
        <p className="text-destructive text-xs font-normal">
          Microphone permission denied. Enable it in your browser settings and refresh, or use the file upload below.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setState({ kind: 'idle' })}>
          Try again
        </Button>
      </div>
    )
  }

  if (state.kind === 'preview') {
    return (
      <div className="bg-muted/40 space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Recording captured</p>
            <p className="text-muted-foreground text-xs font-normal">
              {formatElapsed(state.durationMs)} · {(state.file.size / 1024).toFixed(0)} KB
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={disabled}
            aria-label="Discard and re-record"
          >
            <Trash2 className="size-4" aria-hidden />
            Re-record
          </Button>
        </div>
        <audio src={state.url} controls className="w-full" />
      </div>
    )
  }

  if (state.kind === 'recording') {
    return (
      <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-2 animate-pulse rounded-full bg-red-500"
            aria-hidden
          />
          <span className="text-sm font-medium">Recording…</span>
          <span className="text-muted-foreground font-mono text-sm">
            {formatElapsed(state.elapsed)}
          </span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={stop} disabled={disabled}>
          <Square className="size-4" aria-hidden />
          Stop
        </Button>
      </div>
    )
  }

  // idle or requesting
  return (
    <Button
      type="button"
      variant="outline"
      onClick={start}
      disabled={disabled || state.kind === 'requesting'}
      className="w-full"
    >
      <Mic className="size-4" aria-hidden />
      {state.kind === 'requesting' ? 'Requesting microphone…' : 'Record this spec call'}
    </Button>
  )
}
