'use client'

import { useSyncExternalStore } from 'react'

import { PipelineBoard } from '@/components/app/pipeline-board'
import { PipelineMobileList } from '@/components/app/pipeline-mobile-list'
import type { GroupedByStage } from '@/lib/db/pipeline-stages'

// VERIFICATION R7: render a SINGLE child (desktop kanban or mobile
// accordion), chosen via window.matchMedia inside useSyncExternalStore.
// NOT the dual-tree Tailwind hidden/block pattern — that would load both
// @dnd-kit AND the Accordion JS in every bundle and inflate page weight.
//
// useSyncExternalStore handles SSR (returns the server snapshot — desktop
// by default) and subscribes to viewport changes on the client without
// the lint rule react-hooks/set-state-in-effect complaining about an
// initial setState inside useEffect.
//
// Acceptable hydration shift: SSR renders desktop. On first client paint
// the snapshot syncs to the real viewport; if the user is on mobile the
// component swaps to the accordion list (a one-frame layout shift,
// expected for Phase 1).

const DESKTOP_MIN_WIDTH = 768
const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getClientSnapshot(): boolean {
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches
}

// SSR snapshot — always desktop. Mobile viewports will swap on hydrate.
function getServerSnapshot(): boolean {
  return true
}

type PipelineShellProps = {
  initial: GroupedByStage
  jobId?: string | null
}

export function PipelineShell({ initial, jobId }: PipelineShellProps) {
  const isDesktop = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)

  if (isDesktop) {
    return <PipelineBoard initial={initial} jobId={jobId} />
  }
  return <PipelineMobileList initial={initial} jobId={jobId} />
}
