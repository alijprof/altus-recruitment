'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

import { AdPanel } from './ad-panel'

// ---------------------------------------------------------------------------
// Plan 03-04 Task D.3 — Client trigger that pairs a "Generate ad" button
// with the AdPanel sheet. Lives as a separate Client Component so the
// jobs/[id]/page.tsx RSC stays a Server Component.
// ---------------------------------------------------------------------------

export function AdPanelTrigger({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Generate ad
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-lg"
        aria-describedby="ad-panel-description"
      >
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold">
            Job ad + inclusivity score
          </SheetTitle>
          <SheetDescription
            id="ad-panel-description"
            className="text-xs font-normal"
          >
            Sonnet generates a markdown ad and an inclusivity score (0-100) in
            one pass. Or paste an existing ad to score it without saving.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <AdPanel jobId={jobId} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
