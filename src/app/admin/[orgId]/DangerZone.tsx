'use client'

// src/app/admin/[orgId]/DangerZone.tsx — Batch B item 6 UI.
//
// Two controls for a super-admin on the per-org page:
//   • Export org data — a plain download link to the export route handler.
//   • Erase organisation — IRREVERSIBLE. Guarded by type-the-slug-to-confirm
//     PLUS a final AlertDialog. Surfaces success/error via toast (CLAUDE.md
//     mutation rule — never a silent success). On success the org no longer
//     exists, so we navigate back to the admin list.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { eraseOrganizationAction } from '../actions'

export function DangerZone({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter()
  const [confirmation, setConfirmation] = useState('')
  const [isPending, startTransition] = useTransition()

  const matches = confirmation.trim() === orgSlug

  function handleErase() {
    startTransition(async () => {
      const result = await eraseOrganizationAction(orgId, confirmation.trim())
      if (result.ok) {
        toast.success(result.message)
        router.push('/admin')
        router.refresh()
        return
      }
      toast.error(result.error)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Export organisation data</p>
          <p className="text-xs text-slate-500">
            Download a JSON dump of this org&apos;s records + a file manifest (for GDPR portability,
            before erasing).
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          {/* Plain link — the route returns the JSON as a file attachment. */}
          <a href={`/admin/${orgId}/export`}>Export data (JSON)</a>
        </Button>
      </div>

      <div className="rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-700">Erase organisation</p>
        <p className="mt-1 text-xs text-red-700/90">
          Permanently deletes this org&apos;s files, users, and all data. This cannot be undone.
          Export first. Cancel any Stripe subscription before erasing.
        </p>
        <div className="mt-3 space-y-2">
          <label className="text-xs font-medium text-slate-700" htmlFor="erase-confirm">
            Type the org slug{' '}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-red-700">{orgSlug}</code> to
            confirm
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="erase-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={orgSlug}
              autoComplete="off"
              className="max-w-xs bg-white"
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  disabled={!matches || isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isPending ? 'Erasing…' : 'Erase organisation'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Erase this organisation?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes <span className="font-medium">{orgSlug}</span> — every
                    file, user, candidate, job and record. There is no undo and no recovery. Make
                    sure you have exported the data first.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleErase}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Erase permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  )
}
