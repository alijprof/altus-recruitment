'use client'

import { AlertTriangle } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_LOGO_BYTES } from '@/lib/upload/image-signature'

import { removeOrgLogoAction, uploadOrgLogoAction } from './actions'

// Logo upload widget — BCV-04 (08-06 Task 1).
//
// The ONLY place in the app that writes organizations.logo_storage_path /
// logo_url (see 08-06-PLAN.md <objective> — the general Settings page's
// duplicate field was removed in Task 2 of this same plan).
//
// Behaviour discipline (CLAUDE.md "silent failures" rule + this codebase's
// hard-won lesson): every submit — upload AND remove — resolves to either
// toast.success or toast.error, wrapped in try/catch with console.error.
// Nothing is ever left pending, and the picked file is NEVER cleared on a
// failed upload (the owner should be able to just retry). router.refresh()
// only runs after a CONFIRMED success, so the Server Component page re-reads
// a fresh signed URL from resolveOrgLogoUrl.
//
// Client-side pre-checks (MIME + size) are fast UX feedback only — the
// server (uploadOrgLogoAction → assertUploadableLogo) is the real authority
// and re-sniffs the actual bytes.

export type LogoUploadFieldProps = {
  currentLogoUrl: string | null
  hasUploadedLogo: boolean
  isLegacyUrl: boolean
  isOwner: boolean
}

const ACCEPTED_MIME_TYPES = new Set(['image/png', 'image/jpeg'])

export function LogoUploadField({
  currentLogoUrl,
  hasUploadedLogo,
  isLegacyUrl,
  isOwner,
}: LogoUploadFieldProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [isUploadPending, startUploadTransition] = useTransition()
  const [isRemovePending, startRemoveTransition] = useTransition()
  // Phase 8 review WR-03: Remove is a one-click, permanent destruction of
  // whatever logo pointer is currently set — for a legacy pasted-URL logo,
  // there is no surface anywhere in the app (since 08-06) that can set
  // logo_url again, so a mis-click loses the org's apply-page branding
  // permanently, recoverable only by a manual SQL update. Gate it behind a
  // confirmation, same pattern as CandidateDeleteButton for an equally
  // irreversible act.
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  const resetFileInput = () => {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null
    setClientError(null)
    if (!picked) {
      setFile(null)
      return
    }
    // Client-side pre-checks only — inline error, no server round-trip.
    if (!ACCEPTED_MIME_TYPES.has(picked.type)) {
      setClientError('Please choose a PNG or JPEG file — SVG is not supported.')
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    if (picked.size > MAX_LOGO_BYTES) {
      setClientError('This logo is too large — please upload a file under 2 MB.')
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setFile(picked)
  }

  const handleUpload = () => {
    if (!isOwner || !file) return
    startUploadTransition(async () => {
      try {
        const formData = new FormData()
        formData.set('file', file)
        const result = await uploadOrgLogoAction(formData)
        if (result.ok) {
          toast.success('Logo uploaded')
          resetFileInput()
          router.refresh()
          return
        }
        if ('formError' in result) {
          toast.error(result.formError)
          return
        }
        toast.error('Could not upload the logo. Please try again.')
      } catch (err) {
        console.error('Logo upload failed:', err)
        toast.error(err instanceof Error ? err.message : "Couldn't upload the logo")
        // Do NOT clear the picked file on failure — let the owner retry.
      }
    })
  }

  const confirmRemove = () => {
    if (!isOwner) return
    startRemoveTransition(async () => {
      try {
        const result = await removeOrgLogoAction()
        if (result.ok) {
          toast.success('Logo removed')
          resetFileInput()
          setIsConfirmOpen(false)
          router.refresh()
          return
        }
        if ('formError' in result) {
          toast.error(result.formError)
          return
        }
        toast.error('Could not remove the logo. Please try again.')
      } catch (err) {
        console.error('Logo remove failed:', err)
        toast.error(err instanceof Error ? err.message : "Couldn't remove the logo")
        // Do NOT close the dialog on failure — let the owner retry or cancel.
      }
    })
  }

  const isPending = isUploadPending || isRemovePending
  const hasAnyLogo = Boolean(currentLogoUrl)

  return (
    <div className="space-y-3">
      <Label>Logo</Label>

      <div className="flex items-center gap-4">
        <div className="flex h-16 w-32 flex-shrink-0 items-center justify-center rounded border bg-white">
          {currentLogoUrl ? (
            <Image
              src={currentLogoUrl}
              alt="Organisation logo preview"
              width={160}
              height={48}
              unoptimized
              className="max-h-12 w-auto object-contain"
            />
          ) : (
            <span className="text-muted-foreground text-xs">No logo yet</span>
          )}
        </div>

        {isOwner && hasAnyLogo ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsConfirmOpen(true)}
            disabled={isPending}
          >
            {isRemovePending ? 'Removing…' : 'Remove'}
          </Button>
        ) : null}
      </div>

      <AlertDialog
        open={isConfirmOpen}
        onOpenChange={(next) => {
          if (!next && !isRemovePending) setIsConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your logo?</AlertDialogTitle>
            <AlertDialogDescription>
              {isLegacyUrl
                ? "This will clear the logo URL you pasted previously — it can't be restored " +
                  'from here. Your apply page and branded CVs will show your organisation name ' +
                  'instead until you upload a new logo file.'
                : "This clears your logo from the apply page and future branded CVs. It can't " +
                  'be undone from here — you can always upload a new file afterwards.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemovePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemovePending}
              onClick={(e) => {
                e.preventDefault()
                confirmRemove()
              }}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {isRemovePending ? 'Removing…' : 'Remove logo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isOwner ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFileChange}
              disabled={isPending}
              aria-label="Logo file"
              className="text-xs file:text-xs"
            />
            <Button
              type="button"
              size="sm"
              onClick={handleUpload}
              disabled={!file || isPending}
              className="h-11 shrink-0 md:h-9"
            >
              {isUploadPending ? 'Uploading…' : 'Upload logo'}
            </Button>
          </div>
          {clientError ? (
            <p role="alert" className="text-destructive text-xs font-normal">
              {clientError}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs font-normal">
              PNG or JPEG, up to 2 MB. A wide, landscape logo works best. SVG isn&apos;t supported —
              it can&apos;t be embedded in the branded PDF.
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Only owners can change the logo.</p>
      )}

      {isLegacyUrl && !hasUploadedLogo ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle
            className="mt-0.5 size-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p>
            This logo is a pasted external URL — it still appears on your apply page, but it will{' '}
            <strong className="font-semibold">not</strong> appear on branded CVs until you upload a
            file here.
          </p>
        </div>
      ) : null}
    </div>
  )
}
