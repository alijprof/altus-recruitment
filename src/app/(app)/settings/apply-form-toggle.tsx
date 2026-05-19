'use client'

import { Copy } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

import { toggleApplyFormEnabledAction } from './apply-form-actions'

// Plan 3 Task 3.3 — owner-only apply-form toggle + copy-link button.
//
// We render the slug + a Copy-link button for everyone (read-only) but the
// toggle is gated on `isOwner`. Non-owners see a disabled checkbox with a
// hint text. The action itself ALSO enforces the owner-check server-side
// (R8); the UI guard is UX, not the security gate.

export type ApplyFormToggleProps = {
  slug: string
  initialEnabled: boolean
  isOwner: boolean
}

export function ApplyFormToggle({ slug, initialEnabled, isOwner }: ApplyFormToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  const onToggle = (nextChecked: boolean) => {
    if (!isOwner) {
      toast.error('Only owners can toggle the apply form.')
      return
    }
    // Optimistic update so the checkbox feels responsive; revert on error.
    setEnabled(nextChecked)
    startTransition(async () => {
      const result = await toggleApplyFormEnabledAction(nextChecked)
      if (!result.ok) {
        setEnabled(!nextChecked)
        toast.error(result.formError)
        return
      }
      toast.success(nextChecked ? 'Apply form enabled' : 'Apply form disabled')
    })
  }

  const copyLink = async () => {
    try {
      const url = `${window.location.origin}/apply/${slug}`
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy. Long-press the link to copy it manually.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Public apply link</Label>
        <div className="flex items-center gap-2">
          <code className="bg-muted flex-1 rounded-md px-3 py-2 font-mono text-xs">
            /apply/{slug}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyLink}
            aria-label="Copy public apply link"
          >
            <Copy className="size-3.5" aria-hidden="true" />
            Copy
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Share this link on your careers page or social media. Candidates
          who apply via this link appear in your candidates list with{' '}
          <span className="font-medium">Source: Apply form</span>.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="apply-form-enabled"
          checked={enabled}
          onCheckedChange={(v) => onToggle(v === true)}
          disabled={!isOwner || isPending}
          aria-describedby="apply-form-enabled-help"
        />
        <div className="space-y-1.5 leading-snug">
          <Label htmlFor="apply-form-enabled" className="text-sm font-normal">
            Accept new applications
          </Label>
          <p id="apply-form-enabled-help" className="text-muted-foreground text-xs">
            {isOwner
              ? 'Untick to pause inbound applications. The /apply page will return 404 immediately.'
              : 'Only owners can change this setting.'}
          </p>
        </div>
      </div>
    </div>
  )
}
